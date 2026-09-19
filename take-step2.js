const puppeteer = require('puppeteer');
const path = require('path');
const GUIDE = path.join(__dirname, 'guide');
const BASE = 'http://127.0.0.1:8765';
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const p = await browser.newPage();
  await p.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });
  await p.goto(BASE + '/performer.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3000);

  // Force show step2 by manipulating DOM
  await p.evaluate(() => {
    const step1 = document.getElementById('step1');
    const step2 = document.getElementById('step2');
    if (step1) step1.style.display = 'none';
    if (step2) {
      step2.style.display = '';
      // Update selected event name
      const evName = document.getElementById('selectedEventName');
      if (evName) evName.textContent = '鬼灯生誕-26';
    }
    // Update step dots
    const dot1 = document.getElementById('stepDot1');
    const dot2 = document.getElementById('stepDot2');
    const line1 = document.getElementById('stepLine1');
    if (dot1) dot1.classList.remove('active');
    if (dot2) dot2.classList.add('active');
    if (line1) line1.classList.add('done');

    // Add mock performers to the list
    const list = document.getElementById('performerPickList');
    if (list) {
      list.innerHTML = `
        <div class="performer-pick" style="padding:1rem;border:1px solid #e5e7eb;border-radius:12px;margin-bottom:0.8rem;cursor:pointer;display:flex;align-items:center;gap:0.8rem;background:var(--bg-card, #fff)">
          <span style="width:12px;height:12px;border-radius:50%;background:#6899be;flex-shrink:0"></span>
          <div style="flex:1"><strong>晴むぅ</strong><div style="font-size:0.82rem;color:#6b7280">夜明けと蛍 / ミュージック・アワー / 少年時代 / それが大事</div></div>
        </div>
        <div class="performer-pick" style="padding:1rem;border:1px solid #e5e7eb;border-radius:12px;margin-bottom:0.8rem;cursor:pointer;display:flex;align-items:center;gap:0.8rem;background:var(--bg-card, #fff)">
          <span style="width:12px;height:12px;border-radius:50%;background:#ff3b30;flex-shrink:0"></span>
          <div style="flex:1"><strong>けん</strong><div style="font-size:0.82rem;color:#6b7280">うどん / エアーマンが倒せない / unravel / カミサマネジマキ</div></div>
        </div>
        <div class="performer-pick" style="padding:1rem;border:1px solid #e5e7eb;border-radius:12px;margin-bottom:0.8rem;cursor:pointer;display:flex;align-items:center;gap:0.8rem;background:var(--bg-card, #fff)">
          <span style="width:12px;height:12px;border-radius:50%;background:#ffd60a;flex-shrink:0"></span>
          <div style="flex:1"><strong>れもねーど</strong><div style="font-size:0.82rem;color:#6b7280">祝福 / ウタカタララバイ / ハレンチ / ...</div></div>
        </div>
        <div class="performer-pick" style="padding:1rem;border:1px solid #e5e7eb;border-radius:12px;margin-bottom:0.8rem;cursor:pointer;display:flex;align-items:center;gap:0.8rem;background:var(--bg-card, #fff)">
          <span style="width:12px;height:12px;border-radius:50%;background:#30d5c8;flex-shrink:0"></span>
          <div style="flex:1"><strong>くまがい</strong><div style="font-size:0.82rem;color:#6b7280">炎のたからもの / メロディー / 銀河鉄道999</div></div>
        </div>
        <div class="performer-pick" style="padding:1rem;border:1px solid #e5e7eb;border-radius:12px;margin-bottom:0.8rem;cursor:pointer;display:flex;align-items:center;gap:0.8rem;background:var(--bg-card, #fff)">
          <span style="width:12px;height:12px;border-radius:50%;background:#ff9500;flex-shrink:0"></span>
          <div style="flex:1"><strong>鬼灯</strong><div style="font-size:0.82rem;color:#6b7280">革命道中 / この夜に乾杯 / モザイクロール / ...</div></div>
        </div>
      `;
    }
  });
  await sleep(500);
  await p.screenshot({ path: path.join(GUIDE, 'new_step2.png'), fullPage: true, type: 'png' });
  console.log('  ✓ new_step2.png');

  await browser.close();
  console.log('=== Step2撮影完了 ===');
})();
