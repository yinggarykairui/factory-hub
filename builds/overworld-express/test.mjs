// Headless checks for overworld-express. Drives the real page in Chromium
// and asserts the done-checklist. Run: node test.mjs
// Needs Playwright resolvable (PLAYWRIGHT_BROWSERS_PATH is honoured).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pwPath = process.env.PW_PATH ||
  require.resolve('playwright', { paths: ['/opt/node-tools/node_modules', '/home/user', '/home/user/factory-hub'] });
const _pw = await import(pwPath);
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const url = 'file://' + join(here, 'index.html');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };

const browser = await chromium.launch();
const errors = [];
const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => window.__ow && window.__ow.map);

const api = () => page.evaluate.bind(page);

// 1. loads with the built-in map, player on a walkable tile, camera set
{
  const d = await page.evaluate(() => {
    const o = window.__ow; const p = o.player; const m = o.map;
    return { w: m.width, h: m.height, version: m.version, pw: p.tx, ph: p.ty,
             walk: o.canWalk(p.tx, p.ty), cam: o.cam, view: o.view, biome: o.biome(), coords: document.getElementById('coords').textContent };
  });
  ok(d.version === 1, 'built-in map has schema version 1');
  ok(d.w >= 40 && d.h >= 30, `map larger than a viewport (${d.w}x${d.h})`);
  ok(d.w * 32 > d.view.w && d.h * 32 > d.view.h, 'map is bigger than the viewport in pixels');
  ok(d.walk, 'player spawns on a walkable tile');
  ok(d.cam.x >= 0 && d.cam.y >= 0, 'camera is clamped to non-negative');
  ok(/^\(\d+, \d+\)$/.test(d.coords), 'coords readout renders');
  ok(d.biome && d.biome.length > 0, 'biome readout renders: ' + d.biome);
}

// 2. movement + camera follow + clamp (no void past the edge)
{
  const start = await page.evaluate(() => window.__ow.player);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(260);
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(160);
  const after = await page.evaluate(() => window.__ow.player);
  ok(after.tx > start.tx || after.ty !== start.ty, 'holding a key walks the traveler');

  // walk hard into the top-left corner; camera must clamp to 0,0 and never go negative
  const clamp = await page.evaluate(() => {
    const o = window.__ow; let minx = 1e9, miny = 1e9;
    for (let i = 0; i < 120; i++) { o.step('up'); o.step('left'); minx = Math.min(minx, o.cam.x); miny = Math.min(miny, o.cam.y); }
    return { camx: o.cam.x, camy: o.cam.y, minx, miny };
  });
  ok(clamp.minx >= 0 && clamp.miny >= 0, 'camera never shows void past the top/left edge');

  const clamp2 = await page.evaluate(() => {
    const o = window.__ow, m = o.map; let maxx = -1, maxy = -1;
    for (let i = 0; i < 200; i++) { o.step('down'); o.step('right'); maxx = Math.max(maxx, o.cam.x); maxy = Math.max(maxy, o.cam.y); }
    return { maxx, maxy, limX: m.width * 32 - o.view.w, limY: m.height * 32 - o.view.h };
  });
  ok(clamp2.maxx <= clamp2.limX + 0.5, 'camera clamps at the right edge');
  ok(clamp2.maxy <= clamp2.limY + 0.5, 'camera clamps at the bottom edge');
}

