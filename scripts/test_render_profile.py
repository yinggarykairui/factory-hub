#!/usr/bin/env python3
"""Unit tests for scripts/render_profile.py (#128). stdlib unittest only.

Run: python3 scripts/test_render_profile.py
Covers slug_from_title's broadened parser (#128 item 1) and
reactions_by_slug's best-received-increment combine (#128 item 2).
"""
import os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render_profile as rp


class SlugFromTitle(unittest.TestCase):
    def test_bare_slug(self):
        self.assertEqual(rp.slug_from_title("word-ladder"), "word-ladder")
        self.assertEqual(rp.slug_from_title("json-tidy"), "json-tidy")

    def test_hyphenated_slug_not_split(self):
        # The slug's own hyphen must not read as a separator.
        self.assertEqual(rp.slug_from_title("word-ladder"), "word-ladder")
        self.assertEqual(rp.slug_from_title("pocket-inventory — a pouch"),
                         "pocket-inventory")

    def test_improve_maintenance_form(self):
        self.assertEqual(rp.slug_from_title("improve word-ladder: foo"),
                         "word-ladder")
        self.assertEqual(rp.slug_from_title("Improve  json-tidy:  bar"),
                         "json-tidy")

    def test_job_lane_spaced_emdash(self):
        self.assertEqual(rp.slug_from_title("trace-lens — replay"), "trace-lens")
        self.assertEqual(rp.slug_from_title("trace-lens – replay"), "trace-lens")

    def test_revisit_parenthetical(self):  # #128 item 1 — was None before
        self.assertEqual(rp.slug_from_title("json-tidy (revisit)"), "json-tidy")
        self.assertEqual(rp.slug_from_title("json-tidy(revisit)"), "json-tidy")

    def test_unspaced_emdash(self):  # #128 item 1 — was None before
        self.assertEqual(rp.slug_from_title("trace-lens—replay"), "trace-lens")
        self.assertEqual(rp.slug_from_title("trace-lens–replay"), "trace-lens")

    def test_non_ship_titles_return_none(self):
        self.assertIsNone(rp.slug_from_title("meta: §11 draw pool"))
        self.assertIsNone(rp.slug_from_title("blocked: hub has no LICENSE"))
        # `improve <doc> §…:` is a doctrine ship, not a project — the colon is
        # not immediately after the doc token, so neither branch keys it.
        self.assertIsNone(rp.slug_from_title("improve MANUAL §11: promote x"))
        self.assertIsNone(rp.slug_from_title("improve STYLE.md: add a form"))

    def test_empty_and_none(self):
        self.assertIsNone(rp.slug_from_title(""))
        self.assertIsNone(rp.slug_from_title(None))


class ReactionsBestReceived(unittest.TestCase):
    def setUp(self):
        self._token, self._issues = rp.token, rp._issues
        rp.token = lambda: "fake-token"

    def tearDown(self):
        rp.token, rp._issues = self._token, self._issues

    def _run_with(self, issues_by_label):
        rp._issues = lambda label, tok: issues_by_label.get(label, [])
        return rp.reactions_by_slug()

    def test_max_across_increments_not_sum(self):
        # A five-increment repo at one 👍 each must rank by its best (1),
        # not its sum (5); a one-ship repo with four 👍 outranks it.
        issues = {
            "shipped": [
                {"number": 1, "title": "revisited-repo", "reactions": {"+1": 1}},
                {"number": 2, "title": "improve revisited-repo: again",
                 "reactions": {"+1": 1}},
                {"number": 3, "title": "revisited-repo (revisit)",
                 "reactions": {"+1": 1}},
                {"number": 4, "title": "one-shot", "reactions": {"+1": 4}},
            ],
            "verified": [],
        }
        counts, voted = self._run_with(issues)
        self.assertTrue(voted)
        self.assertEqual(counts["revisited-repo"], 1)   # max, not 3
        self.assertEqual(counts["one-shot"], 4)
        self.assertGreater(counts["one-shot"], counts["revisited-repo"])

    def test_shipped_and_verified_merge_by_number(self):
        # The same issue under both labels is counted once (seen-by-number),
        # and the max still holds across the dedup.
        issues = {
            "shipped": [{"number": 7, "title": "dup-repo", "reactions": {"+1": 2}}],
            "verified": [{"number": 7, "title": "dup-repo", "reactions": {"+1": 2}},
                         {"number": 8, "title": "improve dup-repo: v2",
                          "reactions": {"+1": 5}}],
        }
        counts, voted = self._run_with(issues)
        self.assertEqual(counts["dup-repo"], 5)   # max(2, 5)

    def test_no_token_degrades(self):
        rp.token = lambda: None
        counts, voted = rp.reactions_by_slug()
        self.assertEqual(counts, {})
        self.assertFalse(voted)


if __name__ == "__main__":
    unittest.main(verbosity=2)
