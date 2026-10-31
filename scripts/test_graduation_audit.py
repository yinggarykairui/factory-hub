#!/usr/bin/env python3
"""Tests for graduation_audit.py.

Each of the eight defects that killed day 034's tool (#94) is reproduced as a
case that asserts the rewrite does NOT exhibit it, plus the one guard that
matters most: no input makes the tool print GRADUATES without a live run of five
consecutive artifact-cited clean evenings.

Run: python3 scripts/test_graduation_audit.py  (stdlib unittest, no deps)
"""

import io
import json
import os
import subprocess
import tempfile
import unittest

import graduation_audit as ga


REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _real_hub_sha():
    """A sha that actually resolves in the hub repo, for the clause-3 checks."""
    out = subprocess.run(
        ["git", "-C", REPO, "rev-parse", "HEAD"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
    )
    return out.stdout.strip() if out.returncode == 0 else None


HUB_SHA = _real_hub_sha()


def dashboard(rows):
    """Build a dashboard index table from (day:int, date:str, slug:str) tuples."""
    lines = [
        "# Dashboard",
        "",
        "| Day | Date | Slug | Type | One-liner | Tech | Rubric | Repo | Demo | Idea source | Builder model |",
        "|-----|------|------|------|-----------|------|--------|------|------|-------------|---------------|",
    ]
    for day, date_, slug in rows:
        lines.append(
            f"| {day:03d} | {date_} | {slug} | cli | x | py | 4.5 | [repo](u) | — | seeded | opus |"
        )
    lines.append("")
    lines.append("**KPI:** streak prose that is not a table row.")
    return "\n".join(lines) + "\n"


def clean_clauses(sha=None, sha_in="git-mood"):
    """A full set of five clauses that all hold and are cited (a clean evening)."""
    return {
        "1_verified_own_ship": {"holds": True, "artifact": "#1", "read_as": "relabelled verified"},
        "2_different_shifts": {"holds": True, "hand_asserted": True, "artifact": "#1", "read_as": "noon vs evening"},
        "3_artifact_form": {"holds": True, "artifact": "#1", "read_as": "EVENING VERIFIED header",
                            "sha": sha or "0123456789abcdef0123456789abcdef01234567", "sha_in": sha_in},
        "4_no_human_fix_owed": {"holds": True, "artifact": "issue plane", "read_as": "no blocked issue"},
        "5_mustpass_passed": {"holds": True, "artifact": "#1", "read_as": "six CLI lines passed"},
    }


def evidence(days):
    """days: {day_number: clauses_dict}."""
    return {
        "owner_login": "yinggarykairui",
        "days": [{"day": d, "date": "x", "clauses": c} for d, c in days.items()],
    }


class Harness(unittest.TestCase):
    def run_audit(self, dashboard_text, evidence_obj, today="2026-02-05", repo=REPO):
        with tempfile.TemporaryDirectory() as tmp:
            dpath = os.path.join(tmp, "dashboard.md")
            epath = os.path.join(tmp, "evidence.json")
            with open(dpath, "w") as fh:
                fh.write(dashboard_text)
            with open(epath, "w") as fh:
                json.dump(evidence_obj, fh)
            buf = io.StringIO()
            code = ga.run_audit(dpath, epath, today, repo, buf)
            return code, buf.getvalue()

    def five_clean_days(self, start_day=1, start_date=(2026, 2, 1)):
        """Five consecutive calendar days, each a clean CLI evening ending at 2026-02-05."""
        import datetime
        rows = []
        days = {}
        d0 = datetime.date(*start_date)
        for i in range(5):
            d = d0 + datetime.timedelta(days=i)
            dn = start_day + i
            rows.append((dn, d.isoformat(), "git-mood"))
            days[dn] = clean_clauses()
        return dashboard(rows), evidence(days)


class TestRealRepo(Harness):
    def test_real_repo_runs_not_yet(self):
        """Done-checklist 1: the tool runs on the real repo, exits 1, says NOT YET,
        live run 0 (matching the dashboard's 'live run still 0 asserted')."""
        buf = io.StringIO()
        code = ga.run_audit(
            os.path.join(REPO, "dashboard", "README.md"),
            os.path.join(REPO, "scripts", "graduation_evidence.json"),
            "2026-10-31", REPO, buf,
        )
        self.assertEqual(code, 1)
        self.assertIn("NOT YET", buf.getvalue())
        self.assertIn("run ending at the last row : 0", buf.getvalue())


class TestDefect3StrictParse(Harness):
    def test_unpadded_date_refuses_loudly_not_silent(self):
        """Defect 3 / point 1: an un-padded date must stop the audit, not vanish.
        The old rows() dropped the line and moved the anchor to a clean row."""
        text = dashboard([(1, "2026-02-01", "a"), (2, "2026-02-02", "b")])
        text = text.replace("2026-02-02", "2026-2-2")  # un-pad the second row
        code, out = self.run_audit(text, evidence({}))
        self.assertEqual(code, 2, out)
        self.assertIn("CANNOT RUN", out)
        self.assertIn("2026-2-2", out)  # the bad value is named

    def test_dropped_row_leaves_a_hole_and_is_caught(self):
        """A row that silently failed to parse would leave a gap in day numbers."""
        # Day numbers 1,2,4 — day 003 missing.
        text = dashboard([(1, "2026-02-01", "a"), (2, "2026-02-02", "b"), (4, "2026-02-04", "d")])
        code, out = self.run_audit(text, evidence({}))
        self.assertEqual(code, 2, out)
        self.assertIn("contiguous", out)

    def test_wrong_column_count_refuses(self):
        text = dashboard([(1, "2026-02-01", "a")])
        text = text.replace("| 001 | 2026-02-01 | a | cli | x | py | 4.5 | [repo](u) | — | seeded | opus |",
                            "| 001 | 2026-02-01 | a | cli |")
        code, out = self.run_audit(text, evidence({}))
        self.assertEqual(code, 2, out)
        self.assertIn("columns", out)


class TestDefect2Timezone(Harness):
    def test_today_override_is_strict(self):
        with self.assertRaises(ga.AuditError):
            ga.factory_today("2026-2-5")  # un-padded

    def test_today_override_used_verbatim(self):
        self.assertEqual(ga.factory_today("2026-02-05").isoformat(), "2026-02-05")

    def test_anchor_follows_supplied_factory_day(self):
        """A run clean through 2026-02-05, audited with 'today' = 2026-02-06, is
        still live (last row == yesterday). The anchor follows the supplied factory
        day. (The UTC-fallback refusal itself is a zoneinfo path not reachable with
        an override supplied; it is exercised by the factory_today unit tests.)"""
        dtext, ev = self.five_clean_days()
        code, out = self.run_audit(dtext, ev, today="2026-02-06")
        self.assertEqual(code, 0, out)  # yesterday anchor, still live


class TestDefect1TrailingZeroDays(Harness):
    def test_trailing_zero_days_block_even_with_clean_tail(self):
        """Defect 1: five clean evenings ending 2026-02-05, but 'today' is far
        later — the factory stopped shipping — must NOT graduate."""
        dtext, ev = self.five_clean_days()
        code, out = self.run_audit(dtext, ev, today="2026-06-01")
        self.assertEqual(code, 1, out)
        self.assertIn("NOT YET", out)
        self.assertIn("trailing stretch of zero", out)

    def test_zero_day_inside_breaks_the_run(self):
        """A missing calendar date between two shipped days breaks consecutiveness."""
        import datetime
        rows, days = [], {}
        dates = ["2026-02-01", "2026-02-02", "2026-02-04", "2026-02-05", "2026-02-06"]  # 02-03 missing
        for i, ds in enumerate(dates, start=1):
            rows.append((i, ds, "git-mood"))
            days[i] = clean_clauses()
        code, out = self.run_audit(dashboard(rows), evidence(days), today="2026-02-06")
        self.assertEqual(code, 1, out)  # run ending at last row is only 3 (02-04..02-06)


class TestDefect2SameDateCollapse(Harness):
    def test_two_rows_one_date_count_once(self):
        """Point 2: days 001 and 002 on one date are one factory day. Five rows on
        four dates must NOT clear the five-evening gate."""
        import datetime
        rows = [
            (1, "2026-02-02", "a"), (2, "2026-02-02", "b"),  # one factory day
            (3, "2026-02-03", "c"), (4, "2026-02-04", "d"), (5, "2026-02-05", "e"),
        ]
        days = {n: clean_clauses() for n in range(1, 6)}
        code, out = self.run_audit(dashboard(rows), evidence(days), today="2026-02-05")
        self.assertEqual(code, 1, out)  # four factory days, not five
        self.assertIn("factory days          : 4", out)

    def test_clause1_reads_last_row_on_the_date(self):
        """§16: 'the dashboard's last row on that date is the ship'. The evening
        for a two-row day is judged against the later row's evidence."""
        rows = [(1, "2026-02-02", "a"), (2, "2026-02-02", "b")]
        with tempfile.TemporaryDirectory() as tmp:
            p = os.path.join(tmp, "d.md")
            with open(p, "w") as fh:
                fh.write(dashboard(rows))
            parsed = ga.parse_dashboard(p)
        fdays = ga.to_factory_days(parsed)
        self.assertEqual(len(fdays), 1)
        self.assertEqual(fdays[0].ship_day, 2)  # the last row on the date


class TestPoint7Unproven(Harness):
    def test_missing_evidence_row_is_unproven_not_clean(self):
        """Point 7: a factory day with a dashboard row but no evidence row is
        UNPROVEN and cannot be in a clean run."""
        dtext, ev = self.five_clean_days()
        ev["days"] = [d for d in ev["days"] if d["day"] != 5]  # drop the last day's evidence
        code, out = self.run_audit(dtext, ev, today="2026-02-05")
        self.assertEqual(code, 1, out)
        self.assertIn("no evidence row for day 005", out)

    def test_uncited_clause_is_unproven(self):
        dtext, ev = self.five_clean_days()
        for d in ev["days"]:
            if d["day"] == 5:
                d["clauses"]["1_verified_own_ship"]["artifact"] = ""  # strip the citation
        code, out = self.run_audit(dtext, ev, today="2026-02-05")
        self.assertEqual(code, 1, out)
        self.assertIn("no artifact citation", out)

    def test_null_clause_shape_does_not_crash(self):
        """Point 4: a null/non-dict clause is UNPROVEN, not a traceback (which the
        contract would misread as 'gate not clear')."""
        dtext, ev = self.five_clean_days()
        for d in ev["days"]:
            if d["day"] == 5:
                d["clauses"]["1_verified_own_ship"] = None
        code, out = self.run_audit(dtext, ev, today="2026-02-05")
        self.assertEqual(code, 1, out)
        self.assertIn("missing or malformed", out)


class TestPoint6ShaMustBeASha(Harness):
    def test_non_hex_sha_refuses(self):
        dtext, ev = self.five_clean_days()
        for d in ev["days"]:
            if d["day"] == 5:
                d["clauses"]["3_artifact_form"]["sha"] = "nothex!!"
        code, out = self.run_audit(dtext, ev, today="2026-02-05")
        self.assertEqual(code, 2, out)
        self.assertIn("40-char hex", out)

    def test_short_sha_rejected_even_cross_repo(self):
        """`defaced`/`1234567`/`deadbeef` pass `[0-9a-f]{7,40}`; §10 requires full
        40 chars, so the short forms are refused before they can count — and this
        closes the cross-repo hole where a short fake would be accepted on citation."""
        for fake in ("defaced", "1234567", "deadbeef"):
            dtext, ev = self.five_clean_days()
            for d in ev["days"]:
                if d["day"] == 5:
                    d["clauses"]["3_artifact_form"]["sha"] = fake
                    d["clauses"]["3_artifact_form"]["sha_in"] = "some-project"
            code, out = self.run_audit(dtext, ev, today="2026-02-05")
            self.assertEqual(code, 2, f"{fake}: {out}")
            self.assertIn("40-char hex", out)

    def test_hub_sha_that_is_not_a_commit_refuses(self):
        """A well-formed 40-hex factory-hub sha that is not a commit is caught by
        repo resolution (format alone cannot tell it from a real one)."""
        dtext, ev = self.five_clean_days()
        for d in ev["days"]:
            if d["day"] == 5:
                d["clauses"]["3_artifact_form"]["sha"] = "0" * 40
                d["clauses"]["3_artifact_form"]["sha_in"] = "factory-hub"
        code, out = self.run_audit(dtext, ev, today="2026-02-05")
        self.assertEqual(code, 2, out)
        self.assertIn("does not resolve to a commit", out)

    @unittest.skipIf(HUB_SHA is None, "git/hub sha unavailable")
    def test_real_hub_sha_resolves(self):
        dtext, ev = self.five_clean_days()
        for d in ev["days"]:
            if d["day"] == 5:
                d["clauses"]["3_artifact_form"]["sha"] = HUB_SHA
                d["clauses"]["3_artifact_form"]["sha_in"] = "factory-hub"
        code, out = self.run_audit(dtext, ev, today="2026-02-05")
        self.assertEqual(code, 0, out)  # real sha resolves; run stays clean

    def test_git_unavailable_on_hub_sha_does_not_graduate(self):
        """MAJOR 2: being unable to run the one machine check (git missing) must NOT
        pass generous. A claimed-clean factory-hub sha with git unavailable is
        unproven, so the day is not clean and the gate does not clear."""
        import unittest.mock
        dtext, ev = self.five_clean_days()
        for d in ev["days"]:
            if d["day"] == 5:
                d["clauses"]["3_artifact_form"]["sha"] = "a" * 40
                d["clauses"]["3_artifact_form"]["sha_in"] = "factory-hub"
        with unittest.mock.patch.object(ga, "_is_commit_in_repo", lambda *a, **k: None):
            code, out = self.run_audit(dtext, ev, today="2026-02-05")
        self.assertNotEqual(code, 0, out)  # must not GRADUATES
        self.assertEqual(code, 1, out)
        self.assertIn("git unavailable", out)


class TestBlocker1Truncation(Harness):
    """A clean prefix followed by real trailing rows must refuse, never truncate."""

    def _split_dashboard(self, break_line):
        import datetime
        head = [
            "# Dashboard", "",
            "| Day | Date | Slug | Type | One-liner | Tech | Rubric | Repo | Demo | Idea source | Builder model |",
            "|-----|------|------|------|-----------|------|--------|------|------|-------------|---------------|",
        ]
        row = lambda n, d: f"| {n:03d} | {d} | s | cli | x | py | 4.5 | [repo](u) | — | seeded | opus |"
        d0 = datetime.date(2026, 2, 1)
        clean = [row(i + 1, (d0 + datetime.timedelta(days=i)).isoformat()) for i in range(5)]
        trailing = [row(6 + i, (d0 + datetime.timedelta(days=5 + i)).isoformat()) for i in range(3)]
        return "\n".join(head + clean + [break_line] + trailing) + "\n"

    def test_blank_line_then_rows_refuses(self):
        ev = evidence({n: clean_clauses() for n in range(1, 6)})  # only 1..5 evidenced
        code, out = self.run_audit(self._split_dashboard(""), ev, today="2026-02-05")
        self.assertEqual(code, 2, out)
        self.assertIn("after the index-table block", out)

    def test_comment_line_then_rows_refuses(self):
        ev = evidence({n: clean_clauses() for n in range(1, 6)})
        code, out = self.run_audit(self._split_dashboard("<!-- archived -->"), ev, today="2026-02-05")
        self.assertEqual(code, 2, out)

    def test_second_table_appended_refuses(self):
        ev = evidence({n: clean_clauses() for n in range(1, 6)})
        second_header = ("\n| Day | Date | Slug | Type | One-liner | Tech | Rubric | Repo | Demo | Idea source | Builder model |"
                         "\n|-----|------|------|------|-----------|------|--------|------|------|-------------|---------------|")
        code, out = self.run_audit(self._split_dashboard(second_header), ev, today="2026-02-05")
        self.assertEqual(code, 2, out)

    def _rows_text(self, extra_last):
        """Header + separator + clean rows 001-005 (2026-02-01..05) + one extra 6th
        line (verbatim), with no blank line before it (contiguous)."""
        head = ("# Dashboard\n\n"
                "| Day | Date | Slug | Type | One-liner | Tech | Rubric | Repo | Demo | Idea source | Builder model |\n"
                "|-----|------|------|------|-----------|------|--------|------|------|-------------|---------------|\n")
        import datetime
        d0 = datetime.date(2026, 2, 1)
        body = "".join(
            f"| {i+1:03d} | {(d0+datetime.timedelta(days=i)).isoformat()} | s | cli | x | py | 4.5 | [repo](u) | — | seeded | opus |\n"
            for i in range(5)
        )
        return head + body + extra_last + "\n"

    def test_contiguous_row_without_leading_pipe_is_parsed_not_truncated(self):
        """Repro A: a GFM row with no leading pipe must be READ (6 factory days),
        never silently dropped. Day 006 has no evidence -> NOT YET, not GRADUATES."""
        ev = evidence({n: clean_clauses() for n in range(1, 6)})  # days 1-5 only
        line6 = "006 | 2026-02-06 | s | cli | x | py | 4.5 | [repo](u) | — | seeded | opus |"
        code, out = self.run_audit(self._rows_text(line6), ev, today="2026-02-06")
        self.assertEqual(code, 1, out)          # not clear
        self.assertNotIn("GRADUATES", out)
        self.assertIn("factory days          : 6", out)   # the row was read, not dropped
        self.assertIn("no evidence row for day 006", out)

    def test_contiguous_row_with_trailing_junk_refuses(self):
        """Repro C: junk after the final pipe makes the column count wrong -> refuse,
        never truncate the table at that row."""
        ev = evidence({n: clean_clauses() for n in range(1, 6)})
        line6 = "| 006 | 2026-02-06 | s | cli | x | py | 4.5 | [repo](u) | — | seeded | opus |x"
        code, out = self.run_audit(self._rows_text(line6), ev, today="2026-02-06")
        self.assertEqual(code, 2, out)
        self.assertIn("columns", out)

    def test_contiguous_unpadded_day_refuses(self):
        ev = evidence({n: clean_clauses() for n in range(1, 6)})
        line6 = "| 6 | 2026-02-06 | s | cli | x | py | 4.5 | [repo](u) | — | seeded | opus |"
        code, out = self.run_audit(self._rows_text(line6), ev, today="2026-02-06")
        self.assertEqual(code, 2, out)
        self.assertIn("3-digit day", out)

    def test_unpadded_row_after_blank_refuses(self):
        """Repro D: a well-formed-pipes but un-padded day row after a blank line must
        be caught by the trailing scan (day_cell \\d{1,3}), not silently ignored."""
        ev = evidence({n: clean_clauses() for n in range(1, 6)})
        line6 = "\n| 6 | 2026-02-06 | s | cli | x | py | 4.5 | [repo](u) | — | seeded | opus |"
        code, out = self.run_audit(self._rows_text(line6), ev, today="2026-02-06")
        self.assertEqual(code, 2, out)
        self.assertIn("after the index-table block", out)

    def test_unicode_separator_in_table_refuses(self):
        """str.splitlines() breaks on U+2028/9, U+000B/C, U+001C-1E, U+0085 but GFM
        does not — embedding one splits a row Python-side that a renderer shows whole,
        silently dropping it. The tool must refuse any dashboard containing them."""
        for ch in (" ", " ", "\x0b", "\x0c", "\x1c", "\x1d", "\x1e", "\x85"):
            dtext, ev = self.five_clean_days()
            # Append the separator char to the end of the last clean row + add a 6th
            # (today, no evidence) row — the exact shape that used to GRADUATES.
            import datetime
            d6 = (datetime.date(2026, 2, 1) + datetime.timedelta(days=5)).isoformat()
            row6 = f"| 006 | {d6} | s | cli | x | py | 4.5 | r | - | s | o |"
            # Inject the char right after '006' in the 6th row and at the end of row 5.
            lines = dtext.split("\n")
            for k, ln in enumerate(lines):
                if ln.startswith("| 005 "):
                    lines[k] = ln + ch
            dtext2 = "\n".join(lines[:-2] + [row6.replace("006", "006" + ch), lines[-2], lines[-1]])
            code, out = self.run_audit(dtext2, ev, today="2026-02-06")
            self.assertEqual(code, 2, f"char {ch!r}: {out}")
            self.assertIn("Refusing", out)

    def test_real_dashboard_prose_does_not_false_positive(self):
        """The real dashboard has ~90 lines of post-table prose with pipe chars and a
        `| 048 |` code span. Parsing it must succeed (exit 1), never trip the scan."""
        buf_code, _ = self._real()
        self.assertEqual(buf_code, 1)

    def _real(self):
        import io as _io
        buf = _io.StringIO()
        code = ga.run_audit(
            os.path.join(REPO, "dashboard", "README.md"),
            os.path.join(REPO, "scripts", "graduation_evidence.json"),
            "2026-10-31", REPO, buf,
        )
        return code, buf.getvalue()


class TestPoint8Clause2Hand(Harness):
    def test_clause2_flagged_hand_asserted(self):
        """Point 8: clause 2 ('different shifts') is not machine-decidable (§10 has
        no shift id). The tool trusts the cited assertion but flags it HAND."""
        dtext, ev = self.five_clean_days()
        code, out = self.run_audit(dtext, ev, today="2026-02-05")
        self.assertEqual(code, 0, out)
        # Assert the specific per-day HAND flag, not just the word "hand" (the
        # GRADUATES footer says "...by hand" regardless, which is why the old
        # assertion was tautological — MINOR 4).
        self.assertIn("hand-cited: 2_different_shifts", out)


class TestGenerousGuard(Harness):
    def test_four_clean_days_do_not_graduate(self):
        import datetime
        rows, days = [], {}
        d0 = datetime.date(2026, 2, 2)
        for i in range(4):
            d = d0 + datetime.timedelta(days=i)
            rows.append((i + 1, d.isoformat(), "git-mood"))
            days[i + 1] = clean_clauses()
        code, out = self.run_audit(dashboard(rows), evidence(days), today="2026-02-05")
        self.assertEqual(code, 1, out)

    def test_one_not_clean_in_the_tail_blocks(self):
        dtext, ev = self.five_clean_days()
        for d in ev["days"]:
            if d["day"] == 5:
                d["clauses"]["5_mustpass_passed"]["holds"] = False
                d["clauses"]["5_mustpass_passed"]["note"] = "a must-pass line failed"
        code, out = self.run_audit(dtext, ev, today="2026-02-05")
        self.assertEqual(code, 1, out)
        self.assertIn("NOT YET", out)

    def test_five_clean_days_do_graduate(self):
        """The positive control: the gate CAN clear, so NOT YET is a real verdict,
        not a tool that always says no."""
        dtext, ev = self.five_clean_days()
        code, out = self.run_audit(dtext, ev, today="2026-02-05")
        self.assertEqual(code, 0, out)
        self.assertIn("GRADUATES", out)


class TestCli(Harness):
    def test_help_documents_exit_codes(self):
        """Done-checklist 2: --help is accurate about the exit-code contract."""
        import contextlib
        buf = io.StringIO()
        with self.assertRaises(SystemExit) as cm, contextlib.redirect_stdout(buf):
            ga.main(["--help"])
        self.assertEqual(cm.exception.code, 0)
        text = buf.getvalue()
        self.assertIn("0", text)
        self.assertIn("NOT YET", text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
