import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionsBitField
} from "discord.js";
import { log } from "./logger.js";

function permissionNames(permissions) {
  if (!permissions) return ["ViewChannel", "SendMessages", "ReadMessageHistory"];

  const missing = [];
  if (!permissions.has(PermissionsBitField.Flags.ViewChannel)) missing.push("ViewChannel");
  if (!permissions.has(PermissionsBitField.Flags.SendMessages)) missing.push("SendMessages");
  if (!permissions.has(PermissionsBitField.Flags.ReadMessageHistory)) missing.push("ReadMessageHistory");
  return missing;
}

async function validateDiscordChannel(client, channelId, purpose) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      log.error("Canal Discord não encontrado", { channelId, purpose });
      return false;
    }
    if (!channel.isTextBased()) {
      log.error("Canal Discord não aceita mensagens de texto", {
        channelId,
        purpose,
        channelType: channel.type
      });
      return false;
    }

    let missingPermissions = [];
    if (channel.guild && client.user) {
      const permissions = channel.permissionsFor(client.user);
      missingPermissions = permissionNames(permissions);
    }

    const channelName = "name" in channel ? channel.name : "mensagem-direta";
    const guildName = channel.guild?.name || null;

    if (missingPermissions.length > 0) {
      log.error("Bot sem permissões necessárias no canal Discord", {
        channelId,
        channelName,
        guildName,
        purpose,
        missingPermissions
      });
      return false;
    }

    log.info("Canal Discord validado", {
      channelId,
      channelName,
      guildName,
      purpose
    });
    return true;
  } catch (error) {
    log.error("Falha ao validar canal Discord", {
      channelId,
      purpose,
      error: error.message
    });
    return false;
  }
}

async function validateConfiguredChannels(client, config) {
  const channelPurposes = new Map();

  for (const channelId of config.discord.allowedChannelIds) {
    channelPurposes.set(channelId, "entrada");
  }
  for (const channelId of config.discord.notifyChannelIds) {
    const current = channelPurposes.get(channelId);
    channelPurposes.set(channelId, current ? `${current} e notificações` : "notificações");
  }

  if (channelPurposes.size === 0) {
    log.warn("Nenhum canal Discord foi configurado", {
      hint: "Defina DISCORD_ALLOWED_CHANNEL_IDS e DISCORD_NOTIFY_CHANNEL_IDS"
    });
    return;
  }

  for (const [channelId, purpose] of channelPurposes) {
    await validateDiscordChannel(client, channelId, purpose);
  }
}

export async function startDiscord(config, gateway, notifier) {
  if (!config.discord.token) {
    log.warn("Discord desabilitado: DISCORD_BOT_TOKEN não configurado");
    return null;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
  });

  notifier.attachDiscord(client);

  client.on(Events.Error, (error) => {
    log.error("Erro no Discord", { error: error.stack || error.message });
  });

  client.on(Events.Warn, (warning) => {
    log.warn("Aviso do Discord", { warning });
  });

  client.on(Events.ShardError, (error, shardId) => {
    log.error("Erro de shard Discord", {
      shardId,
      error: error.stack || error.message
    });
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || message.system) return;

    const userId = String(message.author.id);
    const channelId = String(message.channel.id);
    const isDm = !message.guild;
    const mentioned = client.user ? message.mentions.has(client.user) : false;

    log.info("Mensagem Discord recebida", {
      userId,
      channelId,
      guildId: message.guild?.id || null,
      isDm,
      mentioned,
      contentChars: message.content?.length || 0
    });

    // Cada lista funciona de modo independente. Lista vazia significa
    // "sem restrição nesse critério", e não "bloquear tudo".
    const userAllowed =
      config.discord.allowedUserIds.size === 0 ||
      config.discord.allowedUserIds.has(userId);
    const channelAllowed =
      config.discord.allowedChannelIds.size === 0 ||
      config.discord.allowedChannelIds.has(channelId);

    if (!userAllowed || !channelAllowed) {
      log.warn("Mensagem Discord não autorizada", {
        userId,
        channelId,
        userAllowed,
        channelAllowed,
        allowedUserIds: [...config.discord.allowedUserIds],
        allowedChannelIds: [...config.discord.allowedChannelIds]
      });
      return;
    }

    if (!isDm && config.discord.requireMention && !mentioned) {
      log.info("Mensagem Discord ignorada: bot não foi mencionado", {
        userId,
        channelId,
        botId: client.user?.id || null
      });
      return;
    }

    let text = message.content || "";
    if (client.user) {
      text = text.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
    }

    if (!text) {
      const explanation = mentioned
        ? "Recebi a menção, mas não encontrei uma instrução. Escreva a pergunta depois de mencionar o bot."
        : "Não consegui ler o conteúdo da mensagem. Habilite Message Content Intent no Discord Developer Portal, na seção Bot > Privileged Gateway Intents.";

      log.warn("Mensagem Discord sem conteúdo utilizável", {
        userId,
        channelId,
        mentioned,
        isDm
      });

      try {
        await message.reply({
          content: explanation,
          allowedMentions: { repliedUser: false, parse: [] }
        });
      } catch (error) {
        log.error("Falha ao responder diagnóstico no Discord", {
          channelId,
          error: error.message
        });
      }
      return;
    }

    try {
      await message.channel.sendTyping();
      await gateway.accept({
        platform: "discord",
        targetId: channelId,
        userId,
        text,
        reply: (response) => notifier.sendDiscord(channelId, response),
        replyFinal: (response, mode) => notifier.sendDiscordResponse(channelId, response, mode)
      });
    } catch (error) {
      log.error("Falha ao processar mensagem Discord", {
        userId,
        channelId,
        error: error.stack || error.message
      });

      try {
        await message.reply({
          content: `❌ Não consegui processar a mensagem: ${error.message}`,
          allowedMentions: { repliedUser: false, parse: [] }
        });
      } catch {}
    }
  });

  const ready = new Promise((resolve) => client.once(Events.ClientReady, resolve));
  await client.login(config.discord.token);
  await ready;

  log.info("Discord conectado", {
    username: client.user?.tag,
    botId: client.user?.id,
    requireMention: config.discord.requireMention,
    allowedUserIds: [...config.discord.allowedUserIds],
    allowedChannelIds: [...config.discord.allowedChannelIds],
    notifyChannelIds: [...config.discord.notifyChannelIds]
  });

  await validateConfiguredChannels(client, config);
  return client;
}
