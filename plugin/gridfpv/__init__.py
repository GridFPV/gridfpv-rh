"""GridFPV for RotorHazard — the plugin entry point.

RotorHazard imports this package as ``plugins.gridfpv`` and calls :func:`initialize` with
its ``rhapi`` object (RHAPI 1.4+, RotorHazard 4.4.0+). Everything the plugin does on the
Python side is registered here, and it is deliberately thin:

- a Flask blueprint that serves the built single-page app under ``/grid``, gating admin
  pages on RotorHazard's own login (``auth.py``);
- the ``gridfpv_*`` socket.io channel: a hello / hello-ack handshake, capture-mode
  tuning (``capture.py``), custom channel presets (``presets.py``), teams (``teams.py``)
  and the event's details (``event.py``);
- a filter on RotorHazard's pilot data so its own pilot page offers our team names;
- a *GridFPV* settings panel with the plugin's options, and a panel on RotorHazard's
  Streams page listing the overlay URLs;
- an optional redirect that sends RotorHazard's home page to ``/grid``.

Race logic stays in RotorHazard. The UI reads and writes through RotorHazard's own socket
events, so everything it does shows up correctly in RotorHazard's pages.
"""

import logging
import os

from flask import Blueprint, abort, redirect, request, send_from_directory

from . import archive, auth, capture, event, presets, races, roster, teams

logger = logging.getLogger(__name__)

PLUGIN_VERSION = "0.3.3"

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
EVT_TEAMS_GET = "gridfpv_teams_get"
EVT_TEAMS_SAVE = "gridfpv_teams_save"
EVT_TEAMS_DELETE = "gridfpv_teams_delete"
#: Broadcast: the full team list, after any change and on request.
EVT_TEAMS = "gridfpv_teams"
EVT_EVENT_GET = "gridfpv_event_get"
EVT_EVENT_SAVE = "gridfpv_event_save"
EVT_EVENT_CLEAR = "gridfpv_event_clear"
#: Broadcast: the whole event (name, description, details), after any change and on request.
EVT_EVENT = "gridfpv_event"
#: The roster (#14): pilots that outlive events. gridfpv_roster carries every entry with an
#: in_event flag; after an add it also carries ``added`` (callsigns created).
EVT_ROSTER_GET = "gridfpv_roster_get"
EVT_ROSTER_ADD = "gridfpv_roster_add"
EVT_ROSTER_REMOVE = "gridfpv_roster_remove"
EVT_ROSTER = "gridfpv_roster"
#: Archive the database under a name (sanitised); answered with gridfpv_archived {ok, file}.
EVT_ARCHIVE = "gridfpv_archive"
EVT_ARCHIVED = "gridfpv_archived"
EVT_RACES_DELETED_GET = "gridfpv_races_deleted_get"
EVT_RACE_DELETE = "gridfpv_race_delete"
EVT_RACE_RESTORE = "gridfpv_race_restore"
EVT_RACE_FORGET = "gridfpv_race_forget"
#: Broadcast: the deleted races that can be restored, after any change and on request;
#: carries ``backup`` (the database backup file a delete made) and ``changed`` (heat/round).
EVT_RACES_DELETED = "gridfpv_races_deleted"

#: Class attribute carrying the Grid stage type ("ace", "ace-row"); see lib/ace.ts (#37).
CLASS_ATTR_STAGE = "gridfpv_stage"

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


#: Panel on RotorHazard's own Streams page listing our overlay URLs next to its overlays.
STREAMS_PANEL = "gridfpv_streams"
STREAMS_MARKDOWN = (
    "- [Race overlay (dark)](/grid/live/race)\n"
    "- [Race overlay (light)](/grid/live/race/light)\n\n"
    "Copy a link into an OBS Browser source. More on the [GridFPV Overlays page](/grid/overlays)."
)


def register_streams(rhapi) -> None:
    """List our overlays on RotorHazard's Streams page (``/streams``), under its own."""
    rhapi.ui.register_panel(STREAMS_PANEL, "GridFPV overlays", "streams", order=0, open=True)
    rhapi.ui.register_markdown(STREAMS_PANEL, "links", STREAMS_MARKDOWN)


