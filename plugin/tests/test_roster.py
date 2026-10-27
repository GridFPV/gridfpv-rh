"""The roster (#14): capture, listing, add-to-event and the pilot-event hooks."""

import json
import os
import sys
import tempfile
import types
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from test_plugin import FakeRhapi  # noqa: E402

import gridfpv  # noqa: E402
from gridfpv import roster  # noqa: E402


def pilot(id, callsign, name="", team="", color="#112233", phonetic=""):
    return types.SimpleNamespace(id=id, callsign=callsign, name=name, team=team, color=color, phonetic=phonetic)


class RosterCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = mock.patch.dict(os.environ, {"GRIDFPV_ROSTER_PATH": os.path.join(self.tmp.name, "r", "roster.json")})
        self.env.start()
        self.rhapi = FakeRhapi()
        self.rhapi.db.pilot_attributes = mock.Mock(return_value=[types.SimpleNamespace(name="mgp_pilot_id", value="42")])
        self.rhapi.db.pilot_by_id = mock.Mock(side_effect=lambda pid: next((p for p in self.rhapi.pilot_list if p.id == pid), None))
        self.rhapi.db.pilot_add = mock.Mock(side_effect=self._pilot_add)

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def _pilot_add(self, name=None, callsign=None, phonetic=None, team=None, color=None):
        p = pilot(100 + len(self.rhapi.pilot_list), callsign, name or "", team or "", color or "", phonetic or "")
        self.rhapi.pilot_list.append(p)
        return p


class CaptureTests(RosterCase):
    def test_capture_upserts_by_callsign_and_skips_placeholders(self):
        self.assertIsNone(roster.capture(self.rhapi, pilot(1, "~Callsign 1")))
        self.assertEqual(roster.load(self.rhapi), [])
        e = roster.capture(self.rhapi, pilot(1, "Ace", "Ace Pilot", "Red"))
        self.assertEqual((e["callsign"], e["name"], e["team"], e["attributes"]), ("Ace", "Ace Pilot", "Red", {"mgp_pilot_id": "42"}))
        again = roster.capture(self.rhapi, pilot(5, "ace", "A. Pilot", "Blue"))
        self.assertEqual(again["id"], e["id"])  # same pilot, callsign case aside
        self.assertEqual([(p["callsign"], p["name"], p["team"]) for p in roster.load(self.rhapi)], [("ace", "A. Pilot", "Blue")])
        self.assertTrue(os.path.isfile(roster.path()))
        self.assertEqual(json.load(open(roster.path()))["version"], 1)

    def test_listing_flags_who_is_in_this_event(self):
        roster.capture(self.rhapi, pilot(1, "Ace"))
        roster.capture(self.rhapi, pilot(2, "Bee"))
        self.rhapi.pilot_list = [pilot(9, "ACE")]
        listed = roster.listing(self.rhapi)
        self.assertEqual([(p["callsign"], p["in_event"]) for p in listed], [("Ace", True), ("Bee", False)])

    def test_add_to_event_creates_the_missing_ones_with_attributes(self):
        roster.capture(self.rhapi, pilot(1, "Ace", "Ace Pilot", "Red"))
        roster.capture(self.rhapi, pilot(2, "Bee"))
        self.rhapi.pilot_list = []
        ids = [p["id"] for p in roster.load(self.rhapi)]
        added = roster.add_to_event(self.rhapi, ids)
        self.assertEqual(added, ["Ace", "Bee"])
        self.assertEqual([p.callsign for p in self.rhapi.pilot_list], ["Ace", "Bee"])
        self.rhapi.db.pilot_add.assert_any_call(name="Ace Pilot", callsign="Ace", phonetic=None, team="Red", color="#112233")
        self.rhapi.db.pilot_alter.assert_any_call(100, attributes={"mgp_pilot_id": "42"})
        # Already there: skipped, not duplicated.
        self.assertEqual(roster.add_to_event(self.rhapi, ids), [])
        with self.assertRaises(roster.RosterError):
            roster.add_to_event(self.rhapi, [])

    def test_remove_and_a_bad_file(self):
        e = roster.capture(self.rhapi, pilot(1, "Ace"))
        roster.remove(self.rhapi, e["id"])
        self.assertEqual(roster.load(self.rhapi), [])
        with open(roster.path(), "w") as fh:
            fh.write("not json")
        self.assertEqual(roster.load(self.rhapi), [])

    def test_hooks_capture_on_rotorhazards_pilot_events(self):
        handlers = {}
        self.rhapi.events = types.SimpleNamespace(on=lambda evt, fn, **kw: handlers.__setitem__(evt, fn))
        fake_evt = types.SimpleNamespace(PILOT_ADD="pilotAdd", PILOT_ALTER="pilotAlter")
        with mock.patch.dict(sys.modules, {"eventmanager": types.SimpleNamespace(Evt=fake_evt)}):
            roster.hook_pilot_events(self.rhapi)
        self.assertEqual(set(handlers), {"pilotAdd", "pilotAlter"})
        self.rhapi.pilot_list = [pilot(3, "~Callsign 3")]
        handlers["pilotAdd"]({"pilot_id": 3})
        self.assertEqual(roster.load(self.rhapi), [])
        self.rhapi.pilot_list = [pilot(3, "Cee")]
        handlers["pilotAlter"]({"pilot_id": 3})
        self.assertEqual([p["callsign"] for p in roster.load(self.rhapi)], ["Cee"])


class SocketTests(RosterCase):
    def test_round_trip(self):
        gridfpv.initialize(self.rhapi, static_dir="/nonexistent", start_loop=False)
        self.rhapi.pilot_list = [pilot(1, "Ace"), pilot(2, "~Callsign 2")]
        self.rhapi.listeners[gridfpv.EVT_ROSTER_GET]({})
        event, payload = self.rhapi.sent[-1]
        self.assertEqual(event, gridfpv.EVT_ROSTER)
        self.assertEqual([(p["callsign"], p["in_event"]) for p in payload["pilots"]], [("Ace", True)])
        self.rhapi.pilot_list = []
        self.rhapi.listeners[gridfpv.EVT_ROSTER_ADD]({"ids": [payload["pilots"][0]["id"]]})
        self.assertEqual([p.callsign for p in self.rhapi.pilot_list], ["Ace"])
        event, payload = self.rhapi.ui.socket_broadcast.call_args_list[-1][0]
        self.assertEqual((event, payload["added"]), (gridfpv.EVT_ROSTER, ["Ace"]))
        self.rhapi.listeners[gridfpv.EVT_ROSTER_REMOVE]({"id": payload["pilots"][0]["id"]})
        self.assertEqual(self.rhapi.ui.socket_broadcast.call_args_list[-1][0][1]["pilots"], [])
        self.rhapi.listeners[gridfpv.EVT_ROSTER_ADD]({"ids": []})
        self.rhapi.ui.message_alert.assert_called_once()


if __name__ == "__main__":
    unittest.main()
