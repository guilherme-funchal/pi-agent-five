import "dotenv/config";
import {
  Client,
  Events,
  GatewayIntentBits,
  PermissionsBitField
} from "discord.js";

const token = process.env.DISCORD_BOT_TOKEN;
const channelId = String(
  process.argv[2] ||
  process.env.DISCORD_NOTIFY_CHANNEL_IDS ||
  process.env.DISCORD_ALLOWED_CHANNEL_IDS ||
  ""
).split(",")[0].trim();

if (!token) {
  console.error("DISCORD_BOT_TOKEN não configurado.");
  process.exit(1);
}
if (!channelId) {
  console.error("Informe o canal: node scripts/test-discord.js ID_DO_CANAL");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const ready = new Promise((resolve) => client.once(Events.ClientReady, resolve));

try {
  await client.login(token);
  await ready;

  console.log(`Conectado como ${client.user.tag} (${client.user.id})`);
  const channel = await client.channels.fetch(channelId);

  if (!channel) throw new Error(`Canal ${channelId} não encontrado`);
  if (!channel.isTextBased()) throw new Error(`Canal ${channelId} não é textual`);

  if (channel.guild) {
    const permissions = channel.permissionsFor(client.user);
    const checks = {
      ViewChannel: permissions?.has(PermissionsBitField.Flags.ViewChannel) || false,
      SendMessages: permissions?.has(PermissionsBitField.Flags.SendMessages) || false,
      ReadMessageHistory: permissions?.has(PermissionsBitField.Flags.ReadMessageHistory) || false
    };
    console.log("Permissões:", checks);
    if (!checks.ViewChannel || !checks.SendMessages) {
      throw new Error("O bot não tem ViewChannel e/ou SendMessages no canal");
    }
  }

  await channel.send({
    content: `✅ Teste de comunicação do Pi Agent concluído em ${new Date().toISOString()}`,
    allowedMentions: { parse: [] }
  });
  console.log(`Mensagem enviada para o canal ${channelId}.`);
} catch (error) {
  console.error("Falha no teste Discord:", error.stack || error.message);
  process.exitCode = 1;
} finally {
  client.destroy();
}
