import { Telegraf } from "telegraf";
import { log } from "./logger.js";
import { transcribeTelegramAudio } from "./transcriber.js";

const TELEGRAM_COMMANDS = [
  { command: "start", description: "Mostrar ajuda" },
  { command: "help", description: "Mostrar ajuda" },
  { command: "status", description: "Estado do agente" },
  { command: "tarefas", description: "Listar tarefas agendadas" },
  { command: "agendar", description: "Criar agendamento explícito" },
  { command: "agora", description: "Executar imediatamente" },
  { command: "parar", description: "Interromper execução atual" },
  { command: "nova", description: "Iniciar nova sessão" },
  { command: "audio", description: "Mostrar estado da transcrição" },
  { command: "voz", description: "Responder uma solicitação em áudio" },
  { command: "texto", description: "Responder uma solicitação em texto" },
  { command: "modo_voz", description: "Definir modo de resposta do chat" },
  { command: "tts", description: "Mostrar estado da síntese de voz" }
];

const RETRY_409_MS = 35_000; // espera o long poll antigo expirar
const RETRY_ERROR_MS = 10_000; // outros erros de rede/polling
const MAX_RETRY_MS = 120_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function allowed(config, chatId) {
  const result = config.telegram.allowedChatIds.has(String(chatId));
  if (process.env.TELEGRAM_DEBUG === "1") {
    log.info("DEBUG Telegram", {
      chatId: String(chatId),
      configuredIds: [...config.telegram.allowedChatIds],
      allowed: result
    });
  }
  return result;
}

async function dispatchText({ ctx, chatId, text, gateway, notifier }) {
  await gateway.accept({
    platform: "telegram",
    targetId: chatId,
    userId: String(ctx.from?.id || "telegram"),
    text,
    reply: (message) => notifier.sendTelegram(chatId, message),
    replyFinal: (message, mode) => notifier.sendTelegramResponse(chatId, message, mode)
  });
}

function mediaDetails(message, config) {
  if (message.voice) {
    return {
      kind: "voice",
      fileId: message.voice.file_id,
      fileSize: message.voice.file_size || 0,
      duration: message.voice.duration || 0,
      mimeType: message.voice.mime_type || "audio/ogg",
      fileName: "voice.ogg",
      caption: String(message.caption || "").trim()
    };
  }
  if (message.audio) {
    return {
      kind: "audio",
      fileId: message.audio.file_id,
      fileSize: message.audio.file_size || 0,
      duration: message.audio.duration || 0,
      mimeType: message.audio.mime_type || "audio/mpeg",
      fileName: message.audio.file_name || "audio",
      caption: String(message.caption || "").trim()
    };
  }
  if (config.telegram.audioAcceptDocuments && message.document) {
    const mime = String(message.document.mime_type || "").toLowerCase();
    const name = String(message.document.file_name || "");
    const looksLikeAudio = mime.startsWith("audio/") || /\.(ogg|opus|mp3|m4a|aac|wav|flac|webm)$/i.test(name);
    if (looksLikeAudio) {
      return {
        kind: "document",
        fileId: message.document.file_id,
        fileSize: message.document.file_size || 0,
        duration: 0,
        mimeType: mime,
        fileName: name || "audio-document",
        caption: String(message.caption || "").trim()
      };
    }
  }
  return null;
}

async function handleAudio({ ctx, bot, config, gateway, notifier }) {
  const chatId = String(ctx.chat.id);
  if (!allowed(config, chatId)) {
    log.warn("Chat Telegram não autorizado", { chatId });
    await ctx.reply("Acesso não autorizado.");
    return;
  }
  if (!config.telegram.audioEnabled) {
    await ctx.reply("O recebimento de áudio está desabilitado neste agente.");
    return;
  }

  const media = mediaDetails(ctx.message, config);
  if (!media) return;

  if (media.fileSize > config.telegram.audioMaxBytes) {
    await ctx.reply(`O áudio ultrapassa o limite de ${Math.floor(config.telegram.audioMaxBytes / 1024 / 1024)} MB.`);
    return;
  }
  if (media.duration > config.telegram.audioMaxDurationSeconds) {
    await ctx.reply(`O áudio ultrapassa o limite de ${config.telegram.audioMaxDurationSeconds} segundos.`);
    return;
  }

  await ctx.reply("🎤 Áudio recebido. Estou transcrevendo...");
  try {
    await ctx.sendChatAction("typing");
    const transcript = await transcribeTelegramAudio({
      bot,
      fileId: media.fileId,
      fileName: media.fileName,
      mimeType: media.mimeType,
      declaredFileSize: media.fileSize,
      config
    });

    log.info("Áudio Telegram transcrito", {
      chatId,
      kind: media.kind,
      durationSeconds: media.duration,
      transcriptChars: transcript.length
    });

    if (config.telegram.audioShowTranscript) {
      await notifier.sendTelegram(chatId, `📝 Transcrição:\n\n${transcript}`);
    }
    const requestText = media.caption
      ? `${media.caption}\n\nTranscrição do áudio:\n${transcript}`
      : transcript;
    await dispatchText({ ctx, chatId, text: requestText, gateway, notifier });
  } catch (error) {
    log.error("Falha ao processar áudio Telegram", { chatId, error: error.stack || error.message });
    await ctx.reply([
      "❌ Não consegui transcrever o áudio.",
      `Erro: ${error.message}`,
      `Endpoint: ${config.speech.baseUrl}${config.speech.inferencePath}`
    ].join("\n"));
  }
}

