/* ============================================================
   SmileRT Reminder Bot — Button Handler
   ============================================================
   Handles performer registration button clicks,
   user select menu, and performer remove menu.

   IMPORTANT: All interaction responses (deferReply/editReply)
   are wrapped in try-catch. Even if the interaction response
   fails, data operations and message updates still execute.
   ============================================================ */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const firebase = require('../firebase');
const config = require('../config');

// ─── Helper: Safe interaction reply ───

async function safeDefer(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return true;
  } catch (e) {
    console.log('⚠ deferReply 失敗（interaction 期限切れ）');
    return false;
  }
}

async function safeReply(interaction, deferred, content) {
  try {
    if (deferred) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch (e) {
    // Interaction expired — user won't see the reply, but data ops still completed
    console.log('⚠ 応答送信失敗（interaction 期限切れ）:', content.slice(0, 50));
  }
}

// ─── Interaction Dispatchers ───

async function handleButton(interaction) {
  if (interaction.customId.startsWith('reg_')) {
    await handleRegistrationButton(interaction);
  }
}

async function handleUserSelect(interaction) {
  if (interaction.customId.startsWith('userselect_')) {
    await handleUserSelectMenu(interaction);
  }
}

async function handleStringSelect(interaction) {
  if (interaction.customId.startsWith('removeperf_')) {
    await handleRemovePerformerMenu(interaction);
  }
}

// ─── User Select: Add Member as Performer ───

async function handleUserSelectMenu(interaction) {
  const eventId = interaction.customId.replace('userselect_', '');
  const selectedUserId = interaction.values[0];
  const deferred = await safeDefer(interaction);

  try {
    const event = await firebase.getEvent(eventId);
    if (!event) { await safeReply(interaction, deferred, '❌ イベントが見つかりません'); return; }

    const member = await interaction.guild.members.fetch(selectedUserId).catch(() => null);
    if (!member) { await safeReply(interaction, deferred, '❌ サーバーメンバーが見つかりません'); return; }

    const displayName = member.displayName || member.user.username;
    const username = member.user.username;

    const existingMapping = await firebase.getMappingByDiscordUser(eventId, selectedUserId);
    if (existingMapping) {
      await safeReply(interaction, deferred, `ℹ️ <@${selectedUserId}> は既に「**${existingMapping.performerName}**」として登録済みです。`);
      return;
    }

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
      await safeReply(interaction, deferred, `✅ <@${selectedUserId}> を既存の出演者「**${existingPerformer.name}**」に自動リンクしました！`);
    } else {
      const newPerformer = firebase.createPerformer({ name: displayName, discord: username });
      await firebase.addPerformerToEvent(eventId, newPerformer);
      await firebase.setMapping(eventId, newPerformer.id, {
        performerName: displayName,
        discordUserId: selectedUserId,
        discordUsername: username,
      });
      await safeReply(interaction, deferred, `✅ <@${selectedUserId}>（**${displayName}**）を出演者として追加しました！`);
    }

    // Always update registration message (even if reply failed)
    await refreshRegistrationMessage(interaction.client, eventId);

    const adminChannel = interaction.client.channels.cache.get(config.channels.admin);
    if (adminChannel) {
      await adminChannel.send(`➕ <@${selectedUserId}>（**${displayName}**）が「${event.title}」に登録されました`).catch(() => {});
    }
  } catch (error) {
    console.error('❌ ユーザー選択処理エラー:', error);
    await safeReply(interaction, deferred, '❌ 処理中にエラーが発生しました');
  }
}

// ─── Remove Performer Menu ───

async function handleRemovePerformerMenu(interaction) {
  const eventId = interaction.customId.replace('removeperf_', '');
  const performerId = interaction.values[0];
  const deferred = await safeDefer(interaction);

  try {
    const event = await firebase.getEvent(eventId);
    if (!event) { await safeReply(interaction, deferred, '❌ イベントが見つかりません'); return; }

    const performer = (event.performers || []).find(p => p.id === performerId);
    if (!performer) { await safeReply(interaction, deferred, '❌ 出演者が見つかりません'); return; }

    const hasSongs = performer.songs && performer.songs.length > 0;
    const duplicates = (event.performers || []).filter(p => p.name === performer.name);

    if (duplicates.length > 1 && hasSongs) {
      const otherDup = duplicates.find(d => d.id !== performer.id);
      const otherHasSongs = otherDup && otherDup.songs && otherDup.songs.length > 0;

      if (!otherHasSongs) {
        await firebase.removePerformerFromEvent(eventId, otherDup.id);
        const otherMapping = await firebase.getMapping(eventId, otherDup.id);
        const thisMapping = await firebase.getMapping(eventId, performer.id);
        if (otherMapping && !thisMapping) {
          await firebase.setMapping(eventId, performer.id, {
            performerName: performer.name,
            discordUserId: otherMapping.discordUserId,
            discordUsername: otherMapping.discordUsername,
          });
        }
        await safeReply(interaction, deferred, `✅ 「**${performer.name}**」の重複（セトリなし）を削除しました\n📋 セトリありの方を残し、マッピングも引き継ぎました`);
        await refreshRegistrationMessage(interaction.client, eventId);
        return;
      }
    }

    const removed = await firebase.removePerformerFromEvent(eventId, performerId);
    if (!removed) { await safeReply(interaction, deferred, '❌ 削除に失敗しました'); return; }

    let msg = `✅ 「**${performer.name}**」を削除しました`;
    if (hasSongs) msg += `\n⚠ この出演者にはセトリ（${performer.songs.length}曲）が登録されていました`;
    await safeReply(interaction, deferred, msg);

    await refreshRegistrationMessage(interaction.client, eventId);

    const adminChannel = interaction.client.channels.cache.get(config.channels.admin);
    if (adminChannel) {
      await adminChannel.send(`🗑 ${interaction.user.tag} が「**${performer.name}**」を「${event.title}」から削除しました`).catch(() => {});
    }
  } catch (error) {
    console.error('❌ 出演者削除エラー:', error);
    await safeReply(interaction, deferred, '❌ 処理中にエラーが発生しました');
  }
}

