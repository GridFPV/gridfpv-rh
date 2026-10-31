"""The plugin's mode (#95): how much of Grid a timer shows, and in whose words.

One plugin option, ``gridfpv_mode``, kept in RotorHazard's database like the event name, so
every client of this timer agrees and it survives reloads and resets: a timer set up for
racegow stays that way until someone changes it.

- ``full``: everything.
- ``simple``: the club-night pages only; Teams, Formats, heat plans and the stage machinery
  (brackets, Chase the Ace, seeding) stay out of the way.
- ``racegow``: simple, plus racegow's own workflow and vocabulary (seasons, tracks, runs).
  The pages themselves arrive over the steps of #95; the setting lands first so the
  nav and the help can follow it.
"""

OPT_MODE = "gridfpv_mode"
MODES = ("full", "simple", "racegow")
DEFAULT_MODE = "full"


class ModeError(ValueError):
    """A mode the plugin refused, with a message fit for the UI."""


def current(rhapi) -> str:
    raw = str(rhapi.db.option(OPT_MODE, default=DEFAULT_MODE) or DEFAULT_MODE).strip().lower()
    return raw if raw in MODES else DEFAULT_MODE


def load(rhapi) -> dict:
    return {"mode": current(rhapi), "modes": list(MODES)}


def save(rhapi, data) -> dict:
    mode = str((data or {}).get("mode") or "").strip().lower()
    if mode not in MODES:
        raise ModeError(f"no mode called {mode!r}; one of {', '.join(MODES)}")
    rhapi.db.option_set(OPT_MODE, mode)
    return load(rhapi)