function registerHandlers(bot, { config, gateway, notifier }) {
  bot.catch((error) => log.error("Erro no Telegram", { error: error.stack || error.message }));

  bot.on("text", async (ctx) => {
    const chatId = String(ctx.chat.id);
    if (!allowed(config, chatId)) {
      log.warn("Chat Telegram não autorizado", { chatId });
      await ctx.reply("Acesso não autorizado.");
      return;
    }

    const text = String(ctx.message.text || "").trim();
    if (!text) return;
    if (text.toLowerCase() === "/audio") {
      await ctx.reply([
        `Áudio: ${config.telegram.audioEnabled ? "habilitado" : "desabilitado"}`,
        `Limite: ${Math.floor(config.telegram.audioMaxBytes / 1024 / 1024)} MB / ${config.telegram.audioMaxDurationSeconds} s`,
        `Idioma: ${config.speech.language}`,
        `Whisper: ${config.speech.baseUrl}${config.speech.inferencePath}`,
        `Exibir transcrição: ${config.telegram.audioShowTranscript ? "sim" : "não"}`
      ].join("\n"));
      return;
    }

    await dispatchText({ ctx, chatId, text, gateway, notifier });
  });

  const audioHandler = (ctx) => handleAudio({ ctx, bot, config, gateway, notifier });
  bot.on("voice", audioHandler);
  bot.on("audio", audioHandler);
  bot.on("document", audioHandler);
}

/**
 * Mantém o polling vivo em segundo plano. Se cair (409 ou erro de rede),
 * recria o bot e tenta de novo, sem derrubar o processo.
 */
async function runPollingForever(state, { config, gateway, notifier }) {
  let delay = RETRY_ERROR_MS;

  while (!state.stopped) {
    const bot = new Telegraf(config.telegram.token);
    state.bot = bot;
    notifier.attachTelegram(bot);
    registerHandlers(bot, { config, gateway, notifier });

    try {
      // Só resolve quando o bot é parado (stop). Erros caem no catch.
      await bot.launch({ dropPendingUpdates: true });
      if (state.stopped) return;
      log.warn("Polling Telegram terminou sem erro; reiniciando");
    } catch (error) {
      if (state.stopped) return;

      if (error?.response?.error_code === 409) {
        log.error("Telegram 409: outro getUpdates está usando este token", {
          agent: process.env.AGENT_ID,
          pid: process.pid,
          retryInMs: RETRY_409_MS
        });
        delay = RETRY_409_MS;
      } else {
        log.error("Polling Telegram caiu", {
          agent: process.env.AGENT_ID,
          error: error.stack || error.message,
          retryInMs: delay
        });
      }
    }

    try { bot.stop("restart"); } catch { /* já parado */ }
    await sleep(delay);
    delay = Math.min(delay * 2, MAX_RETRY_MS);
  }
}

export async function startTelegram(config, gateway, notifier) {
  if (!config.telegram.token) {
    log.warn("Telegram desabilitado: TELEGRAM_BOT_TOKEN não configurado");
    return null;
  }

  // Valida o token antes de iniciar o polling e identifica o bot nos logs.
  const probe = new Telegraf(config.telegram.token);
  let me;
  try {
    me = await probe.telegram.getMe();
  } catch (error) {
    log.error("Token do Telegram inválido ou API inacessível", { error: error.message });
    return null;
  }

  const state = { stopped: false, bot: null };

  // Polling em segundo plano: NÃO usar await aqui.
  runPollingForever(state, { config, gateway, notifier }).catch((error) => {
    log.error("Loop do Telegram encerrou inesperadamente", { error: error.stack || error.message });
  });

  try {
    await probe.telegram.setMyCommands(TELEGRAM_COMMANDS);
  } catch (error) {
    log.warn("Não foi possível registrar o menu de comandos Telegram", { error: error.message });
  }

  log.info("Telegram conectado", {
    agent: process.env.AGENT_ID,
    username: me.username,
    botId: me.id,
    audioEnabled: config.telegram.audioEnabled,
    whisperEndpoint: `${config.speech.baseUrl}${config.speech.inferencePath}`
  });

  return {
    get bot() { return state.bot; },
    stop(reason = "shutdown") {
      state.stopped = true;
      try { state.bot?.stop(reason); } catch { /* ignore */ }
    }
  };
}
