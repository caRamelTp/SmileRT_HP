/* ============================================================
   SmileRT Reminder Bot — Slash Command: /status
   ============================================================
   出演者の登録状況・Discordリンク・次回リマインドを確認
   ============================================================ */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const firebase = require('../firebase');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('出演者の登録状況・リマインド予定を確認します')
    .addStringOption(option =>
      option.setName('event')
        .setDescription('イベント名（省略で受付中のイベントを表示）')
        .setRequired(false)),

  async execute(interaction) {
    let deferred = false;
    try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); deferred = true; } catch (e) {}
    const reply = async (payload) => {
      try {
        if (deferred) await interaction.editReply(payload);
        else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
      } catch (e) { console.log('⚠ /status 応答失敗'); }
    };

    try {
      const eventName = interaction.options.getString('event');
      let events;
      if (eventName) {
        const all = await firebase.getEvents();
        const lower = eventName.toLowerCase();
        events = all.filter(e => (e.title || '').toLowerCase().includes(lower));
        if (events.length === 0) return reply({ content: `❌ イベント「${eventName}」が見つかりません` });
      } else {
        const all = await firebase.getEvents();
        const now = Date.now();
        events = all.filter(e => e.setlistDeadline && new Date(e.setlistDeadline) > now);
        if (events.length === 0) return reply({ content: '📋 受付中（提出期限前）のイベントはありません。\n`/status event:イベント名` で個別に確認できます。' });
      }

      const embeds = [];
      for (const ev of events.slice(0, 10)) embeds.push(await buildEventStatusEmbed(ev));
      await reply({ embeds });
    } catch (error) {
      console.error('❌ /status エラー:', error);
      await reply({ content: '❌ 状況の取得中にエラーが発生しました' });
    }
  },
};

async function buildEventStatusEmbed(event) {
  const mappings = await firebase.getMappingsByEvent(event.id);
  const mappingMap = new Map(mappings.map(m => [m.performerId, m]));
  const performers = event.performers || [];

  const nameCount = {};
  performers.forEach(p => { const n = (p.name || '').trim().toLowerCase(); nameCount[n] = (nameCount[n] || 0) + 1; });

  const lines = performers.map(p => {
    const m = mappingMap.get(p.id);
    const songs = (p.songs || []).length;
    const dup = nameCount[(p.name || '').trim().toLowerCase()] > 1 ? ' ⚠重複' : '';
    const songText = songs > 0 ? `🎵${songs}曲` : '🎵未提出';
    return m
      ? `✅ ${p.name} → <@${m.discordUserId}>　${songText}${dup}`
      : `❌ ${p.name} → **Discord未リンク**（通知が届きません）　${songText}${dup}`;
  });

  const registered = performers.filter(p => mappingMap.has(p.id)).length;
  const total = performers.length;

  // Reminder schedule
  let schedule = '期限未設定のためリマインドなし';
  if (event.setlistDeadline) {
    const dl = new Date(event.setlistDeadline).getTime();
    const hoursLeft = (dl - Date.now()) / 3600000;
    if (hoursLeft <= 0) {
      schedule = '期限切れ（リマインド終了）';
    } else {
      const future = config.remindHours.filter(h => h < hoursLeft);
      schedule = future.length
        ? future.map(h => `・${labelHours(h)}前 → ${formatDeadline(new Date(dl - h * 3600000))}`).join('\n')
        : 'これ以降のリマインドはありません';
    }
  }

  let desc =
    `⏰ 提出期限: **${formatDeadline(event.setlistDeadline)}**\n\n` +
    (lines.length ? lines.join('\n') : '出演者なし') +
    `\n\nDiscordリンク: **${registered}/${total}**\n\n` +
    `🔔 **リマインド予定**\n${schedule}`;
  if (desc.length > 4000) desc = desc.slice(0, 3990) + '…';

  return new EmbedBuilder()
    .setColor(registered === total && total > 0 ? 0x00D4AA : 0xFFAA00)
    .setTitle(`📋 ${event.title}`)
    .setDescription(desc);
}

function labelHours(h) {
  if (h % 24 === 0) return h === 168 ? '1週間' : `${h / 24}日`;
  return `${h}時間`;
}

function formatDeadline(d) {
  if (!d) return '未設定';
  const x = new Date(d);
  if (isNaN(x.getTime())) return '未設定';
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  const mm = (x.getMonth() + 1).toString().padStart(2, '0');
  const dd = x.getDate().toString().padStart(2, '0');
  const hh = x.getHours().toString().padStart(2, '0');
  const mi = x.getMinutes().toString().padStart(2, '0');
  return `${mm}/${dd}(${days[x.getDay()]}) ${hh}:${mi}`;
}
