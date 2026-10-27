"""Saved-race delete and restore (#36): the fallback path against a fake RotorHazard data
layer, the native path against a fake RHAPI 1.12, and the socket round trip."""

import json
import os
import sys
import types
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from test_plugin import FakeRhapi  # noqa: E402

import gridfpv  # noqa: E402
from gridfpv import races  # noqa: E402


class Row:
    """A SQLAlchemy-ish row: attributes from kwargs."""

    def __init__(self, **kw):
        self.__dict__.update(kw)


class FakeQuery:
    """`Model.query.filter_by(...)` over a list of rows, with .all/.first/.one/.delete/.order_by."""

    def __init__(self, rows, fail_on_delete=False):
        self._rows = rows
        self._pred = {}
        self._fail = fail_on_delete

    def filter_by(self, **kw):
        q = FakeQuery(self._rows, self._fail)
        q._pred = kw
        return q

    def _match(self):
        return [r for r in self._rows if all(getattr(r, k, None) == v for k, v in self._pred.items())]

    def order_by(self, *_a):
        return self

    def all(self):
        return self._match()

    def first(self):
        m = self._match()
        return m[0] if m else None

    def one(self):
        m = self._match()
        if len(m) != 1:
            raise LookupError("no row")
        return m[0]

    def delete(self):
        if self._fail:
            raise RuntimeError("disk on fire")
        n = len(self._match())
        self._rows[:] = [r for r in self._rows if r not in self._match()]
        return n


class FakeDatabase(types.ModuleType):
    """Stands in for RotorHazard's Database module: models with .query over shared lists."""

    def __init__(self, fail_on_delete=False):
        super().__init__("Database")
        self.metas, self.attrs, self.pilotraces, self.laps = [], [], [], []
        self._ids = {"meta": 100, "pr": 500, "lap": 900}
        db = self

        def model(name, rows):
            cls = type(name, (Row,), {})
            cls.query = FakeQuery(rows, fail_on_delete)
            return cls

        self.SavedRaceMeta = model("SavedRaceMeta", self.metas)
        self.SavedRaceMetaAttribute = model("SavedRaceMetaAttribute", self.attrs)
        self.SavedPilotRace = model("SavedPilotRace", self.pilotraces)
        self.SavedRaceLap = model("SavedRaceLap", self.laps)

        class Session:
            def delete(self_, row):
                for lst in (db.metas, db.attrs, db.pilotraces, db.laps):
                    if row in lst:
                        lst.remove(row)

            def add(self_, row):
                if isinstance(row, db.SavedRaceMetaAttribute):
                    db.attrs.append(row)
                elif isinstance(row, db.SavedPilotRace):
                    db.pilotraces.append(row)
                elif isinstance(row, db.SavedRaceLap):
                    db.laps.append(row)
                else:
                    db.metas.append(row)

            def flush(self_):
                pass

            def refresh(self_, row):
                pass

        self.DB_session = Session()


class FakeRhData:
    def __init__(self, db: FakeDatabase, commit_ok=True):
        self.db = db
        self.commit_ok = commit_ok
        self.commits = self.rollbacks = 0
        self.cleared = 0
        self.backups = 0

    def get_savedRaceMeta_by_heat_round(self, heat_id, round_id):
        return self.db.SavedRaceMeta.query.filter_by(heat_id=heat_id, round_id=round_id).one()

    def get_savedrace_attributes(self, race):
        return self.db.SavedRaceMetaAttribute.query.filter_by(id=race.id).all()

    def get_savedPilotRaces_by_savedRaceMeta(self, race_id):
        return self.db.SavedPilotRace.query.filter_by(race_id=race_id).all()

    def add_savedRaceMeta(self, data):
        self.db._ids["meta"] += 1
        row = self.db.SavedRaceMeta(id=self.db._ids["meta"], **data)
        self.db.metas.append(row)
        return row

    def add_race_data(self, data):
        for node_index, d in data.items():
            self.db._ids["pr"] += 1
            pr = self.db.SavedPilotRace(
                id=self.db._ids["pr"], race_id=d["race_id"], node_index=node_index, pilot_id=d["pilot_id"],
                history_values=d.get("history_values"), history_times=d.get("history_times"), penalty_time=0,
                penalty_desc=None, enter_at=d["enter_at"], exit_at=d["exit_at"], frequency=d.get("frequency"),
                marshal_type=d.get("marshal_type"))
            self.db.pilotraces.append(pr)
            for lap in d["laps"]:
                self.db._ids["lap"] += 1
                self.db.laps.append(self.db.SavedRaceLap(
                    id=self.db._ids["lap"], race_id=d["race_id"], pilotrace_id=pr.id, node_index=node_index,
                    pilot_id=d["pilot_id"], lap_time_stamp=lap.lap_time_stamp, lap_time=lap.lap_time,
                    lap_time_formatted=lap.lap_time_formatted, source=lap.source, deleted=lap.deleted,
                    peak_rssi=lap.peak_rssi))
        return True

    def commit(self):
        self.commits += 1
        return self.commit_ok

    def rollback(self):
        self.rollbacks += 1
        return True

    def clear_results_all(self):
        self.cleared += 1

    def backup_db_file(self, copy_flag):
        self.backups += 1
        return "/opt/RotorHazard/src/server/database/backup/database_20261027_031500.db"


