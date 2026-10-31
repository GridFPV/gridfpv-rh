"""The overlay's placement (#96): one JSON option every page that draws the overlay reads."""

import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from test_plugin import FakeRhapi  # noqa: E402

from gridfpv import overlay  # noqa: E402

DEFAULT = {"corner": "top-left", "x": 24, "y": 24, "scale": 100}


class OverlayPlacementTests(unittest.TestCase):
    def test_defaults_and_tolerance(self):
        self.assertEqual(overlay.load(FakeRhapi()), DEFAULT)
        self.assertEqual(overlay.load(FakeRhapi(options={overlay.OPT_OVERLAY: "nope"})), DEFAULT)
        stored = json.dumps({"corner": "bottom-right", "x": "40", "y": 30.4, "scale": 150})
        self.assertEqual(
            overlay.load(FakeRhapi(options={overlay.OPT_OVERLAY: stored})),
            {"corner": "bottom-right", "x": 40, "y": 30, "scale": 150},
        )
        # Out-of-range values fall back one by one, not all together.
        stored = json.dumps({"corner": "middle", "x": -5, "y": 9999, "scale": 400})
        self.assertEqual(overlay.load(FakeRhapi(options={overlay.OPT_OVERLAY: stored})), DEFAULT)

    def test_save_writes_the_fields_given_and_refuses_bad_ones(self):
        rhapi = FakeRhapi()
        out = overlay.save(rhapi, {"corner": "top-right", "scale": 150})
        self.assertEqual(out, {"corner": "top-right", "x": 24, "y": 24, "scale": 150})
        self.assertEqual(json.loads(rhapi.options[overlay.OPT_OVERLAY]), out)
        out = overlay.save(rhapi, {"x": 40, "y": "30"})
        self.assertEqual(out, {"corner": "top-right", "x": 40, "y": 30, "scale": 150})
        for bad in ({"corner": "centre"}, {"x": -1}, {"y": "wide"}, {"scale": 10}, {"scale": 301}):
            with self.assertRaises(overlay.OverlayError):
                overlay.save(rhapi, bad)
        # A refused save leaves the record as it was.
        self.assertEqual(overlay.load(rhapi), {"corner": "top-right", "x": 40, "y": 30, "scale": 150})


if __name__ == "__main__":
    unittest.main()
