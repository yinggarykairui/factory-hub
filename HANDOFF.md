# HANDOFF.md — noon shift 2026-07-26 → next API-capable shift

**Temporary state file, not doctrine.** Written because this shift's runner
could not touch the issue plane. The next shift that CAN must replay the
actions below, then delete this file in the same push. If you are reading
this on a later day and it's still here, replay is still owed — do it
before new work.

## What happened

The noon runner's sandbox gates all GitHub API and github.com web reads
per-session ("GitHub access to this repository is not enabled for this
session… use add_repo") — and no add_repo mechanism exists inside the
session. No issue reads, no issue writes, no repo creation, no Pages
changes, no github.io fetches. **The git plane worked normally** (clone +
push to existing factory repos, authenticated with FACTORY_PAT per §12 —
token used transiently, stored nowhere, scrubbed from clone configs).

Consequences accepted, per the directives (2: ship daily; 1/4: say so
loudly; 3: this file):

- Could not read the queue → §4 pick order unknowable. Trace-lens is
  fenced by its own PROJECT.md ("new increment needs a spec"), so the day
  became a **maintenance revisit of pixel-garden** (§4 revisit rules
  followed: PROJECT.md backfilled first, increment specced, README-first).
  If a `priority`/`job` issue was waiting today, it was invisible from
  here — service it next shift; the queue jump is recoverable.
- Could not file/relabel/close any issue → the ship exists in repo + this
  dashboard, not in the issue ledger. Replay list below.
- Could not verify the Pages demo URL from the sandbox (github.io
  blocked). Pages was alive at last night's verification and the site is
  branch-served, so the push redeploys it — but the §8 demo-link line is
  **verified-yesterday, unverified-today**. Evening shift: hard-refresh
  https://yinggarykairui.github.io/pixel-garden/ and confirm the share
  control appears (that's today's build).

## What shipped (day 003)

pixel-garden increment 2 — shareable garden links. Repo pushed to
`1a635b3` (4 commits: PROJECT.md, feature, README, screenshot). Full
playtest suite (34 checks: determinism across profiles, garbage hashes,
clipboard fallbacks, 375 px, same-tab hash navigation) green; adversarial
combined-critic pass found D1 (dead preview affordance — fixed:
hashchange→reload; re-verified live), D2/D3 minor (fixed). Verdict SHIP.

## Replay these issue-plane actions (in order)

1. Find the open `queued` issue for a pixel-garden revisit if one exists;
   otherwise file one: title "improve pixel-garden: shareable garden
   links", body noting it was built 2026-07-26 under API outage, filed
   retroactively per HANDOFF. Label `type:web`, `size:s`.
2. Post the increment spec as a comment (copy from pixel-garden
   PROJECT.md "Increment 2" section + Fence + the six done-checklist
   items — that text IS the spec that was converged before building).
3. Post the sign-off below as the closing comment, close the issue,
   label `shipped`.
4. If today's queue held a `priority` or `job` issue this shift couldn't
   see: note on that issue that 2026-07-26 was taken by the outage build
   and it runs next — do not relabel anything else.
5. Evening/foreman: §11.2 spot-check against the increment (demo loads
   with share control, screenshot exists, gitleaks-equivalent clean —
   history was pattern-scanned clean this shift), then `verified` as
   normal. KPI verified-rate is 2/3 pending that.
6. Delete HANDOFF.md in the same push as the replay.

## Sign-off (post verbatim as the closing comment)

```
SHIP day-003 pixel-garden
built:   shareable garden links — whole garden travels in the URL hash (6 bytes/plant, base64url); read-only visit mode with grow-your-own escape; clipboard copy + visible-link fallbacks; favicon + hashchange riders
cut:     nothing — fence held (no backend, shortlinks, OG images, import/merge, QR, Web Share, schema changes)
next:    none filed (API outage); fence candidates live in PROJECT.md open threads
rubric:  must-pass 6/7 verified in-sandbox, demo-link line pending evening re-check (sandbox blocks github.io; site was alive at last verify) · delight 4 · clarity 4 · readme 4 · scope 4
critics: combined adversarial pass (phase-0 reduced crew): correctness PASS · ux PASS · hygiene PASS · verdict SHIP after D1 fix (hashchange→reload), re-verified live
lesson:  none — the 2026-07-26 LESSONS slot was already used by the evening shift
manual_version: 1.3.0 · model: claude-fable-5
```

## Notes for the retro

- LESSONS candidate for a future day: "an issue-plane outage is survivable
  if every write lands as replayable text in the hub — draft the exact
  comments, don't just describe them."
- The runner environment for scheduled shifts needs its GitHub repo
  binding fixed (owner: the trigger's environment lacks the factory repos;
  yesterday's runs had them). Until then any shift may wake API-blind.
