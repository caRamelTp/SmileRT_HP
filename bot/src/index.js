/* ============================================================
   SmileRT Reminder Bot — Entry Point
   ============================================================ */

const { Client, GatewayIntentBits, Events } = require('discord.js');
const config = require('./config');
const { loadCommands, handleCommand } = require('./handlers/commandHandler');
const { handleButton } = require('./handlers/buttonHandler');
const { startReminderService } = require('./services/reminderService');

// Create Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// Load commands
console.log('📌 コマンドを読み込み中...');
const commands = loadCommands();

// ─── Ready ───
client.once(Events.ClientReady, (readyClient) => {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ ${readyClient.user.tag} がオンラインになりました！`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // Start reminder service
  startReminderService(client);
});

// ─── Interaction Handler ───
client.on(Events.InteractionCreate, async (interaction) => {
  // Slash commands
  if (interaction.isChatInputCommand()) {
    await handleCommand(interaction, commands);
    return;
  }

  // Button clicks
  if (interaction.isButton()) {
    await handleButton(interaction);
    return;
  }
});

// ─── Error Handling ───
client.on('error', (error) => {
  console.error('❌ Discord クライアントエラー:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ 未処理のPromiseエラー:', error);
});

// ─── Login ───
console.log('📡 Discord に接続中...');
client.login(config.token);
