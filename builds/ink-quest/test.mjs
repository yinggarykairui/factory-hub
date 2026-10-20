// Headless verification for ink-quest. Run with Playwright resolvable, e.g.
//   node --import ./_pw.mjs test.mjs   — or set the import path below.
// Exercises load, the single-choice flow, all three endings, phone width,
// reduced motion, keyboard activation and double-tap guard. Zero console
// errors is a hard requirement (§8 must-pass line 1).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pwPath = process.env.PW_PATH ||
  require.resolve('playwright', { paths: ['/opt/node-tools/node_modules', '/home/user'] });
const _pw = await import(pwPath);
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const url = pathToFileURL(path.resolve('index.html')).href;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('FAIL  ' + m); } };

const browser = await chromium.launch();

async function newPage(opts = {}) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push(String(e)));
  page.errs = errs;
  return { ctx, page };
}

// ---- 1. load + opening scene ----
{
  const { ctx, page } = await newPage();
  await page.goto(url);
  await page.waitForTimeout(300);
  ok(page.errs.length === 0, 'no console errors on load (' + page.errs.join(' | ') + ')');
  const strokes = await page.locator('#scene path.stroke').count();
  ok(strokes > 20, 'opening scene drew many ink strokes: ' + strokes);
  const btns = await page.locator('#choices button').count();
  ok(btns === 3, 'exactly three choices offered: ' + btns);
  ok((await page.locator('#caption').textContent()).includes('wayshrine'), 'caption names the wayshrine');
  ok((await page.locator('#paths').textContent()) === '0', 'endings found starts at 0');
  await ctx.close();
}

// ---- 2. each choice leads to its own distinct ending ----
const endings = [
  { idx: 0, cap: "sword's road", need: 'blade comes free' },
  { idx: 1, cap: 'kept flame',   need: 'wick catches' },
  { idx: 2, cap: "raven's wood",  need: 'leave the sword' },
];
for (const e of endings) {
  const { ctx, page } = await newPage();
  await page.goto(url);
  await page.waitForTimeout(150);
  await page.locator('#choices button').nth(e.idx).click();
  await page.waitForTimeout(150);
  const cap = (await page.locator('#caption').textContent()).toLowerCase();
  ok(cap.includes(e.cap), 'choice ' + e.idx + ' → caption "' + e.cap + '" (got "' + cap + '")');
  const story = (await page.locator('#story').textContent()).toLowerCase();
  ok(story.includes(e.need), 'ending ' + e.idx + ' shows its own prose');
  ok((await page.locator('#story .cost').count()) === 1, 'ending ' + e.idx + ' shows a single cost line');
  ok((await page.locator('#paths').textContent()) === '1', 'endings found advanced to 1');
  const restart = page.locator('.restart button');
  ok((await restart.count()) === 1, 'a Restart button is offered');
  // no second choice is possible from an ending (only the restart button)
  ok((await page.locator('#choices button').count()) === 1, 'no further choice from the ending');
  ok(page.errs.length === 0, 'no console errors through ending ' + e.idx + ' (' + page.errs.join(' | ') + ')');
  await ctx.close();
}

// ---- 3. paths-found persists across replays; all three discoverable ----
{
  const { ctx, page } = await newPage();
  await page.goto(url);
  await page.waitForTimeout(120);
  for (let i = 0; i < 3; i++) {
    await page.locator('#choices button').nth(i).click();
    await page.waitForTimeout(100);
    await page.locator('.restart button').click();
    await page.waitForTimeout(100);
  }
  ok((await page.locator('#paths').textContent()) === '3', 'all three endings counted after replays');
  ok((await page.locator('#hint').textContent()).includes('every ending found'), 'hint reports completion');
  ok(page.errs.length === 0, 'no console errors across full replay (' + page.errs.join(' | ') + ')');
  await ctx.close();
}

// ---- 4. phone width: no horizontal overflow ----
for (const w of [320, 360, 414]) {
  const { ctx, page } = await newPage({ viewport: { width: w, height: 680 } });
  await page.goto(url);
  await page.waitForTimeout(120);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(over <= 1, 'no horizontal overflow at ' + w + 'px (overflow ' + over + ')');
  const box = await page.locator('#choices button').first().boundingBox();
  ok(box && box.height >= 44, 'choice button is tappable (>=44px) at ' + w + 'px: ' + (box && Math.round(box.height)));
  await ctx.close();
}

// ---- 5. reduced motion: strokes fully drawn immediately ----
{
  const { ctx, page } = await newPage({ reducedMotion: 'reduce' });
  await page.goto(url);
  await page.waitForTimeout(80);
  const offset = await page.evaluate(() => {
    const p = document.querySelector('#scene path.stroke');
    return getComputedStyle(p).strokeDashoffset;
  });
  ok(offset === '0px' || offset === '0', 'reduced-motion renders final frame (dashoffset ' + offset + ')');
  await ctx.close();
}

// ---- 6. keyboard: Tab to a choice and activate with Enter ----
{
  const { ctx, page } = await newPage();
  await page.goto(url);
  await page.waitForTimeout(120);
  await page.locator('#choices button').first().focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  ok((await page.locator('#caption').textContent()).toLowerCase().includes('road'), 'Enter on a focused choice activates it');
  ok(page.errs.length === 0, 'no console errors via keyboard (' + page.errs.join(' | ') + ')');
  await ctx.close();
}

// ---- 7. double/rapid click only takes one choice ----
{
  const { ctx, page } = await newPage();
  await page.goto(url);
  await page.waitForTimeout(120);
  const first = page.locator('#choices button').nth(0);
  await first.click({ clickCount: 1 });
  // a second rapid click on what is now a disabled/replaced button must not re-fire
  await page.locator('#choices button').nth(0).click().catch(() => {});
  await page.waitForTimeout(120);
  ok((await page.locator('#paths').textContent()) === '1', 'rapid double-click still records one ending');
  await ctx.close();
}

// ---- 8. regression: draw-on is a quick sketch, capped (fix: subject-last pacing) ----
{
  const { ctx, page } = await newPage();
  await page.goto(url);
  await page.waitForTimeout(80);
  const maxDelay = await page.evaluate(() => {
    let m = 0;
    for (const n of document.querySelectorAll('#scene .stroke, #scene .fade')) {
      const d = parseFloat(getComputedStyle(n).animationDelay) || 0; // seconds
      if (d > m) m = d;
    }
    return m;
  });
  ok(maxDelay <= 1.35, 'draw-on stagger is capped at ~1.3s (max delay ' + maxDelay.toFixed(2) + 's)');
  await ctx.close();
}

// ---- 9. regression: flying ravens render in the raven ending (fix: raven shape) ----
{
  const { ctx, page } = await newPage();
  await page.goto(url);
  await page.waitForTimeout(100);
  await page.locator('#choices button').nth(2).click();
  await page.waitForTimeout(150);
  const fills = await page.locator('#scene path.fade').count();
  ok(fills >= 8, 'raven ending composes multiple filled ink shapes (birds + figure): ' + fills);
  ok(page.errs.length === 0, 'no console errors in raven ending (' + page.errs.join(' | ') + ')');
  await ctx.close();
}

// ---- 10. regression: no dead road() helper left in source ----
{
  const fs = await import('node:fs');
  const src = fs.readFileSync('index.html', 'utf8');
  ok(!/function road\s*\(/.test(src), 'no unused road() helper in source');
}

await browser.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