def seed_race(db: FakeDatabase, heat_id=7, round_id=2, race_id=42):
    db.metas.append(db.SavedRaceMeta(id=race_id, round_id=round_id, heat_id=heat_id, class_id=3, format_id=1,
                                     start_time=1000, start_time_formatted="03:14"))
    db.attrs.append(db.SavedRaceMetaAttribute(id=race_id, name="note", value="x"))
    for node, pilot in ((1, 11), (2, 12)):
        pr = db.SavedPilotRace(id=500 + node, race_id=race_id, node_index=node, pilot_id=pilot, history_values="[]",
                               history_times="[]", penalty_time=0, penalty_desc=None, enter_at=50, exit_at=40,
                               frequency=5800, marshal_type=None)
        db.pilotraces.append(pr)
        for i in range(3):
            db.laps.append(db.SavedRaceLap(id=900 + node * 10 + i, race_id=race_id, pilotrace_id=pr.id, node_index=node,
                                           pilot_id=pilot, lap_time_stamp=1000 * (i + 1), lap_time=1000.0,
                                           lap_time_formatted="0:01.000", source=0, deleted=False, peak_rssi=90))


def fallback_rhapi(db: FakeDatabase, rhdata: FakeRhData, status=0):
    rhapi = FakeRhapi()  # RHAPI 1.4: fallback
    rhapi._racecontext = types.SimpleNamespace(rhdata=rhdata, pagecache=mock.Mock(), rhui=mock.Mock())
    rhapi.race = types.SimpleNamespace(status=status)
    rhapi.db.pilot_by_id = mock.Mock(side_effect=lambda pid: Row(id=pid, callsign=f"P{pid}"))
    rhapi.db.heat_by_id = mock.Mock(side_effect=lambda hid: Row(id=hid) if hid == 7 else None)
    return rhapi


class FallbackTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        seed_race(self.db)
        self.rhdata = FakeRhData(self.db)
        self.rhapi = fallback_rhapi(self.db, self.rhdata)
        self._patch = mock.patch.dict(sys.modules, {"Database": self.db})
        self._patch.start()

    def tearDown(self):
        self._patch.stop()

    def test_not_native_on_rhapi_1_4(self):
        self.assertFalse(races.is_native(self.rhapi))

    def test_delete_keeps_a_copy_removes_every_row_and_backs_up_first(self):
        out = races.delete(self.rhapi, 7, 2)
        self.assertEqual(out["backup"], "database_20261027_031500.db")
        self.assertEqual(self.rhdata.backups, 1)
        self.assertEqual((self.db.metas, self.db.attrs, self.db.pilotraces, self.db.laps), ([], [], [], []))
        kept = json.loads(self.rhapi.options[races.OPT_DELETED])
        self.assertEqual(len(kept), 1)
        snap = kept[0]
        self.assertEqual(snap["race"], {"round_id": 2, "heat_id": 7, "class_id": 3, "format_id": 1,
                                        "start_time": 1000, "start_time_formatted": "03:14"})
        self.assertEqual([p["node_index"] for p in snap["pilotraces"]], [1, 2])
        self.assertEqual(len(snap["pilotraces"][0]["laps"]), 3)
        self.assertEqual(snap["attributes"], [{"name": "note", "value": "x"}])
        self.assertEqual(snap["callsigns"], ["P11", "P12"])
        self.assertEqual(self.rhdata.cleared, 1)
        self.rhapi._racecontext.pagecache.set_valid.assert_called_with(False)
        listed = races.load(self.rhapi)
        self.assertEqual((listed[0]["heat_id"], listed[0]["round_id"], listed[0]["callsigns"]), (7, 2, ["P11", "P12"]))

    def test_refuses_while_a_race_is_on_the_timer_or_when_there_is_no_such_round(self):
        self.rhapi.race.status = 1
        with self.assertRaises(races.RaceError):
            races.delete(self.rhapi, 7, 2)
        self.rhapi.race.status = 0
        with self.assertRaises(races.RaceError):
            races.delete(self.rhapi, 7, 9)
        self.assertEqual(len(self.db.metas), 1)
        self.assertEqual(self.rhdata.backups, 0)

    def test_a_failing_delete_rolls_back_and_drops_the_copy(self):
        db = FakeDatabase(fail_on_delete=True)
        seed_race(db)
        rhdata = FakeRhData(db)
        rhapi = fallback_rhapi(db, rhdata)
        with mock.patch.dict(sys.modules, {"Database": db}):
            with self.assertRaises(races.RaceError):
                races.delete(rhapi, 7, 2)
        self.assertEqual(rhdata.rollbacks, 1)
        self.assertEqual(len(db.metas), 1)
        # The race still exists, so no copy is listed (the board would offer a restore that must fail).
        self.assertEqual(json.loads(rhapi.options[races.OPT_DELETED]), [])

    def test_a_copy_that_did_not_store_stops_the_delete(self):
        self.rhapi.db.option_set = mock.Mock()  # writes vanish
        with self.assertRaises(races.RaceError):
            races.delete(self.rhapi, 7, 2)
        self.assertEqual(len(self.db.metas), 1)

    def test_restore_puts_the_race_back_and_drops_the_copy(self):
        races.delete(self.rhapi, 7, 2)
        deleted_id = races.load(self.rhapi)[0]["id"]
        out = races.restore(self.rhapi, deleted_id)
        self.assertEqual(out, {"heat_id": 7, "round_id": 2})
        self.assertEqual(len(self.db.metas), 1)
        meta = self.db.metas[0]
        self.assertEqual((meta.heat_id, meta.round_id, meta.start_time_formatted), (7, 2, "03:14"))
        self.assertEqual(sorted(pr.node_index for pr in self.db.pilotraces), [1, 2])
        self.assertEqual(len(self.db.laps), 6)
        self.assertTrue(all(lap.race_id == meta.id for lap in self.db.laps))
        self.assertEqual([a.name for a in self.db.attrs], ["note"])
        self.assertEqual(races.load(self.rhapi), [])
        self.assertEqual(self.rhdata.cleared, 2)

    def test_restore_refuses_a_reraced_round_or_a_missing_heat(self):
        races.delete(self.rhapi, 7, 2)
        deleted_id = races.load(self.rhapi)[0]["id"]
        self.db.metas.append(self.db.SavedRaceMeta(id=77, round_id=2, heat_id=7, class_id=3, format_id=1,
                                                   start_time=2000, start_time_formatted="03:20"))
        with self.assertRaises(races.RaceError):
            races.restore(self.rhapi, deleted_id)
        self.db.metas.clear()
        self.rhapi.db.heat_by_id = mock.Mock(return_value=None)
        with self.assertRaises(races.RaceError):
            races.restore(self.rhapi, deleted_id)
        self.assertEqual(len(races.load(self.rhapi)), 1)  # the copy survives both refusals
        with self.assertRaises(races.RaceError):
            races.restore(self.rhapi, "nope")

    def test_forget_drops_a_copy(self):
        races.delete(self.rhapi, 7, 2)
        races.forget(self.rhapi, races.load(self.rhapi)[0]["id"])
        self.assertEqual(races.load(self.rhapi), [])


