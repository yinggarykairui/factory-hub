#!/usr/bin/env python3
"""Audit §16's graduation gate against the issue record. MANUAL 1.8.0.

WHAT IS MACHINE-CHECKED
  clause 1     the ship issue carries the `verified` label, or (epics) an
               increment verification comment.
  clause 3     a comment on that issue carries the header
               `EVENING VERIFIED day-<NNN>`, names a sha -- hex with at least one
               letter, so "1234567 lines" is not one -- and was written by the
               owner account (§15's owner-only rule applies to the artifact the
               gate is built on).
  consecutive  over dashboard rows; a zero day between rows breaks a run. Two
               rows sharing one date are one factory day, not a break; rows out
               of date order are an error, not a run.
  live         the run must end at the dashboard's last row, and that row must be
               the current factory day or the one before it. The single day of
               slack is deliberate: a noon shift files the advancing issue before
               §9.8 has appended today's row, so demanding "today" would make the
               gate unclearable by the only shift positioned to clear it.

WHAT IS NOT
  clauses 2, 4, 5   not decidable from a comment body. They come from ADJUDICATED
                    below, one entry per day, each naming the artifact it was read
                    from and the STANDARD it was read under -- [repo] the
                    adjudicator tested repo state, [self] it accepted the
                    sign-off's own report. A day with no entry prints UNPROVEN and
                    is never counted clean: the default is "not shown", never
                    "fine". ADJUDICATED is hand-maintained, which is exactly where
                    a shift could rig a verdict, so read the table before the
                    verdict.

  ADJUDICATED's rows through day 033 are a RETROSPECTIVE SEED, written in one
  sitting by the build that wrote the clause set, partly from sign-offs that were
  self-reported. It is the weakest evidence in this file and should be treated as
  provisional. Rows after day 033 belong to the shift that decides the day.

  A day whose ship issue cannot be resolved, or whose API lookup fails, prints
  UNPROVEN and says why on stderr. It never prints "no verification artifact",
  because that is a claim about the record and a failed lookup is not evidence
  about the record -- the rule scripts/render_profile.py states in its own
  docstring.

  The ship issue is resolved from the dashboard's "idea source" column, which is a
  proxy: for a job-lane build it names the posting issue, and for days 001-004 it
  names nothing. Those days print UNPROVEN.

Usage:  python3 scripts/graduation_audit.py [--today=YYYY-MM-DD]
        FACTORY_PAT is read from the environment or ~/.factory.env. There is
        deliberately no fallback to any other credential.
Exit:   0 gate clear · 1 gate not clear · 2 the audit could not be run.
"""
import datetime, json, os, re, sys, urllib.error, urllib.request
from zoneinfo import ZoneInfo

REPO = "yinggarykairui/factory-hub"
OWNER = "yinggarykairui"
FACTORY_TZ = ZoneInfo("America/Los_Angeles")   # a factory day ends at local
                                               # midnight (config block); the
                                               # sandbox runs UTC, which is
                                               # already tomorrow from 17:00 PT.
HERE = os.path.dirname(os.path.abspath(__file__))
NEEDED = 5

STANDARD_SELF_FOOTNOTE = (
    "days marked [self] rest on the sign-off's own must-pass claim. The demo-line "
    "must-pass check only became independently provable on day 031 (the "
    "two-transport method), so no earlier web ship has a repo-standard clause-5 "
    "reading. Rows through day 033 are a retrospective seed (see the docstring)."
)

