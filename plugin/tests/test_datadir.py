"""Where the plugin's files land: RotorHazard's data folder (RHAPI's data_dir, else the working
directory RotorHazard has already changed into)."""

import os
import sys
import tempfile
import types
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from gridfpv import datadir, roster  # noqa: E402


class DataDirCase(unittest.TestCase):
    def test_prefers_the_folder_rhapi_names(self):
        with tempfile.TemporaryDirectory() as d:
            rhapi = types.SimpleNamespace(server=types.SimpleNamespace(data_dir=d))
            self.assertEqual(datadir.data_dir(rhapi), d)

    def test_falls_back_to_the_working_directory(self):
        with tempfile.TemporaryDirectory() as d, mock.patch("os.getcwd", return_value=d):
            self.assertEqual(datadir.data_dir(None), d)  # no RHAPI at all
            no_server = types.SimpleNamespace()
            self.assertEqual(datadir.data_dir(no_server), d)
            unset = types.SimpleNamespace(server=types.SimpleNamespace(data_dir=None))
            self.assertEqual(datadir.data_dir(unset), d)  # RotorHazard run from its program folder
            odd = types.SimpleNamespace(server=mock.Mock())  # a mock, not a path
            self.assertEqual(datadir.data_dir(odd), d)
            gone = types.SimpleNamespace(server=types.SimpleNamespace(data_dir=os.path.join(d, "missing")))
            self.assertEqual(datadir.data_dir(gone), d)


class RosterPathCase(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ)
        self.env.start()
        os.environ.pop("GRIDFPV_ROSTER_PATH", None)

    def tearDown(self):
        self.env.stop()

    def test_roster_sits_in_rotorhazards_data_folder(self):
        with tempfile.TemporaryDirectory() as data, tempfile.TemporaryDirectory() as cwd, mock.patch(
            "os.getcwd", return_value=cwd
        ):
            rhapi = types.SimpleNamespace(server=types.SimpleNamespace(data_dir=data))
            self.assertEqual(roster.path(rhapi), os.path.join(data, "gridfpv-data", "roster.json"))
            self.assertEqual(roster.path(None), os.path.join(cwd, "gridfpv-data", "roster.json"))

    def test_a_roster_left_under_the_working_directory_moves_beside_the_database_once(self):
        with tempfile.TemporaryDirectory() as data, tempfile.TemporaryDirectory() as cwd, mock.patch(
            "os.getcwd", return_value=cwd
        ):
            legacy = os.path.join(cwd, "gridfpv-data", "roster.json")
            os.makedirs(os.path.dirname(legacy))
            with open(legacy, "w", encoding="utf-8") as fh:
                fh.write('{"version": 1, "pilots": [{"id": "r1", "callsign": "Ace"}]}')
            rhapi = types.SimpleNamespace(server=types.SimpleNamespace(data_dir=data))
            p = roster.path(rhapi)
            self.assertEqual(p, os.path.join(data, "gridfpv-data", "roster.json"))
            self.assertTrue(os.path.isfile(p))
            self.assertFalse(os.path.exists(legacy))
            self.assertEqual(roster.load(rhapi)[0]["callsign"], "Ace")
            # A second legacy file never overwrites the one now beside the database.
            os.makedirs(os.path.dirname(legacy), exist_ok=True)
            open(legacy, "w").close()
            self.assertEqual(roster.path(rhapi), p)
            self.assertTrue(os.path.isfile(legacy))

    def test_a_failed_move_keeps_using_the_old_place(self):
        with tempfile.TemporaryDirectory() as data, tempfile.TemporaryDirectory() as cwd, mock.patch(
            "os.getcwd", return_value=cwd
        ), mock.patch("shutil.move", side_effect=OSError("read-only")):
            legacy = os.path.join(cwd, "gridfpv-data", "roster.json")
            os.makedirs(os.path.dirname(legacy))
            open(legacy, "w").close()
            rhapi = types.SimpleNamespace(server=types.SimpleNamespace(data_dir=data))
            self.assertEqual(roster.path(rhapi), legacy)


if __name__ == "__main__":
    unittest.main()
