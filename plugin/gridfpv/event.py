"""The event: RotorHazard's name + description options, plus the details it has no field for.

RotorHazard's "event" is two options, ``eventName`` and ``eventDescription``, that its own
pages read when they render. We keep the rest — date, venue, organizer, notes — as one
JSON plugin option, ``gridfpv_event``. A "new event" in RotorHazard is a database reset
with an archive (``reset_database``), after which it generates a fresh name; our new-event
flow follows that reset with a save here, so the extras are cleared and the name is the
one the director typed.
"""

import json
import logging

logger = logging.getLogger(__name__)

OPT_EVENT = "gridfpv_event"
OPT_NAME = "eventName"
OPT_DESCRIPTION = "eventDescription"
# RotorHazard's "Consecutive Laps Base" (results rank "fastest N consecutive"). Written over
# RotorHazard's own ``set_consecutives_count`` so its side effects (results cache) happen;
# read back here so the UI sees the stored value, since RotorHazard does not broadcast it.
OPT_CONSECUTIVES = "consecutivesCount"
DEFAULT_CONSECUTIVES = 3
MAX_NAME = 80
MAX_DESCRIPTION = 300
EXTRA_FIELDS = ("date", "venue", "organizer", "notes")
MAX_EXTRA = {"date": 20, "venue": 120, "organizer": 80, "notes": 2000}


class EventError(ValueError):
    """A save the plugin refused, with a message fit for the UI."""


def _extras(rhapi) -> dict:
    raw = rhapi.db.option(OPT_EVENT, default="")
    data = {}
    if raw:
        try:
            data = json.loads(raw)
        except (TypeError, ValueError):
            logger.warning("gridfpv event: stored option is not JSON; starting empty")
    if not isinstance(data, dict):
        data = {}
    return {k: str(data.get(k) or "") for k in EXTRA_FIELDS}


def consecutives_base(rhapi) -> int:
    try:
        n = int(rhapi.db.option(OPT_CONSECUTIVES, default=DEFAULT_CONSECUTIVES) or DEFAULT_CONSECUTIVES)
    except (TypeError, ValueError):
        return DEFAULT_CONSECUTIVES
    return n if n >= 2 else DEFAULT_CONSECUTIVES


def load(rhapi) -> dict:
    out = {
        "name": str(rhapi.db.option(OPT_NAME, default="") or ""),
        "description": str(rhapi.db.option(OPT_DESCRIPTION, default="") or ""),
        "consecutives_base": consecutives_base(rhapi),
    }
    out.update(_extras(rhapi))
    return out


def save(rhapi, data) -> dict:
    """Write whichever fields are present. Returns the whole event."""
    data = data or {}
    if "name" in data:
        name = str(data.get("name") or "").strip()
        if not name:
            raise EventError("an event needs a name")
        if len(name) > MAX_NAME:
            raise EventError(f"name is longer than {MAX_NAME} characters")
        rhapi.db.option_set(OPT_NAME, name)
    if "description" in data:
        description = str(data.get("description") or "").strip()
        if len(description) > MAX_DESCRIPTION:
            raise EventError(f"description is longer than {MAX_DESCRIPTION} characters")
        rhapi.db.option_set(OPT_DESCRIPTION, description)
    extras = _extras(rhapi)
    changed = False
    for key in EXTRA_FIELDS:
        if key in data:
            value = str(data.get(key) or "").strip()
            if len(value) > MAX_EXTRA[key]:
                raise EventError(f"{key} is longer than {MAX_EXTRA[key]} characters")
            extras[key] = value
            changed = True
    if changed:
        rhapi.db.option_set(OPT_EVENT, json.dumps(extras))
    return load(rhapi)


def clear_extras(rhapi) -> dict:
    """After RotorHazard's reset-with-archive: the new event starts with blank details."""
    rhapi.db.option_set(OPT_EVENT, json.dumps({k: "" for k in EXTRA_FIELDS}))
    return load(rhapi)
