# Race formats

A format is how one race is run. A stage points at one; the same format can serve many
stages, and RotorHazard ships with a sensible set.

- **Clock**: a fixed time counting down, or no limit counting up; what happens when time
  runs out (stop at once, finish the lap within so many seconds, keep running).
- **Winner**: most laps in the fastest time, first to a lap target, fastest single lap,
  fastest consecutive laps (over the event's consecutive laps base), and the tie rules.
- **Start**: prestage tones, minimum and random staging delay, tones while staging.
- **Racing mode**: individual, team, co-op.
- **Points**: a points method and its own settings (for example "Position" with a points
  list), which cumulative-points stages add up.

**New format** and **Duplicate** open a draft; nothing is written until **Save**. A format
with saved races warns that changing it recalculates those results. A format a stage uses
cannot be deleted; change the stage's format first.
