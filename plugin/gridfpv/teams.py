"""Teams: a named list the director manages, stored as a plugin option, and pushed into
RotorHazard's own pilot dropdown so both UIs offer the same names.

RotorHazard stores a pilot's team as free text and prints it wherever teams appear (its
pilot page, heats, team-racing results), but its own dropdown is built from a fixed A–Z
list (``RHData.TEAM_NAMES_LIST``) when it emits pilot data. The ``emitPilotData`` filter
hook runs on that payload before it reaches the browser, so we rebuild each pilot's
``team_options`` from our list — plus any team value already in use that is not in the
list, so no pilot is ever shown with the wrong team. The stored value is the team's name;
there is no second key to keep in sync.

Renaming a team moves its pilots to the new name through RHAPI; deleting one clears them.
"""

import html
import json
import logging
import uuid

logger = logging.getLogger(__name__)

OPT_TEAMS = "gridfpv_teams"
MAX_NAME = 40
MAX_DESCRIPTION = 120
#: The filter hook name (filtermanager.Flt.EMIT_PILOT_DATA in RotorHazard 4.4.0).
FILTER_HOOK = "emitPilotData"
FILTER_NAME = "gridfpv_teams"


class TeamError(ValueError):
    """A save or delete the plugin refused, with a message fit for the UI."""


def load(rhapi) -> list:
    raw = rhapi.db.option(OPT_TEAMS, default="")
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        logger.warning("gridfpv teams: stored option is not JSON; starting empty")
        return []
    return [t for t in data if isinstance(t, dict) and t.get("id") and t.get("name")]


def _store(rhapi, teams: list) -> list:
    teams.sort(key=lambda t: t["name"].lower())
    rhapi.db.option_set(OPT_TEAMS, json.dumps(teams))
    return teams


def _clean(name, description):
    name = str(name or "").strip()
    description = str(description or "").strip()
    if not name:
        raise TeamError("a team needs a name")
    if len(name) > MAX_NAME:
        raise TeamError(f"name is longer than {MAX_NAME} characters")
    if len(description) > MAX_DESCRIPTION:
        raise TeamError(f"description is longer than {MAX_DESCRIPTION} characters")
    return name, description


def _pilots_on(rhapi, team_name: str):
    return [p for p in (rhapi.db.pilots or []) if (getattr(p, "team", "") or "") == team_name]


def save(rhapi, team_id, name, description) -> list:
    """Create a team (``team_id`` None) or update one; a rename moves its pilots along."""
    name, description = _clean(name, description)
    teams = load(rhapi)
    for t in teams:
        if t["name"].lower() == name.lower() and t["id"] != team_id:
            raise TeamError(f"there is already a team called {t['name']}")
    if team_id is None:
        teams.append({"id": uuid.uuid4().hex[:12], "name": name, "description": description})
        return _store(rhapi, teams)
    current = next((t for t in teams if t["id"] == team_id), None)
    if current is None:
        raise TeamError("no such team")
    old_name = current["name"]
    current["name"] = name
    current["description"] = description
    out = _store(rhapi, teams)
    if old_name != name:
        moved = 0
        for pilot in _pilots_on(rhapi, old_name):
            rhapi.db.pilot_alter(pilot.id, team=name)
            moved += 1
        if moved:
            logger.info("gridfpv teams: renamed %r to %r, moved %d pilot(s)", old_name, name, moved)
            rhapi.ui.broadcast_pilots()
    return out


def delete(rhapi, team_id) -> list:
    """Remove a team; its pilots are left with no team."""
    teams = load(rhapi)
    gone = next((t for t in teams if t["id"] == team_id), None)
    if gone is None:
        raise TeamError("no such team")
    kept = [t for t in teams if t["id"] != team_id]
    out = _store(rhapi, kept)
    cleared = 0
    for pilot in _pilots_on(rhapi, gone["name"]):
        rhapi.db.pilot_alter(pilot.id, team="")
        cleared += 1
    if cleared:
        rhapi.ui.broadcast_pilots()
    return out


def team_options_html(names, in_use, selected) -> str:
    """RotorHazard's dropdown markup: no team, our teams, then any stray value still in use."""
    ordered = [""] + sorted(names, key=str.lower)
    ordered += sorted((v for v in in_use if v and v not in names), key=str.lower)
    out = []
    for value in ordered:
        label = "—" if value == "" else value
        sel = " selected" if value == (selected or "") else ""
        out.append(f'<option value="{html.escape(value, quote=True)}"{sel}>{html.escape(label)}</option>')
    return "".join(out)


def filter_pilot_data(rhapi):
    """The emitPilotData filter: swap RotorHazard's A–Z dropdown for our team names."""

    def fn(payload):
        try:
            pilots = payload.get("pilots") if isinstance(payload, dict) else None
            if not pilots:
                return payload
            names = {t["name"] for t in load(rhapi)}
            in_use = {str(p.get("team") or "") for p in pilots}
            for p in pilots:
                p["team_options"] = team_options_html(names, in_use, p.get("team"))
        except Exception:  # never let a display tweak break RotorHazard's own page
            logger.exception("gridfpv teams: pilot_data filter failed")
        return payload

    return fn
