#!/usr/bin/env python3
"""graduation_audit.py — compute the §16 graduation verdict from committed artifacts.

The build factory graduates to phase 1 on **five consecutive clean evenings**
(MANUAL.md §16). That judgement is made by hand, day by day, against the issue
record, and §16 is emphatic about why a tool for it is dangerous:

    "A tool that can be wrong in the generous direction is worse than no tool,
     because the gate is the one place the factory grades itself."

Day 034 wrote such a tool and scoped it out under §7.4 after three critic cycles,
each finding it wrong in a new way. This is the rewrite owed as issue #94. It does
not replace the by-hand audit — the advancing issue's by-hand assertion still
governs (§16) — it *assists* it, and it is built to fail only ever toward
NOT-clean: it refuses loudly on corrupt input (a dropped row, a malformed sha, a
truncated table) and prints GRADUATES only on a live run of five artifact-cited
clean evenings. What it cannot machine-verify — cross-repo shas it cannot clone,
and clauses 1, 2, 4 and 5 — it trusts on the evidence table's citation and flags
HAND; those remain the by-hand audit's to confirm. It is honest about that line:
machine-confirmed is the dashboard-derived sequence and liveness and a factory-hub
sha against the repo; everything else is cited hand-assertion, never silently
accepted corruption.

What is decidable from the dashboard alone (committed, machine-checkable): the
factory-day sequence, same-date collapse, calendar gaps / trailing zero days, and
the liveness anchor. What is NOT decidable from the dashboard (§16 clauses 1–5):
a hand-kept evidence table supplies it, and **every clause names the artifact it
was read from**; a factory day with no evidence row, or any clause without a
citation, is UNPROVEN and cannot be part of a clean run.

Exit codes — the contract (#94 point 4: a failed lookup and an absent artifact
are different things, and neither is a crash):

  0   gate CLEARS   — GRADUATES: a live run of >= 5 consecutive clean evenings
  1   gate NOT clear — NOT YET: a normal, expected result (the usual outcome)
  2   could NOT run  — refuse loudly: unparseable dashboard, malformed evidence,
                       a non-hex sha, missing tz data with no --today override, a
                       claimed-clean hub ship whose sha does not resolve in the repo

A day being UNPROVEN or an evening being NOT-clean is exit 1 (a verdict was
produced and the gate is not clear), never exit 2. Exit 2 means the machinery
could not produce a trustworthy verdict at all.
"""

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import date, datetime, timedelta

HUB_SLUG = "factory-hub"
REQUIRED_CLAUSES = (
    "1_verified_own_ship",
    "2_different_shifts",
    "3_artifact_form",
    "4_no_human_fix_owed",
    "5_mustpass_passed",
)
RUN_LENGTH_REQUIRED = 5  # §16: five consecutive clean evenings
SHA_RE = re.compile(r"[0-9a-f]{40}")  # §10: shas are written in full, 40 chars
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")  # strict: 2026-8-27 does not match
# Line/paragraph separators and vertical controls that str.splitlines() breaks on
# but CommonMark/GFM do NOT (GFM breaks only on \n, \r, \r\n). One of these embedded
# in the table would let Python see a line boundary the renderer does not, splitting
# a visible row into fragments the parser drops -> silent truncation.
_MD_FORBIDDEN = "\x0b\x0c\x1c\x1d\x1e\x85  "


class AuditError(Exception):
    """Raised for 'could not run' conditions. Maps to exit code 2."""


# --------------------------------------------------------------------------- #
# Dashboard parsing — strict, refuses loudly (#94 point 1 / defect 3)
# --------------------------------------------------------------------------- #

class IndexRow:
    __slots__ = ("day", "date", "slug", "type", "lineno", "raw")

    def __init__(self, day, date_, slug, type_, lineno, raw):
        self.day = day
        self.date = date_
        self.slug = slug
        self.type = type_
        self.lineno = lineno
        self.raw = raw


def _cells(line):
    """Split a markdown table row into stripped cells, the way a GFM renderer does.

    Leading and trailing pipes are OPTIONAL in GFM, so `a | b | c`, `| a | b | c |`
    and `| a | b | c` are all three-cell rows. A stricter splitter than the renderer
    is the day-034 trap in a new coat: a row the dashboard renders but the tool does
    not recognize gets silently dropped, truncating the table and sliding the
    liveness anchor back to an older clean row. So this matches the renderer, and the
    strict *validation* (11 columns, 3-digit day, real date) happens in the caller,
    loudly. Returns None for a line with no pipe at all (genuine prose)."""
    s = line.strip()
    if not s or "|" not in s:
        return None
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    return [c.strip() for c in s.split("|")]