class NativeTests(unittest.TestCase):
    def make(self):
        rhapi = FakeRhapi()
        rhapi.API_VERSION_MINOR = 12
        rhapi.race = types.SimpleNamespace(status=0)
        rhdata = mock.Mock()
        race = Row(id=42, heat_id=7, round_id=2)
        rhdata.get_savedRaceMeta_by_heat_round = mock.Mock(return_value=race)
        rhdata.backup_db_file = mock.Mock(return_value="db/backup/x_1.db")
        rhapi._racecontext = types.SimpleNamespace(rhdata=rhdata, pagecache=mock.Mock(), rhui=mock.Mock())
        deleted = Row(id=5, race_id=42, heat_id=7, round_id=2, class_id=3, start_time_formatted="03:14",
                      deleted_time_formatted="03:15")
        rhapi.db.race_delete = mock.Mock(return_value=True)
        rhapi.db.deleted_races = [deleted]
        rhapi.db.deleted_race_data = mock.Mock(return_value={"pilotraces": [{"pilot_id": 11}]})
        rhapi.db.deleted_race_by_id = mock.Mock(side_effect=lambda i: deleted if i == 5 else None)
        rhapi.db.deleted_race_conflicts = mock.Mock(return_value=[])
        rhapi.db.race_restore = mock.Mock(return_value=Row(id=43))
        rhapi.db.pilot_by_id = mock.Mock(return_value=Row(id=11, callsign="Ace"))
        return rhapi, race

    def test_uses_rotorhazards_own_delete_and_restore(self):
        rhapi, race = self.make()
        self.assertTrue(races.is_native(rhapi))
        out = races.delete(rhapi, 7, 2)
        rhapi.db.race_delete.assert_called_once_with(race, keep_copy=True)
        self.assertEqual(out["backup"], "x_1.db")
        self.assertNotIn(races.OPT_DELETED, rhapi.options)
        listed = races.load(rhapi)
        self.assertEqual(listed, [{"id": "5", "heat_id": 7, "round_id": 2, "class_id": 3, "start_time_formatted": "03:14",
                                   "deleted_at": "03:15", "callsigns": ["Ace"]}])
        self.assertEqual(races.restore(rhapi, "5"), {"heat_id": 7, "round_id": 2})
        rhapi.db.race_restore.assert_called_once()

    def test_native_refusals_surface_as_errors(self):
        rhapi, _ = self.make()
        rhapi.db.deleted_race_conflicts = mock.Mock(return_value=["round 2 exists"])
        with self.assertRaises(races.RaceError):
            races.restore(rhapi, 5)
        rhapi.db.race_delete = mock.Mock(return_value=False)
        with self.assertRaises(races.RaceError):
            races.delete(rhapi, 7, 2)


class SocketTests(unittest.TestCase):
    def test_round_trip_over_the_plugin_events(self):
        db = FakeDatabase()
        seed_race(db)
        rhdata = FakeRhData(db)
        rhapi = fallback_rhapi(db, rhdata)
        gridfpv.initialize(rhapi, static_dir="/nonexistent", start_loop=False)
        with mock.patch.dict(sys.modules, {"Database": db}):
            rhapi.listeners[gridfpv.EVT_RACES_DELETED_GET]({})
            self.assertEqual(rhapi.sent[-1], (gridfpv.EVT_RACES_DELETED, {"races": [], "native": False}))
            rhapi.listeners[gridfpv.EVT_RACE_DELETE]({"heat_id": 7, "round_id": 2})
            event, payload = rhapi.ui.socket_broadcast.call_args_list[-1][0]
            self.assertEqual(event, gridfpv.EVT_RACES_DELETED)
            self.assertEqual(payload["changed"], {"heat_id": 7, "round_id": 2, "action": "deleted"})
            self.assertEqual(payload["backup"], "database_20261027_031500.db")
            self.assertEqual(len(payload["races"]), 1)
            rhapi.listeners[gridfpv.EVT_RACE_DELETE]({"heat_id": 7, "round_id": 2})  # gone already
            rhapi.ui.message_alert.assert_called_once()
            rhapi.listeners[gridfpv.EVT_RACE_RESTORE]({"id": payload["races"][0]["id"]})
            _, payload = rhapi.ui.socket_broadcast.call_args_list[-1][0]
            self.assertEqual((payload["races"], payload["changed"]["action"]), ([], "restored"))
            self.assertEqual(len(db.metas), 1)


if __name__ == "__main__":
    unittest.main()
