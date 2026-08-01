/* ============================================================
   SmileRT Reminder Bot — Button Handler
   ============================================================
   Handles performer registration button clicks and
   user select menu interactions
   ============================================================ */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const firebase = require('../firebase');
const config = require('../config');

/**
 * Handle a button interaction
 */
async function handleButton(interaction) {
  const customId = interaction.customId;

  // Registration button: reg_{eventId}_{performerId}
  if (customId.startsWith('reg_')) {
    await handleRegistrationButton(interaction);
    return;
  }

  // Assign user to performer: assign_{eventId}_{performerId}_{userId}
  if (customId.startsWith('assign_')) {
    await handleAssignButton(interaction);
    return;
  }

  // Unregister confirmation: unreg_confirm_{eventId}_{performerId}
  if (customId.startsWith('unreg_confirm_')) {
    await handleUnregisterConfirm(interaction);
    return;
  }

  // Unregister cancel
  if (customId.startsWith('unreg_cancel')) {
    await interaction.update({ content: 'キャンセルしました', components: [] });
    return;
  }
}

/**
 * Handle user select menu interaction
 */
async function handleUserSelect(interaction) {
  const customId = interaction.customId;

  // userselect_{eventId}
  if (!customId.startsWith('userselect_')) return;

  const eventId = customId.replace('userselect_', '');
  const selectedUserId = interaction.values[0];

  const event = await firebase.getEvent(eventId);
  if (!event) {
    return interaction.reply({ content: '❌ イベントが見つかりません', flags: MessageFlags.Ephemeral });
  }

  // Get selected user info
  const selectedUser = await interaction.guild.members.fetch(selectedUserId).catch(() => null);
  const displayName = selectedUser ? (selectedUser.displayName || selectedUser.user.username) : selectedUserId;

  // Check if this user is already registered for a performer in this event
  const existingMapping = await firebase.getMappingByDiscordUser(eventId, selectedUserId);
  if (existingMapping) {
    return interaction.reply({
      content: `ℹ️ <@${selectedUserId}> は既に「**${existingMapping.performerName}**」として登録済みです。\n変更する場合は、先にそのボタンを押して解除してください。`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // Get existing mappings
  const mappings = await firebase.getMappingsByEvent(eventId);
  const registeredPerformerIds = new Set(mappings.map(m => m.performerId));

  // Show performer selection buttons (only unregistered performers)
  const availablePerformers = event.performers.filter(p => !registeredPerformerIds.has(p.id));

  if (availablePerformers.length === 0) {
    return interaction.reply({
      content: '✅ 全出演者が登録済みです！',
      flags: MessageFlags.Ephemeral,
    });
  }

  const rows = [];
  let currentRow = new ActionRowBuilder();
  let buttonCount = 0;

  for (const performer of availablePerformers) {
    if (buttonCount > 0 && buttonCount % 5 === 0) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
    if (rows.length >= 5) break;

    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`assign_${eventId}_${performer.id}_${selectedUserId}`)
        .setLabel(performer.name.slice(0, 80))
        .setStyle(ButtonStyle.Primary)
    );
    buttonCount++;
  }
  if (currentRow.components.length > 0) {
    rows.push(currentRow);
  }

  await interaction.reply({
    content: `<@${selectedUserId}>（${displayName}）を、どの出演者として登録しますか？`,
    components: rows,
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * Handle assign button (from user select flow)
 */
async function handleAssignButton(interaction) {
  // assign_{eventId}_{performerId}_{userId}
  const parts = interaction.customId.split('_');
  const eventId = parts[1];
  const performerId = parts[2];
  const userId = parts[3];

  await interaction.deferUpdate();

  const event = await firebase.getEvent(eventId);
  if (!event) {
    return interaction.editReply({ content: '❌ イベントが見つかりません', components: [] });
  }

  const performer = event.performers.find(p => p.id === performerId);
  if (!performer) {
    return interaction.editReply({ content: '❌ 出演者が見つかりません', components: [] });
  }

  // Check if already registered by someone else
  const existing = await firebase.getMapping(eventId, performerId);
  if (existing && existing.discordUserId !== userId) {
    return interaction.editReply({
      content: `⚠ 「${performer.name}」は既に <@${existing.discordUserId}> が登録済みです`,
      components: [],
    });
  }

  // Get user info
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  const username = member ? member.user.username : 'unknown';

  // Save mapping
  await firebase.setMapping(eventId, performerId, {
    performerName: performer.name,
    discordUserId: userId,
    discordUsername: username,
  });

  await interaction.editReply({
    content: `✅ <@${userId}> を **${performer.name}**（${event.title}）として登録しました！`,
    components: [],
  });

  // Update registration message buttons
  await updateRegistrationButtons(interaction.client, event);

  // Log to admin channel
  const adminChannel = interaction.client.channels.cache.get(config.channels.admin);
  if (adminChannel) {
    await adminChannel.send(`✅ <@${userId}> が **${performer.name}**（${event.title}）として登録されました（by ${interaction.user.tag}）`).catch(() => {});
  }
}

/**
 * Handle registration button click (self-registration)
 */
async function handleRegistrationButton(interaction) {
  const parts = interaction.customId.split('_');
  const eventId = parts[1];
  const performerId = parts.slice(2).join('_');

  if (!eventId || !performerId) {
    return interaction.reply({ content: '❌ ボタンデータが不正です', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
        ).catch(() => {});
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
    await adminChannel.send(`✅ <@${interaction.user.id}> が **${performer.name}**（${event.title}）として登録しました`).catch(() => {});
  }
}

/**
 * Handle unregister confirmation
 */
async function handleUnregisterConfirm(interaction) {
  const parts = interaction.customId.split('_');
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

  if (event) {
    await updateRegistrationButtons(interaction.client, event);
  }

  const adminChannel = interaction.client.channels.cache.get(config.channels.admin);
  if (adminChannel) {
    await adminChannel.send(`🔓 <@${interaction.user.id}> が **${performerName}**（${event ? event.title : '?'}）の登録を解除しました`).catch(() => {});
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
    return;
  }

  const mappings = await firebase.getMappingsByEvent(event.id);
  const registeredPerformerIds = new Set(mappings.map(m => m.performerId));

  // Rebuild buttons (reserve last row for UserSelectMenu)
  const maxButtonRows = 4;
  const rows = [];
  let currentRow = new ActionRowBuilder();
  let buttonCount = 0;

  for (const performer of event.performers) {
    if (buttonCount > 0 && buttonCount % 5 === 0) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
    if (rows.length >= maxButtonRows) break;

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

  // Add UserSelectMenu
  const userSelectRow = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`userselect_${event.id}`)
      .setPlaceholder('サーバーメンバーを選んで登録...')
      .setMinValues(1)
      .setMaxValues(1)
  );
  rows.push(userSelectRow);

  try {
    await message.edit({ components: rows });
  } catch (e) {
    console.error('Button update error:', e);
  }
}

module.exports = { handleButton, handleUserSelect, updateRegistrationButtons };
