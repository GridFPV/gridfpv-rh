"""Custom channel presets, stored in RotorHazard's database as a plugin option.

A **preset** is only a layout: which channel each seat is on. A **profile** (RotorHazard's
own record) is that plus every seat's tuning. The built-in presets (RotorHazard's R1367,
IMD5C, IMD6C, Raceband 1–8 and MultiGP's sets) live in the frontend; the ones a director
saves live here, as JSON in the ``gridfpv_presets`` option, so they survive a restart and
travel with a database backup.
"""

import json
import logging
import re
import uuid

logger = logging.getLogger(__name__)

OPT_PRESETS = "gridfpv_presets"
MAX_NAME = 40
MIN_MHZ, MAX_MHZ = 5000, 6000


class PresetError(ValueError):
    """A save or delete the plugin refused, with a message fit for the UI."""


def load(rhapi) -> list:
    raw = rhapi.db.option(OPT_PRESETS, default="")
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        logger.warning("gridfpv presets: stored option is not JSON; starting empty")
        return []
    return [p for p in data if isinstance(p, dict) and "id" in p and "name" in p and "seats" in p]


def _store(rhapi, presets: list) -> list:
    rhapi.db.option_set(OPT_PRESETS, json.dumps(presets))
    return presets


def _clean_seat(seat) -> dict:
    if not isinstance(seat, dict):
        raise PresetError("each seat must be an object")
    try:
        frequency = int(seat.get("frequency", 0) or 0)
    except (TypeError, ValueError):
        raise PresetError("frequency must be a number") from None
    if frequency == 0:
        return {"band": None, "channel": None, "frequency": 0}
    if not MIN_MHZ <= frequency <= MAX_MHZ:
        raise PresetError(f"frequency {frequency} is outside {MIN_MHZ}–{MAX_MHZ} MHz")
    band = seat.get("band")
    channel = seat.get("channel")
    if band is not None and not re.fullmatch(r"[A-Z]{1,3}", str(band)):
        raise PresetError(f"bad band {band!r}")
    if channel is not None:
        try:
            channel = int(channel)
        except (TypeError, ValueError):
            raise PresetError("channel must be a number") from None
    return {"band": str(band) if band else None, "channel": channel, "frequency": frequency}


def save(rhapi, name, seats) -> list:
    """Add a preset (or replace one with the same name). Returns the new list."""
    name = str(name or "").strip()
    if not name:
        raise PresetError("a preset needs a name")
    if len(name) > MAX_NAME:
        raise PresetError(f"name is longer than {MAX_NAME} characters")
    if not isinstance(seats, list) or not seats:
        raise PresetError("a preset needs at least one seat")
    cleaned = [_clean_seat(s) for s in seats]
    if not any(s["frequency"] for s in cleaned):
        raise PresetError("a preset with every seat off is not worth saving")
    presets = [p for p in load(rhapi) if p["name"].lower() != name.lower()]
    presets.append({"id": uuid.uuid4().hex[:12], "name": name, "seats": cleaned})
    presets.sort(key=lambda p: p["name"].lower())
    return _store(rhapi, presets)


def delete(rhapi, preset_id) -> list:
    presets = load(rhapi)
    kept = [p for p in presets if p["id"] != preset_id]
    if len(kept) == len(presets):
        raise PresetError("no such preset")
    return _store(rhapi, kept)
