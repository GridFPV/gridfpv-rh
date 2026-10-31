# gridfpv-video — the RaceGOW video companion

A small program for the **OBS machine** (not the timer). It listens to RotorHazard, has OBS
record each run clean, writes down where the start signal sits in the file, and after every
save — and again after every marshal — renders the corrected overlay onto the recording.
The finished file just appears: `RaceGOW 2 Track 4 Round 7.mp4`, with `… overlay.webm`
(the overlay alone, with alpha) beside it for a vertical cut in Resolve. It never uploads
anything. Design and reasons: GridFPV/gridfpv-rh#96.

## What it does on race day

| Timer says                     | Companion does                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| Staging                        | starts the OBS recording (unless one is already on)                                         |
| Start                          | notes how far into the recording the start signal is (the timer's clock, synced)            |
| Stop                           | records a few more seconds, stops OBS, writes `<recording>.gridfpv.json`                    |
| Round saved                    | names the run from the timer (`RaceGOW {season} {track} Round {round}`) and renders         |
| Ready, nothing saved (Discard) | moves the recording to `trash/` beside it (never deletes; `trashDiscarded: false` keeps it) |
| Results change (a marshal)     | re-renders every run whose laps differ from what was last rendered                          |
| A round deleted in Grid        | moves its recording and renders to `trash/`                                                 |

Renders are idempotent on the laps: the same laps never render twice.

## Setup

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
