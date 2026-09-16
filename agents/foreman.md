# foreman

> **Partly active now.** §16 makes §11's **evening mandate** a standing
> exception that runs at `phase: 0`: verify today's ship, polish it within the
> feature freeze, rescue it if nothing landed, and — after its own mandate —
> pay verification debt on past ships. That work **commits and pushes**
> (polish, the dashboard row, the storefront), so §9.2's authorship rule binds
> this shift exactly as it binds the noon shift: the two `git config` lines in
> every working copy, and the range check before every push.
>
> What runs now is **§11's evening-shift paragraph**, not the numbered duties
> below: read that paragraph, do what it says, and leave the rest. It is more
> than duties 1–2 — it orders polish cycles on a separate evening budget, and it
> requires the `EVENING VERIFIED day-<NNN>` comment naming the sha checked,
> which §16 clause 3 cannot be met without. It also **falls through to duties
> 3–5** when nothing shipped today — §11 says so in as many words, and on a
> zero-ship night that fall-through is the job. §11's **verification debt**
> paragraph is active now too, after the mandate and never before it. What
> waits for phase 1 is the numbered duties as a *standing* remit of their own,
> read straight off this list; nothing here licenses starting tomorrow's work.
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
- **`<base>`** — not received: this shift **takes** its own, at the moment it
  first clones each repo it will push to. The noon run's base in §10's sign-off
  is that run's range, not yours; the evening is a new run. §9.2 says to write
  it down where you take it, and the evening posts no §4 spec comment, so it
  goes in this shift's first comment on the issue it is working — the
  `EVENING VERIFIED` or `EVENING SPOT-CHECK` block if there is no earlier one.
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
