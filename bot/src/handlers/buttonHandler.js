/* ============================================================
   SmileRT Reminder Bot — Button Handler
   ============================================================
   Handles performer registration button clicks and
   user select menu interactions
   ============================================================ */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder, MessageFlags } = require('discord.js');
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
 * Flow: select a server member → add them directly as a performer
 * If a performer with the same name already exists, auto-link instead.
 */
async function handleUserSelect(interaction) {
  const customId = interaction.customId;
  if (!customId.startsWith('userselect_')) return;

  const eventId = customId.replace('userselect_', '');
  const selectedUserId = interaction.values[0];

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const event = await firebase.getEvent(eventId);
    if (!event) {
      return interaction.editReply({ content: '❌ イベントが見つかりません' });
    }

    // Get selected user info
    const member = await interaction.guild.members.fetch(selectedUserId).catch(() => null);
    if (!member) {
      return interaction.editReply({ content: '❌ サーバーメンバーが見つかりません' });
    }
    const displayName = member.displayName || member.user.username;
    const username = member.user.username;

    // Check if this Discord user is already registered for this event
    const existingMapping = await firebase.getMappingByDiscordUser(eventId, selectedUserId);
    if (existingMapping) {
      return interaction.editReply({
        content: `ℹ️ <@${selectedUserId}> は既に「**${existingMapping.performerName}**」として登録済みです。`,
      });
    }

    // Check if a performer with the same name already exists in the event
    const existingPerformer = (event.performers || []).find(p =>
      p.name && p.name === displayName
    );

    if (existingPerformer) {
      // Auto-link: same name found → link Discord ID to existing performer
      await firebase.setMapping(eventId, existingPerformer.id, {
        performerName: existingPerformer.name,
        discordUserId: selectedUserId,
        discordUsername: username,
      });

      await interaction.editReply({
        content: `✅ <@${selectedUserId}> を既存の出演者「**${existingPerformer.name}**」に自動リンクしました！`,
      });

      // Log
      const adminChannel = interaction.client.channels.cache.get(config.channels.admin);
      if (adminChannel) {
        await adminChannel.send(`🔗 <@${selectedUserId}> を既存の出演者「**${existingPerformer.name}**」（${event.title}）に自動リンクしました`).catch(() => {});
      }
    } else {
      // No match: create a new performer and add to the event
      const newPerformer = firebase.createPerformer({
        name: displayName,
        discord: username,
      });

      await firebase.addPerformerToEvent(eventId, newPerformer);

      // Save Discord ID mapping
      await firebase.setMapping(eventId, newPerformer.id, {
        performerName: displayName,
        discordUserId: selectedUserId,
        discordUsername: username,
      });

      await interaction.editReply({
        content: `✅ <@${selectedUserId}>（**${displayName}**）を出演者として追加しました！`,
      });

      // Log
      const adminChannel = interaction.client.channels.cache.get(config.channels.admin);
      if (adminChannel) {
        await adminChannel.send(`➕ <@${selectedUserId}>（**${displayName}**）が「${event.title}」の出演者として追加されました`).catch(() => {});
      }
    }

    // Update registration message buttons (re-fetch event to get latest data)
    const updatedEvent = await firebase.getEvent(eventId);
    if (updatedEvent) {
      await updateRegistrationButtons(interaction.client, updatedEvent);
    }

  } catch (error) {
    console.error('❌ ユーザー選択処理エラー:', error);
    await interaction.editReply({ content: '❌ 処理中にエラーが発生しました' }).catch(() => {});
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

  try {
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

  } catch (error) {
    console.error('❌ ボタン処理エラー:', error);
    await interaction.editReply({ content: '❌ 処理中にエラーが発生しました' }).catch(() => {});
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

  try {
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
  } catch (error) {
    console.error('❌ 解除処理エラー:', error);
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
