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
    // (5) banner must NOT itself be a live region; the storage message is
    // announced once through the single #live announcer. Captured before any
    // interaction overwrites #live.
    const bannerLive = await p2.evaluate(() => {
      const b = document.getElementById("banner");
      return { role: b.getAttribute("role"), ariaLive: b.getAttribute("aria-live"), live: document.getElementById("live").textContent };
    });
    check("7c. banner is not a live region; storage message announced once via #live",
      !bannerLive.role && !bannerLive.ariaLive && /Storage unavailable/.test(bannerLive.live), JSON.stringify(bannerLive));
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

  // ---------- Regression suite: proves the review-cycle fixes ----------
  {
    const eR = [];
    const cR = await browser.newContext();
    const pR = await cR.newPage();
    trackErrors(pR, eR);
    await pR.goto(URL);
    await pR.waitForTimeout(120);

    // (1) imported playedMs:3e9 (>2^31, not checksum-covered) renders a sane,
    //     non-negative playtime instead of 32-bit-truncated garbage.
    const r1 = await pR.evaluate(() => {
      const data = { name: "Overflow", cls: "Mage", level: 2, hp: 20, maxHp: 20, gold: 5, x: 1, y: 1, inv: [] };
      const rec = { schema: 2, savedAt: new Date().toISOString(), playedMs: 3000000000, checksum: window.__sc.checksumOf(data), data };
      window.__sc.Store.set(window.__sc.PREFIX + "slot1", JSON.stringify(rec));
      window.__sc.renderSlots();
      const card = [...document.querySelectorAll(".slot")].find(c => c.querySelector(".ttl")?.textContent === "Slot I");
      const playedText = card ? [...card.querySelectorAll(".meta span")].map(s => s.textContent).find(t => /played/.test(t)) || "" : "";
      card.querySelector("button[data-act=load]").click();
      return { kind: window.__sc.readSlot("slot1").kind, playedText, livePlayed: window.__sc.playedMs };
    });
    check("R1. imported playedMs:3e9 renders non-negative playtime (no 32-bit wrap)",
      r1.kind === "ok" && /played\s+\d/.test(r1.playedText) && !/-/.test(r1.playedText) && r1.livePlayed >= 0,
      JSON.stringify(r1));

    // (2a) a checksummed import with hp:-500, maxHp:30 is rejected, never
    //      rendering negative hp.
    const r2a = await pR.evaluate(() => {
      const data = { name: "Bad HP", cls: "Knight", level: 1, hp: -500, maxHp: 30, gold: 0, x: 0, y: 0, inv: [] };
      const rec = { schema: 2, savedAt: new Date().toISOString(), playedMs: 0, checksum: window.__sc.checksumOf(data), data };
      window.__sc.Store.set(window.__sc.PREFIX + "slot2", JSON.stringify(rec));
      window.__sc.renderSlots();
      const card = [...document.querySelectorAll(".slot")].find(c => c.querySelector(".ttl")?.textContent === "Slot II");
      return { kind: window.__sc.readSlot("slot2").kind, corrupt: card?.classList.contains("corrupt"), hasLoad: !!card?.querySelector("button[data-act=load]"), text: card?.textContent || "" };
    });
    check("R2a. hp:-500,maxHp:30 rejected — never renders negative hp",
      r2a.kind === "corrupt" && r2a.corrupt && !r2a.hasLoad && !/-500/.test(r2a.text), JSON.stringify(r2a));

    // (2b) a schema-2 record missing a valid cls is rejected, so no blank class
    //      pill can ever be loaded/rendered.
    const r2b = await pR.evaluate(() => {
      const data = { name: "No Class", level: 1, hp: 30, maxHp: 30, gold: 0, x: 0, y: 0, inv: [] }; // no cls
      const rec = { schema: 2, savedAt: new Date().toISOString(), playedMs: 0, checksum: window.__sc.checksumOf(data), data };
      window.__sc.Store.set(window.__sc.PREFIX + "slot3", JSON.stringify(rec));
      window.__sc.renderSlots();
      const card = [...document.querySelectorAll(".slot")].find(c => c.querySelector(".ttl")?.textContent === "Slot III");
      return { kind: window.__sc.readSlot("slot3").kind, corrupt: card?.classList.contains("corrupt"), hasLoad: !!card?.querySelector("button[data-act=load]") };
    });
    check("R2b. schema-2 data missing cls rejected (no blank class pill)",
      r2b.kind === "corrupt" && r2b.corrupt && !r2b.hasLoad, JSON.stringify(r2b));

    // (3) two slots holding identical data must not emit duplicate element ids.
    const r3 = await pR.evaluate(() => {
      const data = { name: "Twin", cls: "Bard", level: 1, hp: 30, maxHp: 30, gold: 0, x: 2, y: 2, inv: [] };
      const json = JSON.stringify({ schema: 2, savedAt: new Date().toISOString(), playedMs: 1000, checksum: window.__sc.checksumOf(data), data });
      window.__sc.Store.set(window.__sc.PREFIX + "slot1", json);
      window.__sc.Store.set(window.__sc.PREFIX + "slot2", json);
      window.__sc.renderSlots();
      const ids = [...document.querySelectorAll("[id]")].map(e => e.id);
      const seen = {}; let dup = null;
      for (const id of ids) { if (seen[id]) { dup = id; break; } seen[id] = 1; }
      return { dup, grads: document.querySelectorAll("radialGradient").length };
    });
    check("R3. identical saves produce no duplicate element id in the DOM",
      r3.dup === null && r3.grads >= 2, JSON.stringify(r3));

    // (4a) demo buttons prefer an empty slot — no confirm, no overwrite.
    await pR.evaluate(() => { ["slot1", "slot2", "slot3", "slot4", "auto"].forEach(id => window.__sc.Store.remove(window.__sc.PREFIX + id)); window.__sc.renderSlots(); });
    let dialogFiredA = false;
    const handlerA = d => { dialogFiredA = true; d.dismiss(); };
    pR.on("dialog", handlerA);
    await pR.click("button[aria-label='Write a legacy v1 save into a slot']");
    await pR.waitForTimeout(60);
    pR.off("dialog", handlerA);
    const r4a = await pR.evaluate(() => ({ slot1: window.__sc.readSlot("slot1").kind }));
    check("R4a. demo prefers an empty slot (no confirm, fills Slot I)",
      !dialogFiredA && r4a.slot1 === "ok", JSON.stringify({ dialogFiredA, r4a }));

    // (4b) with every manual slot full, a demo button must confirm before
    //      overwriting; dismissing the confirm leaves the slot intact.
    await pR.evaluate(() => {
      const mk = name => { const data = { name, cls: "Knight", level: 1, hp: 30, maxHp: 30, gold: 0, x: 0, y: 0, inv: [] }; return JSON.stringify({ schema: 2, savedAt: new Date().toISOString(), playedMs: 0, checksum: window.__sc.checksumOf(data), data }); };
      ["slot1", "slot2", "slot3", "slot4"].forEach((id, i) => window.__sc.Store.set(window.__sc.PREFIX + id, mk("Hero" + i)));
      window.__sc.renderSlots();
    });
    const slot4Before = await pR.evaluate(() => JSON.stringify(window.__sc.readSlot("slot4").rec.data));
    let dialogFiredB = false;
    const handlerB = d => { dialogFiredB = true; d.dismiss(); };
    pR.on("dialog", handlerB);
    await pR.click("button[aria-label='Forge a future v99 save into a slot']");
    await pR.waitForTimeout(60);
    pR.off("dialog", handlerB);
    const slot4After = await pR.evaluate(() => JSON.stringify(window.__sc.readSlot("slot4").rec.data));
    check("R4b. demo confirms before overwriting a full slot; dismiss preserves it",
      dialogFiredB && slot4Before === slot4After, JSON.stringify({ dialogFiredB, preserved: slot4Before === slot4After }));

    // (5) exactly one aria-live region in the whole DOM.
    const r5 = await pR.evaluate(() => document.querySelectorAll('[aria-live],[role="status"],[role="alert"]').length);
    check("R5. exactly one aria-live region in the DOM", r5 === 1, "count=" + r5);

    // (6) a record with a bad savedAt renders a safe fallback, not "Invalid Date".
    const r6 = await pR.evaluate(() => {
      window.__sc.Store.remove(window.__sc.PREFIX + "slot2");
      const data = { name: "Timeless", cls: "Ranger", level: 1, hp: 30, maxHp: 30, gold: 0, x: 0, y: 0, inv: [] };
      const rec = { schema: 2, savedAt: "not-a-real-date", playedMs: 0, checksum: window.__sc.checksumOf(data), data };
      window.__sc.Store.set(window.__sc.PREFIX + "slot1", JSON.stringify(rec));
      window.__sc.renderSlots();
      const card = [...document.querySelectorAll(".slot")].find(c => c.querySelector(".ttl")?.textContent === "Slot I");
      return { kind: window.__sc.readSlot("slot1").kind, text: card ? card.textContent : "" };
    });
    check("R6. bad savedAt shows fallback ('unknown'), not 'Invalid Date'",
      r6.kind === "ok" && !/Invalid Date/.test(r6.text) && /unknown/.test(r6.text), JSON.stringify(r6));

    // (7) a slot re-render preserves keyboard focus on the acting button,
    //     instead of dropping it to <body> (evening a11y fix).
    const r7 = await pR.evaluate(() => {
      const data = { name: "Focus", cls: "Knight", level: 1, hp: 30, maxHp: 30, gold: 0, x: 0, y: 0, inv: [] };
      const rec = { schema: 2, savedAt: new Date().toISOString(), playedMs: 0, checksum: window.__sc.checksumOf(data), data };
      window.__sc.Store.set(window.__sc.PREFIX + "slot1", JSON.stringify(rec));
      window.__sc.renderSlots();
      const btn = document.querySelector('button[data-act="save"][data-id="slot1"]'); // "Overwrite"
      btn.focus();
      const before = document.activeElement === btn;
      window.__sc.renderSlots(); // the rebuild that used to drop focus to <body>
      const a = document.activeElement;
      return { before, tag: a ? a.tagName : null, act: a && a.dataset ? a.dataset.act : null, id: a && a.dataset ? a.dataset.id : null };
    });
    check("R7. focus survives a slot re-render (keyboard flow not dropped to body)",
      r7.before && r7.tag === "BUTTON" && r7.act === "save" && r7.id === "slot1", JSON.stringify(r7));

    // (8) a save with an empty name renders a placeholder, not a blank line.
    const r8 = await pR.evaluate(() => {
      const data = { name: "", cls: "Knight", level: 1, hp: 30, maxHp: 30, gold: 0, x: 0, y: 0, inv: [] };
      const rec = { schema: 2, savedAt: new Date().toISOString(), playedMs: 0, checksum: window.__sc.checksumOf(data), data };
      window.__sc.Store.set(window.__sc.PREFIX + "slot2", JSON.stringify(rec));
      window.__sc.renderSlots();
      const card = [...document.querySelectorAll(".slot")].find(c => c.querySelector(".ttl")?.textContent === "Slot II");
      const nm = card ? card.querySelector(".nm") : null;
      return { kind: window.__sc.readSlot("slot2").kind, nm: nm ? nm.textContent : null };
    });
    check("R8. empty-name save renders a placeholder, not a blank name line",
      r8.kind === "ok" && r8.nm === "(unnamed)", JSON.stringify(r8));

    check("R. zero console errors across the regression suite", eR.length === 0, eR.join(" | "));
    await cR.close();
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
