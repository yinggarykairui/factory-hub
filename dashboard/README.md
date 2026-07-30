# Dashboard — one index row appended per ship, KPI row refreshed on every ship, by the shipper (§9.8).

| Day | Date | Slug | Type | One-liner | Tech | Rubric | Repo | Demo | Idea source | Builder model |
|-----|------|------|------|-----------|------|--------|------|------|-------------|---------------|
| 001 | 2026-07-25 | pixel-garden | web | One procedural pixel plant grows per daily visit | vanilla JS, canvas | 4.25 | [repo](https://github.com/yinggarykairui/pixel-garden) | [demo](https://yinggarykairui.github.io/pixel-garden/) | seeded | claude-fable-5 |
| 002 | 2026-07-25 | trace-lens | web | Replay an LLM agent run as a live streaming trace | TypeScript, React, canvas | 4.25 | [repo](https://github.com/yinggarykairui/trace-lens) | [demo](https://yinggarykairui.github.io/trace-lens/) | job lane (#25) | claude-fable-5 |
| 003 | 2026-07-26 | pixel-garden | web | The garden now travels in a URL — share links, read-only visits | vanilla JS, canvas | 4.00 | [repo](https://github.com/yinggarykairui/pixel-garden) | [demo](https://yinggarykairui.github.io/pixel-garden/) | self-picked revisit (replayed as #28) | claude-fable-5 |
| 004 | 2026-07-27 | orbit-doodle | web | The pen orbits your cursor — you steer, physics draws the flourishes | vanilla JS, canvas | 4.50 | [repo](https://github.com/yinggarykairui/orbit-doodle) | [demo](https://yinggarykairui.github.io/orbit-doodle/) | seeded | claude-fable-5 |
| 005 | 2026-07-29 | trace-lens | web | Deep-link any moment of the replay; opened tool cards survive scrubbing | TypeScript, React, canvas | 4.50 | [repo](https://github.com/yinggarykairui/trace-lens) | [demo](https://yinggarykairui.github.io/trace-lens/) | self-picked revisit (issue-plane record owed, HANDOFF.md) | claude-opus-5 |

**KPI:** streak: 1 · verified rate: 3/5 · avg rubric score: 4.30 · demos alive: unchecked

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
