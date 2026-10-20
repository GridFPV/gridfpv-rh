"""GridFPV for RotorHazard — the plugin entry point.

RotorHazard imports this package as ``plugins.gridfpv`` and calls :func:`initialize` with
its ``rhapi`` object (RHAPI 1.4+, RotorHazard 4.4.0+). Everything the plugin does on the
Python side is registered here, and it is deliberately thin:

- a Flask blueprint that serves the built single-page app under ``/grid``;
- the ``gridfpv_*`` socket.io channel (today: a hello / hello-ack handshake);
- a *GridFPV* settings panel with the plugin's options;
- an optional redirect that sends RotorHazard's home page to ``/grid``.

Race logic stays in RotorHazard. The UI reads and writes through RHAPI and RotorHazard's
own socket events, so everything it does shows up correctly in RotorHazard's pages.
"""

import logging
import os

from flask import Blueprint, abort, redirect, request, send_from_directory

logger = logging.getLogger(__name__)

PLUGIN_VERSION = "0.1.0"

#: Where the SPA is mounted inside RotorHazard's web server.
URL_PREFIX = "/grid"

#: The built SPA lives next to this file. ``make build`` fills it; the plugin zip ships it.
DEFAULT_STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

#: RotorHazard option (stored in its database) — "1" sends ``/`` to ``/grid``.
OPT_REDIRECT_HOME = "gridfpv_redirect_home"

#: Settings panel the options hang off.
PANEL = "gridfpv"

EVT_HELLO = "gridfpv_hello"
EVT_HELLO_ACK = "gridfpv_hello_ack"

#: Paths RotorHazard owns that the redirect must never touch.
_NEVER_REDIRECT = ("/first-run",)


def _truthy(value) -> bool:
    """RotorHazard stores checkbox options as the strings "0" / "1"."""
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("1", "true", "on", "yes")


def redirect_enabled(rhapi) -> bool:
    return _truthy(rhapi.db.option(OPT_REDIRECT_HOME, default="0"))


def build_blueprint(rhapi, static_dir: str) -> Blueprint:
    """The Flask blueprint: the SPA under ``/grid`` plus the home-page redirect hook."""
    bp = Blueprint("gridfpv", __name__)
    index_path = os.path.join(static_dir, "index.html")

    def serve(subpath: str = ""):
        # A real file under static/ (Vite's hashed assets, favicons) is served as-is;
        # anything else is a client-side route and gets index.html.
        if subpath:
            candidate = os.path.normpath(os.path.join(static_dir, subpath))
            if candidate.startswith(os.path.abspath(static_dir) + os.sep) and os.path.isfile(
                candidate
            ):
                return send_from_directory(static_dir, subpath)
        if not os.path.isfile(index_path):
            abort(
                503,
                "GridFPV UI is not built. Run `make build` in gridfpv-rh, or install the "
                "packaged plugin zip.",
            )
        return send_from_directory(static_dir, "index.html")

    bp.add_url_rule(URL_PREFIX, "index", serve)
    bp.add_url_rule(URL_PREFIX + "/", "index_slash", serve)
    bp.add_url_rule(URL_PREFIX + "/<path:subpath>", "asset", serve)

    @bp.before_app_request
    def _home_redirect():
        if request.path != "/" or request.path in _NEVER_REDIRECT:
            return None
        if redirect_enabled(rhapi):
            return redirect(URL_PREFIX, code=302)
        return None

    return bp


def register_options(rhapi) -> None:
    from RHUI import UIField, UIFieldType  # RotorHazard's own module; only importable in-process

    rhapi.ui.register_panel(PANEL, "GridFPV", "settings", order=0)
    rhapi.fields.register_option(
        UIField(
            OPT_REDIRECT_HOME,
            "Open GridFPV instead of the RotorHazard home page",
            UIFieldType.CHECKBOX,
            desc=(
                "When on, visiting the timer's address goes straight to the GridFPV UI at "
                "/grid. RotorHazard's own pages stay reachable at their usual addresses."
            ),
        ),
        PANEL,
    )


def register_socket(rhapi) -> None:
    def on_hello(*_args, **_kwargs):
        info = {}
        try:
            info = dict(rhapi.server.info or {})
        except Exception:  # pragma: no cover - defensive against RHAPI shape drift
            logger.debug("gridfpv: rhapi.server.info unavailable", exc_info=True)
        payload = {
            "plugin_version": PLUGIN_VERSION,
            "rhapi_version": f"{rhapi.API_VERSION_MAJOR}.{rhapi.API_VERSION_MINOR}",
            "rh_version": info.get("release_version"),
            "seat_count": len(rhapi.interface.seats or []),
            "redirect_home": redirect_enabled(rhapi),
        }
        # Prefer answering only the asking client; fall back to a broadcast on an RHAPI
        # that has no per-client send.
        send = getattr(rhapi.ui, "socket_send", None) or rhapi.ui.socket_broadcast
        send(EVT_HELLO_ACK, payload)

    rhapi.ui.socket_listen(EVT_HELLO, on_hello)


def initialize(rhapi, static_dir: str = DEFAULT_STATIC_DIR) -> None:
    """RotorHazard's plugin entry point."""
    register_options(rhapi)
    register_socket(rhapi)
    rhapi.ui.blueprint_add(build_blueprint(rhapi, static_dir))
    built = os.path.isfile(os.path.join(static_dir, "index.html"))
    logger.info(
        "GridFPV %s: UI at %s (%s)",
        PLUGIN_VERSION,
        URL_PREFIX,
        "built" if built else "NOT BUILT — run `make build`",
    )
