"""Archive the database under the event's name, safely (#43).

RotorHazard's own ``reset_database with_archive`` names the backup after the raw ``eventName``
option, so a name with a "/" (a date: "Club Night 10/27") makes the copy fail on the path; it
logs the error, returns None and clears the database anyway. Grid's new-event flow therefore
archives through here first — a file name RotorHazard's data layer accepts, verified on disk —
and resets only after the archive exists.
"""

from __future__ import annotations

import logging
import os
import re

from . import datadir


logger = logging.getLogger(__name__)

#: Characters no sane filesystem (or RotorHazard's path building) accepts in a file name.
BAD_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]+')
MAX_NAME = 80
BKP_DIR = "db_bkp"
#: Backups the plugin takes before deleting a race (#54): listed apart, never offered to restore.
SAFETY_PREFIX = "before-delete_"


class ArchiveError(ValueError):
    """An archive that could not be made, with a message fit for the UI."""


def safe_name(name) -> str:
    """The event name as a file name: bad characters become '-', blanks become 'event'."""
    cleaned = BAD_CHARS.sub("-", str(name or "")).strip(" .-")
    cleaned = re.sub(r"\s+", " ", cleaned)[:MAX_NAME].strip(" .-")
    return cleaned or "event"


def unused_name(wanted: str, bkp_dir: str | None = None) -> str:
    """`wanted`, or `wanted (2)`, `wanted (3)`… — the first not already in db_bkp (#54).
    RotorHazard's own fallback for a taken name is a bare timestamp, which loses the event."""
    d = bkp_dir or os.path.join(os.getcwd(), BKP_DIR)
    if not os.path.isfile(os.path.join(d, wanted + ".db")):
        return wanted
    n = 2
    while os.path.isfile(os.path.join(d, f"{wanted} ({n}).db")):
        n += 1
    return f"{wanted} ({n})"


def safety_name(event_name) -> str:
    """The file name of a backup taken before a race delete: prefixed, event, timestamp."""
    from datetime import datetime

    return f"{SAFETY_PREFIX}{safe_name(event_name)}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"


def is_safety(file_name) -> bool:
    return str(file_name or "").startswith(SAFETY_PREFIX)


def archive(rhapi, name) -> str:
    """Copy the database to db_bkp/<safe name>.db, with a counter when the name is taken.
    Returns the file name; raises ArchiveError when no file landed."""
    ctx = getattr(rhapi, "_racecontext", None)
    if ctx is None:
        raise ArchiveError("this RotorHazard does not expose its data layer")
    wanted = unused_name(safe_name(name), os.path.join(datadir.data_dir(rhapi), BKP_DIR))
    try:
        path = ctx.rhdata.backup_db_file(True, use_filename=wanted)
    except Exception as e:  # backup_db_file catches its own errors; this is belt and braces
        logger.exception("gridfpv archive: backup raised")
        raise ArchiveError(f"RotorHazard could not copy the database ({e})") from e
    if not path or not os.path.isfile(path):
        raise ArchiveError("RotorHazard could not copy the database; nothing was reset")
    logger.info("gridfpv archive: %s", path)
    return os.path.basename(path)
