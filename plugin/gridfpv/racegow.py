"""RaceGOW mode's own settings (#95): the season number, the seat flown, the pilot.

One JSON plugin option, ``gridfpv_racegow``, in RotorHazard's database. A season *is* a
database (a new season archives the old one), so the option travels with the season: a
restored season brings its own number back, and a new one is written as it is created.

- ``season``: the season number the names carry (``RaceGOW {season} Track 3 Round 7``).
- ``seat``: the seat (node index) the pilot flies, or None until chosen.
- ``callsign``: the pilot, by roster key (ids are per database; callsigns outlive seasons).
- ``name_template``: what a run is called — ``RaceGOW {season} {track} Round {round}`` — on the
  overlay, in Results, and baked into a recording's sidecar (#96). ``{track}`` is the track's
  name, so "Track 3" needs no parsing; ``{heat}`` exists for a track with more than one heat.
"""

import json
import logging
import re

logger = logging.getLogger(__name__)

OPT_RACEGOW = "gridfpv_racegow"
FIELDS = ("season", "seat", "callsign", "name_template")
MAX_SEASON = 9999
MAX_CALLSIGN = 40
DEFAULT_NAME_TEMPLATE = "RaceGOW {season} {track} Round {round}"
MAX_TEMPLATE = 120
TEMPLATE_TOKENS = ("{season}", "{track}", "{round}", "{heat}")


class RaceGowError(ValueError):
    """A save the plugin refused, with a message fit for the UI."""


def _default() -> dict:
    return {"season": 1, "seat": None, "callsign": "", "name_template": DEFAULT_NAME_TEMPLATE}


def load(rhapi) -> dict:
    raw = rhapi.db.option(OPT_RACEGOW, default="")
    data = {}
    if raw:
        try:
            data = json.loads(raw)
        except (TypeError, ValueError):
            logger.warning("gridfpv racegow: stored option is not JSON; starting fresh")
    if not isinstance(data, dict):
        data = {}
    out = _default()
    try:
        season = int(data.get("season", out["season"]))
        if 1 <= season <= MAX_SEASON:
            out["season"] = season
    except (TypeError, ValueError):
        pass
    seat = data.get("seat")
    try:
        out["seat"] = int(seat) if seat is not None and int(seat) >= 0 else None
    except (TypeError, ValueError):
        out["seat"] = None
    out["callsign"] = str(data.get("callsign") or "")[:MAX_CALLSIGN]
    template = str(data.get("name_template") or "").strip()
    out["name_template"] = template[:MAX_TEMPLATE] if template else DEFAULT_NAME_TEMPLATE
    return out


def template_problem(template: str):
    """Why a name template is refused, or None: it must name the run (``{round}``) and be a
    usable file name stem, since the same template names the recording (#96)."""
    t = template.strip()
    if not t:
        return None  # blank means the default
    if len(t) > MAX_TEMPLATE:
        return f"the template is longer than {MAX_TEMPLATE} characters"
    if "{round}" not in t:
        return "the template needs {round}, or every run of a track would share a name"
    bad = [c for c in t if c in '\\/:*?"<>|' or ord(c) < 32]
    if bad:
        return f"{bad[0]!r} cannot be in a name: it also names the recording file"
    unknown = [tok for tok in re.findall(r"\{[^}]*\}", t) if tok not in TEMPLATE_TOKENS]
    if unknown:
        return f"unknown token {unknown[0]}; the tokens are {', '.join(TEMPLATE_TOKENS)}"
    return None


def save(rhapi, data) -> dict:
    """Write whichever fields are present; returns the whole record."""
    data = data or {}
    out = load(rhapi)
    if "season" in data:
        try:
            season = int(data["season"])
        except (TypeError, ValueError):
            raise RaceGowError("the season must be a number")
        if not 1 <= season <= MAX_SEASON:
            raise RaceGowError(f"the season must be between 1 and {MAX_SEASON}")
        out["season"] = season
    if "seat" in data:
        seat = data["seat"]
        if seat is None or seat == "":
            out["seat"] = None
        else:
            try:
                seat = int(seat)
            except (TypeError, ValueError):
                raise RaceGowError("the seat must be a number")
            seats = len(getattr(rhapi.interface, "seats", None) or [])
            if seat < 0 or (seats and seat >= seats):
                raise RaceGowError(f"there is no seat {seat + 1} on this timer")
            out["seat"] = seat
    if "callsign" in data:
        callsign = str(data["callsign"] or "").strip()
        if len(callsign) > MAX_CALLSIGN:
            raise RaceGowError(f"callsign is longer than {MAX_CALLSIGN} characters")
        out["callsign"] = callsign
    if "name_template" in data:
        template = str(data["name_template"] or "").strip()
        problem = template_problem(template)
        if problem:
            raise RaceGowError(problem)
        out["name_template"] = template or DEFAULT_NAME_TEMPLATE
    rhapi.db.option_set(OPT_RACEGOW, json.dumps(out))
    return out
