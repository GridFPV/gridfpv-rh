# GridFPV for RotorHazard

A modern race-director UI for [RotorHazard](https://github.com/RotorHazard/RotorHazard),
delivered as a RotorHazard plugin. The UI is served from inside the timer at `/grid`;
RotorHazard keeps owning timing, the database, and its own pages. Our UX, RotorHazard's
data model.

Requires RotorHazard **4.4.0+** (RHAPI 1.4). Free software, AGPL-3.0-or-later.

Plans, decisions, and bugs live in
[GitHub issues](https://github.com/GridFPV/gridfpv-rh/issues); phases are milestones.

## Install (a timer)

1. Download `gridfpv-<version>.zip` from a release.
2. Unzip it and copy the inner `gridfpv/` folder into RotorHazard's user plugins
   directory (usually `~/rh-data/plugins/`, so you end up with
   `~/rh-data/plugins/gridfpv/__init__.py`).
3. Restart RotorHazard and open `http://<timer>/grid`.
4. Optional: in RotorHazard's Settings, the **GridFPV** panel has a switch that sends
   the timer's home page to GridFPV.

## Develop

```sh
make setup      # npm ci + a Python venv for the plugin tests
make rig-up     # RotorHazard 4.4.0 with mock nodes on http://localhost:5050, plugin mounted
make build      # build the SPA into plugin/gridfpv/static  → http://localhost:5050/grid
make dev        # or: Vite with hot reload on :5173/grid/, socket.io proxied to the rig
make test       # plugin (unittest) + frontend (vitest)
make lint check # ESLint + Prettier; svelte-check + py_compile
make zip        # dist/gridfpv-<version>.zip, ready to drop into a timer
```

`make help` lists everything. The rig's login is `admin` / `rotorhazard`.

## Layout

```
plugin/gridfpv/     the RotorHazard plugin (this folder is what ships)
  __init__.py       initialize(rhapi): blueprint, socket channel, options, redirect
  manifest.json
  static/           the built SPA (gitignored; `make build` fills it)
plugin/tests/       plugin unit tests, run with a stub rhapi
frontend/           npm workspace — same stack as GridFPV's console
  packages/components/   design tokens + base primitives (carried over from GridFPV)
  apps/plugin-ui/        the Svelte app built into plugin/gridfpv/static
dev/                the local RotorHazard rig (docker compose)
```
