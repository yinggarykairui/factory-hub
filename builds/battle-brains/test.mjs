// Headless verification for battle-brains. Run with Playwright resolvable:
//   node test.mjs
// Covers the done-checklist: load/flow, each personality's distinct behaviour,
// boldness-gated pack commits, ward pulse + cooldown, contact→heart→game over,
// phone width + touch, garbage input, reduced motion. Zero console errors is a
// hard requirement (§8 must-pass line 1).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pwPath = process.env.PW_PATH ||
  require.resolve('playwright', { paths: ['/opt/node-tools/node_modules', '/home/user', '/home/user/factory-hub'] });
const _pw = await import(pwPath);
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';

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
// start a clean play session with spawns frozen and no enemies, player centred
const setup = `window.__bb.begin(); window.__bb.seed(12345); window.__bb.stopSpawns();
  window.__bb.clearEnemies(); window.__bb.setPlayer(window.__bb.ARENA_W/2, window.__bb.ARENA_H/2);`;

// ---- 1. load + flow ----
{
  const { ctx, page } = await newPage({ viewport: { width: 1000, height: 700 } });
  await page.goto(url); await page.waitForTimeout(200);
  ok(page.errs.length === 0, 'no console errors on load (' + page.errs.join(' | ') + ')');
  ok(await page.evaluate(() => window.__bb.state === 'title'), 'starts on the title screen');
  await page.evaluate(() => window.__bb.begin());
  ok(await page.evaluate(() => window.__bb.state === 'play' && window.__bb.hearts === 3), 'begin starts play with 3 hearts');
  await ctx.close();
}

// ---- 2. aggressor seeks ----
{
  const { ctx, page } = await newPage({ viewport: { width: 1000, height: 700 } });
  await page.goto(url);
  const r = await page.evaluate((s) => {
    eval(s); const c = window.__bb.ARENA_W/2, cy = window.__bb.ARENA_H/2;
    window.__bb.spawn('aggressor', 80, 80);
    const d0 = window.__bb.enemies[0].dist;
    window.__bb.tick(40);               // player stationary
    return { d0, d1: window.__bb.enemies[0].dist };
  }, setup);
  ok(r.d1 < r.d0 - 20, `aggressor charges toward the player (${r.d0.toFixed(0)} -> ${r.d1.toFixed(0)})`);
  await ctx.close();
}

// ---- 3. coward flees when near, approaches when far ----
{
  const { ctx, page } = await newPage({ viewport: { width: 1000, height: 700 } });
  await page.goto(url);
  const flee = await page.evaluate((s) => {
    eval(s); const cx = window.__bb.ARENA_W/2, cy = window.__bb.ARENA_H/2;
    window.__bb.spawn('coward', cx + 100, cy);      // dist 100 < flee radius 150
    const d0 = window.__bb.enemies[0].dist; window.__bb.tick(30);
    return { d0, d1: window.__bb.enemies[0].dist };
  }, setup);
  ok(flee.d1 > flee.d0 + 15, `coward bolts when the player is near (${flee.d0.toFixed(0)} -> ${flee.d1.toFixed(0)})`);

  const approach = await page.evaluate((s) => {
    eval(s); const cx = window.__bb.ARENA_W/2, cy = window.__bb.ARENA_H/2;
    window.__bb.spawn('coward', cx + 330, cy);      // dist 330 > approach radius 300
    const d0 = window.__bb.enemies[0].dist; window.__bb.tick(30);
    return { d0, d1: window.__bb.enemies[0].dist };
  }, setup);
  ok(approach.d1 < approach.d0 - 8, `coward creeps in from a distance (${approach.d0.toFixed(0)} -> ${approach.d1.toFixed(0)})`);
  await ctx.close();
}

// ---- 4. pack: boldness-gated commits ----
{
  const { ctx, page } = await newPage({ viewport: { width: 1000, height: 700 } });
  await page.goto(url);
  // a full pack of 3 should, together, commit a rush within a few seconds
  const full = await page.evaluate((s) => {
    eval(s); const cx = window.__bb.ARENA_W/2, cy = window.__bb.ARENA_H/2;
    const id = 7;
    window.__bb.spawn('pack', cx+120, cy, id);
    window.__bb.spawn('pack', cx-120, cy, id);
    window.__bb.spawn('pack', cx, cy+120, id);
    let sawRush = false, minDist = 1e9;
    for (let i=0;i<40;i++){ window.__bb.tick(10);
      for (const e of window.__bb.enemies){ if (e.state==='rush') sawRush=true; minDist=Math.min(minDist,e.dist); } }
    return { sawRush, minDist };
  }, setup);
  ok(full.sawRush, 'a full pack commits rushes (≥2 present → boldness gate opens)');

  // a lone packmate must hang back and never commit
  const lone = await page.evaluate((s) => {
    eval(s); const cx = window.__bb.ARENA_W/2, cy = window.__bb.ARENA_H/2;
    window.__bb.spawn('pack', cx+185, cy, 9);
    let sawRush = false, minDist = 1e9;
    for (let i=0;i<40;i++){ window.__bb.tick(10);
      const e = window.__bb.enemies[0]; if (e){ if (e.state==='rush') sawRush=true; minDist=Math.min(minDist,e.dist); } }
    return { sawRush, minDist };
  }, setup);
  ok(!lone.sawRush && lone.minDist > 100, `a lone packmate loses its nerve and keeps its distance (minDist ${lone.minDist.toFixed(0)}, no rush)`);
  await ctx.close();
}

