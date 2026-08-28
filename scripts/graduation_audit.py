#!/usr/bin/env python3
"""Audit §16's graduation gate against the issue record. MANUAL 1.8.0.

Machine-checked here: clause 1 and clause 3 — a verification artifact exists on
that day's ship issue, carries the `EVENING VERIFIED day-<NNN>` header, and names
a sha. Clauses 2, 4 and 5 are not decidable by regex; they come from ADJUDICATED
below, one entry per day, each with the artifact it was read from. A day with no
entry is reported UNPROVEN and never counted clean — the audit's default is "not
shown", not "fine".

Then: `consecutive` over dashboard rows (a zero day breaks a run), and `live`
(the run must end at the last row). Usage: GH_TOKEN=... python3 scripts/graduation_audit.py
"""
import datetime, json, os, re, subprocess, sys

REPO = "yinggarykairui/factory-hub"
TOK = os.environ.get("GH_TOKEN")
if not TOK:
    sys.exit("GH_TOKEN not set")

def gha(path):
    r = subprocess.run(
        ["curl", "-s", "--noproxy", "*", "-H", f"Authorization: Bearer {TOK}",
         "-H", "Accept: application/vnd.github+json",
         f"https://api.github.com/repos/{REPO}/{path}"],
        capture_output=True, text=True)
    return json.loads(r.stdout)

# Clauses 2, 4, 5 — adjudicated from the record, not guessed. (ok, note)
ADJUDICATED = {
    "011": (False, "c4: #41 open against this evening's own eight commits"),
    "012": (False, "c1/c3: amended the ship after verifying; header 'EVENING day-012'"),
    "013": (True,  "sign-off 7/7 re-checked; no rescue; no blocked issue names it"),
    "014": (True,  "sign-off 7/7 re-checked; no rescue; no blocked issue names it"),
    "015": (True,  "sign-off 7/7 re-checked against the live deploy; no rescue"),
    "016": (True,  "sign-off 7/7; must-pass line re-tested by the evening; no rescue"),
    "017": (True,  "sign-off 7/7; must-pass line re-tested by the evening; no rescue"),
    "018": (True,  "sign-off 7/7; secrets line re-tested by lot; no rescue"),
    "019": (False, "c1: no evening shift ran (#55)"),
    "020": (False, "c2: §11.3 rescue — the evening finished what it verified (#55)"),
    "021": (False, "c2: §11.3 rescue (#55)"),
    "022": (False, "c1: unverified, still unlabelled"),
    "023": (True,  "verified by the 2026-08-16 evening"),
    "024": (False, "c1: the 2026-08-17 evening left no trace (#60)"),
    "025": (True,  "verified by the 2026-08-18 evening"),
    "026": (False, "c1: unverified, still unlabelled"),
    "027": (True,  "verified by the 2026-08-20 evening"),
    "028": (False, "c5: the hub fails two must-pass lines (#65); verified withheld"),
    "029": (True,  "verified by the 2026-08-22 evening after three cycles"),
    "030": (True,  "verified by the 2026-08-23 evening at 3824c71"),
    "031": (True,  "verified by the 2026-08-24 evening at c06a4aa; stood down from finishing it"),
    "032": (True,  "verified by the 2026-08-25 evening at 4eb4d41"),
    "033": (False, "c2: the same shift built it under §11.4 — self-rescue, not evidence"),
}

rows = []
for line in open(os.path.join(os.path.dirname(__file__), "..", "dashboard", "README.md")):
    m = re.match(r"\|\s*(\d{3})\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*([a-z0-9-]+)\s*\|", line)
    if m:
        cells = line.split("|")
        src = re.findall(r"issues/(\d+)|\(#(\d+)\)", cells[-3])
        num = next((int(a or b) for a, b in reversed(src)), None)
        rows.append({"day": m.group(1), "date": m.group(2), "slug": m.group(3), "issue": num})

SHA = re.compile(r"\b([0-9a-f]{7,40})\b")
print(f"{'day':>4} {'date':<11} {'slug':<14} {'c1+c3':<7} verdict")
audited = []
for r in rows:
    day = r["day"]
    c13, why13 = False, "no ship issue in the dashboard row"
    if r["issue"]:
        cs = gha(f"issues/{r['issue']}/comments?per_page=100")
        hit = None
        for c in cs if isinstance(cs, list) else []:
            if re.search(rf"EVENING VERIFIED day-{day}\b", c["body"]):
                hit = c
        if hit is None:
            why13 = "no EVENING VERIFIED header"
        elif not SHA.search(hit["body"]):
            why13 = "header present, no sha named"
        else:
            c13, why13 = True, "artifact ok"
    adj = ADJUDICATED.get(day)
    if adj is None:
        state, why = "UNPROVEN", "clauses 2/4/5 not adjudicated"
    elif not c13:
        state, why = "not clean", why13
    elif not adj[0]:
        state, why = "not clean", adj[1]
    else:
        state, why = "CLEAN", adj[1]
    audited.append((day, r["date"], state == "CLEAN"))
    print(f"{day:>4} {r['date']:<11} {r['slug']:<14} {str(c13):<7} {state} — {why}")

runs, run, prev = [], [], None
for day, date, clean in audited:
    d = datetime.date.fromisoformat(date)
    gap = prev is not None and (d - prev).days > 1
    if gap or not clean:
        if run:
            runs.append(run)
        run = [day] if (gap and clean) else []
    else:
        run.append(day)
    prev = d
if run:
    runs.append(run)
last_day = audited[-1][0]
live = next((r for r in runs if r and r[-1] == last_day), [])
longest = max(runs, key=len) if runs else []
print()
print(f"longest run ever: {len(longest)} — days {', '.join(longest) or '(none)'} (spent unless live)")
print(f"live run (must end at day {last_day}): {len(live)} — days {', '.join(live) or '(none)'}")
print(f"VERDICT: {'GRADUATES' if len(live) >= 5 else 'does not graduate'} — needs 5 live")
