/* ============================================================
   SmileRT Reminder Bot — Button Handler
   ============================================================
   Handles performer registration button clicks,
   user select menu, and performer remove menu
   ============================================================ */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const firebase = require('../firebase');
const config = require('../config');

// ─── Interaction Dispatchers ───

async function handleButton(interaction) {
  const customId = interaction.customId;
  if (customId.startsWith('reg_')) {
    await handleRegistrationButton(interaction);
  }
}

async function handleUserSelect(interaction) {
  const customId = interaction.customId;
  if (customId.startsWith('userselect_')) {
    await handleUserSelectMenu(interaction);
  }
}

async function handleStringSelect(interaction) {
  const customId = interaction.customId;
  if (customId.startsWith('removeperf_')) {
    await handleRemovePerformerMenu(interaction);
  }
}

// ─── User Select: Add Member as Performer ───

async function handleUserSelectMenu(interaction) {
  const eventId = interaction.customId.replace('userselect_', '');
  const selectedUserId = interaction.values[0];

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const event = await firebase.getEvent(eventId);
    if (!event) return interaction.editReply({ content: '❌ イベントが見つかりません' });

    const member = await interaction.guild.members.fetch(selectedUserId).catch(() => null);
    if (!member) return interaction.editReply({ content: '❌ サーバーメンバーが見つかりません' });

    const displayName = member.displayName || member.user.username;
    const username = member.user.username;

    // Already registered?
    const existingMapping = await firebase.getMappingByDiscordUser(eventId, selectedUserId);
    if (existingMapping) {
      return interaction.editReply({
        content: `ℹ️ <@${selectedUserId}> は既に「**${existingMapping.performerName}**」として登録済みです。`,
      });
    }

    // Check for existing performer with same name (exact → case-insensitive → discord username)
    const performers = event.performers || [];
    const existingPerformer =
      performers.find(p => p.name && p.name === displayName) ||
      performers.find(p => p.name && p.name.toLowerCase() === displayName.toLowerCase()) ||
      performers.find(p => p.discord && p.discord.toLowerCase() === username.toLowerCase());

    if (existingPerformer) {
      await firebase.setMapping(eventId, existingPerformer.id, {
        performerName: existingPerformer.name,
        discordUserId: selectedUserId,
        discordUsername: username,
      });
      await interaction.editReply({
        content: `✅ <@${selectedUserId}> を既存の出演者「**${existingPerformer.name}**」に自動リンクしました！`,
      });
    } else {
      const newPerformer = firebase.createPerformer({ name: displayName, discord: username });
      await firebase.addPerformerToEvent(eventId, newPerformer);
      await firebase.setMapping(eventId, newPerformer.id, {
        performerName: displayName,
        discordUserId: selectedUserId,
        discordUsername: username,
      });
      await interaction.editReply({
        content: `✅ <@${selectedUserId}>（**${displayName}**）を出演者として追加しました！`,
      });
    }

    // Refresh registration message
    const updatedEvent = await firebase.getEvent(eventId);
    if (updatedEvent) await updateRegistrationButtons(interaction.client, updatedEvent);

    const adminChannel = interaction.client.channels.cache.get(config.channels.admin);
    if (adminChannel) {
      await adminChannel.send(`➕ <@${selectedUserId}>（**${displayName}**）が「${event.title}」に登録されました`).catch(() => {});
    }
  } catch (error) {
    console.error('❌ ユーザー選択処理エラー:', error);
    await interaction.editReply({ content: '❌ 処理中にエラーが発生しました' }).catch(() => {});
  }
}

// ─── Remove Performer Menu ───

