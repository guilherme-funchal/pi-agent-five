import "dotenv/config";
import { config } from "./config.js";
import { log } from "./logger.js";
import { PiRpc } from "./pi-rpc.js";
import { Notifier } from "./notifier.js";
import { Gateway } from "./gateway.js";
import { startTelegram } from "./telegram.js";
import { startDiscord } from "./discord.js";
import { startHttp } from "./http.js";
import { makeAllSchedulesShared } from "./schedule-store.js";
import { checkModelEndpoint } from "./model-health.js";

const pi = new PiRpc(config.pi);
const notifier = new Notifier(config);
const gateway = new Gateway(pi, notifier, config);

await checkModelEndpoint(config.pi.baseUrl);
const http = startHttp(config, gateway, pi);

let telegram = null;
let discord = null;

try {
  // Só abre Telegram/Discord depois que o subprocesso respondeu ao get_state.
  // Isso impede mensagens de chegarem enquanto o stdin do RPC ainda não existe.
  await pi.start();

  [telegram, discord] = await Promise.all([
    startTelegram(config, gateway, notifier),
    startDiscord(config, gateway, notifier)
  ]);
  await makeAllSchedulesShared();

  // Atualiza o estado RPC para diagnóstico, sem bloquear a inicialização.
  setTimeout(() => {
    pi.getState().catch((error) => log.warn("Não foi possível consultar o estado Pi", { error: error.message }));
  }, 3000).unref();

  const notificationStatus = notifier.status();
  if (telegram && notificationStatus.telegram.configuredTargets.length === 0) {
    log.warn("Telegram conectado sem destino fixo para notificações", {
      hint: "Defina TELEGRAM_NOTIFY_CHAT_IDS ou TELEGRAM_ALLOWED_CHAT_IDS"
    });
  }
  if (discord && notificationStatus.discord.configuredTargets.length === 0) {
    log.warn("Discord conectado sem canal fixo para notificações", {
      hint: "Defina DISCORD_NOTIFY_CHANNEL_IDS ou DISCORD_ALLOWED_CHANNEL_IDS"
    });
  }

  log.info("Aplicação pronta", {
    agentId: config.agentId,
    telegram: Boolean(telegram),
    discord: Boolean(discord),
    telegramNotifyTargets: notificationStatus.telegram.configuredTargets,
    discordNotifyTargets: notificationStatus.discord.configuredTargets,
    ttsEnabled: notificationStatus.tts.enabled,
    ttsEndpoint: notificationStatus.tts.endpoint,
    ttsVoice: notificationStatus.tts.voice,
    timezone: config.timezone,
    model: `${config.pi.provider}/${config.pi.model}`
  });
} catch (error) {
  log.error("Falha durante a inicialização", { error: error.stack || error.message });
  try { http?.close(); } catch {}
  try { pi.shutdown(); } catch {}
  setTimeout(() => process.exit(1), 250);
}

async function shutdown(signal) {
  log.info("Encerrando aplicação", { signal });
  try { telegram?.stop(signal); } catch {}
  try { await discord?.destroy(); } catch {}
  try { http?.close(); } catch {}
  try { pi.shutdown(); } catch {}
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("uncaughtException", (error) => {
  log.error("uncaughtException", { error: error.stack || error.message });
});
process.on("unhandledRejection", (error) => {
  log.error("unhandledRejection", { error: error?.stack || String(error) });
});
