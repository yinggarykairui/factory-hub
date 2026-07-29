# HANDOFF.md — noon shift 2026-07-29 → next API-capable shift

**Temporary state file, not doctrine.** Written because this shift's runner
could not touch the issue plane (same sandbox gating as 2026-07-26 —
second occurrence). The next shift that CAN must replay the actions below,
then delete this file in the same push. If you are reading this on a later
day and it's still here, replay is still owed — do it before new work.

**Mid-flight marker:** if this file has no "What shipped (day 005)"
section below, the 2026-07-29 build died mid-flight. This file then stands
in for the `building` label: resume per §4.1 — repo state is whatever
`trace-lens` main holds; the spec being built is verbatim below.

## What happened

Scheduled noon runner, cloud sandbox. Per-session GitHub gating identical
to 2026-07-26: all api.github.com repo-scoped paths blocked ("not enabled
for this session… use add_repo" — no add_repo mechanism exists in the
session), github.com HTML blocked, github.io blocked, WebFetch
permission-gated with no user present. **Git plane worked normally**
(clone + push to existing factory repos, FACTORY_PAT used transiently per
§12, stored nowhere). No issue reads, no issue writes, no repo creation,
no Pages changes, no live-demo fetches.

Also found at boot: **2026-07-28 was a zero day.** No dashboard row, no
HANDOFF, no commits to any factory repo, no trace of either shift. Nothing
to resume; the streak broke. Today's KPI row records that honestly
(streak 1 at today's ship). Owner should know: of the last three days,
two scheduled runs hit this same sandbox wall and one left no trace at
all — the scheduled-run environment looks systematically degraded, while
desk sessions (2026-07-27) work fine. See "Notes for the owner" at bottom.

Consequences accepted, per the directives (2: ship daily; 1/4: say so
loudly; 3: this file):

- Could not read the queue → §4 pick order unknowable. If a `priority` or
  `job` issue was waiting, it was invisible from here — the queue jump is
  recoverable next shift. §17 servicing: no `job` issue could be read or
  serviced this run (the hourly watcher may be hitting the same wall —
  check its recent runs).
- Day became a **self-picked maintenance revisit of trace-lens** (§4
  revisit rules: PROJECT.md read first, increment specced by a
  clean-context planner, README-first diff drafted before code). Pick
  rationale vs TASTE.md + §5 variety governor: last two builds were both
  vanilla-canvas toys (register rule: never the same three days running →
  a dev-tool day is due), TS/React last used three builds ago, and
  trace-lens is the agent-lane/job-signal repo. Its PROJECT.md fence says
  a revisit may move a fence item with a new spec comment — this spec
  moves URL-hash deep-links in, closes kept nits D2 + D3, nothing else.
- Could not file/relabel/close any issue → the increment's issue-plane
  record is this file until replayed.

## The increment spec (post verbatim as the spec comment at replay)

SPEC — trace-lens, increment 2 (day 005 revisit). Maintenance build per §4: commits to the existing `trace-lens` repo, no new repo. Same loop, same rubric, same sign-off. Diffed against PROJECT.md and the live repo: the v0 done-map is complete (shipped day 002, must-pass 7/7); this increment closes the two open threads (D2, D3) and moves exactly ONE fence item into scope.

SCOPE — includes (these three, nothing else):

1. **D2 — persistent card expand state.** Expand state becomes a keyed set (`call_id`) held in `Transcript`, outside `projectState`. An opened card that unmounts when you scrub back past its birth returns still open when you scrub forward again. It survives restart (Transcript never unmounts); a page reload resets it. `projectState` stays pure — `(trace, vt) → items`, nothing else.

2. **D3 — empty-pane hint.** When the projection yields zero items (playhead before the first event, 0.4 s in) and playback is paused, the transcript shows one muted line — press play (or space), or scrub — instead of a bare pane. It disappears the moment any item projects. No animation, no new controls.

3. **Deep-link — `#t=<seconds>` in the URL hash** (e.g. `#t=12.4`).
   - In: parsed once at load. Finite number → clamp to [0, duration], seek there, start PAUSED (overrides autoplay). Anything else (`#t=junk`, no hash) → ignored, normal autoplay load. `#t=-3` clamps to 0 (and shows the D3 hint); `#t=9999` clamps to the end.
   - Out: on pause and on seek, debounced ~250 ms (one write per drag, not per frame), write `#t=<seconds, one decimal>` via `history.replaceState` — the Back button gains zero entries. While playing, the hash keeps the last paused/scrubbed value: it is a share-this-moment link, not a live mirror.

SCOPE — excludes (the fence; a later spec comment is the only door): second bundled trace · reduced-motion mode · live model connection · BYO-key · multi-trace upload/paste · WebGL · trace editing · export · routing/state-lib/CSS-framework/localStorage · any new runtime dependency · live hashchange handling after load (hash is read once) · copy-link button or any share UI (the address bar is the share UI).

ARCHITECTURE INVARIANT (must survive): everything renders through pure `projectState(trace, vt)`; pane and playhead cannot disagree. The D2 fix is keyed VIEW state outside the projection, not a projection change. The deep-link is vt in/out of the hash at the App boundary — no second clock, no second event walk.

STACK — unchanged: TypeScript + React + Vite; runtime deps `react` + `react-dom` only; build to committed `docs/`, Pages serves it.

BUILD ORDER (budget rule): D3 → D2 → deep-link in → deep-link out. Each lands alone; a working, shippable v0 of the increment exists from the first item on.

DONE-CHECKLIST (each testable on a local build):
- [ ] Expand a tool card, drag the playhead before the card's birth (card leaves the pane), drag forward past it — the card returns expanded. Reload the page — it returns collapsed.
- [ ] Pause and drag the playhead fully left (0:00): the transcript shows the one-line hint. Play or scrub right: the hint is gone once the first item lands.
- [ ] Open `<local URL>#t=12.4`: starts paused, readout 0:12 / 0:47, transcript and timeline projected to that exact moment (mid-word is fine).
- [ ] Open with `#t=garbage`, `#t=-3`, `#t=9999`: no error screen — garbage loads normally (autoplay); -3 opens paused at 0:00; 9999 paused at the end.
- [ ] Scrub anywhere, pause, copy the URL, open in a new tab: same paused moment. Back after a dozen scrubs leaves the page in one step (replaceState only, no history spam).
- [ ] Regression: play/pause/space, 0.5–4× speeds, restart, drag-scrub, and the 375 px layout all still work; `npm run build` exits clean.

RUBRIC LINES THAT MATTER MOST: "loads/runs without errors on first use" (the hash is a brand-new load path — a bad hash must never white-screen) · "survives garbage input" (the hash IS this increment's garbage surface) · "README truthful" (the new README sentences must be exactly what ships) · scored: scope discipline (three items; the fence holds).

README-first: the README diff is drafted with this spec — deep-link sentence in "What it does", card-persistence clause, `#t` note under "How to run"; screenshot and footer unchanged. The build's job is to make those sentences true. Label `speccing` → `building` on posting this comment.

## Replay these issue-plane actions (in order)

1. File the build issue: title "improve trace-lens: deep-links + D2/D3
   closes", body noting it was built 2026-07-29 under the sandbox gating,
   filed retroactively per HANDOFF (the day-003 → #28 pattern). Label
   `type:web`, `size:s`.
2. Post the increment spec above as a comment, verbatim.
3. Post the sign-off (added below at ship) as the closing comment, close
   the issue, label `shipped`.
4. If the queue held a `priority` or `job` issue this shift couldn't see:
   note on that issue that 2026-07-29 was taken by the outage build and
   it runs next — do not relabel anything else. Service any open `job`
   issue's overdue §17 steps.
5. Evening/foreman: §11.2 spot-check against the increment — hard-refresh
   https://yinggarykairui.github.io/trace-lens/ and confirm the new
   `#t=` behavior (open with `#t=12.4`: paused at 0:12), then verify per
   §11 (comment or label as the issue form requires).
6. Delete HANDOFF.md in the same push as the replay.

## Notes for the owner

Two of the last three scheduled noon runs (07-26, 07-29) landed in
sandboxes with no GitHub app repo enrollment — git works via PAT, but the
whole issue plane (and github.io) is egress-blocked, and 07-28's runs left
zero trace. If the scheduled-task environment can't be given repo access,
every scheduled day becomes a HANDOFF day and the issue ledger drifts a
day behind. Possible fixes from your side: attach the factory repos to the
scheduled task's environment (the gate's "add_repo… attach the repository
with credentials" is an environment-level setting), or run the shifts from
an environment that already has them. Until then the factory stays alive
on the git plane alone — degraded but per doctrine.
