/* 照合・統合のエンドツーエンドテスト
   「Firebase共有テスト」イベントに一時データを作り、検証後に必ず削除する
   node scripts/test-reconcile.js */
process.chdir(require('path').join(__dirname, '..'));
const { Client, GatewayIntentBits } = require('discord.js');
const config = require('../src/config');
const firebase = require('../src/firebase');
const { reconcileEvent } = require('../src/services/reconcileService');

const TEST_UID = '1377630909616099469'; // @kita_og（実在メンバー。通知は送らない）
const fakeClient = { channels: { cache: { get: () => null } } }; // #bot管理 に投稿しない

let pass = 0, fail = 0;
const t = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${name} ${extra}`); };

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
client.once('clientReady', async () => {
  const guild = client.guilds.cache.get(config.guildId);
  const ev0 = (await firebase.getEvents()).find(e => e.title === 'Firebase共有テスト');
  if (!ev0) { console.log('テストイベントがありません'); process.exit(1); }
  const EID = ev0.id;
  const created = [];
  const cleanup = async () => {
    for (const id of created) {
      await firebase.removePerformerFromEvent(EID, id).catch(() => {});
      await firebase.deleteMapping(EID, id).catch(() => {});
    }
  };
  const add = async (p) => { const x = firebase.createPerformer(p); created.push(x.id); await firebase.addPerformerToEvent(EID, x); return x; };
  const reload = () => firebase.getEvent(EID);
  const onlyTest = async () => { const e = await reload(); e.performers = e.performers.filter(p => created.includes(p.id)); return e; };

  try {
    // ── ケースB: Discordで先に登録(Bot作成・空) → 後からサイトで別名＋セトリ登録 ──
    console.log('── ケースB: 別名の重複を Discord ID で統合 ──');
    const bot = await add({ name: 'きいた/Tie\'', discord: 'kita_og', createdBy: 'discord-bot' });
    await firebase.setMapping(EID, bot.id, { performerName: bot.name, discordUserId: TEST_UID, discordUsername: 'kita_og' });
    const site = await add({ name: 'Tie（テスト）', discord: '@Kita_OG', twitter: '@x', songs: [{ title: 'テスト曲', artist: 'a' }] });
    await reconcileEvent(fakeClient, guild, await onlyTest(), new Map());
    let ev = await reload();
    t('Bot作成の空の重複が削除された', !ev.performers.some(p => p.id === bot.id));
    t('サイト登録（セトリあり）が残った', ev.performers.some(p => p.id === site.id));
    const m1 = await firebase.getMapping(EID, site.id);
    t('Discordリンクがサイト側に引き継がれた', m1 && m1.discordUserId === TEST_UID, m1 ? `→ @${m1.discordUsername}` : '');
    t('削除側のリンクは消えた', !(await firebase.getMapping(EID, bot.id)));
    await cleanup(); created.length = 0;

    // ── ケースA: サイトだけで登録（discord欄あり・未リンク）→ 自動リンク ──
    console.log('\n── ケースA: サイト登録のみ → Discord ID で自動リンク ──');
    const onlySite = await add({ name: '名前が全然違う人', discord: 'kita_og', twitter: '@y' });
    await reconcileEvent(fakeClient, guild, await onlyTest(), new Map());
    const m2 = await firebase.getMapping(EID, onlySite.id);
    t('discord欄のIDでリンクされた', m2 && m2.discordUserId === TEST_UID, m2 ? `(linkedBy=${m2.linkedBy})` : '');
    await cleanup(); created.length = 0;

    // ── ケースC: 同じ人が別ユニットで2組出演（どちらもサイト登録）→ 削除しない ──
    console.log('\n── ケースC: 同一人物の別ユニット出演 → 削除しない ──');
    const u1 = await add({ name: 'きいたソロ', discord: 'kita_og', twitter: '@a', songs: [{ title: 's1' }] });
    const u2 = await add({ name: 'きいた&ゆにっと', discord: 'kita_og', twitter: '@a' });
    await reconcileEvent(fakeClient, guild, await onlyTest(), new Map());
    ev = await reload();
    t('ソロが残っている', ev.performers.some(p => p.id === u1.id));
    t('別ユニット（空）も削除されていない', ev.performers.some(p => p.id === u2.id));
    await cleanup(); created.length = 0;

    // ── ケースD: 存在しない Discord ID → 何もしない ──
    console.log('\n── ケースD: 存在しないID → 自動リンクしない ──');
    const ghost = await add({ name: '幽霊', discord: 'not_exist_user_zzz' });
    await reconcileEvent(fakeClient, guild, await onlyTest(), new Map());
    t('リンクされない', !(await firebase.getMapping(EID, ghost.id)));
    ev = await reload();
    t('出演者も消されない', ev.performers.some(p => p.id === ghost.id));
  } catch (e) {
    fail++; console.error('❌ テスト中エラー:', e);
  } finally {
    await cleanup();
    const left = (await reload()).performers.filter(p => created.includes(p.id));
    console.log(`\n🧹 後片付け: テストデータ残り ${left.length} 件`);
    try { await firebase.mutateEvent(EID, () => {}); } catch (e) {}
    console.log(`結果: ${pass} 件成功 / ${fail} 件失敗`);
    await client.destroy();
    process.exit(fail ? 1 : 0);
  }
});
client.login(config.token);
