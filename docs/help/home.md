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
7. **Seats** and **Overlays**: channels and thresholds; stream overlays for OBS.

Every page has a **?** that opens its help. This help ships inside the plugin and works
with no internet at the field.

## RotorHazard agrees

RotorHazard's own pages (Format, Run, Marshal, Results) stay reachable at their usual
addresses and always show what GridFPV wrote. If a page here cannot set something
RotorHazard can, it says so and links there.