// ---- 5. ward pulse knockback + cooldown ----
{
  const { ctx, page } = await newPage({ viewport: { width: 1000, height: 700 } });
  await page.goto(url);
  const r = await page.evaluate((s) => {
    eval(s); const cx = window.__bb.ARENA_W/2, cy = window.__bb.ARENA_H/2;
    window.__bb.spawn('aggressor', cx+90, cy);
    window.__bb.spawn('coward', cx-90, cy);
    window.__bb.spawn('pack', cx, cy+90, 3);
    const before = window.__bb.enemies.map(e=>e.dist);
    const fired = window.__bb.pulse();
    const readyRightAfter = window.__bb.pulseReady;
    window.__bb.tick(12);
    const after = window.__bb.enemies.map(e=>e.dist);
    window.__bb.clearEnemies(); window.__bb.tick(60*5 + 10);   // let cooldown elapse
    return { fired, readyRightAfter, before, after, readyLater: window.__bb.pulseReady };
  }, setup);
  ok(r.fired === true, 'ward pulse fires when ready');
  ok(r.after.every((d,i)=> d > r.before[i] + 10), 'ward pulse knocks every nearby enemy back');
  ok(r.readyRightAfter === false, 'pulse goes on cooldown immediately after firing');
  ok(r.readyLater === true, 'pulse recharges after its cooldown');
  await ctx.close();
}

// ---- 6. contact costs a heart; game over; restart ----
{
  const { ctx: ctx2, page: page2 } = await newPage({ viewport: { width: 1000, height: 700 } });
  await page2.goto(url);
  const h = await page2.evaluate(() => {
    window.__bb.begin(); window.__bb.stopSpawns();
    const hp = [];
    for (let k=0;k<3;k++){
      window.__bb.clearEnemies();
      window.__bb.setPlayer(window.__bb.ARENA_W/2, window.__bb.ARENA_H/2);
      window.__bb.spawn('aggressor', window.__bb.ARENA_W/2, window.__bb.ARENA_H/2);
      window.__bb.tick(2); hp.push(window.__bb.hearts); window.__bb.tick(80);
    }
    const overState = window.__bb.state;
    window.__bb.begin();
    return { hp, overState, afterRestart: { state: window.__bb.state, hearts: window.__bb.hearts } };
  });
  ok(h.hp[0] === 2, 'first contact costs one heart (3 -> 2)');
  ok(h.hp.join(',') === '2,1,0', `each contact costs a heart (${h.hp.join(',')})`);
  ok(h.overState === 'over', 'zero hearts ends the game');
  ok(h.afterRestart.state === 'play' && h.afterRestart.hearts === 3, 'restart resets to play with full hearts');
  ok(page2.errs.length === 0, 'no console errors through the heart/game-over flow (' + page2.errs.join(' | ') + ')');
  await ctx2.close();
}

// ---- 7. phone width: touch controls + no scroll + dpad moves ----
{
  const { ctx, page } = await newPage({ viewport: { width: 360, height: 720 }, hasTouch: true, isMobile: true });
  await page.goto(url); await page.evaluate(() => window.__bb.begin()); await page.waitForTimeout(60);
  ok(await page.isVisible('#touch'), 'touch controls visible at phone width');
  ok(await page.isVisible('#pbtn'), 'ward button present');
  const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  ok(noScroll, 'no horizontal page scroll at 360px');
  const moved = await page.evaluate(() => {
    window.__bb.stopSpawns(); window.__bb.clearEnemies();
    window.__bb.setPlayer(window.__bb.ARENA_W/2, window.__bb.ARENA_H/2);
    const y0 = window.__bb.player.y;
    const btn = document.getElementById('d-up'); const rect = btn.getBoundingClientRect();
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, clientX:rect.x+5, clientY:rect.y+5 }));
    window.__bb.tick(40);
    btn.dispatchEvent(new PointerEvent('pointerup', { bubbles:true }));
    return window.__bb.player.y < y0 - 10;
  });
  ok(moved, 'the on-screen D-pad moves the player');
  ok(page.errs.length === 0, 'no console errors on mobile (' + page.errs.join(' | ') + ')');
  await ctx.close();
}

