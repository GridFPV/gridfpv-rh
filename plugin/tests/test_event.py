"""The event: RotorHazard's name/description options plus our details option."""

import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from test_plugin import FakeRhapi  # noqa: E402

import gridfpv  # noqa: E402
from gridfpv import event  # noqa: E402


class EventTests(unittest.TestCase):
    def test_load_merges_rotorhazard_options_with_our_details(self):
        rhapi = FakeRhapi(options={"eventName": "Club night", "eventDescription": "round 3"})
        self.assertEqual(event.load(rhapi), {
            "name": "Club night", "description": "round 3", "consecutives_base": 3,
            "date": "", "venue": "", "organizer": "", "notes": ""})

    def test_consecutives_base_is_rotorhazards_option_with_a_sane_default(self):
        self.assertEqual(event.load(FakeRhapi(options={"consecutivesCount": "5"}))["consecutives_base"], 5)
        self.assertEqual(event.load(FakeRhapi(options={"consecutivesCount": "junk"}))["consecutives_base"], 3)
        self.assertEqual(event.load(FakeRhapi(options={"consecutivesCount": "1"}))["consecutives_base"], 3)

    def test_save_writes_only_the_fields_given(self):
        rhapi = FakeRhapi(options={"eventName": "Old", "eventDescription": "d"})
        out = event.save(rhapi, {"venue": "The barn", "date": "2026-11-01"})
        self.assertEqual((out["name"], out["venue"], out["date"]), ("Old", "The barn", "2026-11-01"))
        self.assertEqual(json.loads(rhapi.options[event.OPT_EVENT])["venue"], "The barn")
        out = event.save(rhapi, {"name": "New name"})
        self.assertEqual((rhapi.options["eventName"], out["venue"]), ("New name", "The barn"))

    def test_refuses_blank_or_oversized(self):
        rhapi = FakeRhapi(options={"eventName": "Old"})
        with self.assertRaises(event.EventError):
            event.save(rhapi, {"name": "  "})
        with self.assertRaises(event.EventError):
            event.save(rhapi, {"venue": "x" * 121})
        self.assertEqual(rhapi.options["eventName"], "Old")

    def test_clear_extras_keeps_rotorhazards_name(self):
        rhapi = FakeRhapi(options={"eventName": "Fresh", event.OPT_EVENT: json.dumps({"venue": "barn"})})
        out = event.clear_extras(rhapi)
        self.assertEqual((out["name"], out["venue"]), ("Fresh", ""))

    def test_socket_round_trip(self):
        rhapi = FakeRhapi(options={"eventName": "E1"})
        gridfpv.initialize(rhapi, static_dir="/nonexistent", start_loop=False)
        rhapi.listeners[gridfpv.EVT_EVENT_GET]({})
        self.assertEqual(rhapi.sent[-1][0], gridfpv.EVT_EVENT)
        self.assertEqual(rhapi.sent[-1][1]["name"], "E1")
        rhapi.listeners[gridfpv.EVT_EVENT_SAVE]({"name": "E2", "organizer": "Ryan"})
        ev, payload = rhapi.ui.socket_broadcast.call_args_list[-1][0]
        self.assertEqual((ev, payload["name"], payload["organizer"]), (gridfpv.EVT_EVENT, "E2", "Ryan"))
        rhapi.listeners[gridfpv.EVT_EVENT_SAVE]({"name": ""})
        rhapi.ui.message_alert.assert_called_once()
        rhapi.listeners[gridfpv.EVT_EVENT_CLEAR]({})
        # The event broadcast comes first; the deleted-race copies are dropped after it (#48).
        broadcasts = [c[0] for c in rhapi.ui.socket_broadcast.call_args_list]
        self.assertEqual(broadcasts[-2][1]["organizer"], "")
        self.assertEqual(broadcasts[-1], (gridfpv.EVT_RACES_DELETED, {"races": [], "native": False}))


if __name__ == "__main__":
    unittest.main()
