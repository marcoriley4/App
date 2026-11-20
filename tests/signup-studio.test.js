// Run: python3 -m http.server 8766 (in the app folder), then node tests/signup-studio.test.js
// Core screen guard: AI Design Studio inside customer sign-up (step 2, Design), attached to the new account.
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const c = await b.newContext({ ...devices['iPhone 13'] });
  await c.addInitScript(() => { window.TH_AI_MOCK = async () => { const k = document.createElement('canvas'); k.width = 400; k.height = 300; const g = k.getContext('2d'); g.fillStyle = '#2a7'; g.fillRect(0,0,400,300); g.fillStyle='#fff'; g.font='bold 30px sans-serif'; g.fillText('AI DREAM', 120, 160); return k.toDataURL('image/jpeg'); }; });
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const txt = async (s) => ((await p.locator(s).first().textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
  const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };
  await p.goto('http://localhost:8766/'); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.goto('http://localhost:8766/');
  await p.tap('.hero-cta'); await p.waitForSelector('.photo-btn');
  await p.setInputFiles('.photo-btn input', require('path').join(__dirname, 'fixtures', 'before.jpg')); await p.waitForSelector('.photo img');
  await p.tap('.wiz-next button'); await p.waitForSelector('.dream-box');
  ok(await p.locator('.dream-box').count() === 1, 'studio is on the sign-up Design step: ' + await txt('.wiz-part:has-text("Build my dream")'));
  await p.tap('.look:has-text("Modern")');
  await p.tap('.dream-btn'); await p.waitForSelector('.dream-box .ba-slider');
  ok(true, 'dream made inside sign-up: ' + await txt('.dream-box h3'));
  // leave to the home page and come back: nothing lost
  await p.goto('http://localhost:8766/'); await p.tap('.hero-cta'); await p.waitForSelector('.wiz'); await p.tap('.wiz-next button'); await p.waitForSelector('.dream-box');
  ok(await p.locator('.dream-box .ba-slider').count() === 1, 'dream still there after leaving and coming back');
  await p.tap('.wiz-next button'); await p.waitForSelector('.cal-day');
  await p.tap('.chip:has-text("I\'m flexible")');
  await p.fill('input[aria-label="Street address and city"]', '5 Elm St, Springfield'); await p.fill('input[aria-label="ZIP code"]', '62704');
  await p.fill('input[aria-label="Full name"]', 'New Customer'); await p.fill('input[aria-label="Mobile phone"]', '5551112222'); await p.fill('input[aria-label="Email"]', 'newcust' + Date.now() + '@example.com'); await p.fill('input[aria-label="Create a password"]', 'password1');
  await p.tap('.wiz-next button'); await p.waitForSelector('.done-mark');
  await p.goto('http://localhost:8766/#/jobs'); await p.waitForSelector('.job-card');
  const card = p.locator('.job-card').first();
  ok((await card.textContent()).includes('Remodel'), 'project is on the new customer dashboard');
  const imgs = await card.locator('img').count();
  ok(imgs >= 2 || (await card.locator('.ba-slider').count()) > 0, `before + AI picture shown on dashboard card (imgs ${imgs}, slider ${await card.locator('.ba-slider').count()})`);
  ok(!errs.length, 'no page errors ' + JSON.stringify(errs)); await b.close();
})();