# (clean, standard, note) -- clauses 2, 4 and 5 only. See docstring.
ADJUDICATED = {
    "011": (False, "repo", "c4: #41 open against this evening's own eight commits"),
    "012": (False, "repo", "c1/c3: amended the ship after verifying; header 'EVENING day-012'"),
    "013": (True,  "self", "7/7 re-checked per sign-off; different shift; no rescue recorded"),
    "014": (True,  "self", "7/7 re-checked per sign-off; different shift; no rescue recorded"),
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
    "025": (True,  "self", "verified by the 2026-08-18 evening; different shift"),
    "026": (False, "repo", "c1: unverified, still unlabelled"),
    "027": (False, "repo", "c5: a meta ship, and the hub already failed §8's LICENSE and "
                           "root-README lines on that date -- #65 discovered the condition, "
                           "it did not create it. Same standard as day 028"),
    "028": (False, "repo", "c5: the hub fails two must-pass lines (#65); verified withheld"),
    "029": (True,  "self", "verified by the 2026-08-22 evening; different shift, no rescue "
                           "recorded. CONTESTED: HANDOFF records 15 evening commits over "
                           "three polish cycles -- clean under c2's stated test, and the "
                           "advancing issue must carry this contest rather than bury it"),
    "030": (True,  "self", "verified by the 2026-08-23 evening at 3824c71"),
    "031": (True,  "repo", "verified by the 2026-08-24 evening at c06a4aa; stood down from "
                           "finishing it; demo line proven at the deployed sha"),
    "032": (True,  "repo", "verified by the 2026-08-25 evening at 4eb4d41"),
    "033": (False, "repo", "c2: the same shift built it under §11.4 -- self-rescue, not evidence"),
}

SHA = re.compile(r"\b(?=[0-9a-f]{7,40}\b)[0-9a-f]*[a-f][0-9a-f]*\b")


def die(msg, code=2):
    print(msg, file=sys.stderr)
    raise SystemExit(code)


def token():
    if os.environ.get("FACTORY_PAT"):
        return os.environ["FACTORY_PAT"]
    env = os.path.expanduser("~/.factory.env")
    if os.path.exists(env):
        pat = re.compile(r"\s*(?:export\s+)?FACTORY_PAT\s*=\s*['\"]?([^'\"\s]+)")
        for line in open(env, encoding="utf-8", errors="replace"):
            m = pat.match(line)
            if m:
                return m.group(1)
    die("FACTORY_PAT not set (env or ~/.factory.env). There is deliberately no "
        "fallback: an ambient GH_TOKEN is not registered in SECRETS.md (§12) and "
        "is not scoped to factory repos (§15).")


def opener():
    # ProxyHandler({}) on purpose. A scheduled sandbox's HTTPS_PROXY 403s the
    # GitHub API, and falling through to it makes every lookup fail identically,
    # which reads as an empty record. render_profile.py has done this since day 027.
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def api(op, tok, path):
    """Return (parsed, None) or (None, reason). Never conflates the two."""
    req = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}/{path}",
        headers={"Authorization": f"Bearer {tok}",
                 "Accept": "application/vnd.github+json",
                 "User-Agent": "factory-graduation-audit"})
    try:
        body = op.open(req, timeout=30).read().decode("utf-8", "replace")
    except (urllib.error.URLError, OSError) as e:
        return None, f"lookup failed: {e}"
    try:
        return json.loads(body), None
    except ValueError:
        return None, "lookup returned non-JSON"


def rows():
    out = []
    path = os.path.join(HERE, "..", "dashboard", "README.md")
    try:
        fh = open(path, encoding="utf-8", errors="replace")
    except OSError as e:
        die(f"cannot read the dashboard: {e}")
    for line in fh:
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


def check_artifact(op, tok, day, issue):
    """clauses 1 and 3. Returns (ok, why, unknown)."""
    if not issue:
        return False, "no ship issue resolvable from the dashboard row", True
    meta, err = api(op, tok, f"issues/{issue}")
    if err or not isinstance(meta, dict) or "labels" not in meta:
        why = err or "issue lookup returned an unexpected shape"
        return False, why, True
    cs, err = api(op, tok, f"issues/{issue}/comments?per_page=100")
    if err or not isinstance(cs, list):
        why = err or f"comment lookup returned {str(cs)[:60]}"
        return False, why, True
    hit = next((c for c in cs
                if re.search(rf"EVENING VERIFIED day-{day}\b", c.get("body", ""))), None)
    if hit is None:
        return False, "c3: no EVENING VERIFIED header", False
    if not SHA.search(hit["body"]):
        return False, "c3: header present, no sha named", False
    if (hit.get("user") or {}).get("login") != OWNER:
        return False, f"c3: artifact authored by {(hit.get('user') or {}).get('login')}, " \
                      f"not {OWNER} (§15)", False
    labels = {l["name"] for l in meta["labels"]}
    if "verified" not in labels and "(increment" not in hit["body"]:
        return False, "c1: no `verified` label and not an epic increment", False
    return True, "artifact ok", False


