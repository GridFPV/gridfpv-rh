"""Where the race overlay sits (#96): one placement for every page that draws it.

The overlay is a transparent page with the panel in a corner. OBS can move and scale a
browser source, but the video companion draws the same page full-frame when it renders a
recording, so the placement has to be the overlay's own — stored on the timer as the JSON
option ``gridfpv_overlay``, read by the live page, the replay page and so every render.

- ``corner``: which corner the panel hangs from.
- ``x``, ``y``: pixels in from that corner's edges.
- ``scale``: the panel's size, percent of its natural size.
"""

import json
import logging

logger = logging.getLogger(__name__)

OPT_OVERLAY = "gridfpv_overlay"
CORNERS = ("top-left", "top-right", "bottom-left", "bottom-right")
OFFSET_MAX = 4000
SCALE_MIN = 25
SCALE_MAX = 300


class OverlayError(ValueError):
    """A save the plugin refused, with a message fit for the UI."""


def _default() -> dict:
    return {"corner": "top-left", "x": 24, "y": 24, "scale": 100}


def _int_in(value, lo, hi):
    try:
        n = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    return n if lo <= n <= hi else None


def load(rhapi) -> dict:
    raw = rhapi.db.option(OPT_OVERLAY, default="")
    data = {}
    if raw:
        try:
            data = json.loads(raw)
        except (TypeError, ValueError):
            logger.warning("gridfpv overlay: stored option is not JSON; using the default placement")
    if not isinstance(data, dict):
        data = {}
    out = _default()
    if data.get("corner") in CORNERS:
        out["corner"] = data["corner"]
    for key in ("x", "y"):
        n = _int_in(data.get(key), 0, OFFSET_MAX)
        if n is not None:
            out[key] = n
    n = _int_in(data.get("scale"), SCALE_MIN, SCALE_MAX)
    if n is not None:
        out["scale"] = n
    return out


def save(rhapi, data) -> dict:
    """Write whichever fields are present; returns the whole record."""
    data = data or {}
    out = load(rhapi)
    if "corner" in data:
        if data["corner"] not in CORNERS:
            raise OverlayError("the corner must be one of " + ", ".join(CORNERS))
        out["corner"] = data["corner"]
    for key in ("x", "y"):
        if key in data:
            n = _int_in(data[key], 0, OFFSET_MAX)
            if n is None:
                raise OverlayError(f"{key} must be a number of pixels between 0 and {OFFSET_MAX}")
            out[key] = n
    if "scale" in data:
        n = _int_in(data["scale"], SCALE_MIN, SCALE_MAX)
        if n is None:
            raise OverlayError(f"the size must be between {SCALE_MIN} and {SCALE_MAX} percent")
        out["scale"] = n
    rhapi.db.option_set(OPT_OVERLAY, json.dumps(out))
    return out
