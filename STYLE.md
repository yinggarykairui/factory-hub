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

<2–5 sentences of truth. What works today. Nothing more.>

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
- The provenance footer is verbatim except `<NNN>` — it is the disclosure
  required by §9.4 and checked by critic-hygiene.
- Repo metadata travels with the README: description = the one-sentence
  opener, topics set from the build's type knobs, LICENSE = MIT (config
  default) unless the issue says otherwise.