async function handleRemovePerformerMenu(interaction) {
  const eventId = interaction.customId.replace('removeperf_', '');
  const performerId = interaction.values[0];

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const event = await firebase.getEvent(eventId);
    if (!event) return interaction.editReply({ content: '❌ イベントが見つかりません' });

    const performer = (event.performers || []).find(p => p.id === performerId);
    if (!performer) return interaction.editReply({ content: '❌ 出演者が見つかりません' });

    const hasSongs = performer.songs && performer.songs.length > 0;

    // Check for duplicate names
    const duplicates = (event.performers || []).filter(p => p.name === performer.name);

    if (duplicates.length > 1 && hasSongs) {
      // This performer has songs and there's a duplicate — warn but allow
      const otherDup = duplicates.find(d => d.id !== performer.id);
      const otherHasSongs = otherDup && otherDup.songs && otherDup.songs.length > 0;

      if (!otherHasSongs) {
        // Suggest deleting the OTHER one (the empty one) instead
        await firebase.removePerformerFromEvent(eventId, otherDup.id);

        // Transfer mapping if needed
        const otherMapping = await firebase.getMapping(eventId, otherDup.id);
        const thisMapping = await firebase.getMapping(eventId, performer.id);
        if (otherMapping && !thisMapping) {
          await firebase.setMapping(eventId, performer.id, {
            performerName: performer.name,
            discordUserId: otherMapping.discordUserId,
            discordUsername: otherMapping.discordUsername,
          });
        }

        const updatedEvent = await firebase.getEvent(eventId);
        if (updatedEvent) await updateRegistrationButtons(interaction.client, updatedEvent);

        return interaction.editReply({
          content: `✅ 「**${performer.name}**」の重複（セトリなし）を削除しました\n📋 セトリありの方を残し、マッピングも引き継ぎました`,
        });
      }
    }

    // Normal delete
    const removed = await firebase.removePerformerFromEvent(eventId, performerId);
    if (!removed) return interaction.editReply({ content: '❌ 削除に失敗しました' });

    let msg = `✅ 「**${performer.name}**」を削除しました`;
    if (hasSongs) {
      msg += `\n⚠ この出演者にはセトリ（${performer.songs.length}曲）が登録されていました`;
    }

    await interaction.editReply({ content: msg });

    const updatedEvent = await firebase.getEvent(eventId);
    if (updatedEvent) await updateRegistrationButtons(interaction.client, updatedEvent);

    const adminChannel = interaction.client.channels.cache.get(config.channels.admin);
    if (adminChannel) {
      await adminChannel.send(`🗑 ${interaction.user.tag} が「**${performer.name}**」を「${event.title}」から削除しました`).catch(() => {});
    }
  } catch (error) {
    console.error('❌ 出演者削除エラー:', error);
    await interaction.editReply({ content: '❌ 処理中にエラーが発生しました' }).catch(() => {});
  }
}

// ─── Registration Button (toggle register/unregister) ───

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
    if (!event) return interaction.editReply({ content: '❌ イベントが見つかりません' });

    const performer = event.performers.find(p => p.id === performerId);
    if (!performer) return interaction.editReply({ content: '❌ 出演者が見つかりません' });

    const existing = await firebase.getMapping(eventId, performerId);

    if (existing) {
      if (existing.discordUserId === interaction.user.id) {
        // Toggle OFF
        await firebase.deleteMapping(eventId, performerId);
        await interaction.editReply({ content: `🔓 **${performer.name}** の登録を解除しました。` });
        await updateRegistrationButtons(interaction.client, event);

        const adminChannel = interaction.client.channels.cache.get(config.channels.admin);
        if (adminChannel) {
          await adminChannel.send(`🔓 <@${interaction.user.id}> が **${performer.name}**（${event.title}）の登録を解除しました`).catch(() => {});
        }
        return;
      } else {
        return interaction.editReply({
          content: `⚠ **${performer.name}** は既に別の方が登録済みです。\n心当たりがない場合は運営にお問い合わせください。`,
        });
      }
    }

    // Check if user is already registered as someone else
    const userMapping = await firebase.getMappingByDiscordUser(eventId, interaction.user.id);
    if (userMapping) {
      return interaction.editReply({
        content: `⚠ あなたは既に「**${userMapping.performerName}**」として登録されています。\n先にそちらのボタンを押して解除してください。`,
      });
    }

    // Toggle ON
    await firebase.setMapping(eventId, performerId, {
      performerName: performer.name,
      discordUserId: interaction.user.id,
      discordUsername: interaction.user.username,
    });
    await interaction.editReply({
      content: `✅ **${performer.name}** として登録しました！\nセトリ提出期限が近づくと通知が届きます。\n（もう一度ボタンを押すと解除できます）`,
    });
    await updateRegistrationButtons(interaction.client, event);

    const adminChannel = interaction.client.channels.cache.get(config.channels.admin);
    if (adminChannel) {
      await adminChannel.send(`✅ <@${interaction.user.id}> が **${performer.name}**（${event.title}）として登録しました`).catch(() => {});
    }
  } catch (error) {
    console.error('❌ ボタン処理エラー:', error);
    await interaction.editReply({ content: '❌ 処理中にエラーが発生しました' }).catch(() => {});
  }
}

