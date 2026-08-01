/* ============================================================
   SmileRT Reminder Bot — Slash Command: /register
   ============================================================
   Posts a registration message with buttons + user select menu
   in #出演者登録
   ============================================================ */

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder, MessageFlags } = require('discord.js');
const firebase = require('../firebase');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription('出演者登録メッセージを投稿します')
    .addStringOption(option =>
      option.setName('event')
        .setDescription('イベント名（部分一致可）')
        .setRequired(true)),

  async execute(interaction) {
    // Always deferReply first to avoid timeout
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const eventName = interaction.options.getString('event');
    const event = await firebase.findEventByTitle(eventName);

    if (!event) {
      return interaction.editReply({ content: `❌ イベント「${eventName}」が見つかりません` });
    }

    if (!event.performers || event.performers.length === 0) {
      return interaction.editReply({ content: `❌ 「${event.title}」に出演者が登録されていません` });
    }

    // Get existing mappings to show ✅ on already-registered performers
    const mappings = await firebase.getMappingsByEvent(event.id);
    const registeredPerformerIds = new Set(mappings.map(m => m.performerId));

    // Build embed
    const deadlineText = event.setlistDeadline
      ? formatDeadline(event.setlistDeadline)
      : '未設定';

    const embed = new EmbedBuilder()
      .setColor(0x00D4AA)
      .setTitle(`🎤 ${event.title} 出演者登録`)
      .setDescription(
        '**方法①**: 下のボタンから **自分の名前** を押して登録\n' +
        '**方法②**: 一番下のメニューから **サーバーメンバーを選択** して登録\n\n' +
        `⏰ セトリ提出期限: **${deadlineText}**`
      )
      .setFooter({ text: 'ボタンを押すと登録、もう一度押すと解除できます' });

    // Build button rows (max 5 buttons per row, reserve last row for select menu)
    const maxButtonRows = 4; // Reserve 1 row for UserSelectMenu
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

    // Add UserSelectMenu as the last row
    const userSelectRow = new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(`userselect_${event.id}`)
        .setPlaceholder('サーバーメンバーを選んで登録...')
        .setMinValues(1)
        .setMaxValues(1)
    );
    rows.push(userSelectRow);

    // Post to registration channel
    const registerChannel = interaction.client.channels.cache.get(config.channels.register);
    if (!registerChannel) {
      return interaction.editReply({ content: '❌ 出演者登録チャンネルが見つかりません。Bot にチャンネルの権限があるか確認してください。' });
    }

    // Check if a registration message already exists for this event
    const existingMessageId = await firebase.getRegistrationMessageId(event.id);
    if (existingMessageId) {
      try {
        const existingMsg = await registerChannel.messages.fetch(existingMessageId);
        await existingMsg.edit({ embeds: [embed], components: rows });
        return interaction.editReply({ content: `✅ 「${event.title}」の登録メッセージを更新しました` });
      } catch (e) {
        // Message was deleted, create a new one
      }
    }

    try {
      const msg = await registerChannel.send({ embeds: [embed], components: rows });
      await firebase.setRegistrationMessageId(event.id, msg.id);
      await interaction.editReply({ content: `✅ 「${event.title}」の登録メッセージを #出演者登録 に投稿しました` });
    } catch (sendError) {
      console.error('❌ 登録メッセージ送信エラー:', sendError);
      return interaction.editReply({ content: `❌ メッセージの送信に失敗しました。Bot に #出演者登録 の「メッセージを送信」「埋め込みリンク」権限があるか確認してください。` });
    }

    // Log to admin channel
    const adminChannel = interaction.client.channels.cache.get(config.channels.admin);
    if (adminChannel) {
      await adminChannel.send(`📋 **${event.title}** の出演者登録メッセージを投稿しました（出演者: ${event.performers.length}名）`).catch(() => {});
    }
  },
};

function formatDeadline(deadlineStr) {
  if (!deadlineStr) return '未設定';
  const d = new Date(deadlineStr);
  if (isNaN(d.getTime())) return '未設定';
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');
  const hh = d.getHours().toString().padStart(2, '0');
  const mi = d.getMinutes().toString().padStart(2, '0');
  return `${mm}/${dd}(${days[d.getDay()]}) ${hh}:${mi}`;
}
