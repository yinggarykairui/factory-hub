// Headless checks for Ember Vale (increment 1). Drives the SHIPPED index.html
// over a file:// URL — never a replica. Fails on any console error or page
// error, at any point. Prints "PASS n/n" and exits non-zero on any failure.
import { fileURLToPath } from 'url';
import path from 'path';
import { createRequire } from 'module';
// Playwright is installed outside this folder's node_modules tree; require()
// consults the environment's global paths where a bare ESM import does not.
const { chromium } = createRequire(import.meta.url)('playwright');

const dir = path.dirname(fileURLToPath(import.meta.url));
const url = 'file://' + path.join(dir, 'index.html');
const shot = path.join(dir, 'screenshot.png');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; failures.push(name); console.log('  FAIL- ' + name); }
}

const consoleErrors = [];

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });

  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

  const wait = ms => page.waitForTimeout(ms);
  const ev = fn => page.evaluate(fn);
  const releaseAll = () => ev(() => { ['up','down','left','right'].forEach(d => window.__ev.release(d)); window.__ev.dismiss(); });

  await page.goto(url);
  await page.waitForFunction(() => window.__ev && window.__ev.state);
  await wait(60);

  // 1 — title screen renders, Enter starts play.
  check('boots on the title screen', await ev(() => window.__ev.state) === 'title');
  check('six readable objects authored', await ev(() => window.__ev.signCount) === 6);
  check('map is larger than the viewport in both dims', await ev(() => {
    const m = window.__ev.map, v = window.__ev.view; return m.w * m.tile > v.w && m.h * m.tile > v.h;
  }));
  await page.keyboard.press('Enter');
  check('Enter begins play', await ev(() => window.__ev.state) === 'play');

  // 2 — 4-directional movement (WASD + arrows).
  await ev(() => window.__ev.place(20, 12, 'down'));
  let before = await ev(() => window.__ev.player.x);
  await page.keyboard.down('d'); await wait(180); await page.keyboard.up('d');
  check('WASD moves the player (right)', (await ev(() => window.__ev.player.x)) > before + 4);
  before = await ev(() => window.__ev.player.y);
  await page.keyboard.down('ArrowUp'); await wait(180); await page.keyboard.up('ArrowUp');
  check('arrow keys move the player (up)', (await ev(() => window.__ev.player.y)) < before - 4);
  await releaseAll();

  // 3 — axis-separated collision: slide along a wall, no corner clip, cannot enter solids.
  // Slide: against the left tree-wall (col 1), pushing left+down keeps X pinned but Y slides.
  const slide = await ev(() => {
    window.__ev.place(2, 9, 'left');
    const x0 = window.__ev.player.x, y0 = window.__ev.player.y;
    window.__ev.press('left'); window.__ev.press('down');
    for (let i = 0; i < 40; i++) window.__ev.step(40);
    const r = { x0, y0, x1: window.__ev.player.x, y1: window.__ev.player.y, tx: window.__ev.player.tx };
    window.__ev.release('left'); window.__ev.release('down');
    return r;
  });
  check('slides along a wall (X pinned)', Math.abs(slide.x1 - slide.x0) < 6 && slide.tx === 2);
  check('slides along a wall (Y advances)', slide.y1 > slide.y0 + 20);

  // No corner clip: into a concave corner (left tree + top cliff), both axes blocked → no motion.
  const corner = await ev(() => {
    window.__ev.place(2, 2, 'up');
    window.__ev.press('up'); window.__ev.press('left');
    for (let i = 0; i < 30; i++) window.__ev.step(40);
    const r = { tx: window.__ev.player.tx, ty: window.__ev.player.ty };
    window.__ev.release('up'); window.__ev.release('left');
    return r;
  });
  check('no corner clip (stays in its tile)', corner.tx === 2 && corner.ty === 2);

  // Cannot enter water.
  const water = await ev(() => {
    window.__ev.place(6, 13, 'down'); // one tile above the stream (rows 14-15 are water)
    window.__ev.press('down');
    for (let i = 0; i < 40; i++) window.__ev.step(40);
    const r = window.__ev.solid(window.__ev.player.tx, window.__ev.player.ty) === false && window.__ev.player.ty <= 13;
    window.__ev.release('down');
    return { blocked: r, ty: window.__ev.player.ty };
  });
  check('cannot walk into water', water.blocked);

  // 4 — camera follows and clamps to the world edge at a corner.
  const tl = await ev(() => { window.__ev.place(2, 2, 'up'); const c = window.__ev.camera; return { x: c.x, y: c.y }; });
  check('camera clamps at the top-left corner', tl.x === 0 && tl.y === 0);
  const br = await ev(() => {
    window.__ev.place(37, 27, 'down');
    const m = window.__ev.map, v = window.__ev.view, c = window.__ev.camera;
    return { x: c.x, y: c.y, mx: m.w * m.tile - v.w, my: m.h * m.tile - v.h };
  });
  check('camera clamps at the bottom-right corner', br.x === br.mx && br.y === br.my);

  // 5 — facing-aware reading, movement frozen, dismiss returns control.
  const faceWrong = await ev(() => {
    window.__ev.dismiss(); window.__ev.place(20, 26, 'up'); // faces path, not the sign at (21,26)
    window.__ev.action(); return window.__ev.reading;
  });
  check('does not read a non-object it faces', faceWrong === false);
  const read = await ev(() => {
    window.__ev.place(20, 26, 'right'); // faces the signpost at (21,26)
    window.__ev.action();
    return { reading: window.__ev.reading, state: window.__ev.state, text: window.__ev.signText };
  });
  check('facing a signpost + action opens the box', read.reading && read.state === 'reading' && read.text.length > 10);
  const frozen = await ev(() => {
    const x0 = window.__ev.player.x;
    window.__ev.press('right'); for (let i = 0; i < 20; i++) window.__ev.step(40); window.__ev.release('right');
    return window.__ev.player.x === x0;
  });
  check('movement is frozen while reading', frozen);
  check('action again dismisses the box', await ev(() => { window.__ev.action(); return window.__ev.state === 'play' && !window.__ev.reading; }));
  check('Escape also dismisses', await ev(() => {
    window.__ev.place(20, 26, 'right'); window.__ev.action();
    const open = window.__ev.reading; window.__ev.dismiss();
    return open && !window.__ev.reading;
  }));
  const ember = await ev(() => {
    window.__ev.place(20, 5, 'up'); // faces the Ember at (20,4)
    window.__ev.action(); const t = window.__ev.signText; const r = window.__ev.reading; window.__ev.dismiss();
    return { r, t };
  });
  check('the Ember reads its own line', ember.r && /Ember/i.test(ember.t));

  // 6 — usable at 360px: no horizontal scroll, touch controls present and functional.
  await page.setViewportSize({ width: 360, height: 720 });
  await wait(50);
  const hscroll = await ev(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
  check('no horizontal page scroll at 360px', hscroll.s <= hscroll.w);
  check('d-pad is visible at 360px', await page.locator('.dpad .up').isVisible());
  check('A button is visible at 360px', await page.locator('#btnA').isVisible());
  await ev(() => { window.__ev.dismiss(); window.__ev.place(20, 12, 'down'); });
  let ty0 = await ev(() => window.__ev.player.y);
  await page.locator('.dpad .up').dispatchEvent('pointerdown');
  await wait(220);
  await page.locator('.dpad .up').dispatchEvent('pointerup');
  check('d-pad actually moves the player', (await ev(() => window.__ev.player.y)) < ty0 - 3);
  await releaseAll();
  await ev(() => window.__ev.place(20, 26, 'right'));
  await page.locator('#btnA').dispatchEvent('pointerdown');
  check('A button triggers a read', await ev(() => window.__ev.reading));
  await ev(() => window.__ev.dismiss());

  // 7 — reduced motion disables the Ember pulse, the walk bob, and vignette breathing.
  await ev(() => window.__ev.setReducedMotion(true));
  const g1 = await ev(() => { window.__ev.step(300); return window.__ev.emberGlowRadius(); });
  const g2 = await ev(() => { window.__ev.step(700); return window.__ev.emberGlowRadius(); });
  check('reduced motion freezes the Ember pulse', g1 === 150 && g2 === 150);
  const bobR = await ev(() => {
    window.__ev.place(10, 10, 'right'); window.__ev.press('right');
    let m = 0; for (let i = 0; i < 12; i++) { window.__ev.step(50); m = Math.max(m, Math.abs(window.__ev.walkBob())); }
    window.__ev.release('right'); return m;
  });
  check('reduced motion freezes the walk bob', bobR === 0);
  await ev(() => window.__ev.setReducedMotion(false));
  const vary = await ev(() => { const a = window.__ev.emberGlowRadius(); window.__ev.step(500); const b = window.__ev.emberGlowRadius(); return Math.abs(a - b); });
  check('the Ember pulses when motion is allowed', vary > 0.01);
  const bobOn = await ev(() => {
    window.__ev.place(10, 10, 'right'); window.__ev.press('right');
    let m = 0; for (let i = 0; i < 24; i++) { window.__ev.step(40); m = Math.max(m, Math.abs(window.__ev.walkBob())); }
    window.__ev.release('right'); return m;
  });
  check('the walk bob is active when motion is allowed', bobOn > 0.1);

  // 8 — survives garbage input: key mashing, opposing dirs, action spam, rapid resize.
  await ev(() => {
    const keys = ['a','b','c','x','z','q','Shift','Control','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','s',' ','Enter','Escape','1','F5'];
    for (let i = 0; i < 300; i++) {
      const k = keys[(Math.random() * keys.length) | 0];
      window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
      if (Math.random() < 0.5) window.dispatchEvent(new KeyboardEvent('keyup', { key: k }));
    }
    window.__ev.press('left'); window.__ev.press('right'); window.__ev.press('up'); window.__ev.press('down');
    for (let i = 0; i < 80; i++) { window.__ev.step(16); window.__ev.action(); window.__ev.dismiss(); }
    ['up','down','left','right'].forEach(d => window.__ev.release(d));
  });
  for (let i = 0; i < 10; i++) { await page.setViewportSize({ width: 300 + i * 48, height: 380 + i * 36 }); }
  check('survives garbage input without crashing', (await ev(() => window.__ev.state)) != null);

  // Console / page errors must be clean across the whole run.
  check('zero console errors across the run', consoleErrors.length === 0);
  if (consoleErrors.length) consoleErrors.forEach(e => console.log('    ! ' + e));

  // Screenshot — the real running build, framed near the Ember at dusk.
  await page.setViewportSize({ width: 960, height: 640 });
  await ev(() => { window.__ev.setReducedMotion(false); window.__ev.dismiss(); window.__ev.place(20, 6, 'up'); });
  await wait(300); // let the glow and fireflies settle into a frame
  await page.screenshot({ path: shot });
  console.log('  screenshot ->', shot);

  await browser.close();

  console.log('\nPASS ' + pass + '/' + (pass + fail));
  if (fail) { console.log('Failures: ' + failures.join(', ')); process.exit(1); }
}

main().catch(e => { console.error(e); process.exit(1); });