def parse_dashboard(path):
    """Parse the dashboard index table strictly.

    The index table is the contiguous block of pipe-rows that follows the header
    row (``| Day | Date | ...``) and its separator. Every line in that block must
    parse into 11 cells with a 3-digit day in column 0 and a strict YYYY-MM-DD
    date in column 1, or the audit stops (never a silent skip). The parsed day
    numbers are then cross-checked to be the contiguous sequence 1..N; a hole
    means a row was dropped somewhere and is a hard error.
    """
    with open(path, encoding="utf-8", newline="") as fh:
        text = fh.read()
    # Refuse a dashboard containing any separator/vertical-control char that
    # str.splitlines() would break on but a Markdown renderer would not: embedded in
    # the table, such a char splits a row the renderer shows whole into fragments the
    # parser drops (silent truncation -> the day-034 anchor-slide reborn, confirmed
    # against cmark-gfm). The real dashboard has none, so refusing is loud and safe.
    bad = sorted({f"U+{ord(c):04X}" for c in text if c in _MD_FORBIDDEN})
    if bad:
        raise AuditError(
            f"{path}: contains line/paragraph-separator or vertical control characters "
            f"({', '.join(bad)}) a Markdown renderer does not treat as line breaks; these "
            f"can hide a dropped table row. Refusing."
        )
    # Split only on the line breaks GFM recognises (\n, \r, \r\n), so the parser's
    # line boundaries are identical to the renderer's.
    lines = re.split(r"\r\n|\r|\n", text)

    header_idx = None
    for i, line in enumerate(lines):
        cells = _cells(line)
        if cells and len(cells) >= 2 and cells[0].lower() == "day" and cells[1].lower() == "date":
            header_idx = i
            break
    if header_idx is None:
        raise AuditError(f"{path}: no index-table header row (| Day | Date | ...) found")

    # The next line must be the separator (|---|---|...).
    sep_idx = header_idx + 1
    if sep_idx >= len(lines):
        raise AuditError(f"{path}: index-table header at line {header_idx + 1} has no separator row")
    sep_cells = _cells(lines[sep_idx])
    if not sep_cells or not all(set(c) <= set("-: ") and c for c in sep_cells):
        raise AuditError(
            f"{path}:{sep_idx + 1}: expected a table separator row after the header, got: {lines[sep_idx]!r}"
        )
    ncols = len(sep_cells)

    # The table block is every CONSECUTIVE non-blank line after the separator, up to
    # the first blank line or EOF — exactly what a GFM renderer treats as the table.
    # The block does NOT end merely because a line fails to parse: a malformed line
    # inside the block is a corrupt row and is refused LOUDLY, never a silent
    # truncation. This is the core of the day-034 fix.
    rows = []
    i = sep_idx + 1
    while i < len(lines):
        line = lines[i]
        if not line.strip(" \t"):
            break  # a blank line (spaces/tabs only, per CommonMark) ends the block
        cells = _cells(line)
        if cells is None:
            # A non-blank, pipe-less line inside the table region: a renderer would
            # treat it as a (malformed) continuation, so we refuse rather than guess.
            raise AuditError(
                f"{path}:{i + 1}: non-table line inside the index-table block (no pipe); "
                f"refusing rather than silently truncate: {line!r}"
            )
        if len(cells) != ncols:
            raise AuditError(
                f"{path}:{i + 1}: index row has {len(cells)} columns, expected {ncols} "
                f"(trailing/leading junk or a stray pipe truncates silently otherwise): {line!r}"
            )
        day_cell = cells[0]
        if not re.fullmatch(r"\d{3}", day_cell):
            raise AuditError(
                f"{path}:{i + 1}: column 1 is not a 3-digit day number: {day_cell!r} "
                f"(an un-padded day is rejected, not skipped) in {line!r}"
            )
        date_cell = cells[1]
        if not DATE_RE.fullmatch(date_cell):
            raise AuditError(
                f"{path}:{i + 1}: column 2 is not a strict YYYY-MM-DD date: {date_cell!r} "
                f"(an un-padded date like 2026-8-27 is rejected, not skipped) in {line!r}"
            )
        try:
            datetime.strptime(date_cell, "%Y-%m-%d")
        except ValueError as exc:
            raise AuditError(f"{path}:{i + 1}: column 2 is not a real date: {date_cell!r} ({exc})")
        rows.append(
            IndexRow(day=int(day_cell), date_=date_cell, slug=cells[2], type_=cells[3],
                     lineno=i + 1, raw=line)
        )
        i += 1

    if not rows:
        raise AuditError(f"{path}: index table has a header but zero data rows")

    # The block ended at a blank line (or EOF). Anything index-row-shaped AFTER it is
    # a dropped row, not prose, and must stop the audit — otherwise a stray blank line
    # then more rows, an annotation, or an appended second table silently truncates
    # the table and the anchor slides back to an older (clean) row (the day-034
    # defect). A dropped row is caught however it is spelled: with or without bounding
    # pipes, and with a padded OR un-padded 1-3 digit day. Genuine prose does not
    # match — it does not begin with a bare 1-3 digit cell followed by table columns
    # (verified against the real dashboard's ~90 lines of post-table narrative, which
    # include pipe characters and even a `| 048 |` code span, none of which trip this).
    for j in range(i, len(lines)):
        later = _cells(lines[j])
        if later and len(later) >= 6 and re.fullmatch(r"\d{1,3}", later[0]):
            raise AuditError(
                f"{path}:{j + 1}: an index-row-shaped line (day {later[0]!r}, "
                f"{len(later)} columns) appears after the index-table block ended at line {i}. "
                f"A row after a break is a dropped row, not prose; refusing rather than parse a "
                f"truncated table: {lines[j]!r}"
            )

    # Cross-check: day numbers are the contiguous sequence 1..N, in order.
    days = [r.day for r in rows]
    expected = list(range(1, len(rows) + 1))
    if days != expected:
        # Find the first disagreement for a useful message.
        for pos, (got, want) in enumerate(zip(days, expected)):
            if got != want:
                raise AuditError(
                    f"{path}: day numbers are not the contiguous sequence 1..{len(rows)} "
                    f"(row {pos + 1} is day {got:03d}, expected {want:03d}); a row was dropped, "
                    f"reordered, or duplicated"
                )
        raise AuditError(
            f"{path}: parsed {len(rows)} index rows but they are not 1..{len(rows)} "
            f"(got up to {max(days):03d})"
        )
    return rows


