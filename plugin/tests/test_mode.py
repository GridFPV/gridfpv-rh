"""The plugin's mode (#95): one option for the whole timer, validated, broadcast."""

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from test_plugin import FakeRhapi  # noqa: E402

import gridfpv  # noqa: E402
from gridfpv import mode  # noqa: E402


class ModeTests(unittest.TestCase):
    def test_defaults_to_full_and_tolerates_junk(self):
        self.assertEqual(mode.current(FakeRhapi()), "full")
        self.assertEqual(mode.current(FakeRhapi(options={mode.OPT_MODE: "RaceGOW "})), "racegow")
        self.assertEqual(mode.current(FakeRhapi(options={mode.OPT_MODE: "turbo"})), "full")
        self.assertEqual(mode.load(FakeRhapi())["modes"], ["full", "simple", "racegow"])

    def test_save_validates(self):
        rhapi = FakeRhapi()
        self.assertEqual(mode.save(rhapi, {"mode": "simple"})["mode"], "simple")
        self.assertEqual(rhapi.options[mode.OPT_MODE], "simple")
        with self.assertRaises(mode.ModeError):
            mode.save(rhapi, {"mode": "turbo"})
        with self.assertRaises(mode.ModeError):
            mode.save(rhapi, {})
        self.assertEqual(rhapi.options[mode.OPT_MODE], "simple")

    def test_socket_round_trip_and_hello(self):
        rhapi = FakeRhapi()
        gridfpv.initialize(rhapi, static_dir="/nonexistent", start_loop=False)
        rhapi.listeners[gridfpv.EVT_HELLO]({})
        self.assertEqual(rhapi.sent[-1][0], gridfpv.EVT_HELLO_ACK)
        self.assertEqual(rhapi.sent[-1][1]["mode"], "full")
        rhapi.listeners[gridfpv.EVT_MODE_GET]({})
        self.assertEqual(rhapi.sent[-1], (gridfpv.EVT_MODE, {"mode": "full", "modes": ["full", "simple", "racegow"]}))
        rhapi.listeners[gridfpv.EVT_MODE_SET]({"mode": "racegow"})
        ev, payload = rhapi.ui.socket_broadcast.call_args_list[-1][0]
        self.assertEqual((ev, payload["mode"]), (gridfpv.EVT_MODE, "racegow"))
        rhapi.listeners[gridfpv.EVT_HELLO]({})
        self.assertEqual(rhapi.sent[-1][1]["mode"], "racegow")
        rhapi.listeners[gridfpv.EVT_MODE_SET]({"mode": "turbo"})
        rhapi.ui.message_alert.assert_called_once()
        self.assertEqual(mode.current(rhapi), "racegow")


if __name__ == "__main__":
    unittest.main()