// ─── Registration Button (toggle register/unregister) ───

async function handleRegistrationButton(interaction) {
  const parts = interaction.customId.split('_');
  const eventId = parts[1];
  const performerId = parts.slice(2).join('_');

  if (!eventId || !performerId) {
    try { await interaction.reply({ content: '❌ ボタンデータが不正です', flags: MessageFlags.Ephemeral }); } catch (e) {}
    return;
  }

  const deferred = await safeDefer(interaction);

  try {
    const event = await firebase.getEvent(eventId);
    if (!event) { await safeReply(interaction, deferred, '❌ イベントが見つかりません'); return; }

    const performer = (event.performers || []).find(p => p.id === performerId);
    if (!performer) { await safeReply(interaction, deferred, '❌ 出演者が見つかりません'); return; }

    const existing = await firebase.getMapping(eventId, performerId);

    if (existing) {
      if (existing.discordUserId === interaction.user.id) {
        // Toggle OFF — always do data op first, then reply, then update message
        await firebase.deleteMapping(eventId, performerId);
        await safeReply(interaction, deferred, `🔓 **${performer.name}** の登録を解除しました。`);
        await refreshRegistrationMessage(interaction.client, eventId);

        const adminChannel = interaction.client.channels.cache.get(config.channels.admin);
        if (adminChannel) {
          await adminChannel.send(`🔓 <@${interaction.user.id}> が **${performer.name}**（${event.title}）の登録を解除しました`).catch(() => {});
        }
        return;
      } else {
        await safeReply(interaction, deferred, `⚠ **${performer.name}** は既に別の方が登録済みです。\n心当たりがない場合は運営にお問い合わせください。`);
        return;
      }
    }

    const userMapping = await firebase.getMappingByDiscordUser(eventId, interaction.user.id);
    if (userMapping) {
      await safeReply(interaction, deferred, `⚠ あなたは既に「**${userMapping.performerName}**」として登録されています。\n先にそちらのボタンを押して解除してください。`);
      return;
    }

    // Toggle ON — always do data op first
    await firebase.setMapping(eventId, performerId, {
      performerName: performer.name,
      discordUserId: interaction.user.id,
      discordUsername: interaction.user.username,
    });
    await safeReply(interaction, deferred, `✅ **${performer.name}** として登録しました！\nセトリ提出期限が近づくと通知が届きます。\n（もう一度ボタンを押すと解除できます）`);
    await refreshRegistrationMessage(interaction.client, eventId);

    const adminChannel = interaction.client.channels.cache.get(config.channels.admin);
    if (adminChannel) {
      await adminChannel.send(`✅ <@${interaction.user.id}> が **${performer.name}**（${event.title}）として登録しました`).catch(() => {});
    }
  } catch (error) {
    console.error('❌ ボタン処理エラー:', error);
    await safeReply(interaction, deferred, '❌ 処理中にエラーが発生しました');
    // Still try to refresh the message even on error
    await refreshRegistrationMessage(interaction.client, eventId).catch(() => {});
  }
}

// ─── Build Components (shared by register.js & refreshRegistrationMessage) ───

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

  const nameCount = {};
  performers.forEach(p => {
    const name = p.name || '(名前なし)';
    nameCount[name] = (nameCount[name] || 0) + 1;
  });

  const maxButtonRows = 3;
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

  // UserSelectMenu (add member)
  rows.push(
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(`userselect_${event.id}`)
        .setPlaceholder('➕ サーバーメンバーを選んで追加...')
        .setMinValues(1)
        .setMaxValues(1)
    )
  );

  // StringSelectMenu (remove performer)
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

// ─── Refresh Registration Message (always re-fetches latest data) ───

async function refreshRegistrationMessage(client, eventId) {
  try {
    const messageId = await firebase.getRegistrationMessageId(eventId);
    if (!messageId) return;

    const registerChannel = client.channels.cache.get(config.channels.register);
    if (!registerChannel) return;

    let message;
    try {
      message = await registerChannel.messages.fetch(messageId);
    } catch (e) {
      console.log('⚠ 登録メッセージが見つかりません（削除された？）');
      return;
    }

    // Always re-fetch the latest data
    const event = await firebase.getEvent(eventId);
    if (!event) return;

    const mappings = await firebase.getMappingsByEvent(eventId);
    const rows = buildRegistrationComponents(event, mappings);

    await message.edit({ components: rows });
    console.log(`📋 登録メッセージ更新完了（${event.performers?.length || 0}名、${rows.length}行）`);
  } catch (e) {
    console.error('❌ 登録メッセージ更新エラー:', e.message);
    if (e.rawError) {
      console.error('  詳細:', JSON.stringify(e.rawError).slice(0, 300));
    }
  }
}

// Legacy alias
const updateRegistrationButtons = (client, event) => refreshRegistrationMessage(client, event.id);

module.exports = {
  handleButton,
  handleUserSelect,
  handleStringSelect,
  buildRegistrationComponents,
  updateRegistrationButtons,
  refreshRegistrationMessage,
};
