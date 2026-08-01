/* ============================================================
   SmileRT Reminder Bot — Slash Command: /register
   ============================================================
   Posts a registration message with buttons in #出演者登録
   ============================================================ */

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
    const eventName = interaction.options.getString('event');
    const event = await firebase.findEventByTitle(eventName);

    if (!event) {
      return interaction.reply({ content: `❌ イベント「${eventName}」が見つかりません`, ephemeral: true });
    }

    if (!event.performers || event.performers.length === 0) {
      return interaction.reply({ content: `❌ 「${event.title}」に出演者が登録されていません`, ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

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
        '下のボタンから **自分の名前** を押して\nDiscord アカウントを登録してください。\n\n' +
        `⏰ セトリ提出期限: **${deadlineText}**`
      )
      .setFooter({ text: 'ボタンを押すと登録、もう一度押すと解除できます' });

    // Build button rows (max 5 buttons per row, max 5 rows = 25 buttons)
    const rows = [];
    let currentRow = new ActionRowBuilder();
    let buttonCount = 0;

    for (const performer of event.performers) {
      if (buttonCount > 0 && buttonCount % 5 === 0) {
        rows.push(currentRow);
        currentRow = new ActionRowBuilder();
      }
      if (rows.length >= 5) break; // Discord limit: max 5 rows

      const isRegistered = registeredPerformerIds.has(performer.id);
      const label = isRegistered ? `✅ ${performer.name}` : performer.name;

      currentRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`reg_${event.id}_${performer.id}`)
          .setLabel(label.slice(0, 80)) // Discord label max: 80 chars
          .setStyle(isRegistered ? ButtonStyle.Success : ButtonStyle.Secondary)
      );
      buttonCount++;
    }
    if (currentRow.components.length > 0) {
      rows.push(currentRow);
    }

    // Post to registration channel
    const registerChannel = interaction.client.channels.cache.get(config.channels.register);
    if (!registerChannel) {
      return interaction.editReply({ content: '❌ 出演者登録チャンネルが見つかりません' });
    }

    // Check if a registration message already exists for this event
    const existingMessageId = await firebase.getRegistrationMessageId(event.id);
    if (existingMessageId) {
      try {
        const existingMsg = await registerChannel.messages.fetch(existingMessageId);
        await existingMsg.edit({ embeds: [embed], components: rows });
        await interaction.editReply({ content: `✅ 「${event.title}」の登録メッセージを更新しました` });
        return;
      } catch (e) {
        // Message was deleted, create a new one
      }
    }

    const msg = await registerChannel.send({ embeds: [embed], components: rows });
    await firebase.setRegistrationMessageId(event.id, msg.id);

    await interaction.editReply({ content: `✅ 「${event.title}」の登録メッセージを #出演者登録 に投稿しました` });

    // Log to admin channel
    const adminChannel = interaction.client.channels.cache.get(config.channels.admin);
    if (adminChannel) {
      await adminChannel.send(`📋 **${event.title}** の出演者登録メッセージを投稿しました（出演者: ${event.performers.length}名）`);
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
