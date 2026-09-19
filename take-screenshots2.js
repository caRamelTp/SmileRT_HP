const puppeteer = require('puppeteer');
const path = require('path');

const GUIDE = path.join(__dirname, 'guide');
const BASE = 'http://127.0.0.1:8765';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function ss(page, name, opts = {}) {
  const fp = path.join(GUIDE, name);
  await page.screenshot({ path: fp, fullPage: opts.fullPage || false, type: 'png' });
  console.log(`  ✓ ${name}`);
}

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  // ===== 出演者ポータル — Step2 + input.html =====
  console.log('\n=== 出演者ポータル Step2 + input ===');
  const p1 = await browser.newPage();
  await p1.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 }); // スマホ幅
  await p1.goto(BASE + '/performer.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3000);

  // Click event even if closed (for screenshot purposes)
  try {
    const evCards = await p1.$$('.event-card');
    if (evCards.length > 0) {
      // Force click by evaluating JS directly
      await p1.evaluate(() => {
        // Find first event card and simulate click
        const cards = document.querySelectorAll('.event-card');
        if (cards.length > 0) {
          // Try triggering the click handler directly
          cards[0].click();
        }
      });
      await sleep(2000);
      
      // Check if step2 is visible
      const step2Visible = await p1.evaluate(() => {
        const s2 = document.getElementById('step2');
        return s2 && s2.style.display !== 'none';
      });
      
      if (step2Visible) {
        await ss(p1, 'new_step2.png', { fullPage: true });
      } else {
        console.log('  ! Step2 not visible, trying direct navigation');
      }
    }
  } catch(e) { console.log('  ! step2 error:', e.message); }

  // Navigate to input.html directly with query params
  try {
    // Get first event ID from Firebase
    const eventId = await p1.evaluate(() => {
      const sel = document.querySelector('#eventSelect, select');
      if (sel && sel.options.length > 1) return sel.options[1].value;
      // Try to get from event cards
      const cards = document.querySelectorAll('.event-card');
      if (cards.length > 0) {
        const onclick = cards[0].getAttribute('onclick') || '';
        const match = onclick.match(/'([^']+)'/);
        if (match) return match[1];
      }
      return null;
    });
    console.log('  Event ID:', eventId);
    
    // Try navigating to input page for first event's first performer
    await p1.goto(BASE + '/input.html' + (eventId ? '?event=' + eventId : ''), { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(4000);
    
    // Profile section
    await p1.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });
    await ss(p1, 'new_step3_profile.png');
    
    // Scroll to setlist
    await p1.evaluate(() => {
      const headings = document.querySelectorAll('h2, h3, .section-title, [class*="setlist"], [class*="song"]');
      for (const h of headings) {
        if (h.textContent && (h.textContent.includes('セットリスト') || h.textContent.includes('セトリ') || h.textContent.includes('曲'))) {
          h.scrollIntoView({ block: 'start' });
          return;
        }
      }
      // Fallback: scroll to middle
      window.scrollTo(0, window.innerHeight * 1.5);
    });
    await sleep(500);
    await ss(p1, 'new_step3_setlist.png');
    
    // Scroll to tech request / photo / save
    await p1.evaluate(() => {
      const headings = document.querySelectorAll('h2, h3, .section-title, .card, [class*="tech"], [class*="photo"]');
      for (const h of headings) {
        if (h.textContent && (h.textContent.includes('技術') || h.textContent.includes('リクエスト') || h.textContent.includes('写真'))) {
          h.scrollIntoView({ block: 'start' });
          return;
        }
      }
      // Fallback: scroll to bottom
      window.scrollTo(0, document.body.scrollHeight - window.innerHeight);
    });
    await sleep(500);
    await ss(p1, 'new_step3_extras.png');
  } catch(e) { console.log('  ! input error:', e.message); }
  await p1.close();

  // ===== 管理画面 — performers, timetable, override =====
  console.log('\n=== 管理画面 ===');
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
  await p2.goto(BASE + '/admin.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);

  // Auth
  try {
    // Type PIN
    await p2.evaluate(() => {
      const inputs = document.querySelectorAll('input[type="password"], input[type="tel"], input[type="number"], #authPin');
      for (const inp of inputs) {
        inp.value = '2525';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await sleep(500);
    // Click auth button
    await p2.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent.includes('ログイン') || b.textContent.includes('認証') || b.id === 'authBtn') {
          b.click();
          return;
        }
      }
      // Try onclick
      const authBtn = document.getElementById('authBtn');
      if (authBtn) authBtn.click();
    });
    await sleep(3000);
  } catch(e) { console.log('  ! auth error:', e.message); }

  // Click event to see performers
  try {
    await p2.evaluate(() => {
      const items = document.querySelectorAll('.event-item, [onclick*="selectEvent"]');
      for (const item of items) {
        const text = item.textContent || '';
        if (text.includes('鬼灯') || text.includes('spin-off')) {
          item.click();
          return;
        }
      }
      if (items.length > 0) items[0].click();
    });
    await sleep(3000);
    await ss(p2, 'new_admin_performers.png');

    // Click timetable tab
    await p2.evaluate(() => {
      const btns = document.querySelectorAll('[data-tab], .tab-btn, button, [role="tab"]');
      for (const b of btns) {
        if (b.textContent && b.textContent.includes('タイムテーブル')) {
          b.click();
          return;
        }
      }
    });
    await sleep(3000);
    await ss(p2, 'new_admin_timetable.png');

    // Go back to performers for override
    await p2.evaluate(() => {
      const btns = document.querySelectorAll('[data-tab], .tab-btn, button, [role="tab"]');
      for (const b of btns) {
        if (b.textContent && b.textContent.includes('出演者')) {
          b.click();
          return;
        }
      }
    });
    await sleep(2000);
    
    // Click override button
    await p2.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent && b.textContent.includes('変更許可')) {
          b.click();
          return;
        }
      }
    });
    await sleep(1500);
    await ss(p2, 'new_admin_override.png');
  } catch(e) { console.log('  ! admin detail error:', e.message); }
  await p2.close();

  // ===== 技術資料 — リハ時間 & 列フィルター =====
  console.log('\n=== 技術資料 リハ+列フィルター ===');
  const p3 = await browser.newPage();
  await p3.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
  await p3.goto(BASE + '/view.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);

  try {
    // Select event
    await p3.evaluate(() => {
      const sel = document.getElementById('eventSelect');
      if (sel && sel.options.length > 1) {
        sel.value = sel.options[1].value;
        sel.dispatchEvent(new Event('change'));
        if (typeof onEventSelect === 'function') onEventSelect(sel.value);
      }
    });
    await sleep(4000);

    // Scroll to timetable header area
    await p3.evaluate(() => {
      const el = document.getElementById('timetableSection');
      if (el) el.scrollIntoView({ block: 'start' });
    });
    await sleep(500);

    // Click rehearsal toggle
    const rehaClicked = await p3.evaluate(() => {
      const btns = document.querySelectorAll('button, label, .toggle, [class*="toggle"], input[type="checkbox"]');
      for (const b of btns) {
        const text = (b.textContent || '') + (b.getAttribute('aria-label') || '');
        if (text.includes('リハ')) {
          b.click();
          return true;
        }
      }
      // Try toggle switch
      const toggles = document.querySelectorAll('.toggle-switch, .switch, input[type="checkbox"]');
      for (const t of toggles) {
        const parent = t.closest('label, div');
        if (parent && parent.textContent.includes('リハ')) {
          t.click();
          return true;
        }
      }
      return false;
    });
    console.log('  Rehearsal toggle clicked:', rehaClicked);
    await sleep(1500);
    await ss(p3, 'new_tech_rehearsal.png');

    // Turn off rehearsal toggle
    if (rehaClicked) {
      await p3.evaluate(() => {
        const btns = document.querySelectorAll('button, label, .toggle, [class*="toggle"], input[type="checkbox"]');
        for (const b of btns) {
          const text = (b.textContent || '') + (b.getAttribute('aria-label') || '');
          if (text.includes('リハ')) { b.click(); return; }
        }
      });
      await sleep(500);
    }

    // Click column filter
    const colClicked = await p3.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent && b.textContent.includes('表示列')) {
          b.click();
          return true;
        }
      }
      return false;
    });
    console.log('  Column filter clicked:', colClicked);
    await sleep(1500);
    await ss(p3, 'new_tech_colfilter.png');
  } catch(e) { console.log('  ! view error:', e.message); }
  await p3.close();

  await browser.close();
  console.log('\n=== 不足分撮影完了 ===');
})();
