# RaceGOW Overlay

The race overlay from GridFPV and nothing else: `/grid/live/race` (and `/grid/live/race/light`)
for an OBS Browser source, plus the RaceGOW and ReconFPV logos in the panel. `/grid` redirects
to the overlay; every other GridFPV page answers 404. Run the race from RotorHazard's own pages.

It serves the same built UI as the full plugin, so the two must not be installed together
(both own `/grid`). `make deploy-overlay TIMER=<host>` removes the full plugin before installing
this one; `make deploy TIMER=<host>` does the reverse.
