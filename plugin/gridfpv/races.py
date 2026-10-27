"""Saved-race delete and restore for the Stages board (#36): a round is one saved race.

RotorHazard main (RHAPI 1.12+) can delete a saved race and keep a copy
(``rhapi.db.race_delete(keep_copy=True)``, ``deleted_races``, ``race_restore``). RotorHazard
4.4.0 (RHAPI 1.4, what the field timers run) has nothing: no socket event, no RHAPI method,
no RHData method. So there are two paths, picked once from the RHAPI version:

* **native** — RotorHazard's own delete and restore, its ``deleted_race`` table as the copy.
* **fallback** — this module snapshots the race (meta, attributes, pilot runs, laps) into the
  plugin option ``gridfpv_deleted_races``, re-reads and compares the snapshot, then deletes
  the rows in one transaction through RotorHazard's SQLAlchemy models (the same tables
  main's ``delete_savedRaceMeta`` touches: ``saved_race_meta_attribute``, ``saved_race_lap``,
  ``saved_pilot_race``, ``saved_race_meta``). Restore re-inserts the snapshot through RHData's
  own add paths and drops it from the option. Any exception rolls back and leaves the
  snapshot in place.

Guardrails on both paths: no delete while a race is staged or running (or finished and not
yet saved); RotorHazard's own database backup is taken first (the same copy its Settings
page button makes); no restore when that heat/round exists again; result caches cleared
afterwards so RotorHazard's Results page rebuilds.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from types import SimpleNamespace

logger = logging.getLogger(__name__)

OPT_DELETED = "gridfpv_deleted_races"
NATIVE_RHAPI = (1, 12)
RACE_READY = 0
MAX_KEPT = 50

RACE_FIELDS = ("round_id", "heat_id", "class_id", "format_id", "start_time", "start_time_formatted")
PILOTRACE_FIELDS = (
    "node_index", "pilot_id", "history_values", "history_times", "penalty_time", "penalty_desc",
    "enter_at", "exit_at", "frequency", "marshal_type",
)
LAP_FIELDS = ("lap_time_stamp", "lap_time", "lap_time_formatted", "source", "deleted", "peak_rssi")


class RaceError(ValueError):
    """A delete or restore the plugin refused, with a message fit for the UI."""


def rhapi_version(rhapi) -> tuple:
    return (int(getattr(rhapi, "API_VERSION_MAJOR", 1)), int(getattr(rhapi, "API_VERSION_MINOR", 0)))


def is_native(rhapi) -> bool:
    return rhapi_version(rhapi) >= NATIVE_RHAPI and hasattr(rhapi.db, "race_delete")


def _context(rhapi):
    """RotorHazard's race context behind RHAPI (private, but stable across 4.x)."""
    ctx = getattr(rhapi, "_racecontext", None)
    if ctx is None:
        raise RaceError("this RotorHazard does not expose its race context")
    return ctx


def _models():
    import Database  # RotorHazard's module; importable inside the server process only

    return Database


def race_status(rhapi) -> int:
    try:
        return int(rhapi.race.status)
    except Exception:
        return RACE_READY


def backup(rhapi) -> str | None:
    """RotorHazard's own database backup (what its Settings page button does). None if it failed."""
    try:
        name = _context(rhapi).rhdata.backup_db_file(True)
    except Exception:
        logger.exception("gridfpv races: database backup failed")
        return None
    if not name:
        return None
    return str(name).rsplit("/", 1)[-1]


def _callsigns(rhapi, pilot_ids) -> list:
    out = []
    for pid in pilot_ids:
        try:
            pilot = rhapi.db.pilot_by_id(pid) if pid else None
        except Exception:
            pilot = None
        out.append(getattr(pilot, "callsign", None) or (f"Pilot {pid}" if pid else "—"))
    return out


# ---- the kept copies, as the UI lists them ----------------------------------------------

def _entry(id_, heat_id, round_id, class_id, started, deleted_at, callsigns) -> dict:
    return {
        "id": str(id_),
        "heat_id": int(heat_id),
        "round_id": int(round_id),
        "class_id": int(class_id or 0),
        "start_time_formatted": started or "",
        "deleted_at": deleted_at or "",
        "callsigns": list(callsigns),
    }


def _read_option(rhapi) -> list:
    raw = rhapi.db.option(OPT_DELETED, default="")
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        logger.warning("gridfpv races: stored deleted-race option is not JSON; starting empty")
        return []
    return [d for d in data if isinstance(d, dict) and d.get("id") and isinstance(d.get("race"), dict)]


