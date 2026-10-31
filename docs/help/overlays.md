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
