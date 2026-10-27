"""Where RotorHazard keeps its data: ``database.db``, ``db_bkp/``, ``config.json``, ``plugins/``.

RotorHazard 4.4.0 picks that folder as ``server.py`` starts (``--data``, ``datapath.ini``,
``~/rh-data``, the program folder when it holds a ``config.json``, the working directory when
it does, else ``~/rh-data`` created) and then ``os.chdir()``s into it before any plugin loads,
so at run time the working directory *is* the data folder whatever the service's
WorkingDirectory says. RHAPI 1.4 also names it (``rhapi.server.data_dir``). Ours asks RHAPI
first and falls back to the working directory, so a RotorHazard that one day stops changing
directory still puts our files beside its database.
"""

from __future__ import annotations

import os


def data_dir(rhapi=None) -> str:
    server = getattr(rhapi, "server", None)
    d = getattr(server, "data_dir", None) if server is not None else None
    if isinstance(d, str) and d and os.path.isdir(d):
        return d
    return os.getcwd()
