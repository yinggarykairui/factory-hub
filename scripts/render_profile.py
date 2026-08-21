#!/usr/bin/env python3
"""Render the profile storefront (yinggarykairui/yinggarykairui README) from
dashboard/README.md. Run by the shipper as part of §9.8; stdlib only.

Ranking for "Best builds": 👍 reactions (from any GitHub user) on the repo's
closed ship issues, the repo's best rubric average as fallback, most recent
ship as tiebreak. Reads the token from $FACTORY_PAT or ~/.factory.env.

The lookup asks for **both** `shipped` and `verified` issues: relabelling a
ship `verified` is what the evening shift does when it passes, so a
`shipped`-only query is blind to exactly the ships the factory stands
behind. It degrades to rubric-only whenever the lookup does not succeed —
no token, a 401, a timeout, malformed JSON — but it says so on stderr and
in the table's caption, because a silent degrade renders a page that claims
a vote ranking it never performed.

The corpus is deduplicated by slug before ranking: a repo that shipped five
increments is one portfolio entry — its best row picks the ranking, its
latest row picks the sentence and every other displayed field, because the
sentence should describe what the visitor will find in the repo today, not
what it was on the day that scored highest. `type:meta` rows (the factory
fixing itself) are a day's work but not a portfolio entry, so they are
excluded from both the hero card and the table.

Every claim this file renders must be true of the corpus it renders from —
§1 directive 4. Numbers in the opening sentence are computed, not written.
"""
import json, os, re, sys, urllib.error, urllib.request
from datetime import date

HUB = "yinggarykairui/factory-hub"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BEST_N = 5
NO_PROXY = urllib.request.ProxyHandler({})

def warn(msg):
    print(f"render_profile: {msg}", file=sys.stderr)

def token():
    t = os.environ.get("FACTORY_PAT")
    if t:
        return t
    try:
        for ln in open(os.path.expanduser("~/.factory.env"), encoding="utf-8"):
            if ln.startswith("FACTORY_PAT="):
                return ln.split("=", 1)[1].strip()
    except OSError:
        pass
    return None

def _isdate(cell):
    """A real calendar date, not just the shape of one: `2026-02-30`
    matches `\\d{4}-\\d{2}-\\d{2}` and then raises in `corpus_line`."""
    try:
        date.fromisoformat((cell or "").strip())
        return True
    except ValueError:
        return False

def num(cell):
    """The rubric average a cell opens with, or None. The dashboard bolds
    and annotates its figures (`**4.50**`, `4.50 (corrected)`) — `float()`
    on the raw cell either crashes the render or silently scores 0.0. The
    match is anchored and range-checked: an unanchored search turns
    `— pending rescore (#59)` into a rubric of 59."""
    m = re.match(r"[\s*`]*(\d+(?:\.\d+)?)", cell or "")
    if not m:
        return None
    v = float(m.group(1))
    if not 0.0 <= v <= 5.0:
        warn(f"rubric {v} is outside 0–5; treating the cell as unscored")
        return None
    return v

def link(cell):
    """The URL of a markdown link, anchored to the end of the cell. An
    unanchored `\\(([^)]+)\\)` returns the first parenthesis in the cell,
    so `[repo (mirror)](https://…)` yields `mirror`."""
    m = re.search(r"\]\(([^)]+)\)\s*$", (cell or "").strip())
    return m.group(1) if m else None

def parse_dashboard():
    kpi, rows = "", []
    path = os.path.join(ROOT, "dashboard", "README.md")
    for ln in open(path, encoding="utf-8"):
        if not kpi and "**KPI:**" in ln:
            # First match only: the notes stream below the table quotes
            # dated KPI snapshots, and last-match-wins would publish one.
            kpi = ln.split("**KPI:**", 1)[1].strip()
        elif ln.startswith("|"):
            # Split on unescaped pipes: a `\|` inside a one-liner is legal
            # markdown and shifts every column after it.
            c = [x.strip() for x in re.split(r"(?<!\\)\|", ln.strip().strip("|"))]
            # An index row is 11 columns with a numeric day, a dated ship
            # and a linked repo. Anything else in this file — the header,
            # the rule, a table in the notes stream below — is not a ship,
            # and admitting one crashes the render on `int(day)`.
            if not (c[0].isascii() and c[0].isdigit()):
                # The header, the rule and any prose table in the notes
                # stream land here and are not worth a word. A cell that
                # holds a day number wrapped in markup is a real ship row
                # about to go missing, and is.
                if any(ch.isdigit() for ch in c[0]):
                    warn(f"dashboard row {c[0]!r} has a day number that is not a bare "
                         f"number; skipped")
                continue
            if len(c) != 11:
                warn(f"dashboard row {c[0]!r} has {len(c)} columns, not 11; skipped")
                continue
            if not link(c[7]) or not _isdate(c[1]):
                warn(f"dashboard row {c[0]!r} has no usable date or repo link; skipped")
                continue
            rows.append({
                "day": c[0], "date": c[1], "slug": c[2], "type": c[3],
                "liner": c[4], "tech": c[5], "rubric": num(c[6]),
                "repo": link(c[7]), "demo": link(c[8]),
            })
    return kpi, rows

