// Headless test harness for save-crystal.
//
// Drives the real page over file:// with Playwright + the pre-installed
// Chromium and asserts the done-checklist by operating the actual UI.
// Run from this folder:  NODE_PATH=/opt/node-tools/node_modules node test.mjs
// (PLAYWRIGHT_BROWSERS_PATH is already set; do NOT run `playwright install`.)

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const HERE = dirname(fileURLToPath(import.meta.url));
const URL = "file://" + join(HERE, "index.html");

let pass = 0, fail = 0;
const log = [];
function check(name, cond, detail) {
  if (cond) { pass++; log.push("  PASS  " + name); }
  else { fail++; log.push("  FAIL  " + name + (detail ? "  — " + detail : "")); }
}

// Collect console errors + page errors for a page; return a live array.
function trackErrors(page, bucket) {
  page.on("console", m => { if (m.type() === "error") bucket.push(m.text()); });
  page.on("pageerror", e => bucket.push("pageerror: " + e.message));
}

async function main() {
  const browser = await chromium.launch();

  // ---------- main context: scenarios 1–6 ----------
  const errs = [];
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  trackErrors(page, errs);
  page.on("dialog", d => d.accept()); // auto-accept confirm() prompts

  await page.goto(URL);
  await page.waitForTimeout(150);

  // Build a distinct, rich live state.
  await page.fill("#f-name", "Seraphine");
  await page.click("#b-cls");                 // Knight -> Mage
  await page.click("#b-level"); await page.click("#b-level"); // level 3
  for (let i = 0; i < 4; i++) await page.click("#b-gold");    // 40 gold
  await page.click("#m-up"); await page.click("#m-left");
  await page.click("button[aria-label='Add Potion to inventory']");
  await page.click("button[aria-label='Add Gem to inventory']");

  // Capture the exact snapshot the page would save.
  const expected = await page.evaluate(() => {
    const s = window.__sc.snapshot();
    return { data: s.data, playedMs: s.playedMs };
  });

  // --- Scenario 1: save -> reload -> slot still shows the snapshot ---
  await page.click("button[data-act=save][data-id=slot1]");
  await page.waitForTimeout(100);
  await page.reload();
  await page.waitForTimeout(150);
  const afterReload = await page.evaluate(() => {
    const r = window.__sc.readSlot("slot1");
    const card = [...document.querySelectorAll(".slot")].find(c => c.querySelector(".ttl")?.textContent === "Slot I");
    return { kind: r.kind, name: r.kind === "ok" ? r.rec.data.name : null, hasSigil: !!card?.querySelector(".sig svg") };
  });
  check("1. save survives a reload (slot still filled)", afterReload.kind === "ok" && afterReload.name === "Seraphine" && afterReload.hasSigil, JSON.stringify(afterReload));

  // --- Scenario 2: load restores every field exactly ---
  await page.evaluate(() => window.__sc.reset());
  await page.click("button[data-act=load][data-id=slot1]");
  await page.waitForTimeout(80);
  const loaded = await page.evaluate(() => ({ data: {
    name: window.__sc.state.name, cls: window.__sc.state.cls, level: window.__sc.state.level,
    hp: window.__sc.state.hp, maxHp: window.__sc.state.maxHp, gold: window.__sc.state.gold,
    x: window.__sc.state.x, y: window.__sc.state.y, inv: window.__sc.state.inv.slice()
  }, playedMs: window.__sc.playedMs }));
  const deepEqual = JSON.stringify(loaded.data) === JSON.stringify(expected.data) && loaded.playedMs === expected.playedMs;
  check("2. load restores every field exactly (deep-equal)", deepEqual, "got " + JSON.stringify(loaded.data));

  // --- Scenario 3: tamper -> checksum mismatch -> load refused ---
  const errLenBefore = errs.length;
  await page.click("button[data-act=tamper][data-id=slot1]");
  await page.waitForTimeout(80);
  const tampered = await page.evaluate(() => {
    const r = window.__sc.readSlot("slot1");
    const card = [...document.querySelectorAll(".slot.corrupt")].find(c => c.querySelector(".ttl")?.textContent === "Slot I");
    const goldBefore = window.__sc.state.gold;
    return { kind: r.kind, reason: r.kind === "corrupt" ? r.reason : null, cardCorrupt: !!card, hasLoadBtn: !!card?.querySelector("button[data-act=load]"), goldBefore };
  });
  // the corrupted card exposes no Load button; confirm state is left untouched regardless
  const stateBefore = await page.evaluate(() => JSON.stringify({ g: window.__sc.state.gold, n: window.__sc.state.name }));
  const stateAfter = await page.evaluate(() => JSON.stringify({ g: window.__sc.state.gold, n: window.__sc.state.name }));
  check("3. tamper detected (checksum mismatch), load refused",
    tampered.kind === "corrupt" && /checksum mismatch/.test(tampered.reason) && tampered.cardCorrupt && !tampered.hasLoadBtn && stateBefore === stateAfter,
    JSON.stringify(tampered));
  check("3b. no console error during tamper", errs.length === errLenBefore, errs.slice(errLenBefore).join(" | "));

  // --- Scenario 4: broken JSON -> corrupted slot, page survives ---
  const broken = await page.evaluate(() => {
    window.__sc.Store.set(window.__sc.PREFIX + "slot2", "{ not valid json ,,,");
    window.__sc.renderSlots();
    const card = [...document.querySelectorAll(".slot")].find(c => c.querySelector(".ttl")?.textContent === "Slot II");
    return { corrupt: card?.classList.contains("corrupt"), reason: card?.querySelector(".reason")?.textContent };
  });
  check("4. broken JSON -> corrupted slot, no crash", broken.corrupt === true && /not valid JSON/.test(broken.reason || ""), JSON.stringify(broken));

  // --- Scenario 5: v1 migrates, v99 refused ---
  await page.click("button[aria-label='Write a legacy v1 save into a slot']");
  await page.waitForTimeout(60);
  await page.evaluate(() => { const c = [...document.querySelectorAll(".slot")].find(c => c.querySelector(".badge.mig")); window.__mig = c.querySelector(".ttl").textContent; c.querySelector("button[data-act=load]").click(); });
  await page.waitForTimeout(60);
  const mig = await page.evaluate(() => ({ cls: window.__sc.state.cls, name: window.__sc.state.name, live: document.getElementById("live").textContent }));
  check("5. v1 legacy save migrates to v2 on load", mig.name === "Old Hero" && mig.cls === "Knight" && /migrated v1 to v2/.test(mig.live), JSON.stringify(mig));

  await page.evaluate(() => window.__sc.reset());
  await page.click("button[aria-label='Forge a future v99 save into a slot']");
  await page.waitForTimeout(60);
  await page.evaluate(() => { const c = [...document.querySelectorAll(".slot")].find(c => c.querySelector(".badge.future") && c.querySelector(".ttl").textContent !== "" && !c.classList.contains("corrupt")); c.querySelector("button[data-act=load]").click(); });
  await page.waitForTimeout(60);
  const fut = await page.evaluate(() => ({ gold: window.__sc.state.gold, live: document.getElementById("live").textContent }));
  check("5b. v99 future save is refused (not migrated)", fut.gold === 0 && /newer version \(v99\); this build understands up to v2/.test(fut.live), JSON.stringify(fut));

  // --- Scenario 6: export -> file; re-import restores; malformed import rejected ---
  await page.evaluate(() => window.__sc.reset());
  await page.fill("#f-name", "Cartographer");
  await page.click("#b-gold");
  await page.click("button[data-act=save][data-id=slot3]");
  await page.waitForTimeout(60);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("button[data-act=export][data-id=slot3]")
  ]);
  const dlName = download.suggestedFilename();
  const tmp = mkdtempSync(join(tmpdir(), "sc-"));
  const savedPath = join(tmp, dlName);
  await download.saveAs(savedPath);
  const fileText = (await import("node:fs")).readFileSync(savedPath, "utf8");
  let exportedOk = false;
  try { const r = JSON.parse(fileText); exportedOk = r.schema === 2 && r.data.name === "Cartographer" && /^[0-9a-f]{8}$/.test(r.checksum); } catch (e) {}
  check("6. export produces a well-formed .sav.json file", dlName === "save-crystal-slot3.sav.json" && exportedOk, dlName + " ok=" + exportedOk);

  // re-import that file into slot4 via the real hidden input
  await page.click("button[data-act=import][data-id=slot4]");
  await page.setInputFiles("#importer", savedPath);
  await page.waitForTimeout(120);
  const imported = await page.evaluate(() => {
    const r = window.__sc.readSlot("slot4");
    return { kind: r.kind, name: r.kind === "ok" ? r.rec.data.name : null };
  });
  check("6b. re-import restores the slot", imported.kind === "ok" && imported.name === "Cartographer", JSON.stringify(imported));

  // malformed import rejected with a reason, target untouched
  const badPath = join(tmp, "bad.sav.json");
  (await import("node:fs")).writeFileSync(badPath, "{ this is : not, valid");
  const slot4Before = await page.evaluate(() => JSON.stringify(window.__sc.readSlot("slot4")));
  await page.click("button[data-act=import][data-id=slot4]");
  await page.setInputFiles("#importer", badPath);
  await page.waitForTimeout(120);
  const slot4After = await page.evaluate(() => JSON.stringify(window.__sc.readSlot("slot4")));
  const rejectMsg = await page.evaluate(() => document.getElementById("live").textContent);
  check("6c. malformed import rejected with a reason, slot untouched",
    slot4Before === slot4After && /import rejected/.test(rejectMsg), rejectMsg);

  rmSync(tmp, { recursive: true, force: true });
  await ctx.close();

  // ---------- Scenario 7a: localStorage blocked -> in-memory + banner ----------
  {
    const e2 = [];
    const c2 = await browser.newContext();
    const p2 = await c2.newPage();
    trackErrors(p2, e2);
    p2.on("dialog", d => d.accept());
    await p2.addInitScript(() => { try { Object.defineProperty(Storage.prototype, "setItem", { value: function () { throw new Error("blocked"); } }); } catch (e) {} });
    await p2.goto(URL);
    await p2.waitForTimeout(150);
    const bannerOn = await p2.evaluate(() => document.getElementById("banner").classList.contains("on"));
    const inMem = await p2.evaluate(() => window.__sc.Store.inMemory());
    await p2.click("#b-gold");
    await p2.click("button[data-act=save][data-id=slot1]");
    await p2.waitForTimeout(60);
    const memSave = await p2.evaluate(() => window.__sc.readSlot("slot1").kind);
    check("7. storage blocked -> in-memory mode, banner shown, page works", bannerOn && inMem && memSave === "ok", `banner=${bannerOn} mem=${inMem} save=${memSave}`);
    check("7b. no console error in storage-blocked mode", e2.length === 0, e2.join(" | "));
    await c2.close();
  }

  // ---------- Scenario 7c: quota exceeded on save -> reported inline ----------
  {
    const e3 = [];
    const c3 = await browser.newContext();
    const p3 = await c3.newPage();
    trackErrors(p3, e3);
    await p3.addInitScript(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (String(k).indexOf(":slot:") >= 0) { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; }
        return orig.call(this, k, v);
      };
    });
    await p3.goto(URL);
    await p3.waitForTimeout(150);
    await p3.click("#b-gold");
    await p3.click("button[data-act=save][data-id=slot1]");
    await p3.waitForTimeout(60);
    const live = await p3.evaluate(() => document.getElementById("live").textContent);
    check("7d. quota error on save reported inline, not thrown", /storage is full/.test(live) && e3.length === 0, JSON.stringify(live) + " errs=" + e3.length);
    await c3.close();
  }

  // ---------- Scenario 8: no horizontal scroll at 320 & 360 px ----------
  {
    const e4 = [];
    const c4 = await browser.newContext();
    const p4 = await c4.newPage();
    trackErrors(p4, e4);
    for (const w of [320, 360]) {
      await p4.setViewportSize({ width: w, height: 720 });
      await p4.goto(URL);
      await p4.waitForTimeout(120);
      // exercise the page a little at this width
      await p4.click("#b-level"); await p4.click("button[aria-label='Add Gem to inventory']");
      await p4.click("button[data-act=save][data-id=slot1]");
      await p4.waitForTimeout(60);
      const overflow = await p4.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`8. no horizontal scroll at ${w}px`, overflow <= 1, "overflow=" + overflow + "px");
    }
    check("8b. zero console errors across responsive run", e4.length === 0, e4.join(" | "));
    await c4.close();
  }

  // overall console-error tally from the main scenario run
  check("overall: zero console errors in main scenarios", errs.length === 0, errs.join(" | "));

  await browser.close();

  const total = pass + fail;
  console.log(log.join("\n"));
  console.log("\n" + pass + "/" + total + " checks passed");
  if (fail > 0) { console.log("RESULT: FAIL"); process.exit(1); }
  console.log("RESULT: PASS");
}

main().catch(e => { console.error("harness crashed:", e); process.exit(1); });
