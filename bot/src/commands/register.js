/* ============================================================
   SmileRT Reminder Bot — Slash Command: /register
   ============================================================
   Posts a registration message with buttons + user select menu
   + performer remove menu in #出演者登録
   ============================================================ */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const firebase = require('../firebase');
const config = require('../config');
const { buildRegistrationComponents } = require('../handlers/buttonHandler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription('出演者登録メッセージを投稿します')
    .addStringOption(option =>
      option.setName('event')
        .setDescription('イベント名（部分一致可）')
        .setRequired(true)),

  async execute(interaction) {
    // Safe deferReply — don't let timeout kill the whole command
    let deferred = false;
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      deferred = true;
    } catch (e) {
      console.log('⚠ /register deferReply 失敗（interaction 期限切れ）');
    }

    // Helper to safely reply
    const reply = async (content) => {
      try {
        if (deferred) {
          await interaction.editReply({ content });
        } else {
          await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        }
      } catch (e) {
        console.log('⚠ /register 応答送信失敗:', content.slice(0, 60));
      }
    };

    try {
      const eventName = interaction.options.getString('event');
      const event = await firebase.findEventByTitle(eventName);

      if (!event) {
        await reply(`❌ イベント「${eventName}」が見つかりません`);
        return;
      }

      // Build embed
      const deadlineText = event.setlistDeadline
        ? formatDeadline(event.setlistDeadline)
        : '未設定';

      const performerCount = (event.performers || []).length;

      const embed = new EmbedBuilder()
        .setColor(0x00D4AA)
        .setTitle(`🎤 ${event.title} 出演者登録`)
        .setDescription(
          '**方法①**: 下のボタンから **自分の名前** を押して登録\n' +
          '**方法②**: メンバー選択メニューから **サーバーメンバーを選択** して登録\n\n' +
          `⏰ セトリ提出期限: **${deadlineText}**\n\n` +
          '💡 ボタンを押すと登録 / もう一度押すと解除\n' +
          '🗑 間違えた場合は一番下の削除メニューから削除できます'
        );

      // Build components (buttons + select menus)
      const mappings = await firebase.getMappingsByEvent(event.id);
      const rows = buildRegistrationComponents(event, mappings);

      // Post to registration channel
      const registerChannel = interaction.client.channels.cache.get(config.channels.register);
      if (!registerChannel) {
        await reply('❌ 出演者登録チャンネルが見つかりません');
        return;
      }

      // Check if a registration message already exists for this event
      const existingMessageId = await firebase.getRegistrationMessageId(event.id);
      if (existingMessageId) {
        try {
          const existingMsg = await registerChannel.messages.fetch(existingMessageId);
          await existingMsg.edit({ embeds: [embed], components: rows });
          await reply(`✅ 「${event.title}」の登録メッセージを更新しました`);
          return;
        } catch (e) {
          // Message was deleted, create a new one
        }
      }

      try {
        const msg = await registerChannel.send({ content: '@everyone', embeds: [embed], components: rows });
        await firebase.setRegistrationMessageId(event.id, msg.id);
        await reply(`✅ 「${event.title}」の登録メッセージを #出演者登録 に投稿しました`);
      } catch (sendError) {
        console.error('❌ 登録メッセージ送信エラー:', sendError);
        await reply('❌ メッセージの送信に失敗しました。Bot のチャンネル権限を確認してください。');
        return;
      }

      const adminChannel = interaction.client.channels.cache.get(config.channels.admin);
      if (adminChannel) {
        await adminChannel.send(`📋 **${event.title}** の出演者登録メッセージを投稿しました（出演者: ${performerCount}名）`).catch(() => {});
      }
    } catch (error) {
      console.error('❌ /register 実行エラー:', error);
      await reply('❌ コマンドの実行中にエラーが発生しました');
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
