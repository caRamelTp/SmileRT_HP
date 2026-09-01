/* ============================================================
   SmileRT Reminder Bot — Reminder Service
   ============================================================
   Periodically checks deadlines and sends reminders
   ============================================================ */

const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const firebase = require('../firebase');
const config = require('../config');

/**
 * Start the reminder cron job (runs every hour at :00)
 */
function startReminderService(client) {
  // Run every hour at minute 0
  cron.schedule('0 * * * *', async () => {
    console.log(`⏰ [${new Date().toLocaleString('ja-JP')}] リマインドチェック実行中...`);
    try {
      await checkDeadlines(client);
    } catch (error) {
      console.error('❌ リマインドチェックエラー:', error);
    }
  });

  const timingText = config.remindHours.map(h => formatHours(h)).join(' / ');
  console.log(`⏰ リマインドサービス開始（毎時0分にチェック、通知タイミング: ${timingText} 前）`);
}

/**
 * Check all events for approaching deadlines
 * 
 * remindHours is sorted descending: [168, 72, 24, 3]
 * For each threshold, we check if hoursLeft <= threshold.
 * But we SKIP thresholds that are larger than the total span
 * from when the event was created — instead, we only fire
 * the reminder whose window the current time falls into.
 * 
 * Example: if hoursLeft = 48, we skip 168h, fire 72h, skip 24h/3h.
 */
async function checkDeadlines(client) {
  const events = await firebase.getEvents();
  const now = new Date();

  for (const event of events) {
    // --- Check global deadline ---
    if (event.setlistDeadline) {
      const deadline = new Date(event.setlistDeadline);
      if (deadline > now) {
        const hoursLeft = (deadline - now) / (1000 * 60 * 60);
        await processReminders(client, event, hoursLeft, event.id, async (timeText) => {
          await sendReminder(client, event, timeText);
        });
      }
    }

    // --- Check individual overrides ---
    if (event.setlistOverrides && event.setlistOverrides.length > 0) {
      for (const override of event.setlistOverrides) {
        if (!override.deadline || !override.performerId) continue;
        const overrideDeadline = new Date(override.deadline);
        if (overrideDeadline <= now) continue;

        const hoursLeft = (overrideDeadline - now) / (1000 * 60 * 60);
        const performer = event.performers.find(p => p.id === override.performerId);
        if (!performer) continue;

        await processReminders(client, event, hoursLeft, event.id, async (timeText) => {
          await sendOverrideReminder(client, event, performer, override, `個別${timeText}`);
        }, `override_${override.performerId}_`);
      }
    }
  }
}

/**
 * Find which reminder threshold hoursLeft falls into, and send if not yet sent.
 * Only sends the ONE matching threshold — skips thresholds that have already passed.
 * 
 * @param {Function} sendFn - async function(timeText) to actually send the reminder
 * @param {string} labelPrefix - prefix for the reminder label (default: "")
 */
async function processReminders(client, event, hoursLeft, eventId, sendFn, labelPrefix = '') {
  const sortedHours = config.remindHours; // descending: [168, 72, 24, 3]

  for (let i = 0; i < sortedHours.length; i++) {
    const hours = sortedHours[i];
    const nextSmaller = sortedHours[i + 1] || 0;

    // hoursLeft must be within this threshold's window: nextSmaller < hoursLeft <= hours
    if (hoursLeft <= hours && hoursLeft > nextSmaller) {
      const label = `${labelPrefix}${hours}h`;
      const alreadySent = await firebase.isReminderSent(eventId, label);
      if (!alreadySent) {
        // Use actual remaining time, not the threshold
        const timeText = `期限まであと **${formatHoursActual(hoursLeft)}**`;
        console.log(`  📢 ${event.title}: ${label} リマインド送信 (実際: ${hoursLeft.toFixed(1)}h)`);
        await sendFn(timeText);
        await firebase.markReminderSent(eventId, label);
      }
      break; // Only one threshold can match
    }
  }
}

/**
 * Get the matched reminder hours for a given hoursLeft
 */
