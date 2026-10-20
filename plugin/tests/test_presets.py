"""Custom presets: validation, storage as a RotorHazard option, and the socket wiring."""

import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from test_plugin import FakeRhapi  # noqa: E402

import gridfpv  # noqa: E402
from gridfpv import presets  # noqa: E402

R1 = {"band": "R", "channel": 1, "frequency": 5658}
OFF = {"band": None, "channel": None, "frequency": 0}


class PresetStoreTests(unittest.TestCase):
    def test_round_trips_through_the_option_as_json(self):
        rhapi = FakeRhapi()
        self.assertEqual(presets.load(rhapi), [])
        out = presets.save(rhapi, "Club night", [R1, {"frequency": 5700}, OFF])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["name"], "Club night")
        self.assertEqual(out[0]["seats"][1], {"band": None, "channel": None, "frequency": 5700})
        self.assertEqual(json.loads(rhapi.options[presets.OPT_PRESETS]), out)
        self.assertEqual(presets.load(rhapi), out)

    def test_same_name_replaces_and_the_list_stays_sorted(self):
        rhapi = FakeRhapi()
        presets.save(rhapi, "Zulu", [R1])
        presets.save(rhapi, "alpha", [R1])
        out = presets.save(rhapi, "zulu", [{"frequency": 5917}])
        self.assertEqual([p["name"] for p in out], ["alpha", "zulu"])
        self.assertEqual(out[1]["seats"][0]["frequency"], 5917)

    def test_delete(self):
        rhapi = FakeRhapi()
        (p,) = presets.save(rhapi, "One", [R1])
        self.assertEqual(presets.delete(rhapi, p["id"]), [])
        with self.assertRaises(presets.PresetError):
            presets.delete(rhapi, "nope")

    def test_refuses_bad_input_with_a_readable_reason(self):
        rhapi = FakeRhapi()
        for name, seats in [("", [R1]), ("x" * 41, [R1]), ("ok", []), ("ok", [OFF]),
                            ("ok", [{"frequency": 4000}]), ("ok", [{"frequency": "abc"}]),
                            ("ok", [{"band": "r1!", "frequency": 5658}])]:
            with self.assertRaises(presets.PresetError, msg=(name, seats)):
                presets.save(rhapi, name, seats)

    def test_garbage_in_the_option_is_ignored_not_fatal(self):
        rhapi = FakeRhapi(options={presets.OPT_PRESETS: "not json"})
        self.assertEqual(presets.load(rhapi), [])
        rhapi = FakeRhapi(options={presets.OPT_PRESETS: json.dumps([{"junk": 1}, {"id": "a", "name": "A", "seats": [R1]}])})
        self.assertEqual([p["id"] for p in presets.load(rhapi)], ["a"])


class SocketTests(unittest.TestCase):
    def test_get_save_delete_round_trip(self):
        rhapi = FakeRhapi()
        gridfpv.initialize(rhapi, static_dir="/nonexistent", start_loop=False)
        rhapi.listeners[gridfpv.EVT_PRESETS_GET]({})
        self.assertEqual(rhapi.sent[-1], (gridfpv.EVT_PRESETS, {"presets": []}))
        rhapi.listeners[gridfpv.EVT_PRESETS_SAVE]({"name": "Club", "seats": [R1, OFF]})
        event, payload = rhapi.ui.socket_broadcast.call_args_list[-1][0]
        self.assertEqual(event, gridfpv.EVT_PRESETS)
        self.assertEqual(payload["presets"][0]["name"], "Club")
        rhapi.listeners[gridfpv.EVT_PRESETS_DELETE]({"id": payload["presets"][0]["id"]})
        event, payload = rhapi.ui.socket_broadcast.call_args_list[-1][0]
        self.assertEqual(payload, {"presets": []})

    def test_bad_save_alerts_instead_of_raising(self):
        rhapi = FakeRhapi()
        gridfpv.initialize(rhapi, static_dir="/nonexistent", start_loop=False)
        rhapi.listeners[gridfpv.EVT_PRESETS_SAVE]({"name": "", "seats": [R1]})
        rhapi.ui.message_alert.assert_called_once()


if __name__ == "__main__":
    unittest.main()
