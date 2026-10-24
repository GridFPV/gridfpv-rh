"""RaceGOW Overlay for RotorHazard — GridFPV's race overlay on its own.

A cut-down sibling of the ``gridfpv`` plugin for timing RaceGOW at home: it serves the same
built single-page app, but only the public overlay routes under ``/grid/live``; ``/grid``
redirects to the overlay and everything else is a 404. The only socket traffic it answers is
the UI's hello and event-name request, so the overlay's title can show the event. Race logic
and race control stay in RotorHazard's own pages.

The ``branding/`` folder next to this file holds ``left.png`` (RaceGOW) and ``right.png``
(ReconFPV); the overlay shows whichever of the two it can load.
"""

import logging
import os

from flask import Blueprint, abort, redirect, send_from_directory

logger = logging.getLogger(__name__)

PLUGIN_VERSION = "0.3.3"
URL_PREFIX = "/grid"
OVERLAY_PATH = URL_PREFIX + "/live/race"
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_STATIC_DIR = os.path.join(HERE, "static")
DEFAULT_BRANDING_DIR = os.path.join(HERE, "branding")

#: Sub-paths that get index.html (client-side overlay routes).
LIVE_PREFIX = "live"
#: Sub-paths served as files from static/.
FILE_PREFIXES = ("assets/", "favicon.svg")

EVT_HELLO = "gridfpv_hello"
EVT_HELLO_ACK = "gridfpv_hello_ack"
EVT_EVENT_GET = "gridfpv_event_get"
EVT_EVENT = "gridfpv_event"


def _safe_file(root: str, subpath: str):
    candidate = os.path.normpath(os.path.join(root, subpath))
    if candidate.startswith(os.path.abspath(root) + os.sep) and os.path.isfile(candidate):
        return candidate
    return None


def build_blueprint(static_dir: str, branding_dir: str) -> Blueprint:
    bp = Blueprint("racegow_overlay", __name__)
    index_path = os.path.join(static_dir, "index.html")

    def index():
        return redirect(OVERLAY_PATH, code=302)

    def serve(subpath: str):
        if subpath.startswith("branding/"):
            if _safe_file(branding_dir, subpath[len("branding/") :]):
                return send_from_directory(branding_dir, subpath[len("branding/") :])
            abort(404)
        if subpath.startswith(FILE_PREFIXES):
            if _safe_file(static_dir, subpath):
                return send_from_directory(static_dir, subpath)
            abort(404)
        if subpath == LIVE_PREFIX or subpath.startswith(LIVE_PREFIX + "/"):
            if not os.path.isfile(index_path):
                abort(503, "RaceGOW Overlay: the UI is not built; install the packaged zip.")
            return send_from_directory(static_dir, "index.html")
        abort(404, "RaceGOW Overlay only serves the race overlay at " + OVERLAY_PATH)

    bp.add_url_rule(URL_PREFIX, "index", index)
    bp.add_url_rule(URL_PREFIX + "/", "index_slash", index)
    bp.add_url_rule(URL_PREFIX + "/<path:subpath>", "serve", serve)
    return bp


def _sender(rhapi):
    return getattr(rhapi.ui, "socket_send", None) or rhapi.ui.socket_broadcast


def register_socket(rhapi) -> None:
    send = _sender(rhapi)

    def on_hello(*_args, **_kwargs):
        info = {}
        try:
            info = dict(rhapi.server.info or {})
        except Exception:  # pragma: no cover
            logger.debug("racegow_overlay: rhapi.server.info unavailable", exc_info=True)
        send(
            EVT_HELLO_ACK,
            {
                "plugin_version": PLUGIN_VERSION,
                "rhapi_version": f"{rhapi.API_VERSION_MAJOR}.{rhapi.API_VERSION_MINOR}",
                "rh_version": info.get("release_version"),
                "seat_count": len(rhapi.interface.seats or []),
                "redirect_home": False,
                "capture": None,
                "overlay_only": True,
            },
        )

    def on_event_get(*_args, **_kwargs):
        send(
            EVT_EVENT,
            {
                "name": str(rhapi.db.option("eventName", default="") or ""),
                "description": str(rhapi.db.option("eventDescription", default="") or ""),
            },
        )

    rhapi.ui.socket_listen(EVT_HELLO, on_hello)
    rhapi.ui.socket_listen(EVT_EVENT_GET, on_event_get)


STREAMS_PANEL = "racegow_overlay_streams"
STREAMS_MARKDOWN = (
    "- [RaceGOW race overlay (dark)](/grid/live/race)\n"
    "- [RaceGOW race overlay (light)](/grid/live/race/light)\n\n"
    "Copy a link into an OBS Browser source."
)


def register_streams(rhapi) -> None:
    """List the overlay on RotorHazard's Streams page (``/streams``), under its own."""
    rhapi.ui.register_panel(STREAMS_PANEL, "RaceGOW overlay", "streams", order=0, open=True)
    rhapi.ui.register_markdown(STREAMS_PANEL, "links", STREAMS_MARKDOWN)


def initialize(
    rhapi, static_dir: str = DEFAULT_STATIC_DIR, branding_dir: str = DEFAULT_BRANDING_DIR
) -> None:
    """RotorHazard's plugin entry point."""
    register_streams(rhapi)
    register_socket(rhapi)
    rhapi.ui.blueprint_add(build_blueprint(static_dir, branding_dir))
    built = os.path.isfile(os.path.join(static_dir, "index.html"))
    logger.info(
        "RaceGOW Overlay %s: overlay at %s (%s)",
        PLUGIN_VERSION,
        OVERLAY_PATH,
        "built" if built else "NOT BUILT",
    )
