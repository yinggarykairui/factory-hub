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
import json, os, re, sys, urllib.request

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

def num(cell):
    """First number in a cell, or None. The dashboard bolds and annotates
    its figures (`**4.50**`, `4.50 (corrected)`) — `float()` on the raw
    cell either crashes the render or silently scores the repo 0.0."""
    m = re.search(r"\d+(?:\.\d+)?", cell or "")
    return float(m.group()) if m else None

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
            if len(c) != 11 or not c[0].isdigit():
                continue
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", c[1]) or not link(c[7]):
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
        return m.group(1)
    # A bare slug, or a job-lane `<slug> — <description>`. The dash must be
    # spaced: `word-ladder` is one slug, not `word` and a description. A
    # `meta:`/`blocked:` title is not a ship and has no slug.
    m = re.match(r"^([a-z0-9][\w-]*?)(?:\s*[—–]\s|\s-\s|\s*$)", t)
    return m.group(1) if m else None

def _issues(label, tok):
    """All closed issues carrying `label`, following pagination. `/issues`
    also returns pull requests; they are not ships."""
    out, page = [], 1
    while True:
        url = (f"https://api.github.com/repos/{HUB}/issues?state=closed"
               f"&labels={label}&per_page=100&page={page}")
        req = urllib.request.Request(url, headers={"Authorization": f"token {tok}"})
        with urllib.request.build_opener(NO_PROXY).open(req, timeout=15) as r:
            batch = json.load(r)
        out += [i for i in batch if "pull_request" not in i]
        if len(batch) < 100:
            return out
        page += 1

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
        for i in seen.values():
            slug = slug_from_title(i["title"])
            if not slug:
                continue
            # A repo with several ship issues (revisits) sums to its
            # total across them: the portfolio entry is the repo, so the
            # votes it earned across its increments are the repo's.
            out[slug] = out.get(slug, 0) + i.get("reactions", {}).get("+1", 0)
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
    def one(label):
        s = seg(label)
        m = re.search(r"\d+(?:\.\d+)?(?:/\d+)?", s) if s else None
        return m.group() if m else None
    demos = seg("demos alive")
    figs = re.findall(r"\d+/\d+", demos) if demos else []
    return {
        "streak": one("streak"),
        "rubric": one("avg rubric score"),
        "verified": one("verified rate"),
        # The KPI reports two demo figures — how many URLs serve their own
        # build, and how many of those were proven to render. Publishing
        # only the first overstates by exactly the difference.
        "serving": figs[0] if figs else None,
        "proven": figs[1] if len(figs) > 1 else None,
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
    page; a 404 there is a broken image on the owner's front door. Checked
    when the network allows, assumed when it does not."""
    url = repo.replace("github.com", "raw.githubusercontent.com") + "/main/screenshot.png"
    t = token()
    if not t:
        return url
    try:
        req = urllib.request.Request(url, method="HEAD",
                                     headers={"Authorization": f"token {t}"})
        with urllib.request.build_opener(NO_PROXY).open(req, timeout=15):
            return url
    except Exception as e:
        warn(f"hero screenshot unreachable ({e}); rendering without it")
        return None

def corpus_line(rows):
    """The opening claim, computed rather than written. The factory has
    shipped twice in one day and has had a day with no ship at all, so
    "one project every day" is not a sentence the corpus supports."""
    from datetime import date
    ships = len(rows)
    days = sorted({r["date"] for r in rows})
    d0, d1 = (date(*map(int, d.split("-"))) for d in (days[0], days[-1]))
    span = (d1 - d0).days + 1
    return f"**{ships} small working projects across {span} days**"

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

    badges = [f"`streak {k['streak']}`", f"`avg rubric {k['rubric']}/5`"]
    if k["verified"]:
        badges.append(f"`verified {k['verified']}`")
    badges.append(f"`demos alive {k['serving']}`" if not k["proven"]
                  else f"`demos alive {k['serving']}` · `{k['proven']} render-proven`")

    L = []
    L.append("## Kairui Ying\n")
    L.append("I design autonomous systems that finish what they start. The proof runs daily:")
    L.append("a build factory I wrote specs, builds, adversarially reviews, and deploys —")
    L.append(f"{corpus_line(rows)} so far, most with a live demo — then")
    L.append("updates this page itself.\n")
    L.append(" · ".join(badges) + "\n")
    L.append(f"### Latest project ship — day {latest['day']} · [{latest['slug']}]({latest['repo']})\n")
    target = latest["demo"] or latest["repo"]
    if shot:
        L.append(f"[![{latest['slug']}]({shot})]({target})\n")
    demo = f"[live demo]({latest['demo']}) · " if latest["demo"] else ""
    score = f" · rubric {latest['rubric']:.2f}" if latest["rubric"] else ""
    L.append(f"{latest['liner']}. *{latest['type']} · {latest['tech']}{score}* — {demo}[source]({latest['repo']})\n")
    L.append("### Best builds\n")
    L.append("| build | what it does | stack | proof |")
    L.append("|-------|--------------|-------|-------|")
    for r in best:
        d = f"[demo]({r['demo']}) · " if r["demo"] else ""
        n = reacts.get(r["slug"], 0)
        why = f"{n}× 👍" if n else (f"rubric {r['best_rubric']:.2f}" if r["best_rubric"] else "—")
        L.append(f"| [{r['slug']}]({r['repo']}) | {r['liner']} | {r['tech']} | {d}{why} |")
    rank_by = ("ranked by 👍 on its ship issues, by its best rubric until the votes arrive"
               if voted else
               "ranked by best rubric — the reaction lookup did not answer on this run")
    L.append(f"\n*One row per repo, {rank_by}; the sentence describes its latest increment.*\n")
    L.append("### How it works\n")
    L.append("Every project starts as an issue. It gets a spec and a README before any code")
    L.append("exists, is built by one agent, then torn apart by adversarial critics. A build")
    L.append("ships only past a must-pass gate — loads clean, survives garbage input, phone")
    L.append("width for web and an accurate `--help` for CLIs, a truthful README with a")
    L.append("screenshot, a licence and repo metadata, a clean secret scan, and a live demo")
    L.append("where the build has one. A day that cannot clear the gate ships the largest")
    L.append("working subset and says so. The doctrine, rubric, and every daily sign-off are")
    L.append(f"public in [factory-hub](https://github.com/{HUB}).\n")
    L.append(f"<sub>Maintained by the factory · [dashboard](https://yinggarykairui.github.io/factory-hub/) · last updated day {last['day']} ({last['date']})</sub>")
    return "\n".join(L) + "\n"

if __name__ == "__main__":
    out = render()
    if len(sys.argv) > 1:
        with open(sys.argv[1], "w", encoding="utf-8") as f:
            f.write(out)
        print(f"wrote {sys.argv[1]} ({len(out)} bytes)", file=sys.stderr)
    else:
        sys.stdout.buffer.write(out.encode("utf-8"))
