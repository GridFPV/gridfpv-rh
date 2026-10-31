# GridFPV for RotorHazard

GridFPV is a race director's UI on top of RotorHazard. RotorHazard keeps timing the
gates and owning the data; GridFPV gives you the event, pilots, stages and race day in
one place, and everything you change here is written to RotorHazard and read back before
it is confirmed.

## A race day, in order

1. **Event**: name the day, set the lap rules.
2. **Pilots** and **Teams**: who is flying. Pilots come back from the roster next time.
3. **Formats**: how one race is run (clock, winner, start tones, points).
4. **Stages**: practice, qualifying, brackets, Chase the Ace; heats and rounds on a board.
5. **Run**: pick the heat, start, watch, save; the board tells you what is next.
6. **Marshal**: fix a lap after the fact.
7. **Seats**: channels, profiles, thresholds and calibration. **Overlays**: stream overlays for OBS.

## Modes

The Home page's **Mode** chooses how much of Grid this timer shows. It is one setting for
the whole timer — every phone, laptop and overlay machine on it sees the same thing — and it
stays until someone changes it.

- **Full**: every page.
- **Simple**: a club night without the machinery. Teams and Formats leave the nav, and
  Stages loses brackets, seeding and Chase the Ace.
- **RaceGOW**: Simple, in racegow's words — seasons, tracks and runs, one pilot on one seat.

A hidden page is still there by its address and from this help; the mode is about what is
in the way, not about locking anything.

Every page has a **?** that opens its help. This help ships inside the plugin and works
with no internet at the field.

## RotorHazard agrees

RotorHazard's own pages (Settings, Format, Run, Marshal, Results) stay reachable at their
usual addresses and always show what GridFPV wrote. What GridFPV does not cover yet (LEDs,
plugins, the server and database settings, voice-recognition and VRx control) is still set
on RotorHazard's own pages; it comes to GridFPV tier by tier.
