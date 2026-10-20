"""The admin gate: public paths stay open, admin paths need RotorHazard's login."""

import base64
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from test_plugin import FakeRhapi, _app_with_plugin, _get  # noqa: E402

from gridfpv import auth  # noqa: E402


def _basic(user, pw):
    token = base64.b64encode(f"{user}:{pw}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


class AuthTests(unittest.TestCase):
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

    def test_is_public_rules(self):
        self.assertTrue(auth.is_public(""))
        self.assertTrue(auth.is_public("live"))
        self.assertTrue(auth.is_public("live/race"))
        self.assertTrue(auth.is_public("assets/index-abc.js"))
        self.assertTrue(auth.is_public("favicon.svg"))
        self.assertFalse(auth.is_public("seats"))
        self.assertFalse(auth.is_public("seats/3"))
        self.assertFalse(auth.is_public("liveish"))

    def test_admin_path_challenges_then_accepts_rh_credentials(self):
        rhapi = FakeRhapi(secrets={"ADMIN_USERNAME": "admin", "ADMIN_PASSWORD": "rotorhazard"})
        client = _app_with_plugin(rhapi, self.static).test_client()
        resp = client.get("/grid/seats")
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.headers["WWW-Authenticate"], 'Basic realm="Login Required"')
        resp.close()
        resp = client.get("/grid/seats", headers=_basic("admin", "wrong"))
        self.assertEqual(resp.status_code, 401)
        resp.close()
        status, body = _get(client, "/grid/seats", headers=_basic("admin", "rotorhazard"))
        self.assertEqual(status, 200)
        self.assertIn(b"grid spa", body)

    def test_public_paths_need_no_login(self):
        rhapi = FakeRhapi(secrets={"ADMIN_USERNAME": "admin", "ADMIN_PASSWORD": "rotorhazard"})
        client = _app_with_plugin(rhapi, self.static).test_client()
        for path in ("/grid", "/grid/", "/grid/live/race", "/grid/assets/app.js", "/grid/favicon.svg"):
            status, _ = _get(client, path)
            self.assertIn(status, (200, 404), path)  # favicon is absent from the fixture
            self.assertNotEqual(status, 401, path)

    def test_blank_admin_credentials_open_everything_like_rotorhazard(self):
        rhapi = FakeRhapi(secrets={"ADMIN_USERNAME": "", "ADMIN_PASSWORD": ""})
        client = _app_with_plugin(rhapi, self.static).test_client()
        self.assertEqual(_get(client, "/grid/seats")[0], 200)


if __name__ == "__main__":
    unittest.main()
