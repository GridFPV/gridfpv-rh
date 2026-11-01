# gridfpv-video — the GridFPV video companion

A small program for the **OBS machine** (not the timer). It listens to RotorHazard, has OBS
record each run clean, writes down where the start signal sits in the file, and after every
save — and again after every marshal — renders the corrected overlay onto the recording.
The finished file just appears: `RaceGOW 2 Track 4 Round 7.mp4`, with `… overlay.webm`
(the overlay alone, with alpha) beside it for a vertical cut in Resolve. It never uploads
anything. Design and reasons: GridFPV/gridfpv-rh#96; the window and the independent
recording: #99, #98 (plan: #101).

## The window: GridFPV Video

The same pipeline behind a small desktop app (`helper/`, Tauri 2; the installer for Windows
is built by GitHub Actions — `.github/workflows/helper-windows.yml` — and published on the
repository's releases page). Install it, and:

- **Profiles** (the Profiles tab): a named set of settings, kept per user in
  `%APPDATA%\GridFPV Video\profiles\*.json` — the timer, OBS, what records each run, where
  files go, the look of the render. A new profile asks for the timer and OBS first and
  **tries both** before showing the rest, so the rest can offer what OBS has — its scenes,
  with the ones carrying a Source Record filter marked — instead of asking for names typed;
  _Try the connections_ does the same on an existing profile. Paths have a **Browse…**
  button (the OS's own dialog; a folder browser of the helper's when there is none). The
  Source Record filter's name is only asked when a scene carries more than one. Add,
  duplicate, rename, delete; the last one used starts selected. A `gridfpv-video.json`
  beside the console program is imported as the first profile.
- **Start / Stop** in the header with the profile to use; two pills say whether the timer
  is synced and OBS is connected.
- **Session** shows every run this session knows — recording, finishing, waiting for the
  save, saved, rendering, rendered — with _Open folder_ and _Render again_, and the log.

**What records each run** (`recordFrom`):

- `obs` — OBS's own Record output, started on staging and stopped after the tail. Right for
  a practice session where nothing else is being recorded.
- `scene` — a scene of your own (`scene`, e.g. `Clean`: the capture feed, no overlay),
  recorded by exeldro's **[Source Record](https://github.com/exeldro/obs-source-record/releases)** (its Windows installer is among the release assets)
  filter to its own file, while OBS's Stream and Record outputs run untouched. The
  race-day shape: OBS streams the program and records the whole day, and every run still
  lands in a clean file. Install Source Record in OBS (0.4.8 or newer; OBS 30–33), add the
  filter to the scene (set its encoder and folder there), name the scene in the profile.
  The helper starts and stops it over obs-websocket (`source-record` vendor requests) and
  names the files `clean heat N <date time>.<ext>`. The helper sets the filter's folder itself
  before every start — `recordDir`, else the folder the filter already had, else OBS's
  recording folder — because Source Record's own default is a different OBS setting (the
  "Custom Output (FFmpeg)" path in Advanced output mode) and a file would land where nobody
  looks. `sceneFilter` is only needed when the scene carries several filters; a scene with
  none gets one made, named "Source Record".

The console form below does everything the window does, from a terminal; `gridfpv-video.cmd ui`
(or `npx gridfpv-video serve --open`) opens the same window in a browser.

## What it does on race day

