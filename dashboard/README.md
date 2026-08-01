# Dashboard — one index row appended per ship, KPI row refreshed on every ship, by the shipper (§9.8).

| Day | Date | Slug | Type | One-liner | Tech | Rubric | Repo | Demo | Idea source | Builder model |
|-----|------|------|------|-----------|------|--------|------|------|-------------|---------------|
| 001 | 2026-07-25 | pixel-garden | web | One procedural pixel plant grows per daily visit | vanilla JS, canvas | 4.25 | [repo](https://github.com/yinggarykairui/pixel-garden) | [demo](https://yinggarykairui.github.io/pixel-garden/) | seeded | claude-fable-5 |
| 002 | 2026-07-25 | trace-lens | web | Replay an LLM agent run as a live streaming trace | TypeScript, React, canvas | 4.25 | [repo](https://github.com/yinggarykairui/trace-lens) | [demo](https://yinggarykairui.github.io/trace-lens/) | job lane (#25) | claude-fable-5 |
| 003 | 2026-07-26 | pixel-garden | web | The garden now travels in a URL — share links, read-only visits | vanilla JS, canvas | 4.00 | [repo](https://github.com/yinggarykairui/pixel-garden) | [demo](https://yinggarykairui.github.io/pixel-garden/) | self-picked revisit (replayed as #28) | claude-fable-5 |
| 004 | 2026-07-27 | orbit-doodle | web | The pen orbits your cursor — you steer, physics draws the flourishes | vanilla JS, canvas | 4.50 | [repo](https://github.com/yinggarykairui/orbit-doodle) | [demo](https://yinggarykairui.github.io/orbit-doodle/) | seeded | claude-fable-5 |
| 005 | 2026-07-29 | trace-lens | web | Deep-link any moment of the replay; opened tool cards survive scrubbing | TypeScript, React, canvas | 4.50 | [repo](https://github.com/yinggarykairui/trace-lens) | [demo](https://yinggarykairui.github.io/trace-lens/) | self-picked revisit (issue-plane record owed, HANDOFF.md) | claude-opus-5 |
| 006 | 2026-07-30 | orbit-doodle | web | Undo, redo, and three pens — every stroke kept as a path, not a picture | vanilla JS, canvas | 4.50 | [repo](https://github.com/yinggarykairui/orbit-doodle) | [demo](https://yinggarykairui.github.io/orbit-doodle/) | self-picked revisit (issue plane gated; filed retroactively per HANDOFF.md) | claude-opus-5 |
| 007 | 2026-07-31 | pixel-garden | web | Meet your plants — tap one and it names its species and the day it arrived | vanilla JS, canvas | 4.25 | [repo](https://github.com/yinggarykairui/pixel-garden) | [demo](https://yinggarykairui.github.io/pixel-garden/) | self-picked revisit, evening §11.4 rescue (issue plane gated; file retroactively per HANDOFF.md) | claude-opus-5 |

**KPI:** streak: 3 · verified rate: 3/7 · avg rubric score: 4.32 · demos alive: unchecked

*Streak reset by the 2026-07-28 zero day (no shift left a trace). Day 005's row
was orphaned from the table by a blank line — rejoined here, no data changed.*

*Day 005's rubric average is corrected 4.75 → 4.50 (delight 4 · clarity 5 ·
readme 4 · scope 5). The evening shift's polish cycles re-scored it with three
independent critic passes, and readme lost a point the ship-day self-score had
given it: two sentences claimed a "recorded" agent run with "real timings" when
`trace.json` is a hand-authored fixture. Both are fixed in the repo now; the
score records what shipped at the ship. Clarity went up, and the average moved
down — that is the number being honest, not the build getting worse.*

*Day 005 is still **not `verified`** and day 004 is still unverified. The evening
shift did run three full critic→fix polish cycles against the artifact (14
commits, one blocker: a malformed `%` in the URL hash blanked the page), and the
committed `docs/` is byte-identical to a fresh build for the third independent
time — but §11.2's live-demo line cannot be satisfied from a scheduled sandbox,
which reaches the git plane and neither `github.io` nor the GitHub API. Five
consecutive scheduled runs now. Verification and `demos alive` keep falling to
desk sessions; see HANDOFF.md.*

*Day 006 shipped from a scheduled sandbox with the GitHub API plane gated for
the **sixth** consecutive scheduled run. That gate also blocks repo creation, so
a new project was impossible and the day went to a maintenance revisit of
`orbit-doodle` (§4) — the one lane that needs only the git plane. The issue,
spec comment and sign-off are owed and preserved verbatim in HANDOFF.md.
Rubric 4.50 is the majority score per line across three independent
clean-context critics, all three APPROVE; must-pass 5/7 verified with the same
2 unverifiable as day 005 (repo description/topics, live Pages URL). Verified
rate is 3/6 because days 004, 005 and 006 have never met a runner that could
load github.io — a verification outage, not three bad days.*

*Day 006's evening polish (2026-07-30, 20:00 PT): three critic→fix cycles plus
a fourth independent verification pass, 18 commits, `38e0c5b` → `c84b362`, no
scope added. The average holds at **4.50** but the composition moved — the
evening's independent scores are delight 4 · clarity 4 · readme 5 · scope 5,
where the ship day scored delight 5 · clarity 4 · readme 4 · scope 5. README
gained the point it earned once its screenshot stopped advertising a pen the
build no longer draws; delight lost one for a first load that shows a black
rectangle and one line of text. Cycle 1 found the day's blocker in the README
itself — the provenance footer still said **Day 004** on a README that
documents day 006 — plus a flagship pen whose stroke ended 482 px behind the
hand that drew it. Cycles 2 and 3 caught two regressions the polish itself
introduced. Still **not `verified`**: §11.2's live-demo line needs `github.io`,
which is unreachable from a scheduled sandbox for the **seventh** consecutive
run. The served artifact was md5-verified identical to `git archive HEAD`, so
Pages serving this commit serves the build that was tested — but nobody has
loaded the URL. Day 004 remains unverified too.*

*Day 007 (2026-07-31) was an **evening §11.4 rescue**: the dashboard's last row
was day 006, so nothing had shipped today and the noon shift left no trace at
all — no commits, no HANDOFF section, no spec. The evening shift planned, built,
critiqued and shipped the day itself. The GitHub API plane was gated for the
**eighth** consecutive scheduled run (repo REST 403 with the `add_repo` message,
`github.io` unreachable, git-over-HTTPS open via the `GIT_CONFIG_GLOBAL=/dev/null`
bypass), so — as on day 006 — a new repo was impossible and the day went to a
maintenance revisit (§4). `pixel-garden` was picked as the least recently touched
repo (day 003, 2026-07-26) and the only one never given an evening polish pass.
The issue, spec comment and sign-off are owed and preserved verbatim in
HANDOFF.md.*

*Rubric 4.25 is the per-line majority across four independent clean-context
passes (delight 4 · clarity 4 · readme 4 · scope 5). The composition is worth
reading: the **final** pass returned **BLOCK** with delight 3 · clarity 4 ·
readme 2 · scope 5, because the README told the user to press Enter to name a
plant and Enter was a dead toggle that dismissed it, and because four of five
advertised dismiss gestures left a dotted cursor silhouette painted on the
canvas. Both were closed in a fourth round with measurements (residual paint
411 px → 0 on every gesture; Enter now idempotent), which is what returns
readme and delight to 4. Must-pass 5/7 verified, with the same 2 unverifiable
as days 004–006: repo description/topics, and the live Pages URL. gitleaks is
clean — its single hit is the string `pixel-garden.v1`, the localStorage key
name, flagged as `generic-api-key` on entropy.*

*A **fifth** independent pass then ran on the blocker fixes alone and returned
**APPROVE**, re-measuring both claims with the pre-fix build as a positive
control (so the harness was shown to detect the defect rather than measure
nothing) and asserting, after every step of 14 mixed pointer/keyboard sequences,
that the canvas is exactly one reference frame and the label agrees with what is
highlighted — zero mismatches, zero stray paint. It found no functional defect
and two record-quality ones, both now corrected in the repo rather than smoothed
over: two shipped records gave different residual-paint figures (215 px vs
411 px) for a measurement that is fixture-specific, and the dotted keyboard
cursor is now **unreachable** — the fixes left `drawCursor()` guarded out of
every state a user can reach, so it is dead code the prose still describes.
Deleting it is a next-increment change.*

*Still not `verified`: §11.2's live-demo line needs `github.io`, unreachable from
a scheduled sandbox for the eighth consecutive run. Verified rate 3/7 remains a
verification outage rather than four bad days — no scheduled runner has ever been
able to load the URL. The desk verification owed now covers days 004, 005, 006
and 007.*
