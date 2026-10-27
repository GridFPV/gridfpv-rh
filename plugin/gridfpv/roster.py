"""The roster (#14): pilots that outlive an event.

In RotorHazard an event *is* the database: a new event (reset) takes the pilots with it, so
the director re-types the club every time. The roster is a plugin-owned JSON file next to
RotorHazard's database (``gridfpv-data/roster.json`` in its data folder, where ``database.db``
and ``db_bkp/`` live; see ``datadir``), so it survives resets, is not inside any archive, and
travels with the timer. Pilots are captured into it automatically as they are added or
edited in any event (RotorHazard's pilotAdd / pilotAlter events), matched by callsign;
"Add from roster" on the Pilots page creates them in the current event through RHAPI.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import uuid

from . import datadir
from datetime import datetime

logger = logging.getLogger(__name__)

DIR_NAME = "gridfpv-data"
FILE_NAME = "roster.json"
FIELDS = ("callsign", "name", "phonetic", "team", "color")
#: Pilot attribute (registered by the plugin) linking an event's pilot to its roster entry, so
#: a renamed pilot stays one entry (#59). It lives and dies with the pilot in the event database.
ATTR_LINK = "gridfpv_roster_id"


class RosterError(ValueError):
    """A roster request the plugin refused, with a message fit for the UI."""


def path(rhapi=None) -> str:
    override = os.environ.get("GRIDFPV_ROSTER_PATH")
    if override:
        return override
    p = os.path.join(datadir.data_dir(rhapi), DIR_NAME, FILE_NAME)
    # Before datadir, the file went under the working directory. RotorHazard changes into its
    # data folder at start so the two are one and the same there; where they differ, a roster
    # left in the old place moves to the new one once.
    legacy = os.path.join(os.getcwd(), DIR_NAME, FILE_NAME)
    if legacy != p and os.path.isfile(legacy) and not os.path.isfile(p):
        try:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            shutil.move(legacy, p)
            logger.info("gridfpv roster: moved %s to %s", legacy, p)
        except OSError:
            logger.exception("gridfpv roster: could not move %s to %s; using the old place", legacy, p)
            return legacy
    return p


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
    """The pilot's plugin attributes (MultiGP id, …), the roster link itself left out."""
    out = {}
    try:
        for attr in rhapi.db.pilot_attributes(pilot) or []:
            name, value = getattr(attr, "name", None), getattr(attr, "value", None)
            if name and name != ATTR_LINK and value not in (None, ""):
                out[str(name)] = str(value)
    except Exception:
        logger.debug("gridfpv roster: no attributes for pilot %s", getattr(pilot, "id", "?"), exc_info=True)
    return out


def _link_of(rhapi, pilot) -> str:
    try:
        for attr in rhapi.db.pilot_attributes(pilot) or []:
            if getattr(attr, "name", None) == ATTR_LINK and getattr(attr, "value", None):
                return str(attr.value)
    except Exception:
        pass
    return ""


def _link(rhapi, pilot, roster_id: str) -> None:
    try:
        rhapi.db.pilot_alter(pilot.id, attributes={ATTR_LINK: roster_id})
    except Exception:
        logger.debug("gridfpv roster: could not link pilot %s", getattr(pilot, "id", "?"), exc_info=True)


def capture(rhapi, pilot) -> dict | None:
    """Upsert one RotorHazard pilot into the roster, by callsign. Placeholders are skipped."""
    callsign = str(getattr(pilot, "callsign", "") or "").strip()
    if not callsign or callsign.startswith("~"):
        return None
    pilots = load(rhapi)
    # The link on the pilot wins (a rename is still the same pilot, #59); else the callsign.
    link = _link_of(rhapi, pilot)
    entry = next((p for p in pilots if p["id"] == link), None) if link else None
    if entry is None:
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
    if link != entry["id"]:
        _link(rhapi, pilot, entry["id"])
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
        # RotorHazard gives a new pilot team "A"; a roster pilot with no team stays without (#60).
        if not entry.get("team"):
            rhapi.db.pilot_alter(pilot.id, team="")
        attrs = {**(entry.get("attributes") or {}), ATTR_LINK: entry["id"]}
        rhapi.db.pilot_alter(pilot.id, attributes=attrs)
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