| Timer says                     | Companion does                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Staging                        | starts the recording — OBS's own, or the clean scene's (Source Record) — unless one is on                                             |
| Start                          | notes how far into the recording the start signal is (the timer's clock, synced)                                                      |
| Stop                           | records a few more seconds, stops OBS, writes `<recording>.gridfpv.json`                                                              |
| Round saved                    | names the run from the timer (`RaceGOW {season} {track} Round {round}`) and renders                                                   |
| Ready, nothing saved (Discard) | after `discardAfterSeconds` (20) with no new round, moves the recording to `trash/` (never deletes; `trashDiscarded: false` keeps it) |
| Results change (a marshal)     | re-renders every run whose laps differ from what was last rendered                                                                    |
| A round deleted in Grid        | moves its recording and renders to `trash/`                                                                                           |

Renders are idempotent on the laps: the same laps never render twice.

## Setup on Windows (the usual case)

1. On the timer, open Grid → **Overlays** → **Download for Windows (zip)**. The zip carries
   its own Node and every JavaScript dependency; nothing to install.
2. Unzip it anywhere, e.g. `C:\gridfpv-video`.
3. In OBS: Tools → WebSocket Server Settings → enable the server, set a password. Record
   the clean capture: the recorded scene has no overlay (keep the live overlay on the
   stream scene if you stream, or use the `obs-source-record` filter).
4. Double-click `gridfpv-video.cmd`. The first run fetches ffmpeg (once, 115 MB, from
   gyan.dev; Windows' own `curl` and `tar` do it) and asks for the timer's address, the
   RotorHazard login and the OBS password, saved to `gridfpv-video.json`. Then it watches.
   Frames are drawn with Edge, which Windows 11 has. Leave the window open while you fly.

`gridfpv-video.cmd probe` checks everything; `gridfpv-video.cmd render "<recording>"`
renders a run again; edit `gridfpv-video.json` for the rest (below).

## Setup elsewhere (from source)

1. **OBS**: Tools → WebSocket Server Settings → enable, note the port and password. Record
   the **clean** capture: a scene with the capture card only (keep the live overlay on the
   stream scene if you stream, or use the `obs-source-record` filter). Any container is fine;
   `mkv` survives a crash.
2. **ffmpeg** on the PATH (or `"ffmpeg": "C:\\tools\\ffmpeg\\bin\\ffmpeg.exe"`), a build with
   `libx264` and `libvpx-vp9` (the usual Windows and Homebrew builds have both; `prores` for
   a ProRes 4444 overlay needs `prores_ks`, also usual).
3. **A browser**: Chrome or Edge installed (`"browserChannel": "chrome"` / `"msedge"`), or run
   `npx playwright-core install chromium` once and set it to `""`.
4. **Node 20+**, then in this folder `npm install`.
5. `gridfpv-video.json` here:

```json
{
  "timer": "http://recon-nh.local:5000",
  "timerUser": "admin",
  "timerPass": "…",
  "obs": "ws://127.0.0.1:4455",
  "obsPass": "…",
  "outDir": "",
  "tailSeconds": 3,
  "composite": true,
  "overlayOnly": "vp9",
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "theme": "dark",
  "layout": "solo",
  "browserChannel": "chrome"
}
```

Secrets can come from the environment instead: `GRIDFPV_TIMER`, `GRIDFPV_TIMER_USER`,
`GRIDFPV_TIMER_PASS`, `GRIDFPV_OBS`, `GRIDFPV_OBS_PASS`, `GRIDFPV_FFMPEG`, `GRIDFPV_BROWSER`.

6. `npx gridfpv-video probe` — checks ffmpeg's encoders, the timer and its clock sync (the
   spread of the samples is your alignment error; a few ms on a LAN), and OBS.
7. `npx gridfpv-video watch` — leave it running during the session.

## Renders by hand

`npx gridfpv-video render "<recording or its .gridfpv.json>"` renders (again) from a sidecar.
A sidecar with no round yet (the companion was not watching when the run was saved) is
matched to the heat's newest round. Edit the sidecar's `round` if that is wrong.

The overlay page itself is `http://<timer>:5000/grid/live/race?heat=H&round=R&t=<ms>` — open it
to check a frame by eye; Grid's Overlays page builds the link.

## How the picture lines up

OBS made the recording, so nothing is recovered from pixels. At the start signal the
companion reads how long OBS has been recording and how old the race is on the timer's own
clock (sampled ten times at connect, median kept, like Grid's run page), and the difference
is where the start sits in the file. The overlay is then drawn frame by frame at exactly
that race time; the clock's tenths and each lap land on the frame they belong to.

## Tests

The real thing, in containers: `make rig-up obs-up` starts RotorHazard and a headless OBS
(Ubuntu's obs-studio under Xvfb, obs-websocket on :4455, password `gridfpv`, recording a
colour source to `dev/recordings`), and `make video-test` plays a race day against both — a
run recorded, saved and rendered; a marshal re-rendered once; a discard trashed — then
decodes what landed. CI runs it. `make obs-logs` has OBS's log; `make obs-down` stops it.

`npm test` runs the state machine and the pure parts in a fake race day. `npm run smoke`
renders a real run from a timer (defaults to the dev rig at `localhost:5050`) and decodes
the result; it needs a Chromium and an ffmpeg with `libvpx-vp9` — see the note in
`smoke/render-rig.mjs` for running it in the Playwright image.
