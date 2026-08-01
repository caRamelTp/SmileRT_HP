/* ============================================================
   SmileRT Reminder Bot — Slash Command: /unlink
   ============================================================ */

const { SlashCommandBuilder } = require('discord.js');
const firebase = require('../firebase');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unlink')
    .setDescription('Discord ユーザーの出演者リンクを解除します')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('リンク解除する Discord ユーザー')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('event')
        .setDescription('イベント名')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser('user');
    const eventName = interaction.options.getString('event');

    // Find event
    const event = await firebase.findEventByTitle(eventName);
    if (!event) {
      return interaction.editReply({ content: `❌ イベント「${eventName}」が見つかりません` });
    }

    // Find mapping for this user in this event
    const mapping = await firebase.getMappingByDiscordUser(event.id, user.id);
    if (!mapping) {
      return interaction.editReply({
        content: `❌ <@${user.id}> は「${event.title}」でリンクされていません`
      });
    }

    // Delete mapping
    await firebase.deleteMapping(event.id, mapping.performerId);

    await interaction.editReply({
      content: `✅ <@${user.id}> の「${mapping.performerName}」（${event.title}）リンクを解除しました`
    });

    // Update registration message buttons
    try {
      const { updateRegistrationButtons } = require('../handlers/buttonHandler');
      await updateRegistrationButtons(interaction.client, event);
    } catch (e) {
      console.error('Registration message update error:', e);
    }

    // Log
    const adminChannel = interaction.client.channels.cache.get(config.channels.admin);
    if (adminChannel && adminChannel.id !== interaction.channelId) {
      await adminChannel.send(`🔓 ${interaction.user.tag} が <@${user.id}> の **${mapping.performerName}**（${event.title}）リンクを解除しました`);
    }
  },
};