// ---- 8. garbage input + rapid resize ----
{
  const { ctx, page } = await newPage({ viewport: { width: 900, height: 650 } });
  await page.goto(url); await page.evaluate(() => window.__bb.begin());
  await page.evaluate(() => {
    const keys = ['q','Z','9','Tab','Shift','F5','ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ','Enter','Escape','@','%'];
    for (let i=0;i<400;i++){ const k = keys[(i*7)%keys.length];
      window.dispatchEvent(new KeyboardEvent('keydown',{key:k}));
      if (i%3===0) window.dispatchEvent(new KeyboardEvent('keyup',{key:k})); }
    ['up','down','left','right'].forEach(d=>window.__bb.press(d));
    for (let i=0;i<60;i++){ window.__bb.pulse(); window.__bb.tick(3); }
    ['up','down','left','right'].forEach(d=>window.__bb.release(d));
  });
  await page.waitForTimeout(80);
  ok(page.errs.length === 0, 'survives key-mash / all-dirs / pulse spam (' + page.errs.join(' | ') + ')');
  ok(await page.evaluate(() => ['play','over','title'].includes(window.__bb.state)), 'state stays valid after garbage input');
  for (const [w,h] of [[320,500],[1200,380],[700,900],[360,640],[1000,700]]) { await page.setViewportSize({width:w,height:h}); await page.waitForTimeout(25); }
  ok(page.errs.length === 0, 'survives rapid resize (' + page.errs.join(' | ') + ')');
  await ctx.close();
}

// ---- 9. reduced motion ----
{
  const { ctx, page } = await newPage({ viewport: { width: 900, height: 650 }, reducedMotion: 'reduce' });
  await page.goto(url); await page.evaluate(() => window.__bb.begin());
  ok(await page.evaluate(() => window.__bb.reduced === true), 'reduced-motion detected (screen shake/particles off)');
  ok(page.errs.length === 0, 'no console errors under reduced motion (' + page.errs.join(' | ') + ')');
  await ctx.close();
}

// ---- 10. fixer-cycle regressions ----
{
  // 10a. a degenerate sub-margin viewport must not throw (scale clamp)
  const { ctx, page } = await newPage({ viewport: { width: 900, height: 650 } });
  await page.goto(url); await page.evaluate(() => window.__bb.begin());
  await page.setViewportSize({ width: 400, height: 20 }); await page.waitForTimeout(60);
  await page.setViewportSize({ width: 900, height: 650 }); await page.waitForTimeout(40);
  ok(page.errs.length === 0, 'no throw at a degenerate sub-28px viewport (' + page.errs.join(' | ') + ')');
  await ctx.close();
}
{
  // 10b. the ward pulse breaks each personality differently: the coward flees far,
  // the aggressor barely flinches and re-charges.
  const { ctx, page } = await newPage({ viewport: { width: 1000, height: 700 } });
  await page.goto(url);
  const r = await page.evaluate((s) => {
    eval(s); const cx = window.__bb.ARENA_W/2, cy = window.__bb.ARENA_H/2;
    window.__bb.spawn('aggressor', cx + 90, cy);     // same distance, opposite sides
    window.__bb.spawn('coward',    cx - 90, cy);
    window.__bb.pulse();
    window.__bb.tick(48);                            // ~0.8s: aggressor fear has lapsed, coward's has not
    const es = window.__bb.enemies;
    const agg = es.find(e=>e.type==='aggressor').dist, cow = es.find(e=>e.type==='coward').dist;
    return { agg, cow };
  }, setup);
  ok(r.cow > r.agg + 40, `pulse breaks each mind differently: coward flees far (${r.cow.toFixed(0)}), aggressor re-charges (${r.agg.toFixed(0)})`);
  ok(page.errs.length === 0, 'no console errors in the differentiated-pulse check');
  await ctx.close();
}

// ---- 11. README truthfulness regressions (evening polish, #85) ----
// The ward pulse is radius-limited (PULSE_R), not global, and the pack's rush
// gate is proximity (≥2 packmates near the player), not geometric flanking.
// A README that said "every enemy" / "have you flanked" overstated both mechanics.
{
  const readme = readFileSync(path.resolve('README.md'), 'utf8');
  ok(!/shove\s+every enemy back/i.test(readme),
    'README does not claim the pulse shoves *every* enemy (it is radius-limited)');
  ok(/near you/i.test(readme),
    'README qualifies the pulse shove as nearby enemies');
  ok(!/flanked/i.test(readme),
    'README does not overstate the pack gate as geometric flanking');
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
