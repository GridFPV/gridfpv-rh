"""Unit tests for the plugin's Python side, run outside RotorHazard.

RotorHazard-only modules (``RHUI``) are stubbed into ``sys.modules`` so the plugin imports;
``rhapi`` is a small fake that records what the plugin registers. Flask is real.
"""

import os
import sys
import tempfile
import types
import unittest
from dataclasses import dataclass
from enum import Enum
from typing import Any
from unittest import mock

from flask import Flask

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))  # so `import gridfpv` resolves to plugin/gridfpv


def _install_rh_stubs():
    class UIFieldType(Enum):
        TEXT = "text"
        CHECKBOX = "checkbox"

    @dataclass
    class UIField:
        name: str
        label: str
        field_type: Any = UIFieldType.TEXT
        value: Any = None
        desc: str = None

    rhui = types.ModuleType("RHUI")
    rhui.UIField = UIField
    rhui.UIFieldType = UIFieldType
    sys.modules["RHUI"] = rhui


_install_rh_stubs()

import gridfpv  # noqa: E402  (after the stubs)


class FakeRhapi:
    API_VERSION_MAJOR = 1
    API_VERSION_MINOR = 4

    def __init__(self, options=None, seats=4, secrets=None):
        self.options = dict(options or {})
        self.secrets = dict(secrets or {"ADMIN_USERNAME": "", "ADMIN_PASSWORD": ""})
        self.config = mock.Mock()
        self.config.get = mock.Mock(side_effect=lambda section, name, as_int=False: self.secrets.get(name) if section == "SECRETS" else None)
        self.panels = []
        self.fields = mock.Mock()
        self.fields.register_option = mock.Mock(side_effect=self._register_option)
        self.registered_options = []
        self.ui = mock.Mock()
        self.ui.register_panel = mock.Mock(side_effect=lambda *a, **k: self.panels.append(a))
        self.listeners = {}
        self.ui.socket_listen = mock.Mock(side_effect=lambda ev, fn: self.listeners.__setitem__(ev, fn))
        self.sent = []
        self.ui.socket_send = mock.Mock(side_effect=lambda ev, data: self.sent.append((ev, data)))
        self.ui.socket_broadcast = mock.Mock()
        self.blueprints = []
        self.ui.blueprint_add = mock.Mock(side_effect=self.blueprints.append)
        self.db = mock.Mock()
        self.db.option = mock.Mock(side_effect=lambda name, default=False, as_int=False: self.options.get(name, default))
        self.db.option_set = mock.Mock(side_effect=lambda name, value: self.options.__setitem__(name, value))
        # Pilots as RHAPI hands them back: objects with id / callsign / team.
        self.pilot_list = []
        type(self.db).pilots = property(lambda db_self: self.pilot_list)
        self.db.pilot_alter = mock.Mock(side_effect=self._pilot_alter)
        self.filters = mock.Mock()
        self.filter_fns = {}
        self.filters.add = mock.Mock(side_effect=lambda hook, name, fn, **kw: self.filter_fns.__setitem__(name, fn))
        self.server = mock.Mock()
        self.server.info = {"release_version": "4.4.0"}
        self.interface = mock.Mock()
        self.interface.seats = [object()] * seats

    def _register_option(self, field, panel=None, order=0):
        self.registered_options.append((field, panel))

    def _pilot_alter(self, pilot_id, **fields):
        for p in self.pilot_list:
            if p.id == pilot_id:
                for k, v in fields.items():
                    if v is not None:
                        setattr(p, k, v)


def _get(client, path, headers=None):
    """GET and return (status, body), closing the response so file handles don't leak."""
    resp = client.get(path, headers=headers)
    try:
        return resp.status_code, resp.data
    finally:
        resp.close()


def _app_with_plugin(rhapi, static_dir):
    app = Flask("rh-test")
    gridfpv.initialize(rhapi, static_dir=static_dir, start_loop=False)
    (bp,) = rhapi.blueprints
    app.register_blueprint(bp)

    @app.route("/")
    def home():
        return "rh home"

    @app.route("/first-run")
    def first_run():
        return "first run"

    return app


class PluginTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.static = self.tmp.name
        with open(os.path.join(self.static, "index.html"), "w") as f:
            f.write("<html><body>grid spa</body></html>")
        os.makedirs(os.path.join(self.static, "assets"))
        with open(os.path.join(self.static, "assets", "app.js"), "w") as f:
            f.write("console.log('grid')")

    def tearDown(self):
        self.tmp.cleanup()

    def test_registers_panel_option_blueprint_and_handshake(self):
        rhapi = FakeRhapi()
        gridfpv.initialize(rhapi, static_dir=self.static, start_loop=False)
        self.assertEqual(rhapi.panels[0][:3], (gridfpv.PANEL, "GridFPV", "settings"))
        self.assertEqual(rhapi.panels[1][:3], (gridfpv.STREAMS_PANEL, "GridFPV overlays", "streams"))
        attr = rhapi.fields.register_raceclass_attribute.call_args.args[0]
        self.assertEqual(attr.name, gridfpv.CLASS_ATTR_STAGE)
        self.assertEqual(rhapi.fields.register_pilot_attribute.call_args.args[0].name, "gridfpv_roster_id")
        (field, panel), = rhapi.registered_options
        self.assertEqual((field.name, panel), (gridfpv.OPT_REDIRECT_HOME, gridfpv.PANEL))
        self.assertEqual(len(rhapi.blueprints), 1)
        self.assertIn(gridfpv.EVT_HELLO, rhapi.listeners)

    def test_hello_answers_with_versions_and_seat_count(self):
        rhapi = FakeRhapi(options={gridfpv.OPT_REDIRECT_HOME: "1"}, seats=8)
        gridfpv.initialize(rhapi, static_dir=self.static, start_loop=False)
        rhapi.listeners[gridfpv.EVT_HELLO]({"client": "test"})
        ((event, payload),) = rhapi.sent
        self.assertEqual(event, gridfpv.EVT_HELLO_ACK)
        self.assertEqual(payload["rhapi_version"], "1.4")
        self.assertEqual(payload["rh_version"], "4.4.0")
        self.assertEqual(payload["seat_count"], 8)
        self.assertEqual(payload["plugin_version"], gridfpv.PLUGIN_VERSION)
        self.assertTrue(payload["redirect_home"])
        self.assertIsNone(payload["capture"])

    def test_spa_routes_serve_index_and_assets(self):
        client = _app_with_plugin(FakeRhapi(), self.static).test_client()
        self.assertIn(b"grid spa", _get(client, "/grid")[1])
        self.assertIn(b"grid spa", _get(client, "/grid/")[1])
        self.assertIn(b"grid spa", _get(client, "/grid/tuning/seat/3")[1])  # client-side route
        self.assertIn(b"console.log", _get(client, "/grid/assets/app.js")[1])

    def test_asset_path_cannot_escape_static_dir(self):
        client = _app_with_plugin(FakeRhapi(), self.static).test_client()
        _status, body = _get(client, "/grid/../manifest.json")
        # Either normalised away to the SPA shell or refused — never the parent dir's file.
        self.assertNotIn(b"required_rhapi_version", body)

    def test_unbuilt_ui_reports_503_with_instructions(self):
        empty = tempfile.mkdtemp()
        client = _app_with_plugin(FakeRhapi(), empty).test_client()
        status, body = _get(client, "/grid")
        self.assertEqual(status, 503)
        self.assertIn(b"make build", body)

    def test_home_redirect_follows_the_option(self):
        rhapi = FakeRhapi()
        client = _app_with_plugin(rhapi, self.static).test_client()
        self.assertEqual(_get(client, "/")[1], b"rh home")
        rhapi.options[gridfpv.OPT_REDIRECT_HOME] = "1"
        resp = client.get("/")
        self.assertEqual(resp.status_code, 302)
        self.assertTrue(resp.headers["Location"].endswith("/grid"))
        resp.close()
        # RH's own pages are untouched either way.
        self.assertEqual(_get(client, "/first-run")[1], b"first run")
        self.assertIn(b"grid spa", _get(client, "/grid")[1])

    def test_truthy_matches_rh_checkbox_storage(self):
        self.assertTrue(gridfpv._truthy("1"))
        self.assertFalse(gridfpv._truthy("0"))
        self.assertFalse(gridfpv._truthy(None))
        self.assertTrue(gridfpv._truthy(True))


if __name__ == "__main__":
    unittest.main()