// ─── Build Components (shared by register.js & updateRegistrationButtons) ───

/**
 * Build all ActionRow components for the registration message
 * Layout (max 5 rows):
 *   Rows 1-3: Performer buttons (max 15)
 *   Row 4:    UserSelectMenu (add member)
 *   Row 5:    StringSelectMenu (remove performer)
 */
function buildRegistrationComponents(event, mappings) {
  const registeredPerformerIds = new Set((mappings || []).map(m => m.performerId));
  const performers = (event.performers || []).filter(Boolean);

  // Detect duplicate names
  const nameCount = {};
  performers.forEach(p => {
    const name = p.name || '(名前なし)';
    nameCount[name] = (nameCount[name] || 0) + 1;
  });

  const maxButtonRows = 3; // Reserve 2 rows for select menus
  const rows = [];
  let currentRow = new ActionRowBuilder();
  let buttonCount = 0;

  for (const performer of performers) {
    if (buttonCount > 0 && buttonCount % 5 === 0) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
    if (rows.length >= maxButtonRows) break;

    const name = performer.name || '(名前なし)';
    const isRegistered = registeredPerformerIds.has(performer.id);
    const isDuplicate = nameCount[name] > 1;
    let label = name;
    if (isDuplicate) label = `⚠ ${label}`;
    if (isRegistered) label = `✅ ${label}`;

    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`reg_${event.id}_${performer.id}`)
        .setLabel(label.slice(0, 80))
        .setStyle(isRegistered ? ButtonStyle.Success : isDuplicate ? ButtonStyle.Danger : ButtonStyle.Secondary)
    );
    buttonCount++;
  }
  if (currentRow.components.length > 0) {
    rows.push(currentRow);
  }

  // Row 4: UserSelectMenu (add member)
  rows.push(
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(`userselect_${event.id}`)
        .setPlaceholder('➕ サーバーメンバーを選んで追加...')
        .setMinValues(1)
        .setMaxValues(1)
    )
  );

  // Row 5: StringSelectMenu (remove performer) — only if there are performers
  if (performers.length > 0) {
    const options = performers.slice(0, 25).map(p => {
      const name = p.name || '(名前なし)';
      const isDuplicate = nameCount[name] > 1;
      const hasSongs = p.songs && p.songs.length > 0;
      let desc = '';
      if (isDuplicate) desc += '⚠ 重複あり ';
      if (hasSongs) desc += `セトリ ${p.songs.length}曲`;
      if (!desc) desc = '未登録';

      return {
        label: name.slice(0, 100) || '(名前なし)',
        value: p.id,
        description: desc.slice(0, 100),
        emoji: isDuplicate ? '⚠' : '🗑',
      };
    });

    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`removeperf_${event.id}`)
          .setPlaceholder('🗑 出演者を削除...')
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(options)
      )
    );
  }

  return rows;
}

// ─── Update Registration Message ───

async function updateRegistrationButtons(client, event) {
  try {
    const messageId = await firebase.getRegistrationMessageId(event.id);
    if (!messageId) {
      console.log('⚠ 登録メッセージID未登録（event: ' + event.id + '）');
      return;
    }

    const registerChannel = client.channels.cache.get(config.channels.register);
    if (!registerChannel) return;

    let message;
    try {
      message = await registerChannel.messages.fetch(messageId);
    } catch (e) {
      console.log('⚠ 登録メッセージが見つかりません（削除された？）');
      return;
    }

    const latestEvent = await firebase.getEvent(event.id);
    const mappings = await firebase.getMappingsByEvent(event.id);
    const rows = buildRegistrationComponents(latestEvent || event, mappings);

    await message.edit({ components: rows });
    console.log(`📋 登録メッセージ更新完了（${(latestEvent || event).performers?.length || 0}名、${rows.length}行）`);
  } catch (e) {
    console.error('❌ 登録メッセージ更新エラー:', e.message);
    console.error('  詳細:', e.code, e.status, JSON.stringify(e.rawError || {}).slice(0, 300));
  }
}

module.exports = {
  handleButton,
  handleUserSelect,
  handleStringSelect,
  buildRegistrationComponents,
  updateRegistrationButtons,
};
