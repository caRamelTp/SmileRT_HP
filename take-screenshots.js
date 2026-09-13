const puppeteer = require('puppeteer');
const path = require('path');

const GUIDE = path.join(__dirname, 'guide');
const BASE = 'http://127.0.0.1:8765';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function screenshot(page, name, opts = {}) {
  const fp = path.join(GUIDE, name);
  await page.screenshot({ path: fp, fullPage: opts.fullPage || false, type: 'png' });
  console.log(`  ✓ ${name}`);
}

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  // ===== 出演者ポータル =====
  console.log('\n=== 出演者ポータル ===');
  const p1 = await browser.newPage();
  await p1.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await p1.goto(BASE + '/performer.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);
  await screenshot(p1, 'new_step1.png', { fullPage: true });

  // Click first event card that is not closed
  try {
    const cards = await p1.$$('.event-card:not(.closed)');
    if (cards.length > 0) {
      await cards[0].click();
      await sleep(2000);
      await screenshot(p1, 'new_step2.png', { fullPage: true });

      // Click first performer name
      const performers = await p1.$$('.performer-item');
      if (performers.length > 0) {
        await performers[0].click();
        await sleep(3000);
        // Now on input.html - screenshot profile section
        await screenshot(p1, 'new_step3_profile.png');

        // Scroll to setlist section
        await p1.evaluate(() => {
          const el = document.querySelector('.setlist-section') || document.querySelector('#songCards') || document.querySelector('h2');
          const sections = document.querySelectorAll('h2, h3');
          for (const s of sections) {
            if (s.textContent.includes('セットリスト') || s.textContent.includes('曲')) {
              s.scrollIntoView({ behavior: 'instant', block: 'start' });
              break;
            }
          }
        });
        await sleep(500);
        await screenshot(p1, 'new_step3_setlist.png');

        // Scroll to bottom (tech request, photo, preview, save)
        await p1.evaluate(() => {
          const sections = document.querySelectorAll('h2, h3, .card');
          for (const s of sections) {
            if (s.textContent && (s.textContent.includes('技術リクエスト') || s.textContent.includes('写真'))) {
              s.scrollIntoView({ behavior: 'instant', block: 'start' });
              break;
            }
          }
        });
        await sleep(500);
        await screenshot(p1, 'new_step3_extras.png');
      }
    }
  } catch (e) { console.log('  ! performer flow error:', e.message); }
  await p1.close();

  // ===== 管理画面 =====
  console.log('\n=== 管理画面 ===');
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
  await p2.goto(BASE + '/admin.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);

  // Enter PIN
  try {
    const pinInput = await p2.$('#authPin, input[type="password"], input[type="tel"]');
    if (pinInput) {
      await pinInput.type('2525');
      await sleep(500);
      const loginBtn = await p2.$('#authBtn, button[onclick*="auth"], .auth-overlay button');
      if (loginBtn) await loginBtn.click();
      await sleep(2000);
    }
  } catch (e) { console.log('  ! auth error:', e.message); }

  await screenshot(p2, 'new_admin_overview.png');

  // Click an event
  try {
    const evItems = await p2.$$('.event-item, .sidebar .event-card, [onclick*="selectEvent"]');
    if (evItems.length > 0) {
      // Try to click the event with data
      for (const item of evItems) {
        const text = await item.evaluate(el => el.textContent);
        if (text && text.includes('5人')) { await item.click(); break; }
      }
      if (!evItems[0]) await evItems[0].click();
      await sleep(2000);
      await screenshot(p2, 'new_admin_performers.png');

      // Click timetable tab
      const tabs = await p2.$$('[data-tab], .tab-btn, button');
      for (const tab of tabs) {
        const text = await tab.evaluate(el => el.textContent);
        if (text && text.includes('タイムテーブル')) {
          await tab.click();
          break;
        }
      }
      await sleep(2000);
      await screenshot(p2, 'new_admin_timetable.png');

      // Try to find override button
      // Go back to performers tab first
      for (const tab of tabs) {
        const text = await tab.evaluate(el => el.textContent);
        if (text && text.includes('出演者')) {
          await tab.click();
          break;
        }
      }
      await sleep(1000);
      const overrideBtns = await p2.$$('button');
      for (const btn of overrideBtns) {
        const text = await btn.evaluate(el => el.textContent);
        if (text && text.includes('変更許可')) {
          await btn.click();
          await sleep(1000);
          await screenshot(p2, 'new_admin_override.png');
          break;
        }
      }
    }
  } catch (e) { console.log('  ! admin flow error:', e.message); }
  await p2.close();

  // ===== 技術資料 =====
  console.log('\n=== 技術資料 ===');
  const p3 = await browser.newPage();
  await p3.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
  await p3.goto(BASE + '/view.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);

  // Select event from dropdown
  try {
    const select = await p3.$('#eventSelect');
    if (select) {
      const options = await p3.$$('#eventSelect option');
      for (const opt of options) {
        const val = await opt.evaluate(el => el.value);
        if (val) {
          await p3.select('#eventSelect', val);
          // Trigger onchange
          await p3.evaluate(() => {
            const sel = document.getElementById('eventSelect');
            sel.dispatchEvent(new Event('change'));
            if (typeof onEventSelect === 'function') onEventSelect(sel.value);
          });
          break;
        }
      }
      await sleep(3000);
      await screenshot(p3, 'new_tech_overview.png');

      // Scroll to timetable
      await p3.evaluate(() => {
        const el = document.getElementById('timetableSection');
        if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
      });
      await sleep(500);
      await screenshot(p3, 'new_tech_timetable.png');

      // Try rehearsal toggle
      const btns = await p3.$$('button');
      for (const btn of btns) {
        const text = await btn.evaluate(el => el.textContent);
        if (text && text.includes('リハ')) {
          await btn.click();
          await sleep(1000);
          await screenshot(p3, 'new_tech_rehearsal.png');
          break;
        }
      }

      // Try column filter
      for (const btn of btns) {
        const text = await btn.evaluate(el => el.textContent);
        if (text && text.includes('表示列')) {
          await btn.click();
          await sleep(1000);
          await screenshot(p3, 'new_tech_colfilter.png');
          // Close it
          await btn.click();
          await sleep(500);
          break;
        }
      }

      // Scroll to performer details
      await p3.evaluate(() => {
        const el = document.getElementById('detailSection');
        if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
      });
      await sleep(500);
      await screenshot(p3, 'new_tech_detail.png');
    }
  } catch (e) { console.log('  ! view flow error:', e.message); }
  await p3.close();

  await browser.close();
  console.log('\n=== 全スクリーンショット完了 ===');
})();