# --------------------------------------------------------------------------- #
# Factory days — same-date collapse (#94 point 2)
# --------------------------------------------------------------------------- #

class FactoryDay:
    __slots__ = ("date", "rows")

    def __init__(self, date_):
        self.date = date_       # 'YYYY-MM-DD'
        self.rows = []          # IndexRow list, in file order

    @property
    def ship_day(self):
        """§16 clause 1: 'the dashboard's last row on that date is the ship'."""
        return self.rows[-1].day

    @property
    def day_numbers(self):
        return [r.day for r in self.rows]


def to_factory_days(rows):
    """Collapse rows that share a calendar date into one factory day.

    §16: 'Two rows on one date are one factory day and count once' — days 001 and
    002 (both 2026-07-25) are the standing example. The old tool appended both to
    the run, so five 'evenings' could span four days.
    """
    out = []
    by_date = {}
    for r in rows:
        if r.date not in by_date:
            fd = FactoryDay(r.date)
            by_date[r.date] = fd
            out.append(fd)
        by_date[r.date].rows.append(r)
    # Rows arrive in day-number order (cross-checked above), so each factory day's
    # .rows is already in order and .date order follows day order for a real
    # dashboard; sort defensively by the first row's day number anyway.
    out.sort(key=lambda fd: fd.rows[0].day)
    return out


# --------------------------------------------------------------------------- #
# "today" in the factory timezone (#94 defect 2: off-by-one against UTC)
# --------------------------------------------------------------------------- #

