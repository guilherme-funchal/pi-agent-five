import { Input } from "telegraf";
import { splitText, redactSecrets, markdownToTelegramHtml } from "./utils.js";
import { normalizeResponseMode } from "./response-mode.js";
import { synthesizeSpeech } from "./tts.js";
import { log } from "./logger.js";

export class Notifier {
  constructor(config) {
    this.config = config;
    this.telegramBot = null;
    this.discordClient = null;
  }

  attachTelegram(bot) {
    this.telegramBot = bot;
  }

  attachDiscord(client) {
    this.discordClient = client;
  }

  status() {
    return {
      telegram: {
        connected: Boolean(this.telegramBot),
        configuredTargets: [...this.config.telegram.notifyChatIds]
      },
      discord: {
        connected: Boolean(this.discordClient),
        configuredTargets: [...this.config.discord.notifyChannelIds]
      },
      tts: {
        enabled: this.config.tts.enabled,
        endpoint: `${this.config.tts.baseUrl}${this.config.tts.synthesisPath}`,
        voice: this.config.tts.voice,
        defaultMode: this.config.tts.defaultMode
      }
    };
  }

  async sendTelegram(chatId, text) {
    if (!this.telegramBot) throw new Error("Telegram não conectado");
    for (const chunk of splitText(redactSecrets(text), this.config.telegram.chunkSize)) {
      try {
        await this.telegramBot.telegram.sendMessage(chatId, markdownToTelegramHtml(chunk), {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true }
        });
      } catch (error) {
        log.warn("Falha ao formatar mensagem Telegram; enviando texto simples", {
          chatId,
          error: error.message
        });
        await this.telegramBot.telegram.sendMessage(chatId, chunk, {
          link_preview_options: { is_disabled: true }
        });
      }
    }
  }

  async #discordChannel(channelId) {
    if (!this.discordClient) throw new Error("Discord não conectado");
    const channel = await this.discordClient.channels.fetch(channelId);
    if (!channel?.isTextBased()) throw new Error(`Canal Discord inválido: ${channelId}`);
    return channel;
  }

  async sendDiscord(channelId, text) {
    const channel = await this.#discordChannel(channelId);
    for (const chunk of splitText(redactSecrets(text), this.config.discord.chunkSize)) {
      await channel.send({ content: chunk, allowedMentions: { parse: [] } });
    }
  }

  async sendTelegramVoiceFile(chatId, filePath, { truncated = false } = {}) {
    if (!this.telegramBot) throw new Error("Telegram não conectado");
    const caption = truncated
      ? "🔊 Resposta em áudio resumida. O texto completo está disponível na mensagem escrita."
      : "🔊 Resposta em áudio";
    await this.telegramBot.telegram.sendVoice(
      chatId,
      Input.fromLocalFile(filePath, "resposta.ogg"),
      { caption }
    );
  }

  async sendDiscordVoiceFile(channelId, filePath, { truncated = false } = {}) {
    const channel = await this.#discordChannel(channelId);
    await channel.send({
      content: truncated
        ? "🔊 Resposta em áudio resumida; consulte o texto para o conteúdo completo."
        : "🔊 Resposta em áudio",
      files: [{ attachment: filePath, name: "resposta.ogg" }],
      allowedMentions: { parse: [] }
    });
  }

  async #synthesizeAndDeliver(text, delivery) {
    const audio = await synthesizeSpeech({ text: redactSecrets(text), config: this.config });
    try {
      await delivery(audio);
    } finally {
      await audio.cleanup();
    }
  }

  async sendTelegramResponse(chatId, text, mode = "text") {
    const normalized = normalizeResponseMode(mode, "text");
    let textDelivered = false;
    if (normalized === "text" || normalized === "both") {
      await this.sendTelegram(chatId, text);
      textDelivered = true;
    }
    if (normalized === "voice" || normalized === "both") {
      try {
        await this.#synthesizeAndDeliver(text, (audio) =>
          this.sendTelegramVoiceFile(chatId, audio.filePath, audio)
        );
      } catch (error) {
        log.error("Falha ao gerar/enviar áudio Telegram", { chatId, error: error.message });
        if (!textDelivered) {
          await this.sendTelegram(chatId, [
            "⚠️ Não consegui gerar a resposta em áudio. Enviando o texto como alternativa.",
            `Erro: ${error.message}`,
            "",
            text
          ].join("\n"));
        }
      }
    }
  }

  async sendDiscordResponse(channelId, text, mode = "text") {
    const normalized = normalizeResponseMode(mode, "text");
    let textDelivered = false;
    if (normalized === "text" || normalized === "both") {
      await this.sendDiscord(channelId, text);
      textDelivered = true;
    }
    if (normalized === "voice" || normalized === "both") {
      try {
        await this.#synthesizeAndDeliver(text, (audio) =>
          this.sendDiscordVoiceFile(channelId, audio.filePath, audio)
        );
      } catch (error) {
        log.error("Falha ao gerar/enviar áudio Discord", { channelId, error: error.message });
        if (!textDelivered) {
          await this.sendDiscord(channelId, [
            "⚠️ Não consegui gerar a resposta em áudio. Enviando o texto como alternativa.",
            `Erro: ${error.message}`,
            "",
            text
          ].join("\n"));
        }
      }
    }
  }

  async sendAll(text) {
    const jobs = [];
    for (const chatId of this.config.telegram.notifyChatIds) {
      jobs.push(this.sendTelegram(chatId, text).catch((error) => {
        log.error("Falha ao notificar Telegram", { chatId, error: error.message });
      }));
    }
    for (const channelId of this.config.discord.notifyChannelIds) {
      jobs.push(this.sendDiscord(channelId, text).catch((error) => {
        log.error("Falha ao notificar Discord", { channelId, error: error.message });
      }));
    }
    await Promise.all(jobs);
  }


  async sendAllWithOrigin(text, origin) {
    const telegramTargets = new Set(this.config.telegram.notifyChatIds);
    const discordTargets = new Set(this.config.discord.notifyChannelIds);
    if (origin?.platform === "telegram" && origin.targetId) telegramTargets.add(String(origin.targetId));
    if (origin?.platform === "discord" && origin.targetId) discordTargets.add(String(origin.targetId));

    const jobs = [];
    for (const chatId of telegramTargets) {
      jobs.push(this.sendTelegram(chatId, text).catch((error) => {
        log.error("Falha ao notificar Telegram", { chatId, error: error.message });
      }));
    }
    for (const channelId of discordTargets) {
      jobs.push(this.sendDiscord(channelId, text).catch((error) => {
        log.error("Falha ao notificar Discord", { channelId, error: error.message });
      }));
    }
    if (origin?.platform === "http" && origin.reply) {
      jobs.push(origin.reply(text));
    }
    await Promise.all(jobs);
  }

  async sendAllResponse(text, mode = "text") {
    const normalized = normalizeResponseMode(mode, "text");
    if (normalized === "text") {
      await this.sendAll(text);
      return;
    }

    const textJobs = [];
    if (normalized === "both") {
      for (const chatId of this.config.telegram.notifyChatIds) {
        textJobs.push(this.sendTelegram(chatId, text).catch((error) => {
          log.error("Falha ao notificar Telegram", { chatId, error: error.message });
        }));
      }
      for (const channelId of this.config.discord.notifyChannelIds) {
        textJobs.push(this.sendDiscord(channelId, text).catch((error) => {
          log.error("Falha ao notificar Discord", { channelId, error: error.message });
        }));
      }
      await Promise.all(textJobs);
    }

    try {
      await this.#synthesizeAndDeliver(text, async (audio) => {
        const audioJobs = [];
        for (const chatId of this.config.telegram.notifyChatIds) {
          audioJobs.push(this.sendTelegramVoiceFile(chatId, audio.filePath, audio).catch((error) => {
            log.error("Falha ao enviar voz Telegram", { chatId, error: error.message });
          }));
        }
        for (const channelId of this.config.discord.notifyChannelIds) {
          audioJobs.push(this.sendDiscordVoiceFile(channelId, audio.filePath, audio).catch((error) => {
            log.error("Falha ao enviar áudio Discord", { channelId, error: error.message });
          }));
        }
        await Promise.all(audioJobs);
      });
    } catch (error) {
      log.error("Falha ao sintetizar resposta multicanal", { error: error.message });
      if (normalized === "voice") {
        await this.sendAll([
          "⚠️ Não consegui gerar o áudio. Enviando o resultado em texto.",
          `Erro: ${error.message}`,
          "",
          text
        ].join("\n"));
      }
    }
  }
}
