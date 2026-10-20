"""GridFPV for RotorHazard — the plugin entry point.

RotorHazard imports this package as ``plugins.gridfpv`` and calls :func:`initialize` with
its ``rhapi`` object (RHAPI 1.4+, RotorHazard 4.4.0+). Everything the plugin does on the
Python side is registered here, and it is deliberately thin:

- a Flask blueprint that serves the built single-page app under ``/grid``, gating admin
  pages on RotorHazard's own login (``auth.py``);
- the ``gridfpv_*`` socket.io channel: a hello / hello-ack handshake, capture-mode
  tuning (``capture.py``) and custom channel presets (``presets.py``);
- a *GridFPV* settings panel with the plugin's options;
- an optional redirect that sends RotorHazard's home page to ``/grid``.

Race logic stays in RotorHazard. The UI reads and writes through RotorHazard's own socket
events, so everything it does shows up correctly in RotorHazard's pages.
"""

import logging
import os

from flask import Blueprint, abort, redirect, request, send_from_directory

from . import auth, capture, presets

logger = logging.getLogger(__name__)

PLUGIN_VERSION = "0.2.1"

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
EVT_CAPTURE_START = "gridfpv_capture_start"
EVT_CAPTURE_STOP = "gridfpv_capture_stop"
EVT_CAPTURE_GET = "gridfpv_capture_get"
#: Broadcasts: a progress chunk while recording, the full trace when done / on request.
EVT_CAPTURE_CHUNK = "gridfpv_capture_chunk"
EVT_CAPTURE = "gridfpv_capture"
EVT_PRESETS_GET = "gridfpv_presets_get"
EVT_PRESETS_SAVE = "gridfpv_presets_save"
EVT_PRESETS_DELETE = "gridfpv_presets_delete"
#: Broadcast: the full custom preset list, after any change and on request.
EVT_PRESETS = "gridfpv_presets"

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
        denied = auth.gate(rhapi, subpath)
        if denied is not None:
            return denied
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


def _sender(rhapi):
    """Answer only the asking client when the RHAPI can; broadcast otherwise."""
    return getattr(rhapi.ui, "socket_send", None) or rhapi.ui.socket_broadcast


def register_socket(rhapi, recorder: capture.Recorder) -> None:
    send = _sender(rhapi)

    def on_hello(*_args, **_kwargs):
        info = {}
        try:
            info = dict(rhapi.server.info or {})
        except Exception:  # pragma: no cover - defensive against RHAPI shape drift
            logger.debug("gridfpv: rhapi.server.info unavailable", exc_info=True)
        send(
            EVT_HELLO_ACK,
            {
                "plugin_version": PLUGIN_VERSION,
                "rhapi_version": f"{rhapi.API_VERSION_MAJOR}.{rhapi.API_VERSION_MINOR}",
                "rh_version": info.get("release_version"),
                "seat_count": len(rhapi.interface.seats or []),
                "redirect_home": redirect_enabled(rhapi),
                "capture": recorder.capture.summary() if recorder.capture else None,
            },
        )

    def on_capture_start(data=None, *_args, **_kwargs):
        seat = int((data or {}).get("seat", -1))
        try:
            summary = recorder.start(seat)
        except ValueError as e:
            rhapi.ui.message_alert(f"GridFPV capture: {e}")
            return
        logger.info("gridfpv capture: recording seat %d", seat + 1)
        rhapi.ui.socket_broadcast(EVT_CAPTURE, {**summary, "times": [], "values": [], "crossings": []})

    def on_capture_stop(*_args, **_kwargs):
        summary = recorder.stop()
        if summary:
            logger.info("gridfpv capture: seat %d stopped, %d samples", summary["seat"] + 1, summary["samples"])

    def on_capture_get(*_args, **_kwargs):
        current = recorder.current()
        send(EVT_CAPTURE, current if current else {"state": "none"})

    def on_presets_get(*_args, **_kwargs):
        send(EVT_PRESETS, {"presets": presets.load(rhapi)})

    def on_presets_save(data=None, *_args, **_kwargs):
        data = data or {}
        try:
            new = presets.save(rhapi, data.get("name"), data.get("seats"))
        except presets.PresetError as e:
            rhapi.ui.message_alert(f"GridFPV preset: {e}")
            return
        rhapi.ui.socket_broadcast(EVT_PRESETS, {"presets": new})

    def on_presets_delete(data=None, *_args, **_kwargs):
        try:
            new = presets.delete(rhapi, (data or {}).get("id"))
        except presets.PresetError as e:
            rhapi.ui.message_alert(f"GridFPV preset: {e}")
            return
        rhapi.ui.socket_broadcast(EVT_PRESETS, {"presets": new})

    rhapi.ui.socket_listen(EVT_HELLO, on_hello)
    rhapi.ui.socket_listen(EVT_PRESETS_GET, on_presets_get)
    rhapi.ui.socket_listen(EVT_PRESETS_SAVE, on_presets_save)
    rhapi.ui.socket_listen(EVT_PRESETS_DELETE, on_presets_delete)
    rhapi.ui.socket_listen(EVT_CAPTURE_START, on_capture_start)
    rhapi.ui.socket_listen(EVT_CAPTURE_STOP, on_capture_stop)
    rhapi.ui.socket_listen(EVT_CAPTURE_GET, on_capture_get)


def build_recorder(rhapi) -> capture.Recorder:
    return capture.Recorder(
        seats_fn=lambda: rhapi.interface.seats,
        on_chunk=lambda chunk: rhapi.ui.socket_broadcast(EVT_CAPTURE_CHUNK, chunk),
        on_done=lambda full: rhapi.ui.socket_broadcast(EVT_CAPTURE, full),
    )


def start_recorder_loop(recorder: capture.Recorder) -> None:
    """Tick the recorder on RotorHazard's gevent loop. Idle ticks are a no-op."""
    import gevent

    def loop():
        while True:
            try:
                recorder.tick()
            except Exception:  # pragma: no cover - keep the loop alive whatever happens
                logger.exception("gridfpv capture: tick failed")
            gevent.sleep(capture.TICK_SECONDS)

    gevent.spawn(loop)


def initialize(rhapi, static_dir: str = DEFAULT_STATIC_DIR, start_loop: bool = True) -> None:
    """RotorHazard's plugin entry point."""
    register_options(rhapi)
    recorder = build_recorder(rhapi)
    register_socket(rhapi, recorder)
    rhapi.ui.blueprint_add(build_blueprint(rhapi, static_dir))
    if start_loop:
        start_recorder_loop(recorder)
    built = os.path.isfile(os.path.join(static_dir, "index.html"))
    logger.info(
        "GridFPV %s: UI at %s (%s)",
        PLUGIN_VERSION,
        URL_PREFIX,
        "built" if built else "NOT BUILT — run `make build`",
    )