def factory_today(override):
    """The current factory day as a date, in America/Los_Angeles.

    If ``override`` is given (--today YYYY-MM-DD) it wins — deterministic for
    tests and an operator escape hatch. Otherwise we compute PT with zoneinfo.
    The sandbox runs UTC; using it directly is the day-034 off-by-one bug, so if
    the timezone database is unavailable we refuse (exit 2) and ask for --today
    rather than silently falling back to UTC.
    """
    if override is not None:
        if not DATE_RE.fullmatch(override):
            raise AuditError(f"--today must be strict YYYY-MM-DD, got {override!r}")
        try:
            return datetime.strptime(override, "%Y-%m-%d").date()
        except ValueError as exc:
            raise AuditError(f"--today is not a real date: {override!r} ({exc})")
    try:
        from zoneinfo import ZoneInfo
    except ImportError:  # pragma: no cover - Python < 3.9
        raise AuditError(
            "zoneinfo is unavailable (Python < 3.9); pass --today YYYY-MM-DD (factory "
            "timezone America/Los_Angeles). Refusing to use the UTC clock — that is the "
            "day-034 off-by-one bug."
        )
    try:
        return datetime.now(ZoneInfo("America/Los_Angeles")).date()
    except Exception as exc:  # tzdata not installed, etc.
        raise AuditError(
            f"could not resolve America/Los_Angeles ({exc}); install tzdata or pass "
            f"--today YYYY-MM-DD. Refusing to fall back to the UTC clock (day-034 off-by-one)."
        )


# --------------------------------------------------------------------------- #
# Evidence table — the hand-kept clause facts (#94 points 7, 8)
# --------------------------------------------------------------------------- #

