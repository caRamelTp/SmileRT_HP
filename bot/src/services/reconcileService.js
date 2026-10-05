/* ============================================================
   SmileRT Reminder Bot — Reconcile Service
   ============================================================
   サイトの出演者データと Discord メンバーを Discord ID で照合する。

   ケースA: サイトで登録（discord欄あり）→ Discord未リンク
            → discord欄のIDでサーバーメンバーを探して自動リンク
   ケースB: Discordで登録（Botが空の出演者を作成）→ 後からサイトで別名で登録
            → 同じ Discord ユーザーの重複を検出し、サイト側に統合
              （Botが作った「空の」出演者だけを削除。リンクは引き継ぐ）
   ケースC: 判断できない重複（両方にデータ / 両方サイト登録）
            → 自動削除はせず #bot管理 に1回だけ通知
              （同じ人が別ユニットで複数出演するケースを誤削除しないため）
   ============================================================ */

const firebase = require('../firebase');
const config = require('../config');
const { normalizeDiscord, normalizeName } = require('../utils/identity');

let running = false;

function hasContent(p) {
  return (p.songs && p.songs.length > 0) ||
    !!(p.techRequests && String(p.techRequests).trim()) ||
    !!p.iconUrl;
}

function isActiveEvent(ev) {
  if (!ev.setlistDeadline) return false;
  return new Date(ev.setlistDeadline).getTime() + 2 * 86400000 > Date.now(); // 期限+2日まで
}

/**
 * Botが作成した空の出演者か
 *  - createdBy マーカー付き（新しい Bot が作成）
 *  - 旧データ: 中身なし & Twitter空 & discord欄=リンク先ユーザー名 & 出演者名=Discord表示名
 */
function isBotCreatedEmpty(p, mapping, memberNames = []) {
  if (hasContent(p)) return false;
  if (p.createdBy === 'discord-bot') return true;
  return !p.twitter && !!mapping &&
    normalizeDiscord(p.discord) === normalizeDiscord(mapping.discordUsername) &&
    memberNames.includes(normalizeName(p.name));
}

/**
 * discord欄の文字列からサーバーメンバーを1人に特定（見つからない/複数なら null）
 */
async function resolveMember(guild, discordValue, cache) {
  const key = normalizeDiscord(discordValue);
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);

  let found = null;
  try {
    const query = discordValue.normalize('NFKC').trim().replace(/^@+/, '').replace(/#\d{1,4}$/, '');
    const results = await guild.members.search({ query: query.slice(0, 32), limit: 10 });
    const list = [...results.values()];
    const byUsername = list.filter(m => normalizeDiscord(m.user.username) === key);
    if (byUsername.length === 1) {
      found = byUsername[0];                       // ユーザー名(ID)一致 = 最も確実
    } else if (byUsername.length === 0) {
      const nk = normalizeName(query);
      const byName = list.filter(m =>
        [m.displayName, m.nickname, m.user.globalName].filter(Boolean).map(normalizeName).includes(nk));
      if (byName.length === 1) found = byName[0];  // 表示名が一意に一致した場合のみ
    }
  } catch (e) {
    console.log(`⚠ メンバー検索失敗 (${discordValue}): ${e.message}`);
  }
  cache.set(key, found);
  return found;
}

async function notifyAdmin(client, text) {
  const ch = client.channels.cache.get(config.channels.admin);
  if (ch) await ch.send(text).catch(() => {});
}

