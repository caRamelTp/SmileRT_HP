/* ============================================================
   SmileRT Reminder Bot — Slash Command: /status
   ============================================================ */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const firebase = require('../firebase');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('出演者の登録状況を確認します')
    .addStringOption(option =>
      option.setName('event')
        .setDescription('イベント名（省略で全イベント表示）')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const eventName = interaction.options.getString('event');

    if (eventName) {
      // Show specific event
      const event = await firebase.findEventByTitle(eventName);
      if (!event) {
        return interaction.editReply({ content: `❌ イベント「${eventName}」が見つかりません` });
      }
      const embed = await buildEventStatusEmbed(event);
      return interaction.editReply({ embeds: [embed] });
    }

    // Show all events
    const events = await firebase.getEvents();
    if (events.length === 0) {
      return interaction.editReply({ content: '📋 イベントが登録されていません' });
    }

    const embeds = [];
    for (const event of events.slice(0, 10)) { // Max 10 embeds
      embeds.push(await buildEventStatusEmbed(event));
    }
    return interaction.editReply({ embeds });
  },
};

async function buildEventStatusEmbed(event) {
  const mappings = await firebase.getMappingsByEvent(event.id);
  const mappingMap = new Map(mappings.map(m => [m.performerId, m]));

  const performers = event.performers || [];
  const lines = performers.map(p => {
    const mapping = mappingMap.get(p.id);
    if (mapping) {
      return `✅ ${p.name} → <@${mapping.discordUserId}>`;
    }
    return `❌ ${p.name} → 未登録`;
  });

  const registered = performers.filter(p => mappingMap.has(p.id)).length;
  const total = performers.length;

  const deadlineText = event.setlistDeadline
    ? formatDeadline(event.setlistDeadline)
    : '未設定';

  return new EmbedBuilder()
    .setColor(registered === total && total > 0 ? 0x00D4AA : 0xFFAA00)
    .setTitle(`📋 ${event.title}`)
    .setDescription(
      `⏰ 提出期限: ${deadlineText}\n\n` +
      (lines.length > 0 ? lines.join('\n') : '出演者なし') +
      `\n\n登録率: **${registered}/${total}** (${total > 0 ? Math.round(registered / total * 100) : 0}%)`
    );
}

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
