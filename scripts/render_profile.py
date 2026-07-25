#!/usr/bin/env python3
"""Render the profile storefront (yinggarykairui/yinggarykairui README) from
dashboard/README.md. Run by the shipper as part of §9.8; stdlib only.

Ranking for "Best builds": owner reactions on the closed ship issue
(👍 total), rubric average as fallback, date as tiebreak. Reads the token
from $FACTORY_PAT or ~/.factory.env; degrades to rubric-only if the API is
unreachable (the page must render offline — §13 spirit).
"""
import json, os, re, sys, urllib.request

HUB = "yinggarykairui/factory-hub"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BEST_N = 5

def token():
    t = os.environ.get("FACTORY_PAT")
    if t:
        return t
    try:
        for ln in open(os.path.expanduser("~/.factory.env")):
            if ln.startswith("FACTORY_PAT="):
                return ln.split("=", 1)[1].strip()
    except OSError:
        pass
    return None

def parse_dashboard():
    kpi, rows = "", []
    for ln in open(os.path.join(ROOT, "dashboard", "README.md")):
        if "**KPI:**" in ln:
            kpi = ln.split("**KPI:**", 1)[1].strip()
        elif ln.startswith("|"):
            c = [x.strip() for x in ln.strip().strip("|").split("|")]
            if len(c) >= 11 and c[0] not in ("Day",) and not set(c[0]) <= set("- "):
                link = lambda s: (re.search(r"\(([^)]+)\)", s) or [None, None])[1]
                rows.append({
                    "day": c[0], "date": c[1], "slug": c[2], "type": c[3],
                    "liner": c[4], "tech": c[5],
                    "rubric": float(c[6]) if re.match(r"^\d", c[6]) else 0.0,
                    "repo": link(c[7]), "demo": link(c[8]),
                })
    return kpi, rows

def reactions_by_slug():
    """+1 counts on closed shipped issues, keyed by issue title (= slug)."""
    out = {}
    t = token()
    if not t:
        return out
    url = f"https://api.github.com/repos/{HUB}/issues?state=closed&labels=shipped&per_page=100"
    req = urllib.request.Request(url, headers={"Authorization": f"token {t}"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            for issue in json.load(r):
                out[issue["title"]] = issue.get("reactions", {}).get("+1", 0)
    except Exception:
        pass  # rubric fallback carries the ranking
    return out

def kpi_bits(kpi):
    """Pull streak / avg rubric / demos-alive out of the KPI line."""
    get = lambda pat: (re.search(pat, kpi) or [None, "—"])[1]
    return (get(r"streak: (\S+)"), get(r"avg rubric score: (\S+)"),
            get(r"demos alive: (\S+)"))

def render():
    kpi, rows = parse_dashboard()
    if not rows:
        sys.exit("no ships in dashboard table; refusing to render an empty storefront")
    reacts = reactions_by_slug()
    latest = max(rows, key=lambda r: r["day"])
    best = sorted(rows, key=lambda r: (-reacts.get(r["slug"], 0), -r["rubric"], r["date"]))[:BEST_N]
    streak, rubric, alive = kpi_bits(kpi)
    shot = latest["repo"].replace("github.com", "raw.githubusercontent.com") + "/main/screenshot.png"

    L = []
    L.append("## Kairui Ying\n")
    L.append("I design autonomous systems that finish what they start. The proof runs daily:")
    L.append("a build factory I wrote specs, builds, adversarially reviews, and deploys")
    L.append("**one small working project every day** — each with a live demo — then updates")
    L.append("this page itself.\n")
    L.append(f"`streak {streak}` · `avg rubric {rubric}/5` · `demos alive {alive}`\n")
    L.append(f"### Latest ship — day {latest['day']} · [{latest['slug']}]({latest['repo']})\n")
    target = latest["demo"] or latest["repo"]
    L.append(f"[![{latest['slug']}]({shot})]({target})\n")
    demo = f"[live demo]({latest['demo']}) · " if latest["demo"] else ""
    L.append(f"{latest['liner']}. *{latest['type']} · {latest['tech']} · rubric {latest['rubric']:.2f}* — {demo}[source]({latest['repo']})\n")
    L.append("### Best builds\n")
    L.append("| build | what it does | stack | proof |")
    L.append("|-------|--------------|-------|-------|")
    for r in best:
        d = f"[demo]({r['demo']}) · " if r["demo"] else ""
        why = f"{reacts[r['slug']]}× 👍" if reacts.get(r["slug"], 0) else f"rubric {r['rubric']:.2f}"
        L.append(f"| [{r['slug']}]({r['repo']}) | {r['liner']} | {r['tech']} | {d}{why} |")
    L.append("\n*Ranked by reactions on ship issues, rubric score until the votes arrive.*\n")
    L.append("### How it works\n")
    L.append("Every project starts as an issue. It gets a spec and a README before any code")
    L.append("exists, is built by one agent, then torn apart by adversarial critics — a build")
    L.append("ships only past a seven-line must-pass gate (loads clean, survives garbage")
    L.append("input, works at phone width, truthful README, licensed, secret-scanned, demo")
    L.append("live). The doctrine, rubric, and every daily sign-off are public in")
    L.append(f"[factory-hub](https://github.com/{HUB}).\n")
    L.append(f"<sub>Maintained by the factory · [dashboard](https://yinggarykairui.github.io/factory-hub/) · last updated day {latest['day']} ({latest['date']})</sub>")
    return "\n".join(L) + "\n"

if __name__ == "__main__":
    out = render()
    if len(sys.argv) > 1:
        open(sys.argv[1], "w").write(out)
        print(f"wrote {sys.argv[1]} ({len(out)} bytes)", file=sys.stderr)
    else:
        sys.stdout.write(out)