def main():
    today = datetime.datetime.now(FACTORY_TZ).date()
    for a in sys.argv[1:]:
        if a in ("-h", "--help"):
            print(__doc__)
            raise SystemExit(0)
        if a.startswith("--today="):
            try:
                today = datetime.date.fromisoformat(a.split("=", 1)[1])
            except ValueError:
                die(f"--today wants YYYY-MM-DD, got {a.split('=', 1)[1]!r}")
        else:
            die(f"unknown argument {a!r} (try --help). Refusing to run: this "
                f"program's only flag decides its verdict.")

    rs = rows()
    if not rs:
        die("no parseable dashboard rows -- nothing to audit")
    tok, op = token(), opener()

    print(f"audit date {today} (America/Los_Angeles) · needs {NEEDED} live")
    print(f"{'day':>4} {'date':<11} {'slug':<14} {'c1+c3':<7} verdict")
    audited, used_self = [], False
    for r in rs:
        day = r["day"]
        ok13, why13, unknown = check_artifact(op, tok, day, r["issue"])
        if unknown:
            print(f"  ! day {day}: {why13}", file=sys.stderr)
        adj = ADJUDICATED.get(day)
        if unknown or adj is None:
            state = "UNPROVEN"
            why = why13 if unknown else "clauses 2/4/5 not adjudicated"
        elif not ok13:
            state, why = "not clean", why13
        elif not adj[0]:
            state, why = "not clean", adj[2]
        else:
            state, why = "CLEAN", f"[{adj[1]}] {adj[2]}"
            used_self = used_self or adj[1] == "self"
        audited.append((day, r["date"], state == "CLEAN"))
        print(f"{day:>4} {str(r['date']):<11} {r['slug']:<14} {str(ok13):<7} {state} -- {why}")

    runs, run, prev = [], [], None
    for day, date, clean in audited:
        if prev is not None and date < prev:
            die(f"dashboard rows are out of date order at day {day} ({date} after "
                f"{prev}) -- refusing to compute a run over a record I cannot order")
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
    live = next((r for r in runs if r and r[-1] == last_day), []) if 0 <= trailing <= 1 else []
    longest = max(runs, key=len) if runs else []

    print()
    if used_self:
        print(f"note: {STANDARD_SELF_FOOTNOTE}")
    print(f"longest run ever: {len(longest)} -- days {', '.join(longest) or '(none)'} "
          f"(spent unless live)")
    if trailing < 0:
        print(f"live run: 0 -- the last dashboard row is day {last_day} ({last_date}), "
              f"dated after the audit date {today}. A future-dated row is a dashboard "
              f"defect, not a live run.")
    elif trailing > 1:
        print(f"live run: 0 -- the last dashboard row is day {last_day} ({last_date}), "
              f"{trailing} factory days before {today}; {trailing - 1} zero day(s) trail "
              f"the record and break any run they trail")
    else:
        print(f"live run (ends at day {last_day}, {last_date}, {trailing} day(s) back): "
              f"{len(live)} -- days {', '.join(live) or '(none)'}")
    clear = len(live) >= NEEDED
    print(f"VERDICT: {'GRADUATES' if clear else 'does not graduate'} -- needs {NEEDED} live")
    raise SystemExit(0 if clear else 1)


if __name__ == "__main__":
    main()
