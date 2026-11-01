# Overlays

Browser-source overlays for OBS: the race overlay in dark and light, at `/grid/live/race`.
Copy a link into an OBS Browser source. They also show on RotorHazard's Streams page.

## Placement

Where the panel sits is the overlay's own setting, kept by the timer: a corner, how far in
from its edges, its size as a percentage, and how solid its background is — from 0, the
text alone over the video, to 100, a solid sheet. The size and the corner apply to the panel's
head — title, clock, pilot and bests; the lap list hangs below the head and grows downward
whichever corner you chose, so the clock never moves as laps come in. In a bottom corner,
leave room below for up to six laps. Set it on the Overlays page and the live
page, the replay and so every render by the video companion draw it the same — so the
rendered file matches the stream. OBS can still move and scale the browser source, but
that only moves the live picture.

## Replay

The same race overlay drawn from a **saved** race instead of the timer: the laps as they
stand after marshalling, at a moment you choose. Add the race to the overlay's URL —
`/grid/live/race?heat=4&round=7&t=12500` — and the panel shows race time `t`
(milliseconds from the start signal; negative is staging) and never ticks. `end` is the
race time the race was stopped: the clock freezes there and the phase reads FINISHED.
`layout=solo` or `layout=field` forces the one-pilot or the table form, and `pilot=` picks
whom the solo form follows. The Replay card builds the URL for you.

This is the page the RaceGOW video re-render screenshots frame by frame to put a
corrected overlay on a clean recording: the renderer calls `window.gridfpvReplay.seek(ms)`
once per frame, so frame N is race time N/fps, identical every run. Nothing about the video
lives on the timer.

## Video companion

The Overlays page also offers the **video companion**: a program for the OBS machine
(Windows) that records each run clean — and, with a second scene named, the overlaid
program too, so the finished video comes straight from OBS — writes down where the start
signal sits in the file, names the files after the run (event, class, heat and round, or
the RaceGOW name), and renders the corrected overlay onto the clean recording when a marshal
changes the laps, when you ask, or after every save if you prefer. It comes two ways:

- **GridFPV Video**, a small desktop app (the installer is on the repository's releases
  page, built for Windows by GitHub Actions). Profiles keep the settings per event — the
  timer, OBS, what records each run, where files go, the look of the render — and the
  window shows the session's runs and the log. Press Start and fly.
- The **console companion**, a zip inside this plugin: unzip, enable OBS's WebSocket
  server, double-click `gridfpv-video.cmd`, answer three questions. `gridfpv-video.cmd ui`
  opens the same window in your browser.

Both carry their own Node and JavaScript, fetch ffmpeg once on first run, and draw frames
with Edge. **What records each run** is a profile choice: OBS's own recording, started and
stopped per run (a session where nothing else is being recorded), or a **clean scene of its
own** through the Source Record filter, so OBS can stream the program and record the whole
day while every run still lands in a clean file. On a race day a **second, overlaid scene**
can be recorded too: its file becomes the finished video at the save, free from OBS, and
nothing renders until you ask — a marshal only marks the run, and **Render all** in the
helper does the rendering when the PC has the room. Details in the companion's README.
