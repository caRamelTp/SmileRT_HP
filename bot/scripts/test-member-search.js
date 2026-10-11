/* Discord メンバー検索の動作確認（読み取りのみ）  node scripts/test-member-search.js */
process.chdir(require('path').join(__dirname, '..'));
const { Client, GatewayIntentBits } = require('discord.js');
const config = require('../src/config');
const { normalizeDiscord, normalizeName } = require('../src/utils/identity');

const queries = process.argv.slice(2).length ? process.argv.slice(2)
  : ['kita_og', '@Ken04784', 'rudokichi', 'グレートせいやEX', 'くまがい', 'amu.hoozuki', 'not_exist_user_zzz'];

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
client.once('ready', async () => {
  const guild = client.guilds.cache.get(config.guildId);
  for (const q of queries) {
    const query = q.normalize('NFKC').trim().replace(/^@+/, '').replace(/#\d{1,4}$/, '');
    try {
      const res = [...(await guild.members.search({ query, limit: 10 })).values()];
      const byUser = res.filter(m => normalizeDiscord(m.user.username) === normalizeDiscord(q));
      const byName = res.filter(m => [m.displayName, m.nickname, m.user.globalName].filter(Boolean).map(normalizeName).includes(normalizeName(query)));
      const pick = byUser.length === 1 ? byUser[0] : (byUser.length === 0 && byName.length === 1 ? byName[0] : null);
      console.log(`${pick ? '✅' : '—'} 「${q}」 候補${res.length}件 → ` +
        (pick ? `@${pick.user.username}（表示名: ${pick.displayName}）${byUser.length ? ' [ID一致]' : ' [表示名一致]'}` : '特定できず（自動リンクしない）'));
    } catch (e) {
      console.log(`❌ 「${q}」検索エラー: ${e.message}`);
    }
  }
  await client.destroy();
  process.exit(0);
});
client.login(config.token);