async function notifyOnce(client, eventId, ids, text) {
  const key = 'dup_' + [...ids].sort().join('_').replace(/[.#$\[\]\/]/g, '');
  if (await firebase.hasNotice(eventId, key)) return;
  await notifyAdmin(client, text);
  await firebase.markNotice(eventId, key);
}

/**
 * 1イベント分の照合
 * @returns {boolean} 変更があったか
 */
async function reconcileEvent(client, guild, ev, memberCache) {
  let changed = false;
  const mappings = await firebase.getMappingsByEvent(ev.id); // 孤立リンクはここで自動掃除
  const byPerformer = new Map(mappings.map(m => [m.performerId, m]));
  const resolvedUid = new Map(); // 未リンク出演者 → discord欄から特定したユーザーID

  // ── ケースA: 未リンク出演者を discord欄 のIDで自動リンク ──
  for (const p of ev.performers) {
    if (byPerformer.has(p.id) || !p.discord) continue;
    const member = await resolveMember(guild, p.discord, memberCache);
    if (!member) continue;
    const uid = member.user.id;
    resolvedUid.set(p.id, uid);

    if (mappings.some(m => m.discordUserId === uid)) continue; // 既に別の出演者にリンク済 → 下で重複処理

    const m = {
      eventId: ev.id, performerId: p.id, performerName: p.name,
      discordUserId: uid, discordUsername: member.user.username,
    };
    await firebase.setMapping(ev.id, p.id, { ...m, linkedBy: 'auto-discord-id' });
    mappings.push(m);
    byPerformer.set(p.id, m);
    changed = true;
    console.log(`🔗 自動リンク: ${ev.title} / ${p.name} → @${member.user.username}`);
    await notifyAdmin(client, `🔗 Discord IDで自動リンクしました: 「**${p.name}**」→ <@${uid}>（${ev.title}）`);
  }

  // ── ケースB/C: 同じ Discord ユーザーに属する出演者をグループ化 ──
  const groups = new Map(); // uid → performers[]
  for (const p of ev.performers) {
    const uid = byPerformer.get(p.id)?.discordUserId || resolvedUid.get(p.id);
    if (!uid) continue;
    if (!groups.has(uid)) groups.set(uid, []);
    groups.get(uid).push(p);
  }

  for (const [uid, list] of groups) {
    if (list.length < 2) continue;
    const userMap = mappings.find(m => m.discordUserId === uid);
    const member = await guild.members.fetch(uid).catch(() => null);
    const memberNames = member
      ? [member.displayName, member.nickname, member.user.globalName, member.user.username].filter(Boolean).map(normalizeName)
      : [];

    // 削除してよいのは「Botが作った空の出演者」だけ
    const deletable = list.filter(p => isBotCreatedEmpty(p, byPerformer.get(p.id) || userMap, memberNames));
    const keepers = list.filter(p => !deletable.includes(p));

    let keep = null;
    if (keepers.length === 1) keep = keepers[0];                 // サイト側が1件 → それを残す
    else if (keepers.length === 0) keep = deletable.find(p => byPerformer.has(p.id)) || deletable[0]; // 全部Bot作成の空 → 1件残す

    if (!keep) {
      await notifyOnce(client, ev.id, list.map(p => p.id),
        `⚠ **同じDiscordユーザー（<@${uid}>）の出演者が複数あります**（${ev.title}）\n` +
        list.map(p => `　・「${p.name}」セトリ${(p.songs || []).length}曲`).join('\n') +
        `\n別ユニットでの複数出演の可能性があるため自動削除していません。\n` +
        `重複であれば、不要な方を #出演者登録 の削除メニューで消してください。`);
      continue;
    }

    const toDelete = list.filter(p => p.id !== keep.id && deletable.includes(p));
    if (toDelete.length === 0) continue;

    // 個別期限が削除側にだけあれば引き継ぐ
    const overrides = ev.setlistOverrides || [];
    const moveOv = overrides.some(o => o.performerId === keep.id)
      ? null : overrides.find(o => toDelete.some(d => d.id === o.performerId));

    for (const d of toDelete) {
      await firebase.removePerformerFromEvent(ev.id, d.id);
      byPerformer.delete(d.id);
    }
    if (!byPerformer.has(keep.id) && userMap) {
      await firebase.setMapping(ev.id, keep.id, {
        performerName: keep.name,
        discordUserId: uid,
        discordUsername: userMap.discordUsername,
        linkedBy: 'auto-merge',
      });
    }
    if (moveOv) {
      await firebase.mutateEvent(ev.id, e => {
        const ov = Array.isArray(e.setlistOverrides) ? e.setlistOverrides : Object.values(e.setlistOverrides || {});
        ov.push({ ...moveOv, performerId: keep.id });
        e.setlistOverrides = ov;
      });
    }
    changed = true;
    const names = toDelete.map(p => `「${p.name}」`).join('、');
    console.log(`🧩 統合: ${ev.title} / ${names} → ${keep.name}`);
    await notifyAdmin(client,
      `🧩 同じDiscordユーザーの重複をまとめました（${ev.title}）\n` +
      `　残した出演者: 「**${keep.name}**」→ <@${uid}>（セトリ${(keep.songs || []).length}曲）\n` +
      `　削除した空の重複（Discord登録時に自動作成）: ${names}`);
  }

  return changed;
}

/**
 * 全アクティブイベントを照合
 */
async function reconcileAll(client) {
  if (running) return;
  running = true;
  try {
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) { console.log('⚠ 照合: サーバーが見つかりません'); return; }
    const events = (await firebase.getEvents()).filter(isActiveEvent);
    const memberCache = new Map();
    for (const ev of events) {
      try {
        const changed = await reconcileEvent(client, guild, ev, memberCache);
        if (changed) {
          const { refreshRegistrationMessage } = require('../handlers/buttonHandler');
          await refreshRegistrationMessage(client, ev.id);
        }
      } catch (e) {
        console.error(`❌ 照合エラー (${ev.title}):`, e.message);
      }
    }
  } finally {
    running = false;
  }
}

function startReconcileService(client) {
  const run = () => reconcileAll(client).catch(e => console.error('❌ 照合エラー:', e));
  setTimeout(run, 5000);                 // 起動5秒後
  setInterval(run, 10 * 60 * 1000);      // 以降10分ごと
  console.log('🔍 Discord ID 照合サービス開始（10分ごと）');
}

module.exports = { startReconcileService, reconcileAll, reconcileEvent, isBotCreatedEmpty, hasContent };
