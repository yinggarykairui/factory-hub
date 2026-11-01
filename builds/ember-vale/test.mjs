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
  // Make a page deterministic: freeze its rAF loop AND seed Math.random (a fixed
  // mulberry32) so every page's fuzz is reproducible run to run. Call it right
  // after each page's __ev is ready, before any check drives it.
  const freeze = (p) => p.evaluate(() => {
    window.__ev.pauseLoop();
    var s = 0x1234567 >>> 0;
    Math.random = function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });

  await page.goto(url);
  await page.waitForFunction(() => window.__ev && window.__ev.state);
  // Determinism, two parts:
  //  (1) Freeze the rAF loop right after load so ONLY explicit step() calls
  //      advance the sim — no wall-clock leaks between evaluate() round-trips.
  //      The few checks that exercise REAL keyboard/d-pad motion resume it
  //      briefly (and pause again); the screenshot page runs the loop live.
  //  (2) Seed the in-page RNG. The fuzz sections below call Math.random() to
  //      place() the traveler on random tiles; an unseeded run can land on a
  //      world-item tile and consume it, flaking a later check (the lantern
  //      errand). index.html itself uses no Math.random, so seeding is safe and
  //      makes the whole run reproducible (deterministic by construction).
  await freeze(page);
  await wait(60);

  // 1 — title screen renders, Enter starts play.
  check('boots on the title screen', await ev(() => window.__ev.state) === 'title');
  check('six readable objects authored', await ev(() => window.__ev.signCount) === 6);
  check('map is larger than the viewport in both dims', await ev(() => {
    const m = window.__ev.map, v = window.__ev.view; return m.w * m.tile > v.w && m.h * m.tile > v.h;
  }));
  await page.keyboard.press('Enter');
  check('Enter begins play', await ev(() => window.__ev.state) === 'play');

  // 2 — 4-directional movement (WASD + arrows). Real key events + wall-clock
  // motion, so the live loop runs for this block, then is frozen again.
  await ev(() => window.__ev.resumeLoop());
  await ev(() => window.__ev.place(20, 12, 'down'));
  let before = await ev(() => window.__ev.player.x);
  await page.keyboard.down('d'); await wait(180); await page.keyboard.up('d');
  check('WASD moves the player (right)', (await ev(() => window.__ev.player.x)) > before + 4);
  before = await ev(() => window.__ev.player.y);
  await page.keyboard.down('ArrowUp'); await wait(180); await page.keyboard.up('ArrowUp');
  check('arrow keys move the player (up)', (await ev(() => window.__ev.player.y)) < before - 4);
  await releaseAll();
  await ev(() => window.__ev.pauseLoop());

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
  await ev(() => window.__ev.resumeLoop());        // real d-pad hold -> wall-clock motion
  await page.locator('.dpad .up').dispatchEvent('pointerdown');
  await wait(220);
  await page.locator('.dpad .up').dispatchEvent('pointerup');
  check('d-pad actually moves the player', (await ev(() => window.__ev.player.y)) < ty0 - 3);
  await releaseAll();
  await ev(() => window.__ev.pauseLoop());
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
    await freeze(tp);
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

  // 13 — a conversation on a phone: pages clear the action button, choices are
  // tappable, and (the day-071 critic's MAJOR) a tall multi-choice reply never
  // spills out of the box or over the controls — portrait and landscape.
  {
    const dc = await browser.newContext({ viewport: { width: 360, height: 720 }, hasTouch: true, isMobile: true });
    const dp = await dc.newPage();
    dp.on('console', m => { if (m.type() === 'error') consoleErrors.push('console(dialog): ' + m.text()); });
    dp.on('pageerror', e => consoleErrors.push('pageerror(dialog): ' + e.message));
    await dp.goto(url);
    await dp.waitForFunction(() => window.__ev && window.__ev.state);
    await freeze(dp);
    await dp.locator('#btnA').tap();                               // begin
    await dp.evaluate(() => window.__ev.place(16, 23, 'up'));       // face Bram at (16,22)
    await dp.locator('#btnA').tap();                               // open the conversation (page 0)
    check('tap opens a conversation on a phone', (await dp.evaluate(() => { const d = window.__ev.dialog(); return d && d.speaker; })) === 'Bram');
    // while reading pages the action button shows and the box clears it; D-pad hidden.
    const reading = await dp.evaluate(() => {
      const box = window.__ev.dialogBox();
      const a = document.getElementById('btnA');
      return { bottom: box && box.bottom, aTop: a.getBoundingClientRect().top,
               aShown: getComputedStyle(a).display !== 'none',
               dpadHidden: getComputedStyle(document.querySelector('.dpad')).display === 'none' };
    });
    check('a page box clears the action button (phone)', reading.aShown && reading.bottom != null && reading.bottom <= reading.aTop);
    check('talking hides the dead D-pad (phone)', reading.dpadHidden);
    for (let i = 0; i < 4 && !(await dp.evaluate(() => { const d = window.__ev.dialog(); return d && d.choosing; })); i++) await dp.locator('#btnA').tap();
    check('a phone conversation reaches its choices', await dp.evaluate(() => window.__ev.dialog().choosing === true));
    await dp.waitForTimeout(60);                                   // let a frame apply the .choosing class
    // while choosing the action button hides (choices are tapped), so no control
    // can overlap and the box has the whole bottom to itself.
    const choosing = await dp.evaluate(() => {
      const box = window.__ev.dialogBox(), vh = window.__ev.view.h;
      const rects = window.__ev.dialogChoiceRects();
      const aHidden = getComputedStyle(document.querySelector('.act')).display === 'none' &&
                      document.getElementById('btnA').getBoundingClientRect().width === 0;
      const inBox = rects.every(r => r.y >= box.top - 0.5 && r.y + r.h <= box.bottom + 0.5);
      return { aHidden, top: box.top, bottom: box.bottom, vh, inBox, n: rects.length };
    });
    check('while choosing, the action button hides (no control overlaps the box)', choosing.aHidden);
    check('the choosing box stays fully on-screen (phone portrait)', choosing.top >= 0 && choosing.bottom <= choosing.vh && choosing.inBox);
    const rect = await dp.evaluate(() => window.__ev.dialogChoiceRects()[0]);
    await dp.touchscreen.tap(rect.x + rect.w / 2, rect.y + rect.h / 2);
    const afterPick = await dp.evaluate(() => { const d = window.__ev.dialog(); return { choosing: d && d.choosing, text: d && d.text }; });
    check('tapping a choice row takes that branch', afterPick.choosing === false && /I'll tell Mum/.test(afterPick.text));
    await dp.locator('#btnA').tap();                               // resolve the branch's end node
    check('resolving the branch sets its flag and closes', await dp.evaluate(() => window.__ev.flags.bramEased === true && window.__ev.state === 'play'));

    // the regression: the Warden's 3-choice reply on a short landscape phone.
    // (fresh flags on this page: questStarted is still false, so warden_intro — 3 choices.)
    await dp.setViewportSize({ width: 568, height: 320 });
    await dp.waitForTimeout(40);
    await dp.evaluate(() => { window.__ev.dismiss(); window.__ev.place(20, 8, 'right'); });  // face the Warden
    await dp.locator('#btnA').tap(); await dp.locator('#btnA').tap(); await dp.locator('#btnA').tap(); // to the 3 choices
    await dp.waitForTimeout(60);
    const land = await dp.evaluate(() => {
      const d = window.__ev.dialog(); if (!d || !d.choosing) return { ok: false };
      const box = window.__ev.dialogBox(), vh = window.__ev.view.h, rects = window.__ev.dialogChoiceRects();
      const bottom = box.bottom;
      const allInBox = rects.length === 3 && rects.every(r => r.y >= box.top - 0.5 && r.y + r.h <= bottom + 0.5);
      const onScreen = box.top >= 0 && bottom <= vh && rects.every(r => r.y + r.h <= vh);
      return { ok: true, n: rects.length, allInBox, onScreen, bottom, vh };
    });
    check('the Warden\'s 3-choice reply fits the box on a landscape phone', land.ok && land.n === 3 && land.allInBox && land.onScreen);
    await dc.close();
  }

  // ================= increment 3: what you carry =================
  // Items placed in the world, picked up by walking onto them; a bag/inventory
  // panel; a persistent seed HUD; and a locked door the iron key gates.

  // 14 — items exist on non-solid, reachable tiles; seed C is sealed by the door.
  await ev(() => window.__ev.dismiss());
  const items = await ev(() => window.__ev.items);
  check('four items placed (three emberseeds + an iron key)',
    items.length === 4 && items.filter(i => i.kind === 'seed').length === 3 && items.filter(i => i.kind === 'key').length === 1);
  check('every world item sits on a non-solid (walkable) tile',
    await ev(() => window.__ev.items.every(it => window.__ev.solid(it.tx, it.ty) === false)));
  // BFS over non-solid tiles from the spawn, with the door first shut then open.
  const reach = await ev(() => {
    const doors = window.__ev.doors;
    const isDoor = (x, y) => doors.some(d => d.tx === x && d.ty === y);
    function bfs(doorOpen) {
      const seen = new Set(['20,26']); const q = [[20, 26]];
      while (q.length) { const [x, y] = q.shift();
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
          if (seen.has(k)) continue;
          let s = window.__ev.solid(nx, ny);
          if (doorOpen && isDoor(nx, ny)) s = false;
          if (!s) { seen.add(k); q.push([nx, ny]); }
        }
      }
      return seen;
    }
    const closed = bfs(false), open = bfs(true);
    const it = window.__ev.items, at = id => it.find(i => i.id === id);
    const r = (id, set) => { const i = at(id); return i ? set.has(i.tx + ',' + i.ty) : null; };
    return {
      aClosed: r('seedA', closed), bClosed: r('seedB', closed), keyClosed: r('ironKey', closed),
      cClosed: r('seedC', closed), cOpen: r('seedC', open)
    };
  });
  check('seeds A & B and the iron key are reachable on foot', reach.aClosed === true && reach.bClosed === true && reach.keyClosed === true);
  check('seed C is sealed — reachable only after the door opens', reach.cClosed === false && reach.cOpen === true);

  // walk onto an item to pick it up: gone from the world, into the bag, toast.
  const pickA = await ev(() => {
    window.__ev.dismiss();
    window.__ev.place(15, 13, 'left');                 // one tile east of seed A (14,13)
    const nBefore = window.__ev.items.length, bagBefore = window.__ev.bag.length;
    window.__ev.press('left'); for (let i = 0; i < 30; i++) window.__ev.step(40); window.__ev.release('left');
    return { nBefore, bagBefore, nAfter: window.__ev.items.length, bagAfter: window.__ev.bag.length,
             toast: window.__ev.toast, seeds: window.__ev.seeds,
             inBag: window.__ev.bag.some(b => b.id === 'seedA'), inWorld: window.__ev.items.some(i => i.id === 'seedA') };
  });
  check('walking onto an item removes it from the world', pickA.nAfter === pickA.nBefore - 1 && pickA.inWorld === false);
  check('walking onto an item adds it to the bag', pickA.bagAfter === pickA.bagBefore + 1 && pickA.inBag === true);
  check('a pickup floats a toast', /Picked up an emberseed/.test(pickA.toast));
  check('the seed HUD rises to 1/3 on pickup', pickA.seeds === 1);

  // a locked door without the key stays shut, names what is needed, and blocks.
  const noKey = await ev(() => {
    window.__ev.dismiss();
    const hadKey = window.__ev.bag.some(b => b.kind === 'key');
    window.__ev.place(26, 22, 'down'); window.__ev.action();       // face the door (26,23), try it
    const toast = window.__ev.toast, locked = window.__ev.doorLocked(26, 23), solidD = window.__ev.solid(26, 23);
    window.__ev.press('down'); for (let i = 0; i < 20; i++) window.__ev.step(40); window.__ev.release('down');
    return { hadKey, toast, locked, solidD, blockedTy: window.__ev.player.ty, cInWorld: window.__ev.items.some(i => i.id === 'seedC') };
  });
  check('a locked door without the key stays shut and names what is needed',
    noKey.hadKey === false && noKey.locked === true && noKey.solidD === true && /lock/i.test(noKey.toast) && /iron/i.test(noKey.toast));
  check('the locked door blocks the way to seed C', noKey.blockedTy === 22 && noKey.cInWorld === true);

  // collect seed B and the key, then the key turns the door, then seed C.
  const run = await ev(() => {
    const log = {};
    window.__ev.dismiss();
    window.__ev.place(32, 7, 'up'); window.__ev.press('up'); for (let i = 0; i < 24; i++) window.__ev.step(40); window.__ev.release('up');   // seed B (32,6)
    log.seedsB = window.__ev.seeds; log.bGone = !window.__ev.items.some(i => i.id === 'seedB');
    window.__ev.place(32, 21, 'right'); window.__ev.press('right'); for (let i = 0; i < 24; i++) window.__ev.step(40); window.__ev.release('right'); // key (33,21)
    log.hasKey = window.__ev.bag.some(b => b.kind === 'key');
    log.lockedBefore = window.__ev.doorLocked(26, 23);
    window.__ev.place(26, 22, 'down'); window.__ev.action();       // key turns the door
    log.unlockToast = window.__ev.toast; log.lockedAfter = window.__ev.doorLocked(26, 23); log.solidAfter = window.__ev.solid(26, 23);
    log.keyStays = window.__ev.bag.some(b => b.kind === 'key');     // not consumed
    window.__ev.place(26, 22, 'down'); window.__ev.press('down'); for (let i = 0; i < 24; i++) window.__ev.step(40); window.__ev.release('down'); // seed C (26,24)
    log.seedsC = window.__ev.seeds; log.cGone = !window.__ev.items.some(i => i.id === 'seedC');
    log.remaining = window.__ev.items.length;
    return log;
  });
  check('the second emberseed is collected (HUD 2/3)', run.seedsB === 2 && run.bGone === true);
  check('the iron key is collected', run.hasKey === true);
  check('the iron key turns the locked door (solid while shut, walkable after)',
    run.lockedBefore === true && run.lockedAfter === false && run.solidAfter === false && /iron key turns/.test(run.unlockToast));
  check('the key stays in the bag after use (not consumed)', run.keyStays === true);
  check('seed C, sealed behind the door, is collected only after unlocking (HUD 3/3)', run.seedsC === 3 && run.cGone === true);
  check('all three seeds collected and the world emptied of items', run.remaining === 0);

  // 15 — the inventory panel (desktop paths): open/close, listing, freeze, select.
  await ev(() => window.__ev.dismiss());
  await page.keyboard.press('i');
  check('the I key opens the bag', await ev(() => window.__ev.inventoryOpen === true && window.__ev.state === 'inventory'));
  check('the bag lists what you carry with names and one-line descriptions',
    await ev(() => { const b = window.__ev.bag; return b.length === 4 && b.every(it => it.name.length > 0 && it.desc.length > 0) && window.__ev.seeds === 3; }));
  check('movement is frozen while the bag is open', await ev(() => {
    const x0 = window.__ev.player.x;
    window.__ev.press('right'); for (let i = 0; i < 20; i++) window.__ev.step(40); window.__ev.release('right');
    return window.__ev.player.x === x0 && window.__ev.inventoryOpen === true;
  }));
  const selKb = await ev(() => {
    window.__ev.inventorySelect(0); const s0 = window.__ev.inventorySel;
    window.__ev.inventoryMove(1); const s1 = window.__ev.inventorySel;
    window.__ev.inventoryMove(-1); window.__ev.inventoryMove(-1); const sw = window.__ev.inventorySel;   // wrap past 0
    return { s0, s1, sw, n: window.__ev.bag.length };
  });
  check('bag selection moves and wraps with the keyboard pokes', selKb.s0 === 0 && selKb.s1 === 1 && selKb.sw === selKb.n - 1);
  await ev(() => window.__ev.inventorySelect(0));
  await page.keyboard.press('ArrowRight');
  check('arrow keys move the bag selection', (await ev(() => window.__ev.inventorySel)) === 1);
  await wait(50);
  check('the bag exposes a view-space hit-rect per slot',
    await ev(() => { const r = window.__ev.inventorySlotRects(); return r.length === 4 && r.every(s => s.w > 0 && s.h > 0); }));
  await page.keyboard.press('Escape');
  check('Esc closes the bag', await ev(() => window.__ev.state === 'play' && window.__ev.inventoryOpen === false));
  await page.keyboard.press('i');
  await ev(() => window.__ev.action());
  check('action closes the bag', await ev(() => window.__ev.state === 'play'));
  await page.keyboard.press('i');
  check('I reopens the bag', await ev(() => window.__ev.inventoryOpen === true));
  await page.keyboard.press('i');
  check('the I key also closes the bag', await ev(() => window.__ev.state === 'play'));

  // 16 — reduced motion freezes the seed glow and the panel; motion lets it breathe.
  const seedRM = await ev(() => {
    window.__ev.setReducedMotion(true);
    const a = window.__ev.seedGlowRadius(); window.__ev.step(300); const b = window.__ev.seedGlowRadius(); window.__ev.step(400); const c = window.__ev.seedGlowRadius();
    if (window.__ev.state === 'play') window.__ev.toggleInventory();
    const p0 = window.__ev.inventoryBox(); window.__ev.step(500); const p1 = window.__ev.inventoryBox();
    window.__ev.dismiss();
    window.__ev.setReducedMotion(false);
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < 120; i++) { window.__ev.step(40); const r = window.__ev.seedGlowRadius(); if (r < mn) mn = r; if (r > mx) mx = r; }
    return { rmConst: a === b && b === c, panelConst: !!(p0 && p1) && p0.top === p1.top && p0.bottom === p1.bottom, spread: mx - mn };
  });
  check('reduced motion freezes the emberseed glow', seedRM.rmConst === true);
  check('the bag panel geometry is static under reduced motion', seedRM.panelConst === true);
  check('the emberseed glow breathes when motion is allowed', seedRM.spread > 2);

  // 17 — empty bag opens and renders cleanly ("Nothing yet.", no slots).
  {
    const ep = await browser.newPage({ viewport: { width: 900, height: 600 } });
    ep.on('console', m => { if (m.type() === 'error') consoleErrors.push('console(empty): ' + m.text()); });
    ep.on('pageerror', e => consoleErrors.push('pageerror(empty): ' + e.message));
    await ep.goto(url);
    await ep.waitForFunction(() => window.__ev && window.__ev.state);
    await freeze(ep);
    await ep.evaluate(() => { window.__ev.start(); window.__ev.toggleInventory(); });
    await ep.waitForTimeout(80);
    const empty = await ep.evaluate(() => ({ open: window.__ev.inventoryOpen, n: window.__ev.bag.length,
      rects: window.__ev.inventorySlotRects().length, box: window.__ev.inventoryBox(), sel: window.__ev.inventorySel }));
    check('an empty bag opens and renders with no slots', empty.open === true && empty.n === 0 && empty.rects === 0 && empty.box && empty.box.bottom > empty.box.top);
    await ep.close();
  }

  // 18 — the bag on a phone, portrait + landscape: the HUD opens it, the panel
  // fits and clears the controls, no horizontal scroll, slots are tappable.
  const noOverlap = (p, c) => p.right <= c.left || p.left >= c.right || p.bottom <= c.top || p.top >= c.bottom;
  {
    const ic = await browser.newContext({ viewport: { width: 360, height: 720 }, hasTouch: true, isMobile: true });
    const ip = await ic.newPage();
    ip.on('console', m => { if (m.type() === 'error') consoleErrors.push('console(bag): ' + m.text()); });
    ip.on('pageerror', e => consoleErrors.push('pageerror(bag): ' + e.message));
    await ip.goto(url);
    await ip.waitForFunction(() => window.__ev && window.__ev.state);
    await freeze(ip);
    await ip.locator('#btnA').tap();                               // begin
    await ip.evaluate(() => {
      window.__ev.place(15, 13, 'left'); window.__ev.press('left'); for (let i = 0; i < 30; i++) window.__ev.step(40); window.__ev.release('left');   // seed A
      window.__ev.place(32, 21, 'right'); window.__ev.press('right'); for (let i = 0; i < 24; i++) window.__ev.step(40); window.__ev.release('right'); // key
    });
    check('the seed HUD shows the count on a phone', (await ip.evaluate(() => document.getElementById('btnBag').textContent)).indexOf('/3') >= 0);

    const probe = async (label) => {
      await ip.locator('#btnBag').tap();                           // open the bag via the HUD
      await ip.waitForTimeout(60);
      const d = await ip.evaluate(() => {
        const box = window.__ev.inventoryBox(), rects = window.__ev.inventorySlotRects();
        const a = document.getElementById('btnA').getBoundingClientRect();
        const hud = document.getElementById('btnBag').getBoundingClientRect();
        return { open: window.__ev.inventoryOpen, box, rects, vw: window.__ev.view.w, vh: window.__ev.view.h,
          a: { left: a.left, right: a.right, top: a.top, bottom: a.bottom },
          hud: { left: hud.left, right: hud.right, top: hud.top, bottom: hud.bottom },
          scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth };
      });
      check('tapping the HUD opens the bag (' + label + ')', d.open === true);
      check('the bag panel fits on-screen (' + label + ')',
        d.box.top >= 0 && d.box.bottom <= d.vh && d.box.left >= 0 && d.box.right <= d.vw);
      check('the bag panel clears the controls (' + label + ')',
        noOverlap(d.box, d.a) && noOverlap(d.box, d.hud));
      check('no horizontal page scroll with the bag open (' + label + ')', d.scrollW <= d.innerW);
      check('slots sit inside the panel (' + label + ')',
        d.rects.length >= 2 && d.rects.every(r => r.y >= d.box.top - 0.5 && r.y + r.h <= d.box.bottom + 0.5 && r.x >= d.box.left - 0.5 && r.x + r.w <= d.box.right + 0.5));
      const r1 = d.rects[1];
      await ip.touchscreen.tap(r1.x + r1.w / 2, r1.y + r1.h / 2);
      check('tapping a slot selects it (' + label + ')', (await ip.evaluate(() => window.__ev.inventorySel)) === 1);
      await ip.locator('#btnBag').tap();                           // close via the HUD
      check('tapping the HUD again closes the bag (' + label + ')', (await ip.evaluate(() => window.__ev.state === 'play')));
    };
    await probe('phone portrait');
    await ip.setViewportSize({ width: 568, height: 320 });
    await ip.waitForTimeout(50);
    await probe('phone landscape');
    await ic.close();
  }

  // 19 — garbage input around the new systems: mash toggles, pickups, door tries
  // and resizes mid-panel. State never goes null and no error escapes.
  await ev(() => {
    const dirs = ['up', 'down', 'left', 'right'];
    for (let i = 0; i < 160; i++) {
      if (Math.random() < 0.5) window.__ev.toggleInventory();
      window.__ev.inventoryMove((Math.random() * 3 | 0) - 1);
      window.__ev.inventorySelect((Math.random() * 6 | 0));
      window.__ev.place((Math.random() * 38 | 0) + 1, (Math.random() * 28 | 0) + 1, dirs[Math.random() * 4 | 0]);
      window.__ev.action();
      window.__ev.step(16);
    }
    ['i', 'I', 'Escape', ' ', 'ArrowLeft', 'ArrowRight'].forEach(k => window.dispatchEvent(new KeyboardEvent('keydown', { key: k })));
    window.__ev.dismiss();
  });
  for (let i = 0; i < 8; i++) {
    await page.setViewportSize({ width: 320 + i * 40, height: 360 + i * 30 });
    if (i % 2) await ev(() => window.__ev.toggleInventory());
  }
  check('survives bag / door / pickup garbage input', (await ev(() => window.__ev.state)) != null);
  await ev(() => window.__ev.dismiss());

  // ================= increment 4: the thread of the quest =================
  // A canvas quest log (Q / #btnLog) — a sixth box-state that freezes movement
  // and never overlaps the others; every step's done-state derived from live
  // state. The main quest shown truthfully in-progress; a fully-completable
  // side errand (fetch a lantern, deliver it to Mira).

  // 20 — the log on a fresh phone page: open/close, freeze, exclusivity, and the
  // full side errand driven to completion with its steps derived off live state.
  {
    const qc = await browser.newContext({ viewport: { width: 360, height: 720 }, hasTouch: true, isMobile: true });
    const qp = await qc.newPage();
    qp.on('console', m => { if (m.type() === 'error') consoleErrors.push('console(quest): ' + m.text()); });
    qp.on('pageerror', e => consoleErrors.push('pageerror(quest): ' + e.message));
    await qp.goto(url);
    await qp.waitForFunction(() => window.__ev && window.__ev.state);
    await freeze(qp);
    await qp.locator('#btnA').tap();                               // begin
    // a deterministic dialogue driver: open, advance to the choices or the last
    // page, pick if choosing, finish any routed node, then dismiss.
    await qp.evaluate(() => {
      window.__talk = function (tx, ty, facing, pick) {
        window.__ev.dismiss(); window.__ev.place(tx, ty, facing); window.__ev.action();
        for (let i = 0; i < 8; i++) { const d = window.__ev.dialog(); if (!d || d.choosing) break; window.__ev.action(); }
        const d = window.__ev.dialog();
        if (d && d.choosing && pick != null) window.__ev.dialogPick(pick);
        for (let i = 0; i < 8 && window.__ev.dialog(); i++) window.__ev.action();
        window.__ev.dismiss();
      };
    });

    // before any charge: the log opens, lists nothing, renders cleanly.
    await qp.evaluate(() => window.__ev.toggleQuests());
    await qp.waitForTimeout(50);
    const empty = await qp.evaluate(() => ({ open: window.__ev.questOpen, n: window.__ev.quests().length, box: window.__ev.questBox() }));
    check('the quest log opens with no quests before the charge',
      empty.open === true && empty.n === 0 && empty.box && empty.box.bottom > empty.box.top);
    // base Ember read below three seeds is unchanged (foreshadow is a 3-seed thing).
    const baseEmber = await qp.evaluate(() => {
      window.__ev.dismiss(); window.__ev.place(20, 5, 'up'); window.__ev.action();
      const t = window.__ev.signText; window.__ev.dismiss(); return t;
    });
    check('the Ember reads its base line below three seeds', /barely a glow/.test(baseEmber));

    // Q opens; movement frozen; Q / action / Esc / tap all close.
    await qp.evaluate(() => window.__ev.dismiss());
    await qp.keyboard.press('q'); await qp.waitForTimeout(40);
    check('the Q key opens the quest log', await qp.evaluate(() => window.__ev.questOpen === true && window.__ev.state === 'quests'));
    const qFrozen = await qp.evaluate(() => {
      const x0 = window.__ev.player.x;
      window.__ev.press('right'); for (let i = 0; i < 20; i++) window.__ev.step(40); window.__ev.release('right');
      return window.__ev.player.x === x0 && window.__ev.questOpen === true;
    });
    check('movement is frozen while the quest log is open', qFrozen);
    await qp.keyboard.press('q');
    check('the Q key closes the quest log', await qp.evaluate(() => window.__ev.state === 'play'));
    await qp.keyboard.press('q'); await qp.evaluate(() => window.__ev.action());
    check('action closes the quest log', await qp.evaluate(() => window.__ev.state === 'play' && window.__ev.questOpen === false));
    await qp.keyboard.press('q'); await qp.keyboard.press('Escape');
    check('Escape closes the quest log', await qp.evaluate(() => window.__ev.state === 'play'));
    await qp.locator('#btnLog').tap(); await qp.waitForTimeout(40);
    check('tapping #btnLog opens the quest log', await qp.evaluate(() => window.__ev.questOpen === true));
    await qp.locator('#btnLog').tap();
    check('tapping #btnLog again closes the quest log', await qp.evaluate(() => window.__ev.state === 'play'));

    // exclusivity: Q never tears the log open over a read or the bag.
    await qp.evaluate(() => { window.__ev.dismiss(); window.__ev.place(20, 26, 'right'); window.__ev.action(); });
    await qp.keyboard.press('q');
    check('Q does not open the log over a read', await qp.evaluate(() => window.__ev.reading === true && window.__ev.questOpen === false));
    await qp.evaluate(() => { window.__ev.dismiss(); window.__ev.place(20, 8, 'right'); window.__ev.action(); });
    await qp.keyboard.press('q');
    check('Q does not open the log over a conversation', await qp.evaluate(() => window.__ev.state === 'dialog' && window.__ev.questOpen === false));
    await qp.evaluate(() => { window.__ev.dismiss(); window.__ev.toggleInventory(); });
    await qp.keyboard.press('q');
    check('Q does not open the log over the bag', await qp.evaluate(() => window.__ev.inventoryOpen === true && window.__ev.questOpen === false));
    await qp.evaluate(() => window.__ev.dismiss());

    // the charge makes the main quest appear with four steps read off live state.
    await qp.evaluate(() => window.__talk(20, 8, 'right', 1));      // "How can I help?" -> the charge
    const relight = await qp.evaluate(() => window.__ev.quests().find(q => q.id === 'relight'));
    check('the main quest appears after the charge with four steps',
      !!relight && relight.steps.length === 4 && relight.complete === false);
    check('the charge step reads done, the rest read live-undone (no seeds, no ask yet)',
      relight.steps[0].done === true && relight.steps[1].done === false &&
      relight.steps[2].done === false && relight.steps[3].done === false);
    check('the gather step shows (0/3) and the return step its base label',
      /\(0\/3\)/.test(relight.steps[2].text) && /three emberseeds to the heart/.test(relight.steps[3].text));

    // the errand is invisible until Mira asks.
    check('the lantern errand is absent until Mira asks',
      await qp.evaluate(() => window.__ev.quests().some(q => q.id === 'lantern') === false));
    await qp.evaluate(() => window.__talk(6, 24, 'up', null));      // mira_open -> miraTold
    check('talking to Mira sets miraTold', await qp.evaluate(() => window.__ev.flags.miraTold === true));
    await qp.evaluate(() => window.__talk(6, 24, 'up', 0));         // mira_wish, "I'll bring you that light" -> miraAsked
    check('accepting Mira\'s errand makes it visible with two steps', await qp.evaluate(() => {
      const q = window.__ev.quests().find(x => x.id === 'lantern');
      return window.__ev.flags.miraAsked === true && !!q && q.steps.length === 2 && q.complete === false;
    }));
    check('both errand steps read undone before the lantern is found', await qp.evaluate(() => {
      const q = window.__ev.quests().find(x => x.id === 'lantern');
      return q.steps[0].done === false && q.steps[1].done === false;
    }));

    // the lantern is a non-ITEMS errand item at (10,25); the four valley items
    // are untouched; walking onto it moves it into the bag and checks step one.
    const errand = await qp.evaluate(() => ({ e: window.__ev.errandItems, items: window.__ev.items.length }));
    check('the lantern is an errand item at (10,25), and items stays four',
      errand.items === 4 && errand.e.length === 1 && errand.e[0].kind === 'lantern' && errand.e[0].tx === 10 && errand.e[0].ty === 25);
    const pickL = await qp.evaluate(() => {
      window.__ev.dismiss(); window.__ev.place(10, 25, 'down'); window.__ev.step(16);
      const q = window.__ev.quests().find(x => x.id === 'lantern');
      return { inBag: window.__ev.bag.some(b => b.kind === 'lantern'), left: window.__ev.errandItems.length,
               findDone: q.steps[0].done, deliverDone: q.steps[1].done, complete: q.complete };
    });
    check('walking onto the lantern moves it into the bag', pickL.inBag === true && pickL.left === 0);
    check('finding the lantern checks step one but not step two', pickL.findDone === true && pickL.deliverDone === false && pickL.complete === false);

    // deliver it: the give hook drops it from the bag, miraLit, both steps done,
    // the quest complete, and Mira's opening is thereafter mira_lit.
    await qp.evaluate(() => window.__talk(6, 24, 'up', 0));         // mira_deliver, "A light for your window"
    const delivered = await qp.evaluate(() => {
      const q = window.__ev.quests().find(x => x.id === 'lantern');
      return { lit: window.__ev.flags.miraLit, gone: !window.__ev.bag.some(b => b.kind === 'lantern'),
               s0: q.steps[0].done, s1: q.steps[1].done, complete: q.complete };
    });
    check('delivering sets miraLit and hands the lantern over (give)', delivered.lit === true && delivered.gone === true);
    check('both errand steps read done and the quest reads complete',
      delivered.s0 === true && delivered.s1 === true && delivered.complete === true);
    const miraNow = await qp.evaluate(() => {
      window.__ev.place(6, 24, 'up'); window.__ev.action();
      const t = window.__ev.dialog().text; window.__ev.dismiss(); return t;
    });
    check('Mira\'s opening is mira_lit after the delivery', /light in the window again/.test(miraNow));

    // the panel fits and clears the controls on a phone, portrait + landscape.
    const fits = async (label) => {
      await qp.evaluate(() => window.__ev.toggleQuests());
      await qp.waitForTimeout(50);
      const d = await qp.evaluate(() => {
        const box = window.__ev.questBox(), vw = window.__ev.view.w, vh = window.__ev.view.h;
        const a = document.getElementById('btnA').getBoundingClientRect();
        const hud = document.getElementById('btnBag').getBoundingClientRect();
        return { box, vw, vh, a: { left: a.left, right: a.right, top: a.top, bottom: a.bottom },
          hud: { left: hud.left, right: hud.right, top: hud.top, bottom: hud.bottom } };
      });
      check('the quest panel fits on-screen (' + label + ')',
        d.box.top >= 0 && d.box.bottom <= d.vh && d.box.left >= 0 && d.box.right <= d.vw);
      check('the quest panel clears the controls (' + label + ')', noOverlap(d.box, d.a) && noOverlap(d.box, d.hud));
      await qp.evaluate(() => window.__ev.toggleQuests());
    };
    await fits('phone portrait');
    await qp.setViewportSize({ width: 568, height: 320 });
    await qp.waitForTimeout(50);
    await fits('phone landscape');
    // a garbage mash with the log in the mix + mid-panel resizes never crashes.
    await qp.evaluate(() => {
      for (let i = 0; i < 120; i++) {
        if (Math.random() < 0.5) window.__ev.toggleQuests();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ['q', 'Q', 'i', 'Escape', ' '][Math.random() * 5 | 0] }));
        window.__ev.action(); window.__ev.step(16);
      }
      window.__ev.dismiss();
    });
    for (let i = 0; i < 6; i++) { await qp.setViewportSize({ width: 320 + i * 40, height: 360 + i * 30 }); if (i % 2) await qp.evaluate(() => window.__ev.toggleQuests()); }
    check('survives quest-log garbage input + resizes', (await qp.evaluate(() => window.__ev.state)) != null);
    await qc.close();
  }

  // 21 — the main page carries all three seeds (section 14): the gather step
  // flips at 3, the return step relabels but stays undone, the quest stays
  // incomplete, and facing the Ember now reads the foreshadow line (no change).
  await ev(() => window.__ev.dismiss());
  const threeSeed = await ev(() => {
    const q = window.__ev.quests().find(x => x.id === 'relight');
    return { seeds: window.__ev.seeds, gatherText: q.steps[2].text, gatherDone: q.steps[2].done,
             returnText: q.steps[3].text, returnDone: q.steps[3].done, complete: q.complete,
             errandAbsent: !window.__ev.quests().some(x => x.id === 'lantern') };
  });
  check('at three seeds the gather step flips to done and reports (3/3)',
    threeSeed.seeds === 3 && /\(3\/3\)/.test(threeSeed.gatherText) && threeSeed.gatherDone === true);
  check('at three seeds the return step relabels to the fight but stays undone',
    /guards the dark/.test(threeSeed.returnText) && threeSeed.returnDone === false);
  check('the main quest never reads complete this increment', threeSeed.complete === false);
  check('the errand is absent on a run where Mira was never asked', threeSeed.errandAbsent === true);
  // lantern reachability on foot with the door shut (the BFS the critic re-runs).
  const lanternReach = await ev(() => {
    const e = window.__ev.errandItems[0];
    const nonsolid = window.__ev.solid(e.tx, e.ty) === false;
    const seen = new Set(['20,26']); const q = [[20, 26]];
    while (q.length) { const [x, y] = q.shift();
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
        if (seen.has(k)) continue; if (!window.__ev.solid(nx, ny)) { seen.add(k); q.push([nx, ny]); }
      }
    }
    return { nonsolid, reachable: seen.has(e.tx + ',' + e.ty) };
  });
  check('the lantern sits on a non-solid tile reachable on foot (door shut)',
    lanternReach.nonsolid === true && lanternReach.reachable === true);
  // The increment-4 foreshadow READ at three seeds is overtaken by increment 5:
  // facing the Ember with all three seeds, the guardian unbeaten, is the real
  // gate and now ENTERS COMBAT instead of reading. (Full trigger coverage —
  // including the <3-seed read and the post-win read — is section 22 below.)
  const fore = await ev(() => {
    window.__ev.dismiss(); window.__ev.place(20, 5, 'up'); window.__ev.action();
    return { state: window.__ev.state, snap: window.__ev.combat(), reading: window.__ev.reading };
  });
  check('facing the Ember with three seeds enters combat (the real gate, not a read)',
    fore.state === 'combat' && fore.reading === false && fore.snap && fore.snap.foe === 'the Hollow');

  // ================= increment 5: what guards the dark (combat) =================
  // A single turn-based encounter — the Hollow gates the heart. Element triangle
  // Ember->Thorn->Tide->Ember (x1.5 weak / x0.5 resist / x1), a deterministic
  // speed action-gauge turn order, attack with an element or Guard, the foe
  // telegraphs and shifts when low. Win sets guardianBeaten and returns to play;
  // lose restores HP and throws you back (retriggerable). In-memory only.

  // a page-side helper: step the fight until the player's turn, or until over.
  const COMBAT_DRIVER = `
    window.__cb = {
      enter: function () { window.__ev.dismiss(); window.__ev.giveSeeds(); window.__ev.place(20, 5, 'up'); window.__ev.action(); },
      toAwait: function () { for (var i = 0; i < 600; i++) { var c = window.__ev.combat(); if (!c || c.over || c.awaiting) return c; window.__ev.step(40); } return window.__ev.combat(); },
      toPlay:  function () { for (var i = 0; i < 300 && window.__ev.state === 'combat'; i++) window.__ev.step(40); return window.__ev.state; },
      // run a whole fight with a per-turn strategy fn(snapshot) -> 'Ember'|'Thorn'|'Tide'|'guard'.
      fight: function (strat) {
        var safety = 0;
        while (safety++ < 4000) {
          var c = window.__ev.combat(); if (!c || c.over) break;
          if (c.awaiting) { var mv = strat(c); if (mv === 'guard') window.__ev.combatGuard(); else window.__ev.combatAttack(mv); }
          else window.__ev.step(40);
        }
        return window.__ev.combat();
      }
    };`;

  // 22 — trigger: enters combat at three seeds, reads below three, reads (no
  // re-fight) after the guardian is beaten.
  {
    const cp = await browser.newPage({ viewport: { width: 900, height: 600 } });
    cp.on('console', m => { if (m.type() === 'error') consoleErrors.push('console(combat): ' + m.text()); });
    cp.on('pageerror', e => consoleErrors.push('pageerror(combat): ' + e.message));
    await cp.goto(url);
    await cp.waitForFunction(() => window.__ev && window.__ev.state);
    await freeze(cp);
    await cp.evaluate(COMBAT_DRIVER);
    const cev = fn => cp.evaluate(fn);

    await cev(() => window.__ev.start());
    // below three seeds the Ember is still a plain read, unchanged.
    const below = await cev(() => {
      window.__ev.place(20, 5, 'up'); window.__ev.action();
      const r = { reading: window.__ev.reading, state: window.__ev.state, t: window.__ev.signText }; window.__ev.dismiss(); return r;
    });
    check('below three seeds the Ember is still a plain read', below.reading === true && below.state === 'reading' && /barely a glow/.test(below.t));
    // at three seeds + guardian unbeaten: action enters combat (the real path).
    const entered = await cev(() => { window.__cb.enter(); return { state: window.__ev.state, snap: window.__ev.combat() }; });
    check('three seeds + action at the Ember enters combat via the real trigger',
      entered.state === 'combat' && entered.snap && entered.snap.foe === 'the Hollow' && entered.snap.over === null);

    // the snapshot reports the readable weakness / resistance / HP / queue.
    const snap = await cev(() => window.__cb.toAwait());
    check('the fight exposes HP, the foe\'s weakness (Ember) and resistance (Tide)',
      snap.foeHP === snap.foeMaxHP && snap.playerHP === snap.playerMaxHP && snap.weak === 'Ember' && snap.resist === 'Tide');
    check('the gauge yields a who\'s-next queue led by the faster traveler',
      Array.isArray(snap.queue) && snap.queue.length >= 2 && snap.queue[0].id === 'player');
    check('it is the player\'s turn and input is awaited', snap.awaiting === true);

    // element multipliers + log naming, across three turns of one fight.
    const mul = await cev(() => {
      var out = {};
      var c = window.__cb.toAwait(); var h0 = c.foeHP;
      window.__ev.combatAttack('Ember'); out.ember = { dmg: h0 - window.__ev.combat().foeHP, log: window.__ev.combat().log.slice(-1)[0] };
      c = window.__cb.toAwait(); h0 = c.foeHP;
      window.__ev.combatAttack('Thorn'); out.thorn = { dmg: h0 - window.__ev.combat().foeHP, log: window.__ev.combat().log.slice(-1)[0] };
      c = window.__cb.toAwait(); h0 = c.foeHP;
      window.__ev.combatAttack('Tide');  out.tide  = { dmg: h0 - window.__ev.combat().foeHP, log: window.__ev.combat().log.slice(-1)[0] };
      return out;
    });
    check('Ember (the weakness) hits x1.5 and names elements + multiplier + damage in the log',
      mul.ember.dmg === 21 && /Your Ember strikes the Hollow/.test(mul.ember.log) && /×1\.5/.test(mul.ember.log) && /21/.test(mul.ember.log));
    check('Thorn (neutral) hits x1', mul.thorn.dmg === 14 && /×1 /.test(mul.thorn.log + ' '));
    check('Tide (the resistance) hits x0.5', mul.tide.dmg === 7 && /×0\.5/.test(mul.tide.log));

    // input is ignored during the foe's turn (awaiting false): a poke does nothing.
    const offturn = await cev(() => {
      window.__cb.toAwait();
      window.__ev.combatAttack('Ember');                 // consume the player's turn
      var before = window.__ev.combat();                 // awaiting now false
      var hp0 = before.foeHP;
      window.__ev.combatAttack('Ember'); window.__ev.combatGuard();   // off-turn pokes
      var after = window.__ev.combat();
      return { awaiting: before.awaiting, hpUnchanged: after.foeHP === hp0, guarding: after.guarding };
    });
    check('combat input is ignored during the foe\'s turn (awaiting false)',
      offturn.awaiting === false && offturn.hpUnchanged === true && offturn.guarding === false);
    await cp.close();
  }

  // 23 — a driven WIN: strike the weakness, guard the telegraphed crush. The
  // guardian is beaten, HP is restored, and we return to play beside the Ember.
  {
    const wp = await browser.newPage({ viewport: { width: 900, height: 600 } });
    wp.on('console', m => { if (m.type() === 'error') consoleErrors.push('console(win): ' + m.text()); });
    wp.on('pageerror', e => consoleErrors.push('pageerror(win): ' + e.message));
    await wp.goto(url);
    await wp.waitForFunction(() => window.__ev && window.__ev.state);
    await freeze(wp);
    await wp.evaluate(COMBAT_DRIVER);
    const result = await wp.evaluate(() => {
      window.__ev.start();
      // take the Warden's charge so the relight quest is visible in the log.
      (function talk(tx, ty, facing, pick) {
        window.__ev.dismiss(); window.__ev.place(tx, ty, facing); window.__ev.action();
        for (var i = 0; i < 8; i++) { var d = window.__ev.dialog(); if (!d || d.choosing) break; window.__ev.action(); }
        var d = window.__ev.dialog(); if (d && d.choosing && pick != null) window.__ev.dialogPick(pick);
        for (var j = 0; j < 8 && window.__ev.dialog(); j++) window.__ev.action();
        window.__ev.dismiss();
      })(20, 8, 'right', 1);
      window.__cb.enter();
      var faced = window.__ev.player;                    // beside the Ember, facing up
      // Good play: strike the weakness, and Guard the moment the crush is
      // telegraphed as coming (don't re-raise an already-held charge).
      var end = window.__cb.fight(function (c) {
        return (c.plan === 'windup' || c.plan === 'crush') && !c.guarding ? 'guard' : 'Ember';
      });
      var over = end ? end.over : null;
      var endHP = end ? end.playerHP : null, endMax = end ? end.playerMaxHP : null;
      var beatenAtWin = window.__ev.flags.guardianBeaten;
      var afterState = window.__cb.toPlay();
      return { over: over, endHP: endHP, endMax: endMax, beatenAtWin: beatenAtWin, afterState: afterState,
        beaten: window.__ev.flags.guardianBeaten, tx: window.__ev.player.tx, ty: window.__ev.player.ty, faced: faced };
    });
    check('good play wins the fight (strike the weakness, guard the telegraphed crush)', result.over === 'win');
    check('good play wins with a comfortable margin (>= 1/3 HP left)',
      result.over === 'win' && result.endHP >= result.endMax / 3 && result.endHP === 48 && result.endMax === 120);
    check('a win sets guardianBeaten', result.beatenAtWin === true && result.beaten === true);
    check('a win returns to play beside the Ember', result.afterState === 'play' && result.tx === 20 && result.ty === 5);
    // after the win, facing the Ember at three seeds is a plain read again (no re-fight).
    const postWin = await wp.evaluate(() => {
      window.__ev.dismiss(); window.__ev.place(20, 5, 'up'); window.__ev.action();
      var r = { state: window.__ev.state, reading: window.__ev.reading, t: window.__ev.signText }; window.__ev.dismiss(); return r;
    });
    check('after the guardian is beaten the Ember is a plain read again (no re-fight)',
      postWin.state === 'reading' && postWin.reading === true && /the way to the heart stands clear/.test(postWin.t));
    // the relight quest return step now reads the open-way label, still not done.
    const q = await wp.evaluate(() => window.__ev.quests().find(x => x.id === 'relight'));
    check('after the win the return step reads the open way but the quest still never completes',
      /way home lies open/.test(q.steps[3].text) && q.steps[3].done === false && q.complete === false);
    await wp.close();
  }

  // 24 — a driven LOSE: strike the resistance, never guard. HP is restored, we
  // return to play, the guardian is NOT beaten, and the fight is retriggerable.
  {
    const lp = await browser.newPage({ viewport: { width: 900, height: 600 } });
    lp.on('console', m => { if (m.type() === 'error') consoleErrors.push('console(lose): ' + m.text()); });
    lp.on('pageerror', e => consoleErrors.push('pageerror(lose): ' + e.message));
    await lp.goto(url);
    await lp.waitForFunction(() => window.__ev && window.__ev.state);
    await freeze(lp);
    await lp.evaluate(COMBAT_DRIVER);
    const lose = await lp.evaluate(() => {
      window.__ev.start(); window.__cb.enter();
      var end = window.__cb.fight(function () { return 'Tide'; });     // only ever the resistance
      var over = end ? end.over : null;
      var afterState = window.__cb.toPlay();
      // retriggerable: face the Ember again -> a fresh fight at full HP.
      window.__ev.place(20, 5, 'up'); window.__ev.action();
      var re = window.__ev.combat();
      return { over: over, afterState: afterState, beaten: window.__ev.flags.guardianBeaten,
        reState: window.__ev.state, rePlayerHP: re ? re.playerHP : null, reMax: re ? re.playerMaxHP : null };
    });
    check('bad play loses the fight (strike the resistance, never guard)', lose.over === 'lose');
    check('a loss returns to play without beating the guardian (no permadeath)',
      lose.afterState === 'play' && lose.beaten === false);
    check('a loss leaves the fight retriggerable at full, restored HP',
      lose.reState === 'combat' && lose.rePlayerHP === lose.reMax && lose.rePlayerHP > 0);
    await lp.close();
  }

  // 25 — the fight on a phone (~380px): the D-pad/HUD hide, the combat bar shows,
  // its buttons are on-screen and a real tap attacks. Reduced motion holds the
  // hit-flash at zero; motion lets it flash. Garbage input never crashes.
  {
    const mc = await browser.newContext({ viewport: { width: 380, height: 720 }, hasTouch: true, isMobile: true });
    const mp = await mc.newPage();
    mp.on('console', m => { if (m.type() === 'error') consoleErrors.push('console(combatPhone): ' + m.text()); });
    mp.on('pageerror', e => consoleErrors.push('pageerror(combatPhone): ' + e.message));
    await mp.goto(url);
    await mp.waitForFunction(() => window.__ev && window.__ev.state);
    await freeze(mp);
    await mp.evaluate(COMBAT_DRIVER);
    await mp.locator('#btnA').tap();                                   // begin
    await mp.evaluate(() => { window.__cb.enter(); window.__cb.toAwait(); });
    await mp.waitForTimeout(60);                                        // let a frame apply the .combat class
    check('the combat bar is visible at 380px', await mp.locator('#btnEmber').isVisible());
    check('the dead D-pad is hidden during a fight (phone)',
      (await mp.evaluate(() => getComputedStyle(document.querySelector('.dpad')).display)) === 'none');
    check('no horizontal page scroll with the fight open (phone)',
      await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const btns = await mp.evaluate(() => ['btnEmber', 'btnThorn', 'btnTide', 'btnGuard'].map(id => {
      const r = document.getElementById(id).getBoundingClientRect();
      return { on: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight, w: r.width, h: r.height };
    }));
    check('all four combat buttons sit on-screen and tappable-sized (phone)',
      btns.every(b => b.on && b.w > 0 && b.h >= 44));
    const hp0 = await mp.evaluate(() => window.__ev.combat().foeHP);
    await mp.locator('#btnEmber').tap();                               // a real tap attacks
    check('tapping a combat button attacks (the foe takes damage)',
      (await mp.evaluate(() => window.__ev.combat().foeHP)) === hp0 - 21);

    // reduced motion gates the hit-flash; motion lets it flash.
    const flash = await mp.evaluate(() => {
      window.__ev.setReducedMotion(true);
      window.__cb.toAwait(); window.__ev.combatAttack('Ember'); var rm = window.__ev.combatFlash();
      window.__ev.setReducedMotion(false);
      window.__cb.toAwait(); window.__ev.combatAttack('Ember'); var on = window.__ev.combatFlash();
      return { rm: rm, on: on };
    });
    check('reduced motion holds the combat hit-flash at zero', flash.rm === 0);
    check('the combat hit-flash fires when motion is allowed', flash.on > 0);

    // garbage input: mash keys/buttons, act off-turn, resize mid-fight — no crash.
    await mp.evaluate(() => {
      var keys = ['1', '2', '3', 'g', 'e', 't', 'd', 'G', 'q', 'i', 'Escape', ' ', 'Enter', 'ArrowUp', 'w', 'a', 's', 'f'];
      for (var i = 0; i < 300; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: keys[(Math.random() * keys.length) | 0] }));
        if (Math.random() < 0.4) window.__ev.combatAttack(['Ember', 'Thorn', 'Tide', 'nope'][(Math.random() * 4) | 0]);
        if (Math.random() < 0.3) window.__ev.combatGuard();
        window.__ev.step(16);
      }
    });
    for (let i = 0; i < 6; i++) await mp.setViewportSize({ width: 320 + i * 40, height: 420 + i * 30 });
    check('survives combat garbage input + mid-fight resizes', (await mp.evaluate(() => window.__ev.state)) != null);
    await mc.close();
  }

  // 26 — Guard semantics (the DEFECT-1 fix). Guard is a one-shot CHARGE: raised
  // on the crush telegraph it is NOT reset when the player's own next turn
  // arrives (the old trap), it persists across intervening player turns, and it
  // halves the crush that finally lands (54 -> 27). A crush taken UNGUARDED is
  // twice as bad. Pure aggression (never guard) does NOT comfortably win — it
  // dies by a hair; pure defence (always guard) loses on the clock, dealing no
  // damage. All deterministic (the loop is frozen; only step() advances).
  {
    const gp = await browser.newPage({ viewport: { width: 900, height: 600 } });
    gp.on('console', m => { if (m.type() === 'error') consoleErrors.push('console(guard): ' + m.text()); });
    gp.on('pageerror', e => consoleErrors.push('pageerror(guard): ' + e.message));
    await gp.goto(url);
    await gp.waitForFunction(() => window.__ev && window.__ev.state);
    await freeze(gp);
    await gp.evaluate(COMBAT_DRIVER);
    const g = await gp.evaluate(() => {
      function toAwait() { for (var i = 0; i < 600; i++) { var c = window.__ev.combat(); if (!c || c.over || c.awaiting) return c; window.__ev.step(40); } return window.__ev.combat(); }
      function crushDmgs(end) { var d = []; ((end && end.log) || []).forEach(function (l) { var m = l.match(/crushing[^→]*→ (\d+)\./); if (m) d.push(+m[1]); }); return d; }
      window.__ev.start();

      // --- persistence: raise the guard on the wind-up telegraph, then keep
      // taking the player's OWN turns until the crush lands; the charge must
      // stay up across every one of them and halve the blow. ---
      window.__cb.enter();
      var c = toAwait(), s = 0;
      while (c && !c.over && c.plan !== 'windup' && s++ < 40) { window.__ev.combatAttack('Ember'); c = toAwait(); }
      var sawWindup = !!(c && c.plan === 'windup');
      window.__ev.combatGuard();                         // raise on the wind-up (awaiting -> false)
      c = toAwait();                                     // foe winds up (harmless); player's OWN next turn
      var heldStates = [], persistCrushDmg = null, ownTurns = 0;
      s = 0;
      while (c && !c.over && s++ < 40) {
        heldStates.push(c.guarding); ownTurns++;
        var hpBefore = c.playerHP;
        window.__ev.combatAttack('Ember');               // intervening own-turn attack
        c = toAwait();
        if (c && c.playerHP < hpBefore) {                // a foe hit landed between our turns
          var logs = (c.log) || (window.__ev.combat() && window.__ev.combat().log) || [];
          for (var li = logs.length - 1; li >= 0; li--) { var mm = logs[li].match(/crushing[^→]*→ (\d+)\./); if (mm) { persistCrushDmg = +mm[1]; break; } }
          if (persistCrushDmg != null) break;
        }
      }
      var heldOnOwnTurn = heldStates.length > 0 && heldStates[0] === true;
      var stayedUp = heldStates.length > 0 && heldStates.every(function (h) { return h === true; });
      window.__cb.fight(function () { return 'guard'; }); // play this one out (guard-only loses -> no guardianBeaten)

      // --- strategy matrix (all lose; none sets guardianBeaten) ---
      window.__cb.toPlay(); window.__cb.enter();
      var never = window.__cb.fight(function () { return 'Ember'; });     // pure aggression
      window.__cb.toPlay(); window.__cb.enter();
      var always = window.__cb.fight(function () { return 'guard'; });    // pure defence

      return {
        sawWindup: sawWindup, heldOnOwnTurn: heldOnOwnTurn, stayedUp: stayedUp,
        ownTurns: ownTurns, persistCrushDmg: persistCrushDmg,
        never: { over: never.over, playerHP: never.playerHP, foeHP: never.foeHP, crush: crushDmgs(never) },
        always: { over: always.over, foeHP: always.foeHP, foeMaxHP: always.foeMaxHP, crush: crushDmgs(always) }
      };
    });
    check('a guard raised on the crush telegraph is still up on the player\'s own next turn (one-shot charge, not reset at turn start)',
      g.sawWindup === true && g.heldOnOwnTurn === true && g.stayedUp === true && g.ownTurns >= 1);
    check('the guard charge survives intervening player turns and halves the crush that lands (54 -> 27)',
      g.persistCrushDmg === 27);
    check('an UNGUARDED crush lands at full (54) — exactly twice as bad as a guarded one',
      g.never.crush.length >= 2 && g.never.crush.every(d => d === 54) && 27 * 2 === 54);
    check('pure aggression (never guard) does NOT comfortably win — it loses by a hair',
      g.never.over === 'lose' && g.never.playerHP === 0 && g.never.foeHP > 0);
    check('pure defence (always guard) loses on the clock, dealing no damage',
      g.always.over === 'lose' && g.always.foeHP === g.always.foeMaxHP && g.always.crush.every(d => d === 27));
    await gp.close();
  }

  // Console / page errors must be clean across the whole run.
  check('zero console errors across the run', consoleErrors.length === 0);
  if (consoleErrors.length) consoleErrors.forEach(e => console.log('    ! ' + e));

  // Screenshot — a real running frame on a fresh page (clean flags): the fight
  // at the heart. The traveler faces the Hollow with all three emberseeds in
  // hand — HP bars, the foe's readable weakness (Ember) and resistance (Tide),
  // the who's-next turn queue, the element/Guard combat bar, and the combat log
  // a few blows in. Increment 5's "what guards the dark" on display.
  {
    const sp = await browser.newPage({ viewport: { width: 960, height: 640 } });
    await sp.goto(url);
    await sp.waitForFunction(() => window.__ev && window.__ev.state);
    await sp.evaluate(() => {
      window.__ev.start(); window.__ev.setReducedMotion(false);
      window.__ev.giveSeeds();                               // TEST-ONLY: three seeds in the bag
      window.__ev.place(20, 5, 'up'); window.__ev.action();  // face the Ember (20,4) + act -> the fight
      // Advance time until it is the player's turn (the gauge fills), then strike
      // twice with Ember so the foe is visibly wounded and the log reads as a
      // fight underway; end on the player's turn so the combat bar is live.
      function toTurn() {
        for (var i = 0; i < 200; i++) {
          var c = window.__ev.combat();
          if (!c || c.over || c.awaiting) return;
          window.__ev.step(16);
        }
      }
      toTurn(); window.__ev.combatAttack('Ember');
      toTurn(); window.__ev.combatAttack('Ember');
      toTurn();                                              // land on the player's turn, foe wounded
    });
    await sp.waitForTimeout(240);                           // let the frame settle
    await sp.screenshot({ path: shot });
    await sp.close();
  }
  console.log('  screenshot ->', shot);

  await browser.close();

  console.log('\nPASS ' + pass + '/' + (pass + fail));
  if (fail) { console.log('Failures: ' + failures.join(', ')); process.exit(1); }
}

main().catch(e => { console.error(e); process.exit(1); });
