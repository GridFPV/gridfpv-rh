"""Teams: the stored list, rename/delete cascading to pilots, and the pilot-data filter."""

import json
import os
import sys
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from test_plugin import FakeRhapi  # noqa: E402

import gridfpv  # noqa: E402
from gridfpv import teams  # noqa: E402


def pilot(id, callsign, team=""):
    return types.SimpleNamespace(id=id, callsign=callsign, team=team)


class TeamStoreTests(unittest.TestCase):
    def test_create_sorts_and_refuses_duplicates(self):
        rhapi = FakeRhapi()
        teams.save(rhapi, None, "Zulu", "")
        out = teams.save(rhapi, None, "alpha", "the A team")
        self.assertEqual([t["name"] for t in out], ["alpha", "Zulu"])
        self.assertEqual(json.loads(rhapi.options[teams.OPT_TEAMS]), out)
        with self.assertRaises(teams.TeamError):
            teams.save(rhapi, None, "ZULU", "")
        with self.assertRaises(teams.TeamError):
            teams.save(rhapi, None, "", "")

    def test_rename_moves_its_pilots_and_broadcasts(self):
        rhapi = FakeRhapi()
        rhapi.pilot_list = [pilot(1, "A1", "Red"), pilot(2, "B1", "Blue"), pilot(3, "A2", "Red")]
        (red,) = teams.save(rhapi, None, "Red", "")
        teams.save(rhapi, red["id"], "Crimson", "renamed")
        self.assertEqual([p.team for p in rhapi.pilot_list], ["Crimson", "Blue", "Crimson"])
        rhapi.ui.broadcast_pilots.assert_called_once()
        self.assertEqual(teams.load(rhapi)[0], {"id": red["id"], "name": "Crimson", "description": "renamed"})

    def test_delete_clears_its_pilots(self):
        rhapi = FakeRhapi()
        rhapi.pilot_list = [pilot(1, "A1", "Red"), pilot(2, "B1", "Blue")]
        (red,) = teams.save(rhapi, None, "Red", "")
        self.assertEqual(teams.delete(rhapi, red["id"]), [])
        self.assertEqual([p.team for p in rhapi.pilot_list], ["", "Blue"])
        with self.assertRaises(teams.TeamError):
            teams.delete(rhapi, "nope")


class FilterTests(unittest.TestCase):
    def test_dropdown_lists_our_teams_plus_stray_values_in_use(self):
        rhapi = FakeRhapi()
        teams.save(rhapi, None, "Red", "")
        teams.save(rhapi, None, "Blue", "")
        fn = teams.filter_pilot_data(rhapi)
        payload = {"pilots": [{"pilot_id": 1, "team": "Red", "team_options": "old"},
                              {"pilot_id": 2, "team": "A", "team_options": "old"},
                              {"pilot_id": 3, "team": "", "team_options": "old"}]}
        out = fn(payload)
        opts = out["pilots"][0]["team_options"]
        self.assertEqual(opts, '<option value="">—</option><option value="Blue">Blue</option>'
                               '<option value="Red" selected>Red</option><option value="A">A</option>')
        self.assertIn('<option value="A" selected>A</option>', out["pilots"][1]["team_options"])
        self.assertIn('<option value="" selected>—</option>', out["pilots"][2]["team_options"])

    def test_filter_escapes_and_never_raises(self):
        rhapi = FakeRhapi()
        teams.save(rhapi, None, 'Say "hi" <b>', "")
        fn = teams.filter_pilot_data(rhapi)
        out = fn({"pilots": [{"pilot_id": 1, "team": 'Say "hi" <b>'}]})
        self.assertIn('value="Say &quot;hi&quot; &lt;b&gt;" selected', out["pilots"][0]["team_options"])
        self.assertEqual(fn("not a dict"), "not a dict")
        self.assertEqual(fn({"pilots": []}), {"pilots": []})


class SocketTests(unittest.TestCase):
    def test_registers_the_filter_and_round_trips(self):
        rhapi = FakeRhapi()
        gridfpv.initialize(rhapi, static_dir="/nonexistent", start_loop=False)
        self.assertIn(teams.FILTER_NAME, rhapi.filter_fns)
        rhapi.listeners[gridfpv.EVT_TEAMS_GET]({})
        self.assertEqual(rhapi.sent[-1], (gridfpv.EVT_TEAMS, {"teams": []}))
        rhapi.listeners[gridfpv.EVT_TEAMS_SAVE]({"name": "Red", "description": "d"})
        event, payload = rhapi.ui.socket_broadcast.call_args_list[-1][0]
        self.assertEqual((event, payload["teams"][0]["name"]), (gridfpv.EVT_TEAMS, "Red"))
        rhapi.listeners[gridfpv.EVT_TEAMS_DELETE]({"id": payload["teams"][0]["id"]})
        self.assertEqual(rhapi.ui.socket_broadcast.call_args_list[-1][0][1], {"teams": []})
        rhapi.listeners[gridfpv.EVT_TEAMS_SAVE]({"name": ""})
        rhapi.ui.message_alert.assert_called_once()


if __name__ == "__main__":
    unittest.main()
