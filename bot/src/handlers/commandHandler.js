/* ============================================================
   SmileRT Reminder Bot — Command Handler
   ============================================================
   Routes slash commands to their respective modules
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { Collection } = require('discord.js');

/**
 * Load all commands from the commands directory
 * @returns {Collection} command name → command module
 */
function loadCommands() {
  const commands = new Collection();
  const commandsPath = path.join(__dirname, '..', 'commands');
  const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

  for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (command.data && command.execute) {
      commands.set(command.data.name, command);
      console.log(`  📌 /${command.data.name}`);
    }
  }

  return commands;
}

/**
 * Handle a slash command interaction
 */
async function handleCommand(interaction, commands) {
  const command = commands.get(interaction.commandName);
  if (!command) {
    console.error(`❓ 不明なコマンド: /${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`❌ コマンドエラー (/${interaction.commandName}):`, error);
    const reply = { content: '❌ コマンドの実行中にエラーが発生しました', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
}

module.exports = { loadCommands, handleCommand };