def register_options(rhapi) -> None:
    from RHUI import UIField, UIFieldType  # RotorHazard's own module; only importable in-process

    rhapi.ui.register_panel(PANEL, "GridFPV", "settings", order=0)
    # A stage's type rides on RotorHazard's class as an attribute, so it is archived, reset
    # and emitted (class_data) with the class, and visible on RotorHazard's Format page.
    rhapi.fields.register_raceclass_attribute(
        UIField(
            CLASS_ATTR_STAGE,
            "GridFPV stage",
            UIFieldType.TEXT,
            desc="Set by GridFPV's Stages page: 'ace' or 'ace-row' for Chase the Ace.",
        )
    )
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

    def on_teams_get(*_args, **_kwargs):
        send(EVT_TEAMS, {"teams": teams.load(rhapi)})

    def on_teams_save(data=None, *_args, **_kwargs):
        data = data or {}
        try:
            new = teams.save(rhapi, data.get("id") or None, data.get("name"), data.get("description"))
        except teams.TeamError as e:
            rhapi.ui.message_alert(f"GridFPV team: {e}")
            return
        rhapi.ui.socket_broadcast(EVT_TEAMS, {"teams": new})

    def on_teams_delete(data=None, *_args, **_kwargs):
        try:
            new = teams.delete(rhapi, (data or {}).get("id"))
        except teams.TeamError as e:
            rhapi.ui.message_alert(f"GridFPV team: {e}")
            return
        rhapi.ui.socket_broadcast(EVT_TEAMS, {"teams": new})

    def on_event_get(*_args, **_kwargs):
        send(EVT_EVENT, event.load(rhapi))

    def on_event_save(data=None, *_args, **_kwargs):
        try:
            out = event.save(rhapi, data or {})
        except event.EventError as e:
            rhapi.ui.message_alert(f"GridFPV event: {e}")
            return
        rhapi.ui.socket_broadcast(EVT_EVENT, out)

    # Saved races (#36): delete keeps a copy, restore puts it back. RotorHazard's own path
    # on RHAPI 1.12+, the plugin's snapshot path on 4.4.0; see races.py.
    def _races_payload(**extra):
        return {"races": races.load(rhapi), "native": races.is_native(rhapi), **extra}

    def on_event_clear(*_args, **_kwargs):
        rhapi.ui.socket_broadcast(EVT_EVENT, event.clear_extras(rhapi))
        # A new event: the kept copies of deleted races belong to the old one (#48).
        races.forget_all(rhapi, "new event")
        rhapi.ui.socket_broadcast(EVT_RACES_DELETED, _races_payload())

    # RotorHazard's own reset / restore drop them too (#48).
    races.hook_database_events(rhapi)

    def _roster_payload(**extra):
        return {"pilots": roster.listing(rhapi), "path": roster.path(rhapi), **extra}

    def on_roster_get(*_args, **_kwargs):
        try:
            roster.capture_all(rhapi)  # whatever this event already has belongs in the roster
        except Exception:
            logger.exception("gridfpv roster: capture failed")
        send(EVT_ROSTER, _roster_payload())

    def on_roster_add(data=None, *_args, **_kwargs):
        try:
            added = roster.add_to_event(rhapi, (data or {}).get("ids") or [])
        except (roster.RosterError, TypeError, ValueError) as e:
            rhapi.ui.message_alert(f"GridFPV roster: {e}")
            return
        broadcast_pilots = getattr(rhapi.ui, "broadcast_pilots", None)
        if callable(broadcast_pilots):
            try:
                broadcast_pilots()
            except Exception:
                logger.debug("gridfpv roster: broadcast_pilots failed", exc_info=True)
        rhapi.ui.socket_broadcast(EVT_ROSTER, _roster_payload(added=added))

    def on_roster_remove(data=None, *_args, **_kwargs):
        roster.remove(rhapi, (data or {}).get("id"))
        rhapi.ui.socket_broadcast(EVT_ROSTER, _roster_payload())

    roster.hook_pilot_events(rhapi)

    def on_archive(data=None, *_args, **_kwargs):
        name = str((data or {}).get("name") or "")
        try:
            file = archive.archive(rhapi, name)
        except archive.ArchiveError as e:
            rhapi.ui.message_alert(f"GridFPV archive: {e}")
            send(EVT_ARCHIVED, {"ok": False, "file": None, "name": name, "message": str(e)})
            return
        send(EVT_ARCHIVED, {"ok": True, "file": file, "name": name})

    def on_races_deleted_get(*_args, **_kwargs):
        send(EVT_RACES_DELETED, _races_payload())

    def on_race_delete(data=None, *_args, **_kwargs):
        data = data or {}
        try:
            out = races.delete(rhapi, data.get("heat_id"), data.get("round_id"))
        except (races.RaceError, TypeError, ValueError) as e:
            rhapi.ui.message_alert(f"GridFPV race: {e}")
            return
        rhapi.ui.socket_broadcast(
            EVT_RACES_DELETED,
            _races_payload(backup=out["backup"], changed={"heat_id": int(data["heat_id"]), "round_id": int(data["round_id"]), "action": "deleted"}),
        )

    def on_race_restore(data=None, *_args, **_kwargs):
        try:
            out = races.restore(rhapi, (data or {}).get("id"))
        except (races.RaceError, TypeError, ValueError) as e:
            rhapi.ui.message_alert(f"GridFPV race: {e}")
            return
        rhapi.ui.socket_broadcast(EVT_RACES_DELETED, _races_payload(changed={**out, "action": "restored"}))

    def on_race_forget(data=None, *_args, **_kwargs):
        races.forget(rhapi, (data or {}).get("id"))
        rhapi.ui.socket_broadcast(EVT_RACES_DELETED, _races_payload())

    rhapi.ui.socket_listen(EVT_HELLO, on_hello)
    rhapi.ui.socket_listen(EVT_EVENT_GET, on_event_get)
    rhapi.ui.socket_listen(EVT_EVENT_SAVE, on_event_save)
    rhapi.ui.socket_listen(EVT_EVENT_CLEAR, on_event_clear)
    rhapi.ui.socket_listen(EVT_ROSTER_GET, on_roster_get)
    rhapi.ui.socket_listen(EVT_ROSTER_ADD, on_roster_add)
    rhapi.ui.socket_listen(EVT_ROSTER_REMOVE, on_roster_remove)
    rhapi.ui.socket_listen(EVT_ARCHIVE, on_archive)
    rhapi.ui.socket_listen(EVT_RACES_DELETED_GET, on_races_deleted_get)
    rhapi.ui.socket_listen(EVT_RACE_DELETE, on_race_delete)
    rhapi.ui.socket_listen(EVT_RACE_RESTORE, on_race_restore)
    rhapi.ui.socket_listen(EVT_RACE_FORGET, on_race_forget)
    rhapi.ui.socket_listen(EVT_TEAMS_GET, on_teams_get)
    rhapi.ui.socket_listen(EVT_TEAMS_SAVE, on_teams_save)
    rhapi.ui.socket_listen(EVT_TEAMS_DELETE, on_teams_delete)
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


def register_filters(rhapi) -> None:
    """Our team names replace RotorHazard's A–Z list in its own pilot dropdown."""
    try:
        from filtermanager import Flt  # RotorHazard's own module

        hook = Flt.EMIT_PILOT_DATA
    except Exception:  # pragma: no cover - the string value is verified against 4.4.0
        hook = teams.FILTER_HOOK
    rhapi.filters.add(hook, teams.FILTER_NAME, teams.filter_pilot_data(rhapi))


def initialize(rhapi, static_dir: str = DEFAULT_STATIC_DIR, start_loop: bool = True) -> None:
    """RotorHazard's plugin entry point."""
    register_options(rhapi)
    register_streams(rhapi)
    register_filters(rhapi)
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
