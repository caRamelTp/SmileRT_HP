/* ============================================================
   SmileRT Reminder Bot — Button Handler
   ============================================================
   Handles performer registration button clicks
   ============================================================ */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const firebase = require('../firebase');
const config = require('../config');

/**
 * Handle a button interaction (customId starts with "reg_")
 */
async function handleButton(interaction) {
  const customId = interaction.customId;

  // Registration button: reg_{eventId}_{performerId}
  if (customId.startsWith('reg_')) {
    await handleRegistrationButton(interaction);
    return;
  }

  // Unregister confirmation: unreg_confirm_{eventId}_{performerId}
  if (customId.startsWith('unreg_confirm_')) {
    await handleUnregisterConfirm(interaction);
    return;
  }

  // Unregister cancel: unreg_cancel
  if (customId.startsWith('unreg_cancel')) {
    await interaction.update({ content: 'キャンセルしました', components: [], ephemeral: true });
    return;
  }
}

/**
 * Handle registration button click
 */
async function handleRegistrationButton(interaction) {
  const parts = interaction.customId.split('_');
  // customId format: reg_{eventId}_{performerId}
  // eventId and performerId may contain underscores, so we need careful parsing
  // Format: reg_EVENTID_PERFORMERID
  const eventId = parts[1];
  const performerId = parts.slice(2).join('_');

  if (!eventId || !performerId) {
    return interaction.reply({ content: '❌ ボタンデータが不正です', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  // Get event to find performer name
  const event = await firebase.getEvent(eventId);
  if (!event) {
    return interaction.editReply({ content: '❌ イベントが見つかりません' });
  }

  const performer = event.performers.find(p => p.id === performerId);
  if (!performer) {
    return interaction.editReply({ content: '❌ 出演者が見つかりません' });
  }

  // Check existing mapping
  const existing = await firebase.getMapping(eventId, performerId);

  if (existing) {
    if (existing.discordUserId === interaction.user.id) {
      // Same user clicked again → offer to unregister
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`unreg_confirm_${eventId}_${performerId}`)
          .setLabel('登録を解除する')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('unreg_cancel')
          .setLabel('キャンセル')
          .setStyle(ButtonStyle.Secondary),
      );
      return interaction.editReply({
        content: `🔄 **${performer.name}** の登録を解除しますか？`,
        components: [row],
      });
    } else {
      // Different user already registered
      const adminChannel = interaction.client.channels.cache.get(config.channels.admin);
      if (adminChannel) {
        await adminChannel.send(
          `⚠ **重複登録の試行**: <@${interaction.user.id}> が「${performer.name}」（${event.title}）を押しましたが、既に <@${existing.discordUserId}> が登録済みです`
        );
      }
      return interaction.editReply({
        content: `⚠ **${performer.name}** は既に別の方が登録済みです。\n心当たりがない場合は運営にお問い合わせください。`,
      });
    }
  }

  // Check if this user is already registered as a different performer in this event
  const userMapping = await firebase.getMappingByDiscordUser(eventId, interaction.user.id);
  if (userMapping) {
    return interaction.editReply({
      content: `⚠ あなたは既に「**${userMapping.performerName}**」として登録されています。\n先にそちらの登録を解除してから、正しいボタンを押してください。`,
    });
  }

  // Register new mapping
  await firebase.setMapping(eventId, performerId, {
    performerName: performer.name,
    discordUserId: interaction.user.id,
    discordUsername: interaction.user.username,
  });

  await interaction.editReply({
    content: `✅ **${performer.name}** として登録しました！\nセトリ提出期限が近づくとこのサーバーで通知が届きます。`,
  });

  // Update button label to show ✅
  await updateRegistrationButtons(interaction.client, event);

  // Log to admin channel
  const adminChannel = interaction.client.channels.cache.get(config.channels.admin);
  if (adminChannel) {
    await adminChannel.send(`✅ <@${interaction.user.id}> が **${performer.name}**（${event.title}）として登録しました`);
  }
}

/**
 * Handle unregister confirmation
 */
async function handleUnregisterConfirm(interaction) {
  const parts = interaction.customId.split('_');
  // unreg_confirm_{eventId}_{performerId}
  const eventId = parts[2];
  const performerId = parts.slice(3).join('_');

  await interaction.deferUpdate();

  const event = await firebase.getEvent(eventId);
  const performer = event ? event.performers.find(p => p.id === performerId) : null;
  const performerName = performer ? performer.name : '不明';

  await firebase.deleteMapping(eventId, performerId);

  await interaction.editReply({
    content: `✅ **${performerName}** の登録を解除しました。\n正しいボタンを押し直してください。`,
    components: [],
  });

  // Update button label to remove ✅
  if (event) {
    await updateRegistrationButtons(interaction.client, event);
  }

  // Log
  const adminChannel = interaction.client.channels.cache.get(config.channels.admin);
  if (adminChannel) {
    await adminChannel.send(`🔓 <@${interaction.user.id}> が **${performerName}**（${event ? event.title : '?'}）の登録を解除しました`);
  }
}

/**
 * Update registration message buttons to reflect current state
 */
async function updateRegistrationButtons(client, event) {
  const messageId = await firebase.getRegistrationMessageId(event.id);
  if (!messageId) return;

  const registerChannel = client.channels.cache.get(config.channels.register);
  if (!registerChannel) return;

  let message;
  try {
    message = await registerChannel.messages.fetch(messageId);
  } catch (e) {
    return; // Message was deleted
  }

  const mappings = await firebase.getMappingsByEvent(event.id);
  const registeredPerformerIds = new Set(mappings.map(m => m.performerId));

  // Rebuild buttons
  const rows = [];
  let currentRow = new ActionRowBuilder();
  let buttonCount = 0;

  for (const performer of event.performers) {
    if (buttonCount > 0 && buttonCount % 5 === 0) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
    if (rows.length >= 5) break;

    const isRegistered = registeredPerformerIds.has(performer.id);
    const label = isRegistered ? `✅ ${performer.name}` : performer.name;

    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`reg_${event.id}_${performer.id}`)
        .setLabel(label.slice(0, 80))
        .setStyle(isRegistered ? ButtonStyle.Success : ButtonStyle.Secondary)
    );
    buttonCount++;
  }
  if (currentRow.components.length > 0) {
    rows.push(currentRow);
  }

  try {
    await message.edit({ components: rows });
  } catch (e) {
    console.error('Button update error:', e);
  }
}

module.exports = { handleButton, updateRegistrationButtons };