def slug_from_title(title):
    """Ship issue titles come in three forms — `<slug>`, `improve <slug>: …`
    (maintenance revisits) and `<slug> — …` (job-lane ships). All three
    should credit the same slug. A title in none of those forms (a `meta:`
    issue) has no slug and returns None."""
    t = (title or "").strip()
    m = re.match(r"^improve\s+([a-z0-9][\w-]*)\s*:", t, re.I)
    if m:
        return m.group(1).lower()
    # A bare slug, or a job-lane `<slug> — <description>`. The dash must be
    # spaced: `word-ladder` is one slug, not `word` and a description. A
    # `meta:`/`blocked:` title is not a ship and has no slug.
    m = re.match(r"^([a-z0-9][\w-]*?)(?:\s*[—–]\s|\s-\s|\s*$)", t, re.I)
    return m.group(1).lower() if m else None

def _issues(label, tok):
    """All closed issues carrying `label`, following pagination. `/issues`
    also returns pull requests; they are not ships."""
    out, page = [], 1
    while page <= 20:     # 2,000 ship issues is not a corpus, it is a loop
        url = (f"https://api.github.com/repos/{HUB}/issues?state=closed"
               f"&labels={label}&per_page=100&page={page}")
        req = urllib.request.Request(url, headers={"Authorization": f"token {tok}"})
        with urllib.request.build_opener(NO_PROXY).open(req, timeout=15) as r:
            batch = json.load(r)
        out += [i for i in batch if "pull_request" not in i]
        if len(batch) < 100:
            return out
        page += 1
    warn("reaction lookup stopped at 20 pages; counts may be partial")
    return out

def reactions_by_slug():
    """(counts keyed by slug, lookup_succeeded). Uses an explicit
    `ProxyHandler({})` so scheduled runs cannot fall through to the
    sandbox's `HTTPS_PROXY`, and asks for `verified` as well as `shipped`
    so a verified ship is not erased from its own ranking."""
    out = {}
    t = token()
    if not t:
        warn("no FACTORY_PAT; ranking by rubric only")
        return out, False
    try:
        seen = {}
        for label in ("shipped", "verified"):
            for i in _issues(label, t):
                seen[i["number"]] = i
        unkeyed = []
        for i in seen.values():
            slug = slug_from_title(i["title"])
            if not slug:
                unkeyed.append(f"#{i['number']}")
                continue
            # A repo with several ship issues (revisits) sums to its
            # total across them: the portfolio entry is the repo, so the
            # votes it earned across its increments are the repo's.
            out[slug] = out.get(slug, 0) + i.get("reactions", {}).get("+1", 0)
        if unkeyed:
            warn("ship issues with no parseable slug (votes not counted): "
                 + ", ".join(sorted(unkeyed)))
        return out, True
    except Exception as e:
        warn(f"reaction lookup failed ({e}); ranking by rubric only")
        return {}, False

