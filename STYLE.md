# STYLE.md — house style and the README template

Referenced by §9.4. The shipper follows the template; critic-hygiene enforces
it. The planner drafts the README from this template *before any code exists*
(§4, README-first) — the build's job is to make it true.

## House style

- **Voice:** first person plural is banned; no marketing. Short sentences,
  plain words. Say what the thing does, not what it "leverages."
- **Truth beats polish.** Every claim in the README must be observable in the
  shipped build. "Planned" features live in follow-up issues, not READMEs.
- **One screenshot, real.** Captured from the shipped build by headless
  browser, committed to the repo (`screenshot.png` at root), embedded near
  the top. Never mocked, never stock.
- **Assets:** self-generated or CC0 only, provenance noted in the README's
  credits line. No hotlinked images, no CDN fonts (§13).
- **Naming:** repo slug is clean (`pixel-garden`), lowercase, hyphenated. Day
  numbers live in the dashboard and the provenance footer, never in the slug.
- **Code style:** vanilla and dependency-free by default (§13). Comments
  explain constraints, not narration. A human contributor should orient in
  five minutes (§8, clarity line).

## README template

```markdown
# <slug>

<One sentence: what it is and why a stranger would care.>

![screenshot](screenshot.png)

**[Live demo](<pages-url>)** ← web builds only; must actually load (§8)

## What it does

<What works today, in short sentences. Nothing more. Aim for under ~250 words; if it needs more than a screenful, the build is doing too much to describe.>

## How to run

<Exact commands or "open index.html". Tested, copy-pasteable.>

## Why it exists

<1–2 sentences. The idea's origin — seeded, self-picked, remix, sequel.>

<!-- credits line, only if any asset wasn't generated in-repo:
Assets: <what> — <source, CC0>. -->

---

*Day <NNN> of an autonomous build factory — [factory-hub](https://github.com/yinggarykairui/factory-hub)*
```

Rules of the template:

- Every section present, in this order. Delete the credits comment if unused.
- The demo link line is deleted (not left dangling) for CLI/lib builds; CLIs
  show a terminal capture as the screenshot instead.
- The provenance footer is verbatim except for its day line, which takes one of
  two forms (an epic mid-build may additionally carry optional arc free text in
  its body, below) — the disclosure required by §9.4 and checked by
  critic-hygiene. A repo's **first** ship carries `Day <NNN>`. A later ship of a
  repo the factory shipped before on an **earlier** day carries
  `Day <NNN> (revisited day <MMM>)`,
  where `<NNN>` stays the origin day and `<MMM>` is **this ship's** day. **Only
  the latest revisit is named** — a repo on its fifth visit carries one `<MMM>`,
  never a list — because the footer is a provenance disclosure (§9.4):
  overwriting the origin day destroys the fact it exists to record, and a list of
  every past visit adds nothing the dashboard index does not already hold. An
  **epic** (§4) mid-build is one continuing build, not a revisit: its increments
  ship to the same repo on consecutive picked days and its footer carries the
  current increment's day (optionally with free text describing the arc, as
  `ember-vale`'s day-079 footer does), never the `(revisited day <MMM>)` form;
  once an epic has closed, a later maintenance pick of that repo is an ordinary
  revisit and takes `Day <NNN> (revisited day <MMM>)` with `<NNN>` the epic's
  first increment day. The rule is **forward-looking only**: footers already
  shipped in the older conventions it reconciles — among them `pixel-garden`'s
  `Day 001 (revisited days 003, 007 and 010)` list, which the no-list rule would
  otherwise bar — sit on closed issues and are immutable (§3), not retroactively
  changed (the five-repo / three-convention census is in `dashboard/README.md`'s
  day-032 note). Both forms satisfy §9.4's looser wording ("Day N of an
  autonomous build factory — [hub link]"), which does not change.
- Repo metadata travels with the README: description = the one-sentence
  opener, topics set from the build's type knobs, LICENSE = MIT (config
  default) unless the issue says otherwise.
