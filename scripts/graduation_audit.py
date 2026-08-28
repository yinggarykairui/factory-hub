#!/usr/bin/env python3
"""Audit §16's graduation gate against the issue record. MANUAL 1.8.0.

WHAT IS MACHINE-CHECKED
  clause 1 + clause 3  a verification artifact exists on that day's ship issue,
                       carries the `EVENING VERIFIED day-<NNN>` header, and names
                       a sha.
  consecutive          over dashboard rows; a zero day between rows breaks a run.
  live                 the run must end at the dashboard's last row AND that row
                       must be the current factory day, so a factory that stops
                       shipping stops being graduatable (§16).

WHAT IS NOT
  clauses 2, 4, 5      not decidable by regex. They come from ADJUDICATED below,
                       one entry per day, each carrying the artifact it was read
                       from and the STANDARD it was read under. A day with no
                       entry prints UNPROVEN and is never counted clean: the
                       default is "not shown", never "fine". ADJUDICATED is
                       hand-maintained, which is exactly where a shift could rig
                       a verdict -- so every entry must name its evidence, and a
                       reviewer should read the table before the output.

  A day whose ship issue cannot be resolved, or whose API lookup fails, prints
  UNPROVEN and says so on stderr. It never prints "no verification artifact",
  because that is a claim about the record and a failed lookup is not evidence
  about the record (the rule `scripts/render_profile.py` states in its own
  docstring).

  The ship issue is resolved from the dashboard's "idea source" column, which is
  a proxy: for a job-lane build it names the posting issue, and for days 001-004
  it names nothing. Those days print UNPROVEN.

Usage:  python3 scripts/graduation_audit.py        # reads FACTORY_PAT from the
                                                   # environment or ~/.factory.env
"""
import datetime, json, os, re, sys, urllib.error, urllib.request

REPO = "yinggarykairui/factory-hub"
HERE = os.path.dirname(os.path.abspath(__file__))
TODAY = datetime.date.today()          # factory timezone is the caller's problem;
                                       # pass --today=YYYY-MM-DD to pin it.

# ---------------------------------------------------------------- clauses 2/4/5
# (clean, standard, note).  standard: "repo"  = the adjudicator tested repo state
#                                     "self"  = accepted the sign-off's own report
STANDARD_SELF_FOOTNOTE = (
    "days marked [self] rest on the sign-off's own must-pass claim. The demo-line "
    "must-pass check only became independently provable on day 031 (two-transport "
    "method), so no earlier web ship has a repo-standard clause-5 reading."
)
ADJUDICATED = {
    "011": (False, "repo", "c4: #41 open against this evening's own eight commits"),
    "012": (False, "repo", "c1/c3: amended the ship after verifying; header 'EVENING day-012'"),
    "013": (True,  "self", "7/7 re-checked per sign-off; no rescue; no blocked issue names it"),
    "014": (True,  "self", "7/7 re-checked per sign-off; no rescue; no blocked issue names it"),
    "015": (True,  "self", "7/7 re-checked against the live deploy per sign-off; no rescue"),
    "016": (True,  "self", "7/7 per sign-off; a must-pass line re-tested by the evening"),
    "017": (True,  "self", "7/7 per sign-off; a must-pass line re-tested by the evening"),
    "018": (True,  "self", "7/7 per sign-off; secrets line re-tested by lot"),
    "019": (False, "repo", "c1: no evening shift ran (#55)"),
    "020": (False, "repo", "c2: §11.3 rescue -- the evening finished what it verified (#55)"),
    "021": (False, "repo", "c2: §11.3 rescue (#55)"),
    "022": (False, "repo", "c1: unverified, still unlabelled"),
    "023": (False, "repo", "c2: §11.3 rescue -- HANDOFF records 9 of 27 commits as the "
                           "evening's own before it verified"),
    "024": (False, "repo", "c1: the 2026-08-17 evening left no trace (#60)"),
    "025": (True,  "self", "verified by the 2026-08-18 evening"),
    "026": (False, "repo", "c1: unverified, still unlabelled"),
    "027": (True,  "self", "verified by the 2026-08-20 evening"),
    "028": (False, "repo", "c5: the hub fails two must-pass lines (#65); verified withheld"),
    "029": (True,  "self", "verified by the 2026-08-22 evening; its polish commits are the "
                           "§11 evening mandate, not a §11.3 rescue"),
    "030": (True,  "self", "verified by the 2026-08-23 evening at 3824c71"),
    "031": (True,  "repo", "verified by the 2026-08-24 evening at c06a4aa; stood down from "
                           "finishing it; demo line proven at the deployed sha"),
    "032": (True,  "repo", "verified by the 2026-08-25 evening at 4eb4d41"),
    "033": (False, "repo", "c2: the same shift built it under §11.4 -- self-rescue, not evidence"),
}


def token():
    if os.environ.get("FACTORY_PAT"):
        return os.environ["FACTORY_PAT"]
    if os.environ.get("GH_TOKEN"):
        # A sandbox often carries its own GH_TOKEN, which is not FACTORY_PAT and
        # is usually scoped away from factory repos -- say so rather than let
        # every lookup fail as if the record were empty.
        print("  ! FACTORY_PAT unset; falling back to GH_TOKEN, which may not be "
              "scoped to factory repos", file=sys.stderr)
        return os.environ["GH_TOKEN"]
    env = os.path.expanduser("~/.factory.env")
    if os.path.exists(env):
        for line in open(env):
            m = re.match(r"\s*(?:export\s+)?FACTORY_PAT\s*=\s*[\"']?([^\"'\s]+)", line)
            if m:
                return m.group(1)
    sys.exit("FACTORY_PAT not set (env or ~/.factory.env). §12: the value never "
             "appears in a repo or in model context.")