def _write_option(rhapi, snapshots: list) -> None:
    rhapi.db.option_set(OPT_DELETED, json.dumps(snapshots[-MAX_KEPT:], default=str))


def load(rhapi) -> list:
    """Every deleted race that can still be restored, newest last."""
    if is_native(rhapi):
        out = []
        for d in rhapi.db.deleted_races or []:
            data = {}
            try:
                data = rhapi.db.deleted_race_data(d) or {}
            except Exception:
                pass
            runs = data.get("pilotraces") or data.get("pilot_runs") or data.get("runs") or []
            pilot_ids = [r.get("pilot_id") for r in runs if isinstance(r, dict)]
            out.append(_entry(d.id, d.heat_id, d.round_id, d.class_id, d.start_time_formatted,
                              d.deleted_time_formatted, _callsigns(rhapi, pilot_ids)))
        return out
    return [
        _entry(s["id"], s["race"]["heat_id"], s["race"]["round_id"], s["race"].get("class_id"),
               s["race"].get("start_time_formatted"), s.get("deleted_at"), s.get("callsigns") or [])
        for s in _read_option(rhapi)
    ]


# ---- delete -----------------------------------------------------------------------------

def delete(rhapi, heat_id, round_id) -> dict:
    """Delete one saved race, keeping a copy. Returns {"backup": file or None}."""
    heat_id, round_id = int(heat_id), int(round_id)
    if race_status(rhapi) != RACE_READY:
        raise RaceError("a race is on the timer; save or discard it first")
    rhdata = _context(rhapi).rhdata
    try:
        race = rhdata.get_savedRaceMeta_by_heat_round(heat_id, round_id)
    except Exception:
        race = None
    if race is None:
        raise RaceError(f"heat {heat_id} has no saved round {round_id}")
    backup_name = backup(rhapi)
    if is_native(rhapi):
        if not rhapi.db.race_delete(race, keep_copy=True):
            raise RaceError("RotorHazard refused to delete the race")
    else:
        _fallback_delete(rhapi, race)
    _after_change(rhapi)
    logger.info("gridfpv races: deleted heat %s round %s (backup %s)", heat_id, round_id, backup_name)
    return {"backup": backup_name}


def snapshot_of(rhapi, race) -> dict:
    """The race as plain data: what the fallback keeps and what restore puts back."""
    rhdata = _context(rhapi).rhdata
    Database = _models()
    attrs = []
    try:
        attrs = [{"name": a.name, "value": a.value} for a in rhdata.get_savedrace_attributes(race)]
    except Exception:
        pass
    pilotraces = []
    for pr in rhdata.get_savedPilotRaces_by_savedRaceMeta(race.id):
        laps = sorted(Database.SavedRaceLap.query.filter_by(pilotrace_id=pr.id).all(),
                      key=lambda lap: (lap.lap_time_stamp or 0, lap.id))
        entry = {f: getattr(pr, f, None) for f in PILOTRACE_FIELDS}
        entry["laps"] = [{f: getattr(lap, f, None) for f in LAP_FIELDS} for lap in laps]
        pilotraces.append(entry)
    pilotraces.sort(key=lambda p: p["node_index"])
    return {
        "id": uuid.uuid4().hex,
        "deleted_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "race": {f: getattr(race, f, None) for f in RACE_FIELDS},
        "attributes": attrs,
        "pilotraces": pilotraces,
        "callsigns": _callsigns(rhapi, [p["pilot_id"] for p in pilotraces]),
    }


def _fallback_delete(rhapi, race) -> None:
    rhdata = _context(rhapi).rhdata
    Database = _models()
    snap = snapshot_of(rhapi, race)
    kept = _read_option(rhapi)
    kept.append(snap)
    _write_option(rhapi, kept)
    # The copy is the only way back: prove it was stored as built before touching a row.
    stored = next((s for s in _read_option(rhapi) if s["id"] == snap["id"]), None)
    if stored is None or json.dumps(stored, sort_keys=True, default=str) != json.dumps(snap, sort_keys=True, default=str):
        raise RaceError("could not keep a copy of the race; nothing was deleted")
    race_id = race.id
    try:
        Database.SavedRaceMetaAttribute.query.filter_by(id=race_id).delete()
        Database.SavedRaceLap.query.filter_by(race_id=race_id).delete()
        Database.SavedPilotRace.query.filter_by(race_id=race_id).delete()
        Database.DB_session.delete(race)
        if not rhdata.commit():
            raise RuntimeError("commit failed")
    except Exception as e:
        rhdata.rollback()
        logger.exception("gridfpv races: delete of race %s rolled back", race_id)
        raise RaceError(f"RotorHazard could not delete the race ({e}); the copy is kept") from e


