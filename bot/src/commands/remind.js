/* ============================================================
   SmileRT Reminder Bot — Slash Command: /remind
   ============================================================
   Manually send a reminder to #セトリリマインド
   ============================================================ */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const firebase = require('../firebase');
const { sendReminder } = require('../services/reminderService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('リマインド通知を手動で送信します')
    .addStringOption(option =>
      option.setName('event')
        .setDescription('イベント名')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const eventName = interaction.options.getString('event');
    const event = await firebase.findEventByTitle(eventName);

    if (!event) {
      return interaction.editReply({ content: `❌ イベント「${eventName}」が見つかりません` });
    }

    if (!event.performers || event.performers.length === 0) {
      return interaction.editReply({ content: `❌ 「${event.title}」に出演者がいません` });
    }

    await sendReminder(interaction.client, event, '手動送信');
    await interaction.editReply({ content: `✅ 「${event.title}」のリマインドを #セトリリマインド に送信しました` });
  },
};
