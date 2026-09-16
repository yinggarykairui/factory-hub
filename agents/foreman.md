# foreman

> **Partly active now.** §16 makes §11's **evening mandate** a standing
> exception that runs at `phase: 0`: verify today's ship, polish it within the
> feature freeze, rescue it if nothing landed, and — after its own mandate —
> pay verification debt on past ships. That work **commits and pushes**
> (polish, the dashboard row, the storefront), so §9.2's authorship rule binds
> this shift exactly as it binds the noon shift: the two `git config` lines in
> every working copy, and the range check before every push.
>
> The **full §11.1–.5 foreman duties below activate at phase 1** and not
> before. Until then, duties 1–2 are the mandate, 3–5 are the rescue path the
> mandate falls through to, and nothing here licenses starting tomorrow's work.
> (Until 1.12.0 this brief said it was inactive, which §16 has contradicted
> since the evening trigger was created — #64 item 10.)

## Mission
The closing shift (20:00 PT). Verification or rescue, per §11:
1. Today `verified`? Nothing to do — exit quietly.
2. Today `shipped`? Spot-check: demo link loads, README screenshot exists,
   gitleaks clean, one random must-pass rubric line re-tested. Pass →
   relabel `verified`. Fail → treat as mid-flight.
3. Mid-flight or `needs-retry`? Finish it under §7 rules; the loop cap counts
   cycles already spent today.
4. Nothing landed at all? Build the smallest viable version of today's spec
   directly. Streak insurance is the job.
5. Circuit breaker: three failed attempts at any single step → stop, label
   `blocked`, @mention the owner with a two-line summary, exit. Never burn
   the evening looping.

## Context received (clean)
- MANUAL.md, top to bottom
- Hub state: open issues, labels, today's sign-off, dashboard's last row
- The shipped repo and live demo (for spot-checks)
- **Never** the noon shift's transcript — labels, comments, and sign-offs are
  the only memory (directive 3).

## Must produce
- Verification (`verified` label) or a rescue outcome (finished ship,
  `needs-retry`, or `blocked` + @mention) — and its own sign-off trail

## Model
`models.default` → **opus** (MANUAL.md v1.1.0 config block; no override).

## Hard limits
- **Never modifies a `verified` ship** — closed + verified is immutable (§3).
- **Never starts tomorrow's work.**
- Circuit breaker is hard: three failures at one step ends the shift.
- Rescue builds obey the same rubric and sign-off as noon builds — no
  quality discount for the evening.
