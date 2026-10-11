/* 照合ロジックのテスト（実データは変更しない）  node scripts/test-identity.js */
process.chdir(require('path').join(__dirname, '..'));
const { normalizeDiscord, matchScore } = require('../src/utils/identity');
const { isBotCreatedEmpty } = require('../src/services/reconcileService');

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}  →  ${JSON.stringify(got)}${ok ? '' : `（期待値 ${JSON.stringify(want)}）`}`);
};
const member = (username, displayName, globalName, nickname) =>
  ({ user: { username, globalName }, displayName, nickname });

console.log('── 正規化 ──');
t('@付き', normalizeDiscord('@kita_og'), 'kita_og');
t('全角＠・大文字・空白', normalizeDiscord(' ＠Kita_OG '), 'kita_og');
t('旧形式 #1234', normalizeDiscord('kita_og#1234'), 'kita_og');
t('#0', normalizeDiscord('kita_og#0'), 'kita_og');
t('全角英数', normalizeDiscord('ｋｉｔａ＿ｏｇ'), 'kita_og');

console.log('\n── 照合スコア（3=ID一致 2=表示名一致 1=名前一致 0=不一致） ──');
const kita = member('kita_og', 'きいた', 'きいた', null);
t('名前が違ってもIDが同じ', matchScore({ name: "きいた/Tie'", discord: 'kita_og' }, kita), 3);
t('IDに@付きで入力', matchScore({ name: 'Tie', discord: '@Kita_OG' }, kita), 3);
t('discord欄に表示名を入力', matchScore({ name: 'Tie', discord: 'きいた' }, kita), 2);
t('discord欄空・名前が表示名と同じ', matchScore({ name: 'きいた', discord: '' }, kita), 1);
t('名前の空白違い', matchScore({ name: 'くまがい まさひろ', discord: '' }, member('rudokichi', 'くまがい　まさひろ')), 1);
t('別人', matchScore({ name: 'けん', discord: 'ken04784' }, kita), 0);
t('部分一致は不一致扱い（けん≠けんた）', matchScore({ name: 'けん', discord: '' }, member('kenta', 'けんた')), 0);

console.log('\n── 自動削除してよいか（Botが作った空の出演者だけ true） ──');
const map = { discordUsername: 'kita_og' };
t('新Bot作成（マーカー付き・空）', isBotCreatedEmpty({ name: 'きいた', discord: 'kita_og', createdBy: 'discord-bot', songs: [] }, map, ['きいた']), true);
t('Bot作成でもセトリあり', isBotCreatedEmpty({ name: 'きいた', discord: 'kita_og', createdBy: 'discord-bot', songs: [{ title: 'a' }] }, map, ['きいた']), false);
t('旧Bot作成（名前=表示名・Twitter空）', isBotCreatedEmpty({ name: 'きいた', discord: 'kita_og', twitter: '', songs: [] }, map, ['きいた', 'kita_og']), true);
t('サイト登録（別ユニット名・空）は消さない', isBotCreatedEmpty({ name: 'きいた&Tie', discord: 'kita_og', twitter: '', songs: [] }, map, ['きいた', 'kita_og']), false);
t('サイト登録（Twitterあり）は消さない', isBotCreatedEmpty({ name: 'きいた', discord: 'kita_og', twitter: '@tie', songs: [] }, map, ['きいた']), false);

console.log(`\n結果: ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail ? 1 : 0);