// 3. collision: cannot enter water / tree / wall / off-map
{
  const r = await page.evaluate(() => {
    const o = window.__ow, m = o.map, out = { blocked: 0, offmap: true };
    // off-map is never walkable
    out.offmap = !o.canWalk(-1, 0) && !o.canWalk(0, -1) && !o.canWalk(m.width, 0) && !o.canWalk(0, m.height);
    // every blocking tile index reports not-walkable
    const names = m.palette;
    let water = null, tree = null, wall = null;
    for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
      const v = m.tiles[y][x];
      if (names[v] === 'water' && !water) water = [x, y];
      if (names[v] === 'tree' && !tree) tree = [x, y];
      if (names[v] === 'wall' && !wall) wall = [x, y];
    }
    out.water = water && !o.canWalk(water[0], water[1]);
    out.tree = tree && !o.canWalk(tree[0], tree[1]);
    out.wall = wall && !o.canWalk(wall[0], wall[1]);
    out.has = { water: !!water, tree: !!tree, wall: !!wall };
    return out;
  });
  ok(r.offmap, 'off-map tiles are never walkable');
  ok(r.has.water && r.water, 'water blocks movement');
  ok(r.has.tree && r.tree, 'trees block movement');
  ok(r.has.wall && r.wall, 'walls block movement');
  // stepping into a blocker does not move the player
  const held = await page.evaluate(() => {
    const o = window.__ow, m = o.map;
    // find a walkable tile adjacent to water, stand there, step toward water
    for (let y = 1; y < m.height - 1; y++) for (let x = 1; x < m.width - 1; x++) {
      if (!o.canWalk(x, y)) continue;
      const nb = [['right', x + 1, y], ['left', x - 1, y], ['down', x, y + 1], ['up', x, y - 1]];
      for (const [dir, nx, ny] of nb) if (m.palette[m.tiles[ny][nx]] === 'water') {
        o.teleport(x, y); const before = o.player; const moved = o.step(dir);
        return { moved, same: o.player.tx === before.tx && o.player.ty === before.ty };
      }
    }
    return { moved: false, same: true };
  });
  ok(!held.moved && held.same, 'a step into water leaves the player put');
}

// 4. biome transition: crossing biomes fires the banner and updates readout
{
  const r = await page.evaluate(async () => {
    const o = window.__ow, m = o.map;
    // find two orthogonally adjacent walkable tiles with different biomes
    const biome = (v) => ({ grass: 'Meadow', flower: 'Meadow', sand: 'The Sands', stone: 'Stone Pass', path: 'The Road', door: 'Doorway' }[m.palette[v]] || 'The Wilds');
    for (let y = 1; y < m.height - 1; y++) for (let x = 1; x < m.width - 1; x++) {
      if (!o.canWalk(x, y)) continue;
      const bHere = biome(m.tiles[y][x]);
      const nb = [['right', x + 1, y], ['down', x, y + 1], ['left', x - 1, y], ['up', x, y - 1]];
      for (const [dir, nx, ny] of nb) {
        if (!o.canWalk(nx, ny)) continue;
        if (biome(m.tiles[ny][nx]) !== bHere) {
          o.teleport(x, y);
          const b0 = o.biome();
          o.step(dir);
          return { b0, b1: o.biome(), banner: o.banner(), changed: o.biome() !== b0 };
        }
      }
    }
    return null;
  });
  ok(r && r.changed, 'crossing into a new biome updates the readout (' + (r ? r.b0 + ' → ' + r.b1 : 'no boundary found') + ')');
  ok(r && r.banner === r.b1, 'the crossing fires the banner with the new biome name');
}

// 5. valid tile-forge import replaces the map and respawns on walkable ground
{
  const sample = JSON.stringify({
    version: 1, width: 5, height: 4,
    palette: ['empty','grass','water','sand','stone','path','tree','flower','wall','door'],
    tiles: [[2,2,2,2,2],[2,1,1,5,2],[2,3,9,1,2],[2,2,2,2,2]]
  });
  const r = await page.evaluate((s) => {
    const o = window.__ow; const okLoad = o.loadText(s);
    return { okLoad, w: o.map.width, h: o.map.height, walk: o.canWalk(o.player.tx, o.player.ty),
             status: document.getElementById('status').textContent };
  }, sample);
  ok(r.okLoad && r.w === 5 && r.h === 4, 'a valid tile-forge export loads and replaces the map');
  ok(r.walk, 'player respawns on a walkable tile in the imported map');
  ok(/Loaded/.test(r.status), 'status confirms the load');
}

