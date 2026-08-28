/* ============================================================
   SmileRT Reminder Bot — Slash Command: /remove
   ============================================================
   Remove a performer from an event (for deduplication)
   ============================================================ */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const firebase = require('../firebase');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('出演者をイベントから削除します（重複解消用）')
    .addStringOption(option =>
      option.setName('event')
        .setDescription('イベント名')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('performer')
        .setDescription('削除する出演者名')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const eventName = interaction.options.getString('event');
    const performerName = interaction.options.getString('performer');

    // Find event
    const event = await firebase.findEventByTitle(eventName);
    if (!event) {
      return interaction.editReply({ content: `❌ イベント「${eventName}」が見つかりません` });
    }

    // Find performer(s) matching the name
    const matches = (event.performers || []).filter(p =>
      p.name && p.name.toLowerCase() === performerName.toLowerCase()
    );

    if (matches.length === 0) {
      const names = (event.performers || []).map(p => p.name).join('、');
      return interaction.editReply({
        content: `❌ 「${event.title}」に「${performerName}」が見つかりません\n出演者一覧: ${names}`
      });
    }

    if (matches.length === 1) {
      // Only one match — check if it has songs before deleting
      const performer = matches[0];
      const hasSongs = performer.songs && performer.songs.length > 0;

      const removed = await firebase.removePerformerFromEvent(event.id, performer.id);
      if (!removed) {
        return interaction.editReply({ content: '❌ 削除に失敗しました' });
      }

      let msg = `✅ 「**${performer.name}**」を「${event.title}」から削除しました`;
      if (hasSongs) {
        msg += `\n⚠ この出演者にはセトリ（${performer.songs.length}曲）が登録されていました`;
      }

      await interaction.editReply({ content: msg });

    } else {
      // Multiple matches (duplicates!) — remove the one WITHOUT songs/data
      // Sort: ones without songs first, so we delete the empty duplicate
      const sorted = matches.sort((a, b) => {
        const aSongs = (a.songs || []).length;
        const bSongs = (b.songs || []).length;
        return aSongs - bSongs; // fewer songs first
      });

      // Delete the first one (least data)
      const toDelete = sorted[0];
      const toKeep = sorted[sorted.length - 1];

      const removed = await firebase.removePerformerFromEvent(event.id, toDelete.id);
      if (!removed) {
        return interaction.editReply({ content: '❌ 削除に失敗しました' });
      }

      // If the kept one doesn't have a mapping but the deleted one did, transfer it
      const deletedMapping = await firebase.getMapping(event.id, toDelete.id);
      const keptMapping = await firebase.getMapping(event.id, toKeep.id);

      if (deletedMapping && !keptMapping) {
        await firebase.setMapping(event.id, toKeep.id, {
          performerName: toKeep.name,
          discordUserId: deletedMapping.discordUserId,
          discordUsername: deletedMapping.discordUsername,
        });
      }

      const deletedSongs = (toDelete.songs || []).length;
      const keptSongs = (toKeep.songs || []).length;

      await interaction.editReply({
        content: `✅ 「**${toDelete.name}**」の重複を1つ削除しました\n` +
          `　削除: セトリ ${deletedSongs}曲\n` +
          `　残り: セトリ ${keptSongs}曲（Discord マッピングも引き継ぎ済み）`
      });
    }

    // Update registration message
    const updatedEvent = await firebase.getEvent(event.id);
    if (updatedEvent) {
      const { updateRegistrationButtons } = require('../handlers/buttonHandler');
      await updateRegistrationButtons(interaction.client, updatedEvent);
    }

    // Log
    const adminChannel = interaction.client.channels.cache.get(config.channels.admin);
    if (adminChannel && adminChannel.id !== interaction.channelId) {
      await adminChannel.send(`🗑 ${interaction.user.tag} が「**${performerName}**」を「${event.title}」から削除しました`).catch(() => {});
    }
  },
};
