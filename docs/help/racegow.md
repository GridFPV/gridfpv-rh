# RaceGOW mode

RaceGOW mode is Grid in racegow's words. You work in **seasons, tracks and runs**; the
plugin maps them onto RotorHazard underneath. Switch it on from **Mode** on the Home page;
it is one setting for the whole timer.

## What the words mean

- A **season** is one RotorHazard event — one database. Starting a new season archives the
  previous one (pilots stay). Seasons are numbered; the number goes into every name.
- A **track** is one layout. Every session is a new track, numbered next in the season from
  1, and every track is unique — within a season and across them — so a track's best is its
  all-time best. Underneath it is a class with one heat, unlimited rounds, and "stay on this
  heat" after a race.
- A **run** is one flight of the track: a round of that heat.
- **You** are one pilot on one seat. The pilot comes from the roster, so a new season knows
  you already.

## A session

1. Home shows the season. **New track** makes the next track and loads it on the timer.
2. **Run** — the seat, its channel and tuning are there; start, fly, land, stop.
3. **Marshal** — racegow tracks are small, so nearly every run needs its laps checked.
4. **Results** — the track's best lap and best 3 consecutive, and every run, newest first.

To start a season, **New season…** asks for the number (the next one is offered). To go
back to a past season, **Switch…** under Past seasons puts its archive back on the timer;
this season is archived first, so it can come back the same way. There is no practice in
RaceGOW mode — every run is saved, and a run you do not want is discarded.

## Names and laps

A run is called `RaceGOW {season} {track} Round {round}` — `RaceGOW 2 Track 4 Round 7` —
on the overlay, in Results, and on its recording. The template is yours to change under
**Names and laps** on Home: `{track}` is the track's name, `{round}` must stay (or every
run of a track would share a name), and nothing a file name refuses. The heat itself
carries only the static part (`RaceGOW 2 Track 4`); the round is the run's own.

**Minimum lap** is there too. Racegow tracks are small, so a lap shorter than the minimum is
a false crossing; making a track switches RotorHazard to *discard* short laps as they land,
which leaves Marshal less to clean. This is RotorHazard's own setting, so it holds for
club nights too until it is changed on the Event page.

## What stays RotorHazard's

Our pages, the overlay and the names speak racegow. RotorHazard's own pages still say
class, heat and round, and a season boundary is a database archive underneath. The pages
RaceGOW mode hides — Event, Pilots, Stages, Teams, Formats — are still there by address
for the odd repair.
