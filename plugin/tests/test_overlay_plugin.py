"""The RaceGOW Overlay plugin: only the overlay routes, 404 for the rest, branding served."""

import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

from flask import Flask

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))  # so `import racegow_overlay` resolves to plugin/racegow_overlay

import racegow_overlay  # noqa: E402


class FakeRhapi:
    API_VERSION_MAJOR = 1
    API_VERSION_MINOR = 4

    def __init__(self):
        self.ui = mock.Mock()
        self.ui.socket_send = None
        self.listeners = {}
        self.ui.socket_listen = mock.Mock(side_effect=lambda n, f: self.listeners.__setitem__(n, f))
        self.blueprints = []
        self.ui.blueprint_add = mock.Mock(side_effect=self.blueprints.append)
        self.server = mock.Mock(info={"release_version": "4.4.0"})
        self.interface = mock.Mock(seats=[1, 2, 3, 4])
        self.db = mock.Mock()
        self.db.option = mock.Mock(side_effect=lambda k, default="": {"eventName": "RaceGOW6"}.get(k, default))


class OverlayPluginTest(unittest.TestCase):
    def setUp(self):
        self.static = tempfile.mkdtemp()
        self.branding = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.static, "assets"))
        with open(os.path.join(self.static, "index.html"), "w") as f:
            f.write("<html>overlay</html>")
        with open(os.path.join(self.static, "assets", "a.js"), "w") as f:
            f.write("1")
        with open(os.path.join(self.branding, "left.png"), "wb") as f:
            f.write(b"png")
        self.rhapi = FakeRhapi()
        racegow_overlay.initialize(self.rhapi, self.static, self.branding)
        app = Flask(__name__)
        (bp,) = self.rhapi.blueprints
        app.register_blueprint(bp)
        self.client = app.test_client()

    def tearDown(self):
        shutil.rmtree(self.static)
        shutil.rmtree(self.branding)

    def test_routes(self):
        self.assertEqual(self.client.get("/grid").status_code, 302)
        self.assertTrue(self.client.get("/grid/").headers["Location"].endswith("/grid/live/race"))
        self.assertEqual(self.client.get("/grid/live/race").status_code, 200)
        self.assertEqual(self.client.get("/grid/live/race/light").data, b"<html>overlay</html>")
        self.assertEqual(self.client.get("/grid/assets/a.js").status_code, 200)
        self.assertEqual(self.client.get("/grid/branding/left.png").data, b"png")
        self.assertEqual(self.client.get("/grid/branding/right.png").status_code, 404)
        self.assertEqual(self.client.get("/grid/run").status_code, 404)
        self.assertEqual(self.client.get("/grid/overlays").status_code, 404)
        # Normalised away or refused: never a file outside static/.
        self.assertNotIn(b"racegow_overlay", self.client.get("/grid/branding/../manifest.json").data)

    def test_streams_panel(self):
        self.rhapi.ui.register_panel.assert_called_once_with(
            "racegow_overlay_streams", "RaceGOW overlay", "streams", order=0, open=True
        )
        (panel, _name, md) = self.rhapi.ui.register_markdown.call_args.args
        self.assertEqual(panel, "racegow_overlay_streams")
        self.assertIn("](/grid/live/race)", md)

    def test_socket(self):
        self.rhapi.listeners["gridfpv_hello"]()
        ack = self.rhapi.ui.socket_broadcast.call_args_list[-1].args
        self.assertEqual(ack[0], "gridfpv_hello_ack")
        self.assertTrue(ack[1]["overlay_only"])
        self.assertEqual(ack[1]["seat_count"], 4)
        self.rhapi.listeners["gridfpv_event_get"]()
        ev = self.rhapi.ui.socket_broadcast.call_args_list[-1].args
        self.assertEqual(ev, ("gridfpv_event", {"name": "RaceGOW6", "description": ""}))


if __name__ == "__main__":
    unittest.main()
