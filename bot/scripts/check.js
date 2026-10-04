/* ============================================================
   SmileRT Bot — 登録状況診断スクリプト
   使い方:  cd bot  →  node scripts/check.js [イベント名の一部]
   ============================================================ */

process.chdir(require('path').join(__dirname, '..'));
const firebase = require('../src/firebase');
const config = require('../src/config');

function fmt(d) {
  if (!d) return '未設定';
  const x = new Date(d);
  if (isNaN(x)) return `不正な日付(${d})`;
  return x.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

function nextReminder(deadline, sent, prefix = '') {
  if (!deadline) return '期限未設定のためリマインドなし';
  const hoursLeft = (new Date(deadline) - Date.now()) / 3600000;
  if (hoursLeft <= 0) return '期限切れ（リマインド終了）';
  const hs = config.remindHours;
  const upcoming = hs.filter(h => h < hoursLeft || (h >= hoursLeft && !sent[`${prefix}${h}h`]));
  const pending = hs.filter(h => !sent[`${prefix}${h}h`] && h >= 0);
  const future = hs.filter(h => h < hoursLeft);
  if (future.length === 0) return `残り${hoursLeft.toFixed(1)}h（全タイミング通過済）`;
  const next = future[0];
  const at = new Date(new Date(deadline).getTime() - next * 3600000);
  return `次回: ${next}h前 → ${fmt(at)}頃`;
}

(async () => {
  const filter = (process.argv[2] || '').toLowerCase();
  const events = await firebase.getEvents();
  const db = require('firebase-admin').database();
  const allMappings = (await db.ref('bot_mappings').once('value')).val() || {};
  const allReminders = (await db.ref('bot_reminders').once('value')).val() || {};
  const regMsgs = (await db.ref('bot_registration_messages').once('value')).val() || {};

  const now = Date.now();
  const targets = events.filter(e => {
    if (filter) return (e.title || '').toLowerCase().includes(filter);
    // 既定: 期限が未来 or 登録メッセージがあるイベント
    return regMsgs[e.id] || (e.setlistDeadline && new Date(e.setlistDeadline) > now);
  });

  if (targets.length === 0) { console.log('対象イベントがありません'); process.exit(0); }

  let problems = 0;
  for (const ev of targets) {
    console.log('\n' + '='.repeat(60));
    console.log(`📋 ${ev.title}`);
    console.log(`   id=${ev.id}`);
    console.log(`   提出期限: ${fmt(ev.setlistDeadline)}`);
    console.log(`   登録メッセージ: ${regMsgs[ev.id] ? 'あり' : '❌ なし（/register 未実行）'}`);
    const sent = allReminders[ev.id] || {};
    console.log(`   送信済リマインド: ${Object.keys(sent).join(', ') || 'なし'}`);
    console.log(`   ${nextReminder(ev.setlistDeadline, sent)}`);

    const maps = Object.values(allMappings).filter(m => m && m.eventId === ev.id);
    const pIds = new Set(ev.performers.map(p => p.id));
    const nameCount = {};
    ev.performers.forEach(p => { const n = (p.name || '').trim().toLowerCase(); nameCount[n] = (nameCount[n] || 0) + 1; });

    console.log(`\n   出演者 ${ev.performers.length}名:`);
    for (const p of ev.performers) {
      const m = maps.find(x => x.performerId === p.id);
      const songs = (p.songs || []).length;
      const dup = nameCount[(p.name || '').trim().toLowerCase()] > 1;
      const flags = [];
      if (!m) flags.push('⚠ Discord未リンク（リマインドでメンションされない）');
      if (dup) flags.push('⚠ 同名が複数');
      if (!m || dup) problems++;
      console.log(`   ${m ? '✅' : '❌'} ${p.name || '(名前なし)'}  セトリ${songs}曲  ` +
        (m ? `→ @${m.discordUsername} (${m.discordUserId})` : '') +
        (flags.length ? '\n        ' + flags.join(' / ') : ''));
      const ov = (ev.setlistOverrides || []).find(o => o.performerId === p.id);
      if (ov) console.log(`        個別期限: ${fmt(ov.deadline)}  ${nextReminder(ov.deadline, sent, `override_${p.id}_`)}`);
    }

    // 孤立マッピング（出演者が削除済）
    const orphans = maps.filter(m => !pIds.has(m.performerId));
    for (const o of orphans) {
      problems++;
      console.log(`   🔴 孤立リンク: @${o.discordUsername} → 「${o.performerName}」(出演者データが存在しない)`);
    }
    // 同一Discordユーザーが複数出演者に
    const byUser = {};
    maps.filter(m => pIds.has(m.performerId)).forEach(m => (byUser[m.discordUserId] ||= []).push(m.performerName));
    for (const [uid, names] of Object.entries(byUser)) {
      if (names.length > 1) { problems++; console.log(`   🔴 同一ユーザーが複数登録: ${uid} → ${names.join(', ')}`); }
    }
  }
  console.log('\n' + '='.repeat(60));
  console.log(problems ? `⚠ 要確認項目: ${problems}件` : '✅ 問題は見つかりませんでした');
  process.exit(0);
})().catch(e => { console.error('❌', e); process.exit(1); });