// 6. garbage imports never crash and keep the current map
{
  const cases = [
    ['not json at all {{{', 'not valid JSON'],
    [JSON.stringify({ width: 3, height: 3 }), 'missing tiles'],
    [JSON.stringify({ version: 1, width: 3, height: 2, tiles: [[1,1,1]] }), 'too few rows'],
    [JSON.stringify({ version: 1, width: 3, height: 1, tiles: [[1,1]] }), 'short row'],
    [JSON.stringify({ version: 1, width: 2, height: 1, tiles: [[1, 99]] }), 'out-of-range index'],
    [JSON.stringify([1,2,3]), 'array not object'],
    [JSON.stringify({ version: 1, width: -4, height: 3, tiles: [] }), 'negative dimension'],
    [JSON.stringify(null), 'null'],
    [JSON.stringify({ version: 1, width: 3, height: 3, tiles: [[2,2,2],[2,8,2],[2,2,2]] }), 'no walkable ground'],
  ];
  for (const [text, label] of cases) {
    const r = await page.evaluate((t) => {
      const o = window.__ow; const before = { w: o.map.width, h: o.map.height };
      let threw = false, ret;
      try { ret = o.loadText(t); } catch (e) { threw = true; }
      return { threw, ret, before, after: { w: o.map.width, h: o.map.height }, status: document.getElementById('status').textContent };
    }, text);
    // the out-of-range case loads with cleared tiles (that is valid structure); all others are refused
    if (label === 'out-of-range index') {
      ok(!r.threw && r.ret === true, 'out-of-range indices are cleared, not crashed');
    } else {
      ok(!r.threw && r.ret === false, `garbage refused without crashing: ${label}`);
      ok(r.after.w === r.before.w && r.after.h === r.before.h, `current map kept after: ${label}`);
    }
  }
}

// 6b. a large all-blocking map is refused without hanging the thread
{
  const big = JSON.stringify((() => {
    const w = 220, h = 220, row = Array(w).fill(8); // all wall
    return { version: 1, width: w, height: h, palette: ['empty','grass','water','sand','stone','path','tree','flower','wall','door'], tiles: Array.from({ length: h }, () => row.slice()) };
  })());
  const r = await page.evaluate((t) => {
    const o = window.__ow; const before = { w: o.map.width };
    const t0 = performance.now(); const ret = o.loadText(t); const ms = performance.now() - t0;
    return { ret, ms, kept: o.map.width === before.w };
  }, big);
  ok(r.ret === false && r.kept, 'a 220×220 all-wall map is refused and the current map kept');
  ok(r.ms < 1000, `refusal is prompt, no spiral hang (${r.ms.toFixed(0)}ms)`);
}

// 6c. a quick d-pad tap steps exactly once (no hold required)
{
  await page.setViewportSize({ width: 360, height: 720 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.dpad')).display !== 'none');
  const r = await page.evaluate(async () => {
    const o = window.__ow; o.loadBuiltIn(); o.teleport(28, 20);           // spawn on the road
    const before = o.player.ty;
    const btn = document.querySelector('.dpad .down');
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));       // released same frame
    await new Promise(r => setTimeout(r, 220));                            // let the tween finish
    return { before, after: o.player.ty, moving: o.player.moving };
  });
  ok(r.after === r.before + 1 && !r.moving, `a tap-release on the d-pad walks one tile (${r.before}→${r.after})`);
}

// 7. phone width: usable at a narrow viewport, d-pad present, resize re-fits
{
  await page.setViewportSize({ width: 360, height: 720 });
  await page.waitForTimeout(120);
  const r = await page.evaluate(() => {
    const o = window.__ow;
    const dpad = getComputedStyle(document.querySelector('.dpad')).display;
    const cv = document.getElementById('view');
    const noHScroll = document.documentElement.scrollWidth <= window.innerWidth + 1;
    return { view: o.view, cvw: cv.width, dpad, noHScroll };
  });
  ok(r.view.w > 0 && r.view.h > 0 && r.cvw > 0, 'canvas re-fits at phone width');
  ok(r.view.w <= 360, 'viewport fits within the phone width');
  ok(r.dpad !== 'none', 'touch d-pad is shown on a coarse/narrow screen');
  ok(r.noHScroll, 'no horizontal page scroll at phone width');
}

// no uncaught errors anywhere above
ok(errors.length === 0, 'no console / page errors (' + errors.slice(0, 3).join(' | ') + ')');

await browser.close();
console.log(`\noverworld-express: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