# ---- restore ----------------------------------------------------------------------------

def restore(rhapi, deleted_id) -> dict:
    """Put a deleted race back as it was. Returns {"heat_id", "round_id"}."""
    if race_status(rhapi) != RACE_READY:
        raise RaceError("a race is on the timer; save or discard it first")
    if is_native(rhapi):
        d = rhapi.db.deleted_race_by_id(int(deleted_id))
        if d is None:
            raise RaceError("that deleted race is no longer kept")
        conflicts = rhapi.db.deleted_race_conflicts(d) or []
        if conflicts:
            raise RaceError("cannot restore: " + "; ".join(str(c) for c in conflicts))
        if not rhapi.db.race_restore(d):
            raise RaceError("RotorHazard refused to restore the race")
        out = {"heat_id": int(d.heat_id), "round_id": int(d.round_id)}
    else:
        out = _fallback_restore(rhapi, str(deleted_id))
    _after_change(rhapi)
    logger.info("gridfpv races: restored heat %s round %s", out["heat_id"], out["round_id"])
    return out


def _fallback_restore(rhapi, deleted_id: str) -> dict:
    rhdata = _context(rhapi).rhdata
    Database = _models()
    kept = _read_option(rhapi)
    snap = next((s for s in kept if s["id"] == deleted_id), None)
    if snap is None:
        raise RaceError("that deleted race is no longer kept")
    race = snap["race"]
    heat_id, round_id = int(race["heat_id"]), int(race["round_id"])
    if rhapi.db.heat_by_id(heat_id) is None:
        raise RaceError("cannot restore: the heat no longer exists")
    if Database.SavedRaceMeta.query.filter_by(heat_id=heat_id, round_id=round_id).first() is not None:
        raise RaceError(f"cannot restore: round {round_id} of that heat has been raced again")
    try:
        new_race = rhdata.add_savedRaceMeta(dict(race))
        for a in snap.get("attributes") or []:
            Database.DB_session.add(Database.SavedRaceMetaAttribute(id=new_race.id, name=a["name"], value=a["value"]))
        for pr in snap.get("pilotraces") or []:
            laps = [SimpleNamespace(**{f: lap.get(f) for f in LAP_FIELDS}) for lap in pr.get("laps") or []]
            rhdata.add_race_data({
                int(pr["node_index"]): {
                    "race_id": new_race.id,
                    "pilot_id": pr.get("pilot_id"),
                    "history_values": pr.get("history_values"),
                    "history_times": pr.get("history_times"),
                    "enter_at": pr.get("enter_at") or 0,
                    "exit_at": pr.get("exit_at") or 0,
                    "frequency": pr.get("frequency"),
                    "marshal_type": pr.get("marshal_type"),
                    "laps": laps,
                }
            })
            if pr.get("penalty_time") or pr.get("penalty_desc"):
                row = Database.SavedPilotRace.query.filter_by(race_id=new_race.id, node_index=int(pr["node_index"])).first()
                if row is not None:
                    row.penalty_time = pr.get("penalty_time") or 0
                    row.penalty_desc = pr.get("penalty_desc")
        if not rhdata.commit():
            raise RuntimeError("commit failed")
    except Exception as e:
        rhdata.rollback()
        logger.exception("gridfpv races: restore of heat %s round %s rolled back", heat_id, round_id)
        raise RaceError(f"RotorHazard could not restore the race ({e}); the copy is kept") from e
    _write_option(rhapi, [s for s in kept if s["id"] != deleted_id])
    return {"heat_id": heat_id, "round_id": round_id}


def forget(rhapi, deleted_id) -> None:
    """Drop a kept copy without restoring it (fallback path only; native has RotorHazard's page)."""
    if is_native(rhapi):
        return
    _write_option(rhapi, [s for s in _read_option(rhapi) if s["id"] != str(deleted_id)])


# ---- after a change ----------------------------------------------------------------------

def _after_change(rhapi) -> None:
    """Results rebuild from scratch; RotorHazard's pages learn the heats and races changed."""
    ctx = _context(rhapi)
    try:
        ctx.rhdata.clear_results_all()
    except Exception:
        logger.exception("gridfpv races: could not clear result caches")
    try:
        ctx.pagecache.set_valid(False)
    except Exception:
        pass
    for name in ("emit_heat_data", "emit_race_list", "emit_current_heat"):
        try:
            getattr(ctx.rhui, name)()
        except Exception:
            pass
