"""Admin gate for the plugin's pages, matching RotorHazard's own rules (decision #11).

RotorHazard protects its admin pages with HTTP basic auth checked against the admin
username and password in its config (``server.py: check_auth``), and opens everything when
both are blank. We apply the same check, with the same realm string, so a browser that has
logged into RotorHazard's settings page is already logged into ours and vice versa.

Which paths are admin is decided here, by URL: the landing page, the live pages and the
built assets are public; everything else under /grid needs the login.
"""

from flask import Response, request

#: Same realm RotorHazard's ``authenticate()`` sends, so the browser reuses credentials.
REALM = 'Basic realm="Login Required"'

#: Path prefixes (relative to the blueprint prefix) that never require login.
PUBLIC_PREFIXES = ("live",)
#: Files the SPA shell needs before anyone can log in.
PUBLIC_FILES = ("assets/", "branding/", "favicon.svg", "index.html")


def is_public(subpath: str) -> bool:
    """True for the landing page (empty path), the live pages, and the shell's assets."""
    if not subpath:
        return True
    for prefix in PUBLIC_PREFIXES:
        if subpath == prefix or subpath.startswith(prefix + "/"):
            return True
    for prefix in PUBLIC_FILES:
        if subpath.startswith(prefix):
            return True
    return False


def credentials_ok(rhapi, auth) -> bool:
    """RotorHazard's rule: open when both admin fields are blank, else username+password."""
    username = rhapi.config.get("SECRETS", "ADMIN_USERNAME") or ""
    password = rhapi.config.get("SECRETS", "ADMIN_PASSWORD") or ""
    if not username and not password:
        return True
    return bool(auth and auth.username == username and auth.password == password)


def challenge() -> Response:
    return Response(
        "GridFPV: this page needs the RotorHazard admin login.\n",
        401,
        {"WWW-Authenticate": REALM},
    )


def gate(rhapi, subpath: str):
    """Return a 401 challenge for an admin path without valid credentials, else None."""
    if is_public(subpath):
        return None
    if credentials_ok(rhapi, request.authorization):
        return None
    return challenge()