def _is_commit_in_repo(sha, repo_dir):
    """True iff ``sha`` resolves to a commit object in the git repo at repo_dir.

    #94 point 6: a sha is not a sha because a regex matched it — `1234567` and the
    word `defaced` both match `[0-9a-f]{7,40}`. The only real check is resolving it
    against the repo. Returns None if git is unavailable (cannot confirm either way).
    """
    try:
        proc = subprocess.run(
            ["git", "-C", repo_dir, "rev-parse", "--verify", "--quiet", f"{sha}^{{commit}}"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except (OSError, ValueError):
        return None  # git not available -> cannot confirm
    return proc.returncode == 0


def load_evidence(path):
    """Load and schema-check the evidence JSON. Malformed structure is exit 2.

    Returns (owner_login, {day_number: clauses_dict}). Each day's clauses dict maps
    each of the five §16 clauses to {holds: bool, artifact: str, ...}. This function
    only checks structure; clause *evaluation* happens in evaluate_day so that an
    absent artifact or a holds:false is a NOT-clean verdict (exit 1), not a crash.
    """
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        raise AuditError(f"evidence file not found: {path}")
    except json.JSONDecodeError as exc:
        raise AuditError(f"{path}: not valid JSON ({exc})")

    if not isinstance(data, dict):
        raise AuditError(f"{path}: top level must be a JSON object")
    owner = data.get("owner_login")
    if not isinstance(owner, str) or not owner:
        raise AuditError(f"{path}: 'owner_login' must be a non-empty string")
    days_list = data.get("days")
    if not isinstance(days_list, list):
        raise AuditError(f"{path}: 'days' must be a list")

    by_day = {}
    for entry in days_list:
        if not isinstance(entry, dict):
            raise AuditError(f"{path}: every entry in 'days' must be an object, got {type(entry).__name__}")
        day = entry.get("day")
        if not isinstance(day, int) or isinstance(day, bool):
            raise AuditError(f"{path}: an evidence entry has a non-integer 'day': {day!r}")
        if day in by_day:
            raise AuditError(f"{path}: duplicate evidence entry for day {day}")
        clauses = entry.get("clauses")
        if not isinstance(clauses, dict):
            raise AuditError(f"{path}: day {day} has no 'clauses' object")
        by_day[day] = clauses
    return owner, by_day


# Per-day evening verdicts.
CLEAN = "CLEAN"
NOT_CLEAN = "NOT_CLEAN"
UNPROVEN = "UNPROVEN"


class DayVerdict:
    __slots__ = ("day", "date", "status", "reasons", "hand_clauses")

    def __init__(self, day, date_):
        self.day = day
        self.date = date_
        self.status = UNPROVEN
        self.reasons = []        # human-readable notes
        self.hand_clauses = []   # clauses accepted on cited hand assertion (not machine-verified)


def evaluate_day(factory_day, evidence_by_day, owner_login, repo_dir):
    """Decide whether this factory day's evening was clean, per §16 clauses 1-5.

    Returns a DayVerdict. The rule: CLEAN iff every one of the five clauses is
    present, holds is True, and carries a non-empty artifact citation. A missing
    evidence row, a missing clause, or a missing citation is UNPROVEN. A clause
    with holds:false is NOT_CLEAN. Both UNPROVEN and NOT_CLEAN break a clean run;
    the distinction is kept for the report (and #94 point 7: no row = unproven).

    Raises AuditError (exit 2) only for an evidence row that asserts a *falsehood*
    the tool can catch — a clause claiming to hold on a non-hex sha, or a
    claimed-clean factory-hub ship whose sha does not resolve in the repo. Those
    are rigged/broken rows, not merely absent ones, and refusing loudly on them is
    exactly the generous-direction failure #94 exists to prevent.
    """
    verdict = DayVerdict(factory_day.ship_day, factory_day.date)
    clauses = evidence_by_day.get(factory_day.ship_day)
    if clauses is None:
        verdict.status = UNPROVEN
        verdict.reasons.append(f"no evidence row for day {factory_day.ship_day:03d}")
        return verdict

    # Two independent failure modes, kept apart (#94 point 4): a clause we can
    # read as definitively false (has_false -> NOT_CLEAN), versus a clause we
    # cannot evaluate because evidence is absent/uncited (has_unproven ->
    # UNPROVEN). A day with a cited-false clause is definitively not clean, so
    # NOT_CLEAN takes precedence; both break a clean run.
    has_false = False
    has_unproven = False
    for name in REQUIRED_CLAUSES:
        c = clauses.get(name)
        if not isinstance(c, dict):
            has_unproven = True
            verdict.reasons.append(f"clause {name}: missing or malformed (unproven)")
            continue
        holds = c.get("holds")
        artifact = c.get("artifact")
        if not isinstance(artifact, str) or not artifact.strip():
            has_unproven = True
            verdict.reasons.append(f"clause {name}: no artifact citation (unproven)")
            continue
        if holds is not True:
            # holds is False, None, or absent -> this clause is cited as not holding.
            has_false = True
            verdict.reasons.append(f"clause {name}: does not hold ({c.get('note', 'holds=false')})")
            continue
        # holds is True and cited. Clause-specific extra checks (may raise -> exit 2):
        if name == "3_artifact_form":
            sig = _check_clause3_sha(c, factory_day, repo_dir, verdict)
            if sig == "unproven":
                has_unproven = True
                verdict.reasons.append(
                    "clause 3_artifact_form: factory-hub sha could not be resolved "
                    "(git unavailable) — unproven, not accepted"
                )
                continue
        if name == "2_different_shifts" and c.get("hand_asserted", True):
            verdict.hand_clauses.append(name)

    if has_false:
        verdict.status = NOT_CLEAN
    elif has_unproven:
        verdict.status = UNPROVEN
    else:
        verdict.status = CLEAN
    return verdict


def _check_clause3_sha(clause, factory_day, repo_dir, verdict):
    """§16 clause 3 names the sha the evening checked. Validate it (#94 point 6).

    Returns one of:
      "confirmed" — a factory-hub sha that resolves to a commit in the hub repo.
      "hand"      — a cross-repo sha the hub cannot resolve; accepted on citation
                    and flagged "verify by hand" (the by-hand audit governs).
      "unproven"  — a factory-hub sha whose resolution could not be run because git
                    is unavailable. NOT accepted: the caller marks the day unproven.
                    (Symmetric with the timezone path, which also refuses to fall
                    back to a guess — being unable to run the one machine check this
                    clause offers must never pass in the generous direction.)
    Raises AuditError (exit 2) for a sha that is not full 40-char hex, or a
    factory-hub sha that git says is not a commit.

    #94 point 6: `[0-9a-f]{7,40}` matches `1234567` and `defaced`, so the short
    forms are rejected outright (§10 requires shas written in full, 40 chars), and
    a full-length factory-hub sha is additionally resolved against the repo. A
    full-length *cross-repo* sha the hub cannot clone is trusted on citation — that
    is the hand-kept-table trust §16 sanctions, flagged so no reader mistakes it
    for machine-verified.
    """
    sha = clause.get("sha")
    sha_in = clause.get("sha_in", HUB_SLUG)
    if not isinstance(sha, str) or not SHA_RE.fullmatch(sha):
        # A clause claiming to hold must cite a full 40-char hex sha (§10). A short
        # or non-hex value here is a corrupt/rigged row -> refuse loudly. This is
        # what rejects `defaced`, `1234567`, `deadbeef` (all < 40) before they can
        # count, cross-repo included.
        raise AuditError(
            f"day {factory_day.ship_day:03d} clause 3 claims to hold but 'sha' is not a "
            f"full 40-char hex sha (§10 requires shas in full): {sha!r}"
        )
    if sha_in == HUB_SLUG:
        resolved = _is_commit_in_repo(sha, repo_dir)
        if resolved is False:
            # Hub ship, claimed clean, but the cited sha is not a commit in the hub.
            # A fabricated-but-well-formed 40-hex hub sha lands here. Refuse (#94 point 6).
            raise AuditError(
                f"day {factory_day.ship_day:03d} clause 3 claims to hold with factory-hub "
                f"sha {sha!r}, but it does not resolve to a commit in the hub repo "
                f"({repo_dir}). A sha must be a sha; refusing."
            )
        if resolved is None:
            # git unavailable -> the one machine check cannot run. Do NOT accept.
            return "unproven"
        verdict.hand_clauses.append("3_artifact_form(sha confirmed in hub)")
        return "confirmed"
    # Cross-repo sha (a project/mirror ship). The hub cannot resolve it, so it is
    # accepted on citation but flagged as hand-confirmed, never machine.
    verdict.hand_clauses.append(f"3_artifact_form(sha in {sha_in}: verify by hand)")
    return "hand"


# --------------------------------------------------------------------------- #
# Liveness, consecutiveness, and the run (#94 defect 1, point 2)
# --------------------------------------------------------------------------- #

def _d(s):
    return datetime.strptime(s, "%Y-%m-%d").date()


def compute_run(factory_days, verdicts_by_day, today):
    """Return (live, anchor_ok, run_days) for the clean-evening run ending at the
    dashboard's last factory day.

    - anchor_ok: the last factory day's date is today or the day before (§16's
      one-day tolerance). This is what catches a trailing stretch of zero days
      (#94 defect 1): if the factory stopped shipping, the last row is older than
      yesterday and the gate is not live however clean the tail is.
    - run_days: walking backward from the last factory day, the maximal streak of
      CLEAN evenings with no calendar gap (a missing date between adjacent factory
      days is a zero day and breaks the run).
    """
    if not factory_days:
        return (False, False, [])
    last = factory_days[-1]
    last_date = _d(last.date)
    anchor_ok = last_date == today or last_date == today - timedelta(days=1)

    run = []
    prev_date = None
    for fd in reversed(factory_days):
        d = _d(fd.date)
        if prev_date is not None and (prev_date - d) != timedelta(days=1):
            break  # a zero day (missing calendar date) breaks the run
        v = verdicts_by_day[fd.ship_day]
        if v.status != CLEAN:
            break
        run.append(fd)
        prev_date = d
    run.reverse()
    live = anchor_ok and bool(run)
    return (live, anchor_ok, run)


# --------------------------------------------------------------------------- #
# Driver
# --------------------------------------------------------------------------- #

def run_audit(dashboard_path, evidence_path, today_override, repo_dir, out):
    """Run the audit, printing a report to ``out``. Returns an exit code (0/1/2)."""
    try:
        rows = parse_dashboard(dashboard_path)
        factory_days = to_factory_days(rows)
        today = factory_today(today_override)
        owner_login, evidence_by_day = load_evidence(evidence_path)
        verdicts = {}
        for fd in factory_days:
            v = evaluate_day(fd, evidence_by_day, owner_login, repo_dir)
            verdicts[fd.ship_day] = v
        live, anchor_ok, run = compute_run(factory_days, verdicts, today)
    except AuditError as exc:
        print(f"CANNOT RUN: {exc}", file=out)
        return 2

    graduates = live and len(run) >= RUN_LENGTH_REQUIRED

    # Report.
    last = factory_days[-1]
    print("=" * 72, file=out)
    print("§16 GRADUATION AUDIT", file=out)
    print("=" * 72, file=out)
    print(f"dashboard rows parsed : {len(rows)} (days 001..{len(rows):03d})", file=out)
    print(f"factory days          : {len(factory_days)} (same-date rows collapsed)", file=out)
    print(f"today (factory TZ)    : {today.isoformat()}"
          f"{'  [--today override]' if today_override else '  [America/Los_Angeles]'}", file=out)
    print(f"last dashboard row    : day {last.ship_day:03d} on {last.date}", file=out)
    print(f"liveness anchor       : {'OK' if anchor_ok else 'STALE'} "
          f"(last row must be {today.isoformat()} or {(today - timedelta(days=1)).isoformat()})", file=out)
    print("", file=out)

    # Show the tail the run is drawn from (last up-to-8 factory days).
    tail = factory_days[-8:]
    print("recent evenings (most recent last):", file=out)
    for fd in tail:
        v = verdicts[fd.ship_day]
        mark = {CLEAN: "clean  ", NOT_CLEAN: "NOT    ", UNPROVEN: "unproven"}[v.status]
        note = ""
        if v.reasons:
            note = "  — " + "; ".join(v.reasons)
        elif v.hand_clauses:
            note = "  — hand-cited: " + "; ".join(v.hand_clauses)
        multi = f" (+{len(fd.rows) - 1} same-date row)" if len(fd.rows) > 1 else ""
        print(f"  day {fd.ship_day:03d} {fd.date}  {mark}{multi}{note}", file=out)
    print("", file=out)

    print(f"clean-evening run ending at the last row : {len(run)} "
          f"(need {RUN_LENGTH_REQUIRED} consecutive)", file=out)
    if run:
        print(f"  {run[0].date} (day {run[0].ship_day:03d}) .. "
              f"{run[-1].date} (day {run[-1].ship_day:03d})", file=out)
    print("", file=out)

    if graduates:
        print("VERDICT: GRADUATES", file=out)
        print("  A live run of >= 5 consecutive clean evenings ends at the last row.", file=out)
        print("  This is an assist, not the gate: §16 still requires the advancing", file=out)
        print("  issue to quote the five as a table and assert clauses 1-5 by hand.", file=out)
        return 0

    print("VERDICT: NOT YET", file=out)
    if not anchor_ok:
        print(f"  The last dashboard row ({last.date}) is older than yesterday "
              f"({(today - timedelta(days=1)).isoformat()}): a trailing stretch of zero", file=out)
        print("  days means the evening lane is not live now, whatever the tail looks like.", file=out)
    if len(run) < RUN_LENGTH_REQUIRED:
        print(f"  The clean-evening run ending at the last row is {len(run)}, "
              f"not {RUN_LENGTH_REQUIRED}.", file=out)
        # Name why the run stopped, if we can.
        idx = len(factory_days) - len(run) - 1
        if 0 <= idx < len(factory_days):
            stop = factory_days[idx]
            sv = verdicts[stop.ship_day]
            why = "; ".join(sv.reasons) if sv.reasons else (
                "hand-cited only" if sv.hand_clauses else "see evidence")
            print(f"  It stops at day {stop.ship_day:03d} ({stop.date}): {sv.status} — {why}", file=out)
    print("  The by-hand audit in the advancing issue governs; this tool only", file=out)
    print("  confirms the gate is not clearable right now.", file=out)
    return 1


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="graduation_audit.py",
        description="Compute the MANUAL.md §16 graduation verdict from committed artifacts. "
                    "Assists the by-hand audit; never replaces it.",
        epilog="Exit codes: 0 GRADUATES, 1 NOT YET (normal), 2 could not run (refused loudly).",
    )
    here = os.path.dirname(os.path.abspath(__file__))
    hub_root = os.path.dirname(here)
    parser.add_argument(
        "--dashboard",
        default=os.path.join(hub_root, "dashboard", "README.md"),
        help="path to the dashboard README (default: the hub's dashboard/README.md)",
    )
    parser.add_argument(
        "--evidence",
        default=os.path.join(here, "graduation_evidence.json"),
        help="path to the hand-kept evidence table (default: scripts/graduation_evidence.json)",
    )
    parser.add_argument(
        "--today",
        default=None,
        metavar="YYYY-MM-DD",
        help="override the factory 'today' (America/Los_Angeles). Deterministic for "
             "tests; without it the factory timezone is used and a missing tz database "
             "is an error, never a silent UTC fallback.",
    )
    parser.add_argument(
        "--repo",
        default=hub_root,
        help="the hub git repo used to resolve factory-hub shas (default: the hub root)",
    )
    args = parser.parse_args(argv)
    return run_audit(args.dashboard, args.evidence, args.today, args.repo, sys.stdout)


if __name__ == "__main__":
    sys.exit(main())
