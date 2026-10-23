// Headless checks for rpg-atlas. Drives the real page in Chromium and asserts
// the done-checklist from the spec. Run: node test.mjs
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

const EXPECT_SLUGS = [
  'tile-forge', 'dungeon-sprout', 'overworld-express',
  'npc-clockwork', 'battle-brains',
  'turn-clash', 'parley', 'shop-keeper',
  'dialogue-loom', 'quest-thread', 'ink-quest',
  'pocket-inventory', 'save-crystal'
];

const browser = await chromium.launch();
const errors = [];
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => window.__atlas && window.__atlas.buttonCount() > 0);

// 1. loads, renders 13 landmarks across 5 territories, no welcome-state crash
{
  const d = await page.evaluate(() => ({
    buttons: document.querySelectorAll('button.landmark').length,
    territories: document.querySelectorAll('section.territory').length,
    systems: window.__atlas.systems.length,
    legendKeys: document.querySelectorAll('#legend .key').length,
    panelHasHeading: !!document.querySelector('#panel h3'),
    countSystems: document.getElementById('count-systems').textContent
  }));
  ok(d.buttons === 13, `13 landmark buttons render (got ${d.buttons})`);
  ok(d.territories === 5, `5 territories render (got ${d.territories})`);
  ok(d.systems === 13, `13 systems in data (got ${d.systems})`);
  ok(d.legendKeys === 5, `map key lists 5 territories (got ${d.legendKeys})`);
  ok(d.panelHasHeading, 'panel shows a welcome heading before any selection');
  ok(d.countSystems === '13', 'masthead states 13 subsystems');
}

// 2. every landmark's links resolve to the right demo + source URLs, all 13 slugs present and unique
{
  const info = await page.evaluate(() => {
    const slugs = Array.from(document.querySelectorAll('button.landmark')).map(b => b.dataset.slug);
    const sys = window.__atlas.systems.map(s => ({
      slug: s.slug, demo: window.__atlas.demoUrl(s.slug), repo: window.__atlas.repoUrl(s.slug)
    }));
    return { slugs, sys };
  });
  const uniq = new Set(info.slugs);
  ok(uniq.size === 13, `all 13 landmark slugs unique (got ${uniq.size})`);
  for (const want of EXPECT_SLUGS) ok(uniq.has(want), `landmark present: ${want}`);
  let urlsOk = true;
  for (const s of info.sys) {
    if (s.demo !== `https://yinggarykairui.github.io/${s.slug}/`) urlsOk = false;
    if (s.repo !== `https://github.com/yinggarykairui/${s.slug}`) urlsOk = false;
  }
  ok(urlsOk, 'every demo/source URL matches the github.io / github.com pattern');
}

// 3. mouse selection updates the panel + aria-pressed; exactly one pressed at a time
{
  const first = page.locator('button.landmark[data-slug="tile-forge"]');
  await first.click();
  const sel = await page.evaluate(() => {
    const pressed = Array.from(document.querySelectorAll('button.landmark'))
      .filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.slug);
    const h3 = document.querySelector('#panel h3').textContent;
    const blurb = document.querySelector('#panel .blurb').textContent;
    const demoHref = document.querySelector('#panel a.link.primary').getAttribute('href');
    const srcHref = document.querySelector('#panel a.link:not(.primary)').getAttribute('href');
    return { pressed, h3, blurbLen: blurb.length, demoHref, srcHref, cur: window.__atlas.current };
  });
  ok(sel.pressed.length === 1 && sel.pressed[0] === 'tile-forge', 'exactly one landmark pressed after click');
  ok(sel.h3 === 'Tilemap', `panel heading is the selected subsystem (got "${sel.h3}")`);
  ok(sel.blurbLen > 20, 'panel shows a non-empty blurb');
  ok(sel.demoHref === 'https://yinggarykairui.github.io/tile-forge/', 'panel Play-demo link is correct');
  ok(sel.srcHref === 'https://github.com/yinggarykairui/tile-forge', 'panel Source link is correct');
  ok(sel.cur === 'tile-forge', 'introspection current matches selection');
}

// 3b. keyboard: focus a landmark and press Enter — same effect as a click
{
  const btn = page.locator('button.landmark[data-slug="save-crystal"]');
  await btn.focus();
  await page.keyboard.press('Enter');
  const d = await page.evaluate(() => ({
    cur: window.__atlas.current,
    h3: document.querySelector('#panel h3').textContent,
    demoHref: document.querySelector('#panel a.link.primary').getAttribute('href')
  }));
  ok(d.cur === 'save-crystal', 'Enter on a focused landmark selects it');
  ok(d.h3 === 'Saves', 'keyboard selection updates the panel heading');
  ok(d.demoHref === 'https://yinggarykairui.github.io/save-crystal/', 'keyboard selection updates the demo link');

  // Space also activates (native button behaviour)
  const btn2 = page.locator('button.landmark[data-slug="parley"]');
  await btn2.focus();
  await page.keyboard.press(' ');
  const cur2 = await page.evaluate(() => window.__atlas.current);
  ok(cur2 === 'parley', 'Space on a focused landmark selects it');
}

// 4. phone width: no horizontal overflow, territories stacked
{
  await page.setViewportSize({ width: 360, height: 760 });
  await page.waitForTimeout(80);
  const d = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    firstBtnVisible: !!document.querySelector('button.landmark').offsetParent
  }));
  ok(d.overflow <= 1, `no horizontal scroll at 360px (overflow ${d.overflow}px)`);
  ok(d.firstBtnVisible, 'landmarks still visible at phone width');
}

// 5. rapid re-selection stays clean; still exactly one pressed, no errors
{
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.evaluate(() => {
    const a = window.__atlas; const s = a.systems;
    for (let i = 0; i < 60; i++) a.select(s[i % s.length].slug);
  });
  const d = await page.evaluate(() => {
    const pressed = Array.from(document.querySelectorAll('button.landmark'))
      .filter(b => b.getAttribute('aria-pressed') === 'true').length;
    return { pressed, cur: window.__atlas.current };
  });
  ok(d.pressed === 1, `after 60 rapid selects exactly one pressed (got ${d.pressed})`);
  // selecting an unknown slug must be a no-op, not a throw
  const before = d.cur;
  const after = await page.evaluate(() => { window.__atlas.select('no-such-slug'); return window.__atlas.current; });
  ok(after === before, 'selecting an unknown slug is a safe no-op');
}

ok(errors.length === 0, 'no console/page errors across the whole run: ' + JSON.stringify(errors.slice(0, 4)));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
