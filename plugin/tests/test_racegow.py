"""RaceGOW mode's settings (#95): one JSON option that travels with the season."""

import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from test_plugin import FakeRhapi  # noqa: E402

import gridfpv  # noqa: E402
from gridfpv import racegow  # noqa: E402


class RaceGowTests(unittest.TestCase):
    def test_defaults_and_tolerance(self):
        self.assertEqual(racegow.load(FakeRhapi()), {"season": 1, "seat": None, "callsign": "", "name_template": "RaceGOW {season} {track} Round {round}"})
        rhapi = FakeRhapi(options={racegow.OPT_RACEGOW: "not json"})
        self.assertEqual(racegow.load(rhapi)["season"], 1)
        rhapi = FakeRhapi(options={racegow.OPT_RACEGOW: json.dumps({"season": "7", "seat": "2", "callsign": "Ryan"})})
        self.assertEqual(racegow.load(rhapi), {"season": 7, "seat": 2, "callsign": "Ryan", "name_template": "RaceGOW {season} {track} Round {round}"})
        rhapi = FakeRhapi(options={racegow.OPT_RACEGOW: json.dumps({"season": 0, "seat": -1})})
        self.assertEqual(racegow.load(rhapi), {"season": 1, "seat": None, "callsign": "", "name_template": "RaceGOW {season} {track} Round {round}"})

    def test_save_writes_only_the_fields_given_and_validates(self):
        rhapi = FakeRhapi(seats=4)
        rhapi.interface = type("I", (), {"seats": [0, 1, 2, 3]})()
        out = racegow.save(rhapi, {"season": 2})
        self.assertEqual(out, {"season": 2, "seat": None, "callsign": "", "name_template": "RaceGOW {season} {track} Round {round}"})
        out = racegow.save(rhapi, {"seat": 3, "callsign": " Ryan "})
        self.assertEqual(out, {"season": 2, "seat": 3, "callsign": "Ryan", "name_template": "RaceGOW {season} {track} Round {round}"})
        self.assertEqual(json.loads(rhapi.options[racegow.OPT_RACEGOW])["seat"], 3)
        for bad in ({"season": "x"}, {"season": 0}, {"seat": 4}, {"seat": "x"}, {"callsign": "c" * 41}):
            with self.assertRaises(racegow.RaceGowError, msg=bad):
                racegow.save(rhapi, bad)
        self.assertEqual(racegow.load(rhapi)["seat"], 3)
        self.assertEqual(racegow.save(rhapi, {"seat": None})["seat"], None)

    def test_name_template_is_validated_and_blank_means_default(self):
        rhapi = FakeRhapi()
        out = racegow.save(rhapi, {"name_template": " S{season} {track} R{round} "})
        self.assertEqual(out["name_template"], "S{season} {track} R{round}")
        self.assertEqual(racegow.save(rhapi, {"name_template": ""})["name_template"], racegow.DEFAULT_NAME_TEMPLATE)
        for bad in ("RaceGOW {season} {track}", "Run {round}: {track}", "{round} {lap}", "x" * 121):
            with self.assertRaises(racegow.RaceGowError, msg=bad):
                racegow.save(rhapi, {"name_template": bad})
        self.assertEqual(racegow.load(rhapi)["name_template"], racegow.DEFAULT_NAME_TEMPLATE)

    def test_socket_round_trip(self):
        rhapi = FakeRhapi()
        gridfpv.initialize(rhapi, static_dir="/nonexistent", start_loop=False)
        rhapi.listeners[gridfpv.EVT_RACEGOW_GET]({})
        self.assertEqual(rhapi.sent[-1], (gridfpv.EVT_RACEGOW, {"season": 1, "seat": None, "callsign": "", "name_template": "RaceGOW {season} {track} Round {round}"}))
        rhapi.listeners[gridfpv.EVT_RACEGOW_SET]({"season": 3, "callsign": "Ryan"})
        ev, payload = rhapi.ui.socket_broadcast.call_args_list[-1][0]
        self.assertEqual((ev, payload["season"], payload["callsign"]), (gridfpv.EVT_RACEGOW, 3, "Ryan"))
        rhapi.listeners[gridfpv.EVT_RACEGOW_SET]({"season": "nope"})
        rhapi.ui.message_alert.assert_called_once()


if __name__ == "__main__":
    unittest.main()
