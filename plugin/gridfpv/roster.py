"""The roster (#14): pilots that outlive an event.

In RotorHazard an event *is* the database: a new event (reset) takes the pilots with it, so
the director re-types the club every time. The roster is a plugin-owned JSON file next to
RotorHazard's database (``gridfpv-data/roster.json`` under its working directory, where
``database.db`` and ``db_bkp/`` live), so it survives resets, is not inside any archive, and
travels with the timer. Pilots are captured into it automatically as they are added or
edited in any event (RotorHazard's pilotAdd / pilotAlter events), matched by callsign;
"Add from roster" on the Pilots page creates them in the current event through RHAPI.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime

logger = logging.getLogger(__name__)

DIR_NAME = "gridfpv-data"
FILE_NAME = "roster.json"
FIELDS = ("callsign", "name", "phonetic", "team", "color")


class RosterError(ValueError):
    """A roster request the plugin refused, with a message fit for the UI."""


def path(rhapi=None) -> str:
    override = os.environ.get("GRIDFPV_ROSTER_PATH")
    if override:
        return override
    return os.path.join(os.getcwd(), DIR_NAME, FILE_NAME)


def _key(callsign) -> str:
    return str(callsign or "").strip().casefold()


def load(rhapi=None) -> list:
    p = path(rhapi)
    if not os.path.isfile(p):
        return []
    try:
        with open(p, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        logger.exception("gridfpv roster: could not read %s; starting empty", p)
        return []
    pilots = data.get("pilots") if isinstance(data, dict) else data
    return [p for p in pilots or [] if isinstance(p, dict) and p.get("id") and _key(p.get("callsign"))]


def save(pilots: list, rhapi=None) -> None:
    p = path(rhapi)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"version": 1, "pilots": pilots}, fh, indent=1, ensure_ascii=False)
    os.replace(tmp, p)


def _attributes(rhapi, pilot) -> dict:
    out = {}
    try:
        for attr in rhapi.db.pilot_attributes(pilot) or []:
            name, value = getattr(attr, "name", None), getattr(attr, "value", None)
            if name and value not in (None, ""):
                out[str(name)] = str(value)
    except Exception:
        logger.debug("gridfpv roster: no attributes for pilot %s", getattr(pilot, "id", "?"), exc_info=True)
    return out


def capture(rhapi, pilot) -> dict | None:
    """Upsert one RotorHazard pilot into the roster, by callsign. Placeholders are skipped."""
    callsign = str(getattr(pilot, "callsign", "") or "").strip()
    if not callsign or callsign.startswith("~"):
        return None
    pilots = load(rhapi)
    entry = next((p for p in pilots if _key(p["callsign"]) == _key(callsign)), None)
    if entry is None:
        entry = {"id": uuid.uuid4().hex, "first_seen": datetime.now().strftime("%Y-%m-%d")}
        pilots.append(entry)
    entry["callsign"] = callsign
    for f in FIELDS[1:]:
        entry[f] = str(getattr(pilot, f, "") or "")
    entry["attributes"] = _attributes(rhapi, pilot)
    entry["last_seen"] = datetime.now().strftime("%Y-%m-%d")
    save(pilots, rhapi)
    return entry


def capture_all(rhapi) -> int:
    n = 0
    for pilot in rhapi.db.pilots or []:
        if capture(rhapi, pilot) is not None:
            n += 1
    return n


def in_event(rhapi) -> set:
    return {_key(getattr(p, "callsign", "")) for p in rhapi.db.pilots or []}


def listing(rhapi) -> list:
    """The roster as the UI shows it: every entry, flagged with whether it is in this event."""
    present = in_event(rhapi)
    return [{**p, "in_event": _key(p["callsign"]) in present} for p in load(rhapi)]


def add_to_event(rhapi, ids) -> list:
    """Create the given roster pilots in the current event (skipping callsigns already in it)."""
    wanted = {str(i) for i in ids or []}
    if not wanted:
        raise RosterError("nothing to add")
    present = in_event(rhapi)
    added = []
    for entry in load(rhapi):
        if entry["id"] not in wanted or _key(entry["callsign"]) in present:
            continue
        pilot = rhapi.db.pilot_add(
            name=entry.get("name") or entry["callsign"],
            callsign=entry["callsign"],
            phonetic=entry.get("phonetic") or None,
            team=entry.get("team") or None,
            color=entry.get("color") or None,
        )
        if pilot is None:
            raise RosterError(f"RotorHazard did not create {entry['callsign']}")
        attrs = entry.get("attributes") or {}
        if attrs:
            rhapi.db.pilot_alter(pilot.id, attributes=dict(attrs))
        added.append(entry["callsign"])
    return added


def remove(rhapi, id_) -> None:
    pilots = load(rhapi)
    kept = [p for p in pilots if p["id"] != str(id_)]
    if len(kept) != len(pilots):
        save(kept, rhapi)


def hook_pilot_events(rhapi) -> None:
    """Capture pilots as RotorHazard adds or edits them, in any event."""
    events = getattr(rhapi, "events", None)
    if events is None or not hasattr(events, "on"):
        return
    try:
        from eventmanager import Evt  # RotorHazard's module; importable in-process only
    except Exception:  # pragma: no cover - outside RotorHazard
        return

    def on_pilot(args=None, *_a, **_k):
        pid = (args or {}).get("pilot_id")
        if pid is None:
            return
        try:
            pilot = rhapi.db.pilot_by_id(pid)
            if pilot is not None:
                capture(rhapi, pilot)
        except Exception:
            logger.exception("gridfpv roster: capture of pilot %s failed", pid)

    for name in ("PILOT_ADD", "PILOT_ALTER"):
        evt = getattr(Evt, name, None)
        if evt is not None:
            events.on(evt, on_pilot, name=f"gridfpv_roster_{name.lower()}")
