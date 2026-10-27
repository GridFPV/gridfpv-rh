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

logger = logging.getLogger(__name__)

#: Characters no sane filesystem (or RotorHazard's path building) accepts in a file name.
BAD_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]+')
MAX_NAME = 80


class ArchiveError(ValueError):
    """An archive that could not be made, with a message fit for the UI."""


def safe_name(name) -> str:
    """The event name as a file name: bad characters become '-', blanks become 'event'."""
    cleaned = BAD_CHARS.sub("-", str(name or "")).strip(" .-")
    cleaned = re.sub(r"\s+", " ", cleaned)[:MAX_NAME].strip(" .-")
    return cleaned or "event"


def archive(rhapi, name) -> str:
    """Copy the database to db_bkp/<safe name>.db (RotorHazard adds a timestamp if it exists).
    Returns the file name; raises ArchiveError when no file landed."""
    ctx = getattr(rhapi, "_racecontext", None)
    if ctx is None:
        raise ArchiveError("this RotorHazard does not expose its data layer")
    wanted = safe_name(name)
    try:
        path = ctx.rhdata.backup_db_file(True, use_filename=wanted)
    except Exception as e:  # backup_db_file catches its own errors; this is belt and braces
        logger.exception("gridfpv archive: backup raised")
        raise ArchiveError(f"RotorHazard could not copy the database ({e})") from e
    if not path or not os.path.isfile(path):
        raise ArchiveError("RotorHazard could not copy the database; nothing was reset")
    logger.info("gridfpv archive: %s", path)
    return os.path.basename(path)
