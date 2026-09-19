const puppeteer = require('puppeteer');
const path = require('path');
const GUIDE = path.join(__dirname, 'guide');
const BASE = 'http://127.0.0.1:8765';
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const p = await browser.newPage();
  await p.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });
  await p.goto(BASE + '/input.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(4000);

  // Scroll to show the song card content (past profile section)
  // Profile section is about 1000px tall, then "セットリスト" heading, then song cards
  await p.evaluate(() => {
    // Find the song number badge "1曲目" element
    const songNum = document.querySelector('.song-number');
    if (songNum) {
      songNum.scrollIntoView({ block: 'start' });
      window.scrollBy(0, -30);
      return;
    }
    // Fallback: scroll by pixel amount
    window.scrollTo(0, 1100);
  });
  await sleep(500);
  await p.screenshot({ path: path.join(GUIDE, 'new_step3_setlist.png'), type: 'png' });
  console.log('  ✓ new_step3_setlist.png');

  await browser.close();
  console.log('=== done ===');
})();