def opener():
    # ProxyHandler({}) on purpose: a scheduled sandbox's HTTPS_PROXY 403s the
    # GitHub API, and falling through to it makes every lookup fail identically.
    # Same reason render_profile.py has done this since day 027.
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def comments(op, tok, issue):
    """Return (list_of_comments, error_or_None). Never conflates the two."""
    req = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}/issues/{issue}/comments?per_page=100",
        headers={"Authorization": f"Bearer {tok}",
                 "Accept": "application/vnd.github+json",
                 "User-Agent": "factory-graduation-audit"})
    try:
        body = op.open(req, timeout=30).read().decode()
    except (urllib.error.URLError, OSError) as e:
        return None, f"lookup failed: {e}"
    try:
        data = json.loads(body)
    except ValueError:
        return None, "lookup returned non-JSON"
    if not isinstance(data, list):
        return None, f"lookup returned {data.get('message', 'an object, not a list')}"
    return data, None


def rows():
    out = []
    path = os.path.join(HERE, "..", "dashboard", "README.md")
    for line in open(path):
        m = re.match(r"\|\s*(\d{3})\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*([^|]+?)\s*\|", line)
        if not m:
            continue
        try:
            date = datetime.date.fromisoformat(m.group(2))
        except ValueError:
            print(f"  ! row {m.group(1)}: unparseable date {m.group(2)!r}, skipped",
                  file=sys.stderr)
            continue
        cells = line.split("|")
        src = re.findall(r"issues/(\d+)|\(#(\d+)\)", cells[-3] if len(cells) >= 3 else "")
        num = next((int(a or b) for a, b in reversed(src)), None)
        out.append({"day": m.group(1), "date": date, "slug": m.group(3)[:14], "issue": num})
    return out


def main():
    today = TODAY
    for a in sys.argv[1:]:
        if a.startswith("--today="):
            today = datetime.date.fromisoformat(a.split("=", 1)[1])
    rs = rows()
    if not rs:
        sys.exit("no parseable dashboard rows -- nothing to audit")
    tok, op = token(), opener()
    sha = re.compile(r"\b[0-9a-f]{7,40}\b")

    print(f"{'day':>4} {'date':<11} {'slug':<14} {'c1+c3':<7} verdict")
    audited, used_self = [], False
    for r in rs:
        day = r["day"]
        c13, why13, unknown = False, "", False
        if not r["issue"]:
            unknown, why13 = True, "no ship issue resolvable from the dashboard row"
        else:
            cs, err = comments(op, tok, r["issue"])
            if err:
                unknown, why13 = True, err
                print(f"  ! day {day}: {err}", file=sys.stderr)
            else:
                hit = next((c for c in cs
                            if re.search(rf"EVENING VERIFIED day-{day}\b", c["body"])), None)
                if hit is None:
                    why13 = "no EVENING VERIFIED header"
                elif not sha.search(hit["body"]):
                    why13 = "header present, no sha named"
                else:
                    c13, why13 = True, "artifact ok"
        adj = ADJUDICATED.get(day)
        if unknown or adj is None:
            state = "UNPROVEN"
            why = why13 if unknown else "clauses 2/4/5 not adjudicated"
        elif not c13:
            state, why = "not clean", why13
        elif not adj[0]:
            state, why = "not clean", adj[2]
        else:
            state, why = "CLEAN", f"[{adj[1]}] {adj[2]}"
            used_self = used_self or adj[1] == "self"
        audited.append((day, r["date"], state == "CLEAN"))
        print(f"{day:>4} {str(r['date']):<11} {r['slug']:<14} {str(c13):<7} {state} -- {why}")

    runs, run, prev = [], [], None
    for day, date, clean in audited:
        gap = prev is not None and (date - prev).days > 1
        if gap or not clean:
            if run:
                runs.append(run)
            run = [day] if (gap and clean) else []
        else:
            run.append(day)
        prev = date
    if run:
        runs.append(run)

    last_day, last_date = audited[-1][0], audited[-1][1]
    trailing = (today - last_date).days
    reaches_today = trailing <= 0
    live = next((r for r in runs if r and r[-1] == last_day), []) if reaches_today else []
    longest = max(runs, key=len) if runs else []

    print()
    if used_self:
        print(f"note: {STANDARD_SELF_FOOTNOTE}")
    print(f"longest run ever: {len(longest)} -- days {', '.join(longest) or '(none)'} "
          f"(spent unless live)")
    if not reaches_today:
        print(f"live run: 0 -- the last dashboard row is day {last_day} ({last_date}), "
              f"{trailing} day(s) before {today}; those are zero days and they break "
              f"any run they trail")
    else:
        print(f"live run (ends at day {last_day}, {last_date}): {len(live)} -- "
              f"days {', '.join(live) or '(none)'}")
    print(f"VERDICT: {'GRADUATES' if len(live) >= 5 else 'does not graduate'} -- needs 5 live")


if __name__ == "__main__":
    main()
