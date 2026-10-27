"""The coverage scraper against a fixture template (T1, #32)."""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import rh_controls  # noqa: E402

FIXTURE = """
<label for="set_min_lap">{{ __('Minimum Lap Time') }}</label>
<input type="number" id="set_min_lap">
<select id="set_min_lap_behavior"></select>
<input id="set_pilot_name_{{ pilot.id }}">        {# per-entity, no literal id #}
<input type="hidden" id="csrf">                    {# hidden inputs are not controls #}
<input type="checkbox" id="set_min_lap">           {# duplicate id listed once #}
<button id="reset_db">Reset <b>database</b></button>
<textarea id="notes"></textarea>
<div id="not_a_control"></div>
"""


class ScrapeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        src = Path(self.tmp.name)
        templates = src / "src" / "server" / "templates"
        templates.mkdir(parents=True)
        for page in rh_controls.PAGES:
            (templates / f"{page}.html").write_text("", encoding="utf-8")
        (templates / "settings.html").write_text(FIXTURE, encoding="utf-8")
        self.src = src

    def tearDown(self):
        self.tmp.cleanup()

    def test_scrape_lists_literal_controls_with_kind_and_label(self):
        rows = rh_controls.scrape(self.src)
        self.assertEqual(rows, [
            ("settings", "set_min_lap", "input:number", "Minimum Lap Time"),
            ("settings", "set_min_lap_behavior", "select", ""),
            ("settings", "reset_db", "button", ""),
            ("settings", "notes", "textarea", ""),
        ])

    def test_check_fails_on_unclassified_and_bad_status(self):
        tsv = Path(self.tmp.name) / "map.tsv"
        tsv.write_text(
            "page\tid\tkind\tlabel\tstatus\tnote\n"
            "settings\tset_min_lap\tinput:number\tMinimum Lap Time\tours\t\n"
            "settings\tset_min_lap_behavior\tselect\t\tplanned:T2\t\n"
            "settings\treset_db\tbutton\t\tsomeday\t\n",  # bad status; `notes` unclassified
            encoding="utf-8",
        )
        self.assertEqual(rh_controls.check(self.src, tsv), 1)
        tsv.write_text(
            "page\tid\tkind\tlabel\tstatus\tnote\n"
            "settings\tset_min_lap\tinput:number\tMinimum Lap Time\tours\t\n"
            "settings\tset_min_lap_behavior\tselect\t\tplanned:T2\t\n"
            "settings\treset_db\tbutton\t\trh-only\twhy\n"
            "settings\tnotes\ttextarea\t\tlink\t\n",
            encoding="utf-8",
        )
        self.assertEqual(rh_controls.check(self.src, tsv), 0)


if __name__ == "__main__":
    unittest.main()