function getMatchedHours(hoursLeft) {
  for (let i = 0; i < config.remindHours.length; i++) {
    const hours = config.remindHours[i];
    const nextSmaller = config.remindHours[i + 1] || 0;
    if (hoursLeft <= hours && hoursLeft > nextSmaller) return hours;
  }
  return config.remindHours[config.remindHours.length - 1];
}

/**
 * Send a reminder for an event (global deadline)
 */
async function sendReminder(client, event, timeText) {
  const remindChannel = client.channels.cache.get(config.channels.remind);
  if (!remindChannel) {
    console.error('❌ リマインドチャンネルが見つかりません');
    return;
  }

  // Get all mappings for this event
  const mappings = await firebase.getMappingsByEvent(event.id);
  const mappingMap = new Map(mappings.map(m => [m.performerId, m]));

  const performers = event.performers || [];
  const mentionLines = [];
  const unregisteredLines = [];

  for (const p of performers) {
    const mapping = mappingMap.get(p.id);
    if (mapping) {
      mentionLines.push(`<@${mapping.discordUserId}>`);
    } else {
      unregisteredLines.push(p.name);
    }
  }

  const deadlineText = event.setlistDeadline
    ? formatDeadline(event.setlistDeadline)
    : '未設定';

  const embed = new EmbedBuilder()
    .setColor(0xFF6B6B)
    .setTitle(`📢 セトリ提出リマインド`)
    .setDescription(`**${event.title}**`)
    .addFields(
      { name: '⏰ ' + timeText, value: `📅 期限: **${deadlineText}**` },
    );

  if (unregisteredLines.length > 0) {
    embed.addFields({
      name: '⚠ 未登録（通知が届いていない可能性あり）',
      value: unregisteredLines.map(n => `・${n}`).join('\n'),
    });
  }

  embed.setFooter({ text: 'セトリの提出をお願いします 🙏' });
  embed.setTimestamp();

  // Build message content with mentions (outside embed for notification)
  const mentionText = mentionLines.length > 0
    ? mentionLines.join(' ')
    : '';

  await remindChannel.send({
    content: mentionText || undefined,
    embeds: [embed],
  });
}

/**
 * Send a reminder for an individual performer override
 */
async function sendOverrideReminder(client, event, performer, override, timeText) {
  const remindChannel = client.channels.cache.get(config.channels.remind);
  if (!remindChannel) return;

  const mapping = await firebase.getMapping(event.id, performer.id);

  const deadlineText = formatDeadline(override.deadline);

  const embed = new EmbedBuilder()
    .setColor(0xFFAA00)
    .setTitle(`📢 個別セトリ提出リマインド`)
    .setDescription(`**${event.title}** — ${performer.name}`)
    .addFields(
      { name: '⏰ ' + timeText, value: `📅 個別期限: **${deadlineText}**` },
    )
    .setFooter({ text: 'セトリの提出・修正をお願いします 🙏' })
    .setTimestamp();

  const mentionText = mapping ? `<@${mapping.discordUserId}>` : `**${performer.name}** さん`;

  await remindChannel.send({
    content: mentionText,
    embeds: [embed],
  });
}

/**
 * Format hours into a readable string
 */
function formatHours(hours) {
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainHours = hours % 24;
    if (remainHours === 0) return `${days}日`;
    return `${days}日${remainHours}時間`;
  }
  return `${hours}時間`;
}

/**
 * Format actual remaining hours into readable string
 * e.g. 50.3 → "2日と2時間", 2.5 → "2時間30分"
 */
function formatHoursActual(hoursLeft) {
  const totalMinutes = Math.floor(hoursLeft * 60);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0 && hours > 0) return `${days}日と${hours}時間`;
  if (days > 0) return `${days}日`;
  if (hours > 0 && minutes > 0) return `${hours}時間${minutes}分`;
  if (hours > 0) return `${hours}時間`;
  return `${minutes}分`;
}

/**
 * Format deadline for display
 */
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

module.exports = { startReminderService, sendReminder };