def kpi_bits(kpi):
    """Pull streak / avg rubric / verified rate / demos-alive out of the
    KPI line. Values are unwrapped from the dashboard's `**bold**` — a
    markdown code span does not process emphasis, so `**23**` reaches the
    live page as four literal asterisks."""
    def seg(label):
        m = re.search(rf"{label}:\s*([^·]+)", kpi)
        return re.sub(r"[*`]", "", m.group(1)).strip() if m else None
    def one(label, pat=r"\d+(?:\.\d+)?"):
        # Anchored to the head of the clause: `streak: broken on 2026-07-28,
        # now 23 days` must not publish a streak of 2026.
        s = seg(label)
        m = re.match(rf"[\W_]*({pat})", s) if s else None
        return m.group(1) if m else None
    demos = seg("demos alive") or ""
    # Anchored to the KPI's own words rather than to position: `figs[1]`
    # publishes whatever the second `x/y` in 200 characters of shipper
    # commentary happens to be.
    serving = re.search(r"(\d+/\d+)\s+URLs serve", demos)
    proven = re.search(r"(\d+/\d+)\s+proven to render", demos)
    figs = re.findall(r"\d+/\d+", demos)
    return {
        "streak": one("streak"),
        "rubric": one("avg rubric score"),
        "verified": one("verified rate", r"\d+/\d+"),
        # The KPI reports two demo figures — how many URLs serve their own
        # build, and how many of those were *proven to render*. Publishing
        # only the first overstates by exactly the difference, so both are
        # rendered and the badge says which is which.
        "serving": serving.group(1) if serving else (figs[0] if figs else None),
        "proven": proven.group(1) if proven else None,
    }

def dedupe_by_slug(rows, reacts):
    """One entry per slug: the best row picks the ranking (most reactions,
    then highest rubric, then most recent ship), the latest row picks the
    sentence and every displayed field — otherwise `orbit-doodle` reads on
    the storefront as something it stopped being three revisits ago."""
    best_by, latest_by = {}, {}
    def rank(r):
        # More reactions, then higher rubric, then the more recent ship.
        # Day is the authoritative sequence; two ships can share a date.
        return (-reacts.get(r["slug"], 0), -(r["rubric"] or 0.0), -int(r["day"]))
    for r in rows:
        s = r["slug"]
        if s not in best_by or rank(r) < rank(best_by[s]):
            best_by[s] = r
        if s not in latest_by or int(r["day"]) > int(latest_by[s]["day"]):
            latest_by[s] = r
    merged = []
    for s, r in best_by.items():
        m = dict(latest_by[s])       # everything shown is the latest increment's
        m["best_rubric"] = r["rubric"]   # …except the score that earned the rank
        merged.append(m)
    return merged

def hero_shot(repo):
    """The screenshot the hero card hot-links is the largest element on the
    page. Only a repo that answers 404/410 for it loses the image; a
    timeout, a blocked host or an expired token means *we* could not look,
    which is no reason to strip the owner's front door."""
    if not repo.startswith("https://github.com/"):
        return None       # never send the token to a host the dashboard named
    url = repo.replace("github.com", "raw.githubusercontent.com") + "/main/screenshot.png"
    t = token()
    if not t:
        return url
    try:
        req = urllib.request.Request(url, method="HEAD",
                                     headers={"Authorization": f"token {t}"})
        with urllib.request.build_opener(NO_PROXY).open(req, timeout=15):
            return url
    except urllib.error.HTTPError as e:
        if e.code in (404, 410):
            warn(f"hero screenshot is {e.code} at {url}; rendering without it")
            return None
        warn(f"hero screenshot check got HTTP {e.code}; keeping the image")
        return url
    except Exception as e:
        warn(f"hero screenshot could not be checked ({e}); keeping the image")
        return url

def corpus_line(rows, projects):
    """The opening claim, computed rather than written.

    Two counts the storefront kept getting wrong. A *project* is a repo,
    not a dashboard row: eight of the rows are revisits of three repos,
    and the table four lines below already says "one row per repo". And
    the factory has shipped twice in one day and has had a day with no
    ship at all, so ships-over-span reads as one-a-day and isn't."""
    repos = len({r["slug"] for r in projects})
    days = sorted({r["date"] for r in rows})
    d0, d1 = (date.fromisoformat(d) for d in (days[0], days[-1]))
    span = (d1 - d0).days + 1
    return (f"**{repos} of them, on {len(days)} of its {span} days**"
            if span > 1 else f"**{repos} of them, on its first day**")

