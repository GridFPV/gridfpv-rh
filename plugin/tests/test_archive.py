"""Named archives (#43): file-name safety and the verified copy."""

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
from gridfpv import archive  # noqa: E402


class SafeNameTests(unittest.TestCase):
    def test_slashes_and_friends_become_dashes(self):
        self.assertEqual(archive.safe_name("Club Night 10/27"), "Club Night 10-27")
        self.assertEqual(archive.safe_name('With "quotes" <b>&</b>'), "With -quotes- -b-&-b")  # trailing dash goes
        self.assertEqual(archive.safe_name("a\\b:c*d?e|f"), "a-b-c-d-e-f")
        self.assertEqual(archive.safe_name("  ..  "), "event")
        self.assertEqual(archive.safe_name(""), "event")
        self.assertEqual(len(archive.safe_name("x" * 200)), 80)


class ArchiveTests(unittest.TestCase):
    def rhapi_with(self, backup):
        rhapi = FakeRhapi()
        rhapi._racecontext = types.SimpleNamespace(rhdata=types.SimpleNamespace(backup_db_file=backup))
        return rhapi

    def test_returns_the_file_rotorhazard_made(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "Club Night 10-27.db")
            open(path, "w").close()
            backup = mock.Mock(return_value=path)
            self.assertEqual(archive.archive(self.rhapi_with(backup), "Club Night 10/27"), "Club Night 10-27.db")
            backup.assert_called_once_with(True, use_filename="Club Night 10-27")

    def test_refuses_when_no_file_landed(self):
        with self.assertRaises(archive.ArchiveError):
            archive.archive(self.rhapi_with(mock.Mock(return_value=None)), "x")
        with self.assertRaises(archive.ArchiveError):
            archive.archive(self.rhapi_with(mock.Mock(return_value="/nonexistent/x.db")), "x")
        with self.assertRaises(archive.ArchiveError):
            archive.archive(self.rhapi_with(mock.Mock(side_effect=OSError("disk"))), "x")


class SocketTests(unittest.TestCase):
    def test_archive_event_answers_with_the_file_or_an_alert(self):
        rhapi = FakeRhapi()
        gridfpv.initialize(rhapi, static_dir="/nonexistent", start_loop=False)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "Night.db")
            open(path, "w").close()
            rhapi._racecontext = types.SimpleNamespace(rhdata=types.SimpleNamespace(backup_db_file=mock.Mock(return_value=path)))
            rhapi.listeners[gridfpv.EVT_ARCHIVE]({"name": "Night"})
            self.assertEqual(rhapi.sent[-1], (gridfpv.EVT_ARCHIVED, {"ok": True, "file": "Night.db", "name": "Night"}))
        rhapi._racecontext = types.SimpleNamespace(rhdata=types.SimpleNamespace(backup_db_file=mock.Mock(return_value=None)))
        rhapi.listeners[gridfpv.EVT_ARCHIVE]({"name": "Night"})
        self.assertEqual(rhapi.sent[-1][1]["ok"], False)
        rhapi.ui.message_alert.assert_called_once()


if __name__ == "__main__":
    unittest.main()
