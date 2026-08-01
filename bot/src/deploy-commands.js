/* ============================================================
   SmileRT Reminder Bot — Deploy Slash Commands
   ============================================================
   Run: node src/deploy-commands.js
   Only needs to be run once (or when commands change)
   ============================================================ */

const { REST, Routes } = require('discord.js');
const config = require('./config');
const { loadCommands } = require('./handlers/commandHandler');

async function deploy() {
  console.log('📡 スラッシュコマンドを登録中...');

  const commands = loadCommands();
  const commandData = commands.map(cmd => cmd.data.toJSON());

  const rest = new REST({ version: '10' }).setToken(config.token);

  try {
    const data = await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commandData },
    );
    console.log(`✅ ${data.length} 個のスラッシュコマンドを登録しました`);
  } catch (error) {
    console.error('❌ コマンド登録エラー:', error);
    process.exit(1);
  }

  process.exit(0);
}

deploy();
