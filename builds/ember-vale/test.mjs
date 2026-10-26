// Headless checks for Ember Vale (increments 1-2). Drives the SHIPPED
// index.html over a file:// URL — never a replica. Fails on any console error
// or page error, at any point. Prints "PASS n/n" and exits non-zero on any
// failure. Sections 1-8/7b cover the overworld (increment 1); 9-13 cover the
// people and the branching, flag-gated dialogue (increment 2).
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
  // Sample the glow across a full pulse period (step() clamps dt to 40ms, so
  // 120 steps ≈ 4.8s > the ~4.1s period) and assert the spread — deterministic
  // regardless of the starting phase, unlike a single two-sample delta.
  const spread = await ev(() => {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < 120; i++) { window.__ev.step(40); const r = window.__ev.emberGlowRadius(); if (r < mn) mn = r; if (r > mx) mx = r; }
    return mx - mn;
  });
  check('the Ember pulses when motion is allowed', spread > 20);
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

  // ================= increment 2: the people who stayed =================

  // 9 — NPCs placed, solid, approachable; you cannot walk through a person.
  await ev(() => window.__ev.dismiss());
  const npcs = await ev(() => window.__ev.npcs);
  check('three NPCs are placed', npcs.length === 3 && npcs.every(n => n.id && n.name));
  check('every NPC tile is solid (cannot be walked through)',
    await ev(() => window.__ev.npcs.every(n => window.__ev.solid(n.tx, n.ty) === true)));
  check('every NPC is reachable (a walkable orthogonal neighbour)', await ev(() =>
    window.__ev.npcs.every(n => [[1,0],[-1,0],[0,1],[0,-1]].some(d => !window.__ev.solid(n.tx + d[0], n.ty + d[1])))));
  const blockedByNpc = await ev(() => {
    const w = window.__ev.npcs.find(n => n.id === 'warden');
    const dirs = { '1,0': 'right', '-1,0': 'left', '0,1': 'down', '0,-1': 'up' };
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = w.tx - dx, ny = w.ty - dy;                 // a free tile on the opposite side
      if (!window.__ev.solid(nx, ny)) {
        const dir = dirs[dx + ',' + dy];
        window.__ev.place(nx, ny, dir); window.__ev.press(dir);
        for (let i = 0; i < 40; i++) window.__ev.step(40);
        window.__ev.release(dir);
        return window.__ev.player.tx === w.tx && window.__ev.player.ty === w.ty;
      }
    }
    return true;
  });
  check('cannot walk onto a person\'s tile', blockedByNpc === false);

  // 10 — one interact button, dispatched by the front tile.
  const faceWarden = await ev(() => {
    window.__ev.dismiss(); window.__ev.place(20, 8, 'right');      // faces the Warden at (21,8)
    window.__ev.action(); const d = window.__ev.dialog();
    return { state: window.__ev.state, speaker: d && d.speaker, reading: window.__ev.reading };
  });
  check('facing a person + action opens a conversation', faceWarden.state === 'dialog' && faceWarden.speaker === 'The Warden');
  check('a conversation is not a read (states never overlap)', faceWarden.reading === false);
  await ev(() => window.__ev.dismiss());
  const faceSign = await ev(() => {
    window.__ev.place(20, 26, 'right'); window.__ev.action();      // the signpost at (21,26)
    return { reading: window.__ev.reading, dialog: window.__ev.dialog() };
  });
  check('facing a signpost still opens a plain read', faceSign.reading === true && faceSign.dialog === null);
  await ev(() => window.__ev.dismiss());
  check('action facing no one does nothing', await ev(() => {
    window.__ev.place(20, 10, 'left'); window.__ev.action();       // faces open ground
    return window.__ev.state === 'play' && window.__ev.dialog() === null && !window.__ev.reading;
  }));

  // 11 — pages advance; a node with choices branches, and the branch changes the text.
  const paged = await ev(() => {
    window.__ev.dismiss(); window.__ev.place(20, 8, 'right'); window.__ev.action();
    const p0 = window.__ev.dialog().page, pages = window.__ev.dialog().pages;
    window.__ev.action();                                          // page 2
    const p1 = window.__ev.dialog().page;
    window.__ev.action();                                          // past the last page -> choices
    const d = window.__ev.dialog();
    return { p0, pages, p1, choosing: d.choosing, n: d.choices ? d.choices.length : 0 };
  });
  check('a multi-page node advances page by page', paged.p0 === 0 && paged.pages === 2 && paged.p1 === 1);
  check('the last page reveals the choices', paged.choosing === true && paged.n === 3);
  const branchWhy = await ev(() => { window.__ev.dialogPick(0); return window.__ev.dialog().text; });
  check('picking a choice branches into its node', /Nothing killed it/.test(branchWhy));
  const abandoned = await ev(() => { window.__ev.dismiss(); return { state: window.__ev.state, quest: window.__ev.flags.questStarted }; });
  check('Esc/dismiss abandons a conversation', abandoned.state === 'play');
  check('abandoning before the charge leaves the quest unset', abandoned.quest === false);
  const endChoice = await ev(() => {
    window.__ev.place(20, 8, 'right'); window.__ev.action(); window.__ev.action(); window.__ev.action(); // to the choices
    window.__ev.dialogPick(2);                                     // "(keep your own counsel)" — end:true
    return window.__ev.state;
  });
  check('an end-choice closes the conversation', endChoice === 'play');

  // 12 — flag-gating: capture pre-quest openings, complete the Warden, confirm they changed.
  const preMira = await ev(() => { window.__ev.place(6, 24, 'up'); window.__ev.action(); const t = window.__ev.dialog().text; window.__ev.dismiss(); return t; });
  const preBram = await ev(() => { window.__ev.place(16, 23, 'up'); window.__ev.action(); const t = window.__ev.dialog().text; window.__ev.dismiss(); return t; });
  const questSet = await ev(() => {
    window.__ev.place(20, 8, 'right'); window.__ev.action(); window.__ev.action(); window.__ev.action(); // to the choices
    window.__ev.dialogPick(1);                                     // "How can I help?" -> the charge
    window.__ev.action(); window.__ev.action();                    // read the charge, resolve
    return { state: window.__ev.state, quest: window.__ev.flags.questStarted, heard: window.__ev.flags.wardenHeard };
  });
  check('the Warden\'s charge sets the main-quest flag', questSet.quest === true && questSet.heard === true && questSet.state === 'play');
  const postMira = await ev(() => { window.__ev.place(6, 24, 'up'); window.__ev.action(); const t = window.__ev.dialog().text; window.__ev.dismiss(); return t; });
  const postBram = await ev(() => { window.__ev.place(16, 23, 'up'); window.__ev.action(); const t = window.__ev.dialog().text; window.__ev.dismiss(); return t; });
  check('Mira\'s opening changes after the quest starts', preMira !== postMira && /latched the shutters/.test(preMira) && /Warden sent you/.test(postMira));
  check('Bram\'s opening changes after the quest starts', preBram !== postBram && /firekeeper/.test(preBram) && /emberseeds/.test(postBram));

  // 7b — the A button works on a REAL touch tap. A tap fires both a pointer
  // event and a touch event; the first build bound action() to both and the
  // read box opened then closed (net no-op on phones). Needs a touch context;
  // a synthetic pointerdown (above) fires only one handler and cannot catch it.
  {
    const tctx = await browser.newContext({ viewport: { width: 360, height: 720 }, hasTouch: true, isMobile: true });
    const tp = await tctx.newPage();
    tp.on('console', m => { if (m.type() === 'error') consoleErrors.push('console(touch): ' + m.text()); });
    tp.on('pageerror', e => consoleErrors.push('pageerror(touch): ' + e.message));
    await tp.goto(url);
    await tp.waitForFunction(() => window.__ev && window.__ev.state);
    await tp.locator('#btnA').tap();
    check('tap on A begins the game from the title', (await tp.evaluate(() => window.__ev.state)) === 'play');
    await tp.evaluate(() => { window.__ev.dismiss(); window.__ev.place(20, 26, 'right'); });
    await tp.locator('#btnA').tap();
    check('tap on A opens a read (single-fire, not a toggle no-op)', (await tp.evaluate(() => window.__ev.reading)) === true);
    // The read box must not sit behind the on-screen controls on a phone
    // (the day-069 evening MAJOR): the D-pad hides while reading, and the box
    // bottom lifts clear of the action button's top. Checked portrait + landscape.
    const clears = async () => tp.evaluate(() => {
      const dpadHidden = getComputedStyle(document.querySelector('.dpad')).display === 'none';
      const box = window.__ev.readBox();
      const aTop = document.getElementById('btnA').getBoundingClientRect().top;
      return { dpadHidden, boxBottom: box && box.bottom, aTop };
    });
    let ov = await clears();
    check('reading hides the dead D-pad (phone portrait)', ov.dpadHidden);
    check('read box clears the action button (phone portrait)', ov.boxBottom != null && ov.boxBottom <= ov.aTop);
    await tp.setViewportSize({ width: 740, height: 360 });  // landscape phone
    await tp.waitForTimeout(50);
    ov = await clears();
    check('read box clears the action button (phone landscape)', ov.boxBottom != null && ov.boxBottom <= ov.aTop);
    await tp.setViewportSize({ width: 360, height: 720 });
    await tp.waitForTimeout(50);
    await tp.locator('#btnA').tap();
    check('tap on A again dismisses the read', (await tp.evaluate(() => window.__ev.reading === false && window.__ev.state === 'play')));
    await tctx.close();
  }

  // 13 — a conversation on a phone: choices are tappable, the box clears the
  // controls, and tapping a choice row takes that branch (fresh flags: Bram's
  // pre-quest intro, which has two choices).
  {
    const dc = await browser.newContext({ viewport: { width: 360, height: 720 }, hasTouch: true, isMobile: true });
    const dp = await dc.newPage();
    dp.on('console', m => { if (m.type() === 'error') consoleErrors.push('console(dialog): ' + m.text()); });
    dp.on('pageerror', e => consoleErrors.push('pageerror(dialog): ' + e.message));
    await dp.goto(url);
    await dp.waitForFunction(() => window.__ev && window.__ev.state);
    await dp.locator('#btnA').tap();                               // begin
    await dp.evaluate(() => window.__ev.place(16, 23, 'up'));       // face Bram at (16,22)
    await dp.locator('#btnA').tap();                               // open the conversation
    check('tap opens a conversation on a phone', (await dp.evaluate(() => { const d = window.__ev.dialog(); return d && d.speaker; })) === 'Bram');
    for (let i = 0; i < 4 && !(await dp.evaluate(() => { const d = window.__ev.dialog(); return d && d.choosing; })); i++) await dp.locator('#btnA').tap();
    check('a phone conversation reaches its choices', await dp.evaluate(() => window.__ev.dialog().choosing === true));
    const ov = await dp.evaluate(() => {
      const box = window.__ev.dialogBox();
      const aTop = document.getElementById('btnA').getBoundingClientRect().top;
      const dpadHidden = getComputedStyle(document.querySelector('.dpad')).display === 'none';
      return { bottom: box && box.bottom, aTop, dpadHidden };
    });
    check('the conversation box clears the action button (phone)', ov.bottom != null && ov.bottom <= ov.aTop);
    check('talking hides the dead D-pad (phone)', ov.dpadHidden);
    const rect = await dp.evaluate(() => window.__ev.dialogChoiceRects()[0]);
    await dp.touchscreen.tap(rect.x + rect.w / 2, rect.y + rect.h / 2);
    const afterPick = await dp.evaluate(() => { const d = window.__ev.dialog(); return { choosing: d && d.choosing, text: d && d.text }; });
    check('tapping a choice row takes that branch', afterPick.choosing === false && /I'll tell Mum/.test(afterPick.text));
    await dp.locator('#btnA').tap();                               // resolve the branch's end node
    check('resolving the branch sets its flag and closes', await dp.evaluate(() => window.__ev.flags.bramEased === true && window.__ev.state === 'play'));
    await dc.close();
  }

  // Console / page errors must be clean across the whole run.
  check('zero console errors across the run', consoleErrors.length === 0);
  if (consoleErrors.length) consoleErrors.forEach(e => console.log('    ! ' + e));

  // Screenshot — a real running frame on a fresh page (clean flags): meeting the
  // Warden by the heart at dusk, the conversation open on its branching choices.
  {
    const sp = await browser.newPage({ viewport: { width: 960, height: 640 } });
    await sp.goto(url);
    await sp.waitForFunction(() => window.__ev && window.__ev.state);
    await sp.evaluate(() => {
      window.__ev.start(); window.__ev.setReducedMotion(false);
      window.__ev.place(20, 8, 'right');                    // stand before the Warden
      window.__ev.action(); window.__ev.action(); window.__ev.action(); // open -> page 2 -> choices
    });
    await sp.waitForTimeout(340);                           // let the glow settle into a frame
    await sp.screenshot({ path: shot });
    await sp.close();
  }
  console.log('  screenshot ->', shot);

  await browser.close();

  console.log('\nPASS ' + pass + '/' + (pass + fail));
  if (fail) { console.log('Failures: ' + failures.join(', ')); process.exit(1); }
}

main().catch(e => { console.error(e); process.exit(1); });
