# Overlays

Browser-source overlays for OBS: the race overlay in dark and light, at `/grid/live/race`.
Copy a link into an OBS Browser source. They also show on RotorHazard's Streams page.

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

The Overlays page also offers the **video companion** for download: a program for the OBS
machine (Windows) that records each run clean, writes down where the start signal sits in
the file, and renders the corrected overlay onto the recording after every save and
marshal. The zip carries its own Node and JavaScript; it fetches ffmpeg once on first run,
and draws frames with Edge. Unzip, enable OBS's WebSocket server, double-click
`gridfpv-video.cmd`, answer three questions. Details in the companion's README.
