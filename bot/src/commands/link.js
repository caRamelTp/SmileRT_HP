/* ============================================================
   SmileRT Reminder Bot — Slash Command: /link
   ============================================================
   Manually link a Discord user to a performer
   ============================================================ */

const { SlashCommandBuilder } = require('discord.js');
const firebase = require('../firebase');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Discord ユーザーを出演者に手動リンクします')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('リンクする Discord ユーザー')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('event')
        .setDescription('イベント名')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('performer')
        .setDescription('出演者名')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser('user');
    const eventName = interaction.options.getString('event');
    const performerName = interaction.options.getString('performer');

    // Find event
    const event = await firebase.findEventByTitle(eventName);
    if (!event) {
      return interaction.editReply({ content: `❌ イベント「${eventName}」が見つかりません` });
    }

    // Find performer
    const performer = event.performers.find(p =>
      p.name && p.name.toLowerCase() === performerName.toLowerCase()
    );
    if (!performer) {
      const names = event.performers.map(p => p.name).join('、');
      return interaction.editReply({
        content: `❌ 「${event.title}」に「${performerName}」が見つかりません\n出演者一覧: ${names}`
      });
    }

    // Check if someone else is already linked
    const existing = await firebase.getMapping(event.id, performer.id);
    if (existing && existing.discordUserId !== user.id) {
      return interaction.editReply({
        content: `⚠ 「${performer.name}」は既に <@${existing.discordUserId}> がリンク済みです。先に /unlink してください。`
      });
    }

    // Save mapping
    await firebase.setMapping(event.id, performer.id, {
      performerName: performer.name,
      discordUserId: user.id,
      discordUsername: user.username,
    });

    await interaction.editReply({
      content: `✅ <@${user.id}> を **${performer.name}**（${event.title}）にリンクしました`
    });

    // Update registration message buttons
    await updateRegistrationMessage(interaction.client, event);

    // Log
    const adminChannel = interaction.client.channels.cache.get(config.channels.admin);
    if (adminChannel && adminChannel.id !== interaction.channelId) {
      await adminChannel.send(`🔗 ${interaction.user.tag} が <@${user.id}> を **${performer.name}**（${event.title}）に手動リンクしました`);
    }
  },
};

async function updateRegistrationMessage(client, event) {
  try {
    const { updateRegistrationButtons } = require('../handlers/buttonHandler');
    await updateRegistrationButtons(client, event);
  } catch (e) {
    console.error('Registration message update error:', e);
  }
}