def render():
    kpi, rows = parse_dashboard()
    if not rows:
        sys.exit("no ships in dashboard table; refusing to render an empty storefront")
    k = kpi_bits(kpi)
    for name in ("streak", "rubric", "serving"):
        if not k[name]:
            sys.exit(f"KPI line has no readable `{name}`; refusing to publish a placeholder "
                     f"on the storefront (is the KPI still one line?)")
    reacts, voted = reactions_by_slug()

    # `type:meta` rows are the factory fixing itself: a real day's work,
    # counted in the streak and the average, but not a portfolio entry —
    # so out of the hero card and out of the table alike.
    projects = [r for r in rows if r["type"] != "meta"] or rows
    latest = max(projects, key=lambda r: int(r["day"]))
    best = sorted(dedupe_by_slug(projects, reacts),
                  key=lambda r: (-reacts.get(r["slug"], 0),
                                 -(r["best_rubric"] or 0.0), -int(r["day"])))[:BEST_N]
    last = max(rows, key=lambda r: int(r["day"]))   # footer: the storefront's own date
    shot = hero_shot(latest["repo"])

    # "Alive" is what a reader hears as *it works*; the KPI's stronger
    # figure only means the URL serves its own build. One badge, with the
    # label attached to the evidence, and the subset inside the same span
    # so a phone cannot wrap them apart.
    demos = (f"`demos {k['serving']} serving, {k['proven'].split('/')[0]} render-proven`"
             if k["proven"] else f"`demos {k['serving']} serving`")
    badges = [f"`streak {k['streak']}`", f"`avg rubric {k['rubric']}/5`", demos]
    if k["verified"]:
        badges.append(f"`{k['verified']} independently verified`")

    L = []
    L.append("## Kairui Ying\n")
    L.append("I design autonomous systems that finish what they start. The proof runs daily:")
    L.append("a build factory I wrote specs, builds, adversarially reviews, and deploys")
    L.append(f"small working projects — {corpus_line(rows, projects)}, most with a live")
    L.append("demo — then updates this page itself.\n")
    L.append(" · ".join(badges) + "\n")
    L.append(f"### Latest project ship — day {latest['day']} · [{latest['slug']}]({latest['repo']})\n")
    target = latest["demo"] or latest["repo"]
    if shot:
        L.append(f"[![{latest['slug']}]({shot})]({target})\n")
    demo = f"[live demo]({latest['demo']}) · " if latest["demo"] else ""
    score = f" · rubric {latest['rubric']:.2f}" if latest["rubric"] is not None else ""
    L.append(f"{latest['liner']}. *{latest['type']} · {latest['tech']}{score}* — {demo}[source]({latest['repo']})\n")
    L.append("### Best builds\n")
    L.append("| build | what it does | stack | proof |")
    L.append("|-------|--------------|-------|-------|")
    for r in best:
        d = f"[demo]({r['demo']}) · " if r["demo"] else ""
        n = reacts.get(r["slug"], 0)
        why = f"{n}× 👍" if n else (f"rubric {r['best_rubric']:.2f}"
                                    if r["best_rubric"] is not None else "unscored")
        L.append(f"| [{r['slug']}]({r['repo']}) | {r['liner']} | {r['tech']} | {d}{why} |")
    rank_by = ("ranked by 👍 on its ship issues, or by its best rubric until the votes"
               " arrive" if voted else
               "ranked by best rubric — the reaction lookup did not answer on this run")
    L.append(f"\n*One row per repo — {rank_by}. The sentence describes the repo's latest"
             " increment.*\n")
    L.append("### How it works\n")
    L.append("Every project starts as an issue. It gets a spec and a README before any code")
    L.append("exists, is built by one agent, then torn apart by adversarial critics. A build")
    L.append("ships only past a seven-line must-pass gate — loads clean, survives garbage")
    L.append("input, phone width for web and an accurate `--help` for CLIs, a README that is")
    L.append("truthful and says how to run it, a LICENSE with the repo's description and")
    L.append("topics set, a clean secret scan, and — for web builds — a Pages demo that")
    L.append("actually loads the build. A day that cannot clear the gate ships the largest")
    L.append("working subset and says so. The doctrine, rubric, and every daily sign-off are")
    L.append(f"public in [factory-hub](https://github.com/{HUB}).\n")
    upkeep = ", a factory upkeep ship" if last["type"] == "meta" else ""
    L.append(f"<sub>Maintained by the factory · [dashboard](https://yinggarykairui.github.io/factory-hub/) · last updated day {last['day']} ({last['date']}){upkeep}</sub>")
    return "\n".join(L) + "\n"

if __name__ == "__main__":
    out = render()
    if len(sys.argv) > 1:
        with open(sys.argv[1], "w", encoding="utf-8") as f:
            f.write(out)
        print(f"wrote {sys.argv[1]} ({len(out)} bytes)", file=sys.stderr)
    else:
        sys.stdout.buffer.write(out.encode("utf-8"))
