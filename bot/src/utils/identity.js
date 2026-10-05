/* ============================================================
   SmileRT Reminder Bot — Identity helpers
   ============================================================
   Discord ID / 名前の表記ゆれを吸収して比較するための正規化
   ============================================================ */

/**
 * Discord ユーザー名の正規化
 *  "@Kita_OG" / "＠kita_og " / "kita_og#0" / "kita_og#1234" → "kita_og"
 */
function normalizeDiscord(s) {
  if (!s || typeof s !== 'string') return '';
  return s
    .normalize('NFKC')           // 全角→半角
    .trim()
    .replace(/^@+/, '')          // 先頭の @
    .replace(/#\d{1,4}$/, '')    // 旧形式の識別子
    .replace(/\s+/g, '')
    .toLowerCase();
}

/**
 * 名前の正規化（空白・全角半角・大小文字を無視）
 *  "くまがい　まさひろ" → "くまがいまさひろ"
 */
function normalizeName(s) {
  if (!s || typeof s !== 'string') return '';
  return s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

/**
 * Discord メンバーから比較用キーを作る
 */
function memberKeys(member) {
  const user = member.user || member;
  return {
    username: normalizeDiscord(user.username),
    names: [member.displayName, member.nickname, user.globalName, user.username]
      .filter(Boolean)
      .map(normalizeName),
  };
}

/**
 * 出演者とメンバーの一致度
 *  3 = サイトの discord 欄 == Discord ユーザー名（最も確実）
 *  2 = サイトの discord 欄 == 表示名/ニックネーム
 *  1 = 出演者名 == 表示名/ユーザー名
 *  0 = 不一致
 */
function matchScore(performer, member) {
  const k = memberKeys(member);
  const pd = normalizeDiscord(performer.discord);
  const pdName = normalizeName(performer.discord);
  const pn = normalizeName(performer.name);
  if (pd && pd === k.username) return 3;
  if (pdName && k.names.includes(pdName)) return 2;
  if (pn && k.names.includes(pn)) return 1;
  return 0;
}

module.exports = { normalizeDiscord, normalizeName, memberKeys, matchScore };
