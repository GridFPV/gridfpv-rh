# Marshal

Fix a saved race after the fact, the way RotorHazard's own Marshal page does, with the
same results. Pick the race and the pilot; the RSSI trace shows what the timer saw, the
ticks along the top are the passes it recorded, and the table lists the laps.

## Recalculate from the signal

Drag the **enter** and **exit** lines on the trace, or type into the **enter** and **exit**
boxes under the table, and the laps are found again from the recording with those
thresholds: a crossing opens when the signal rises above enter, the pass is the middle of
its peak, and it closes when the signal falls below exit. A threshold never crosses the
other one; it drags it along. Passes before the start are dropped; after a timed race's
time is up the first lap still counts and later ones are deleted. Laps added by hand or
by a tool survive a recalculation and slot in by time.

The event's **minimum lap time** and **ignore crossings before** (Event page) apply here
as the timer would have applied them. RotorHazard's own Marshal page reads both as 0 and
ignores them when it recalculates, so its page can show more laps than this one does; what
is saved from here is what the timer would have scored.

## Laps

Click a lap to delete it (it stays, greyed, and RotorHazard keeps it as deleted); click
again to restore it. **Manual lap** adds a lap at the seconds you type since the start,
marked "manual"; lap times are re-measured around it. **Clean deleted laps** drops the
deleted laps from the list so a save forgets them for good. **Load from seat** copies the
seat's current enter and exit into the boxes and recalculates. **Use these thresholds on
the seat** goes the other way: the seat races with them from now on.

## Save, move

**Save laps** writes the laps and thresholds back onto the saved race; RotorHazard rebuilds
the results and the Results and Stages pages follow. **Move to heat** with **Reassign**
moves the whole saved race (its round and every pilot's run) under another heat, as
RotorHazard's Reassign Heat does; a grouped stage's raced heats cannot take it.

A race that was just stopped and not yet saved can be marshalled too: pick "the stopped
race" at the top; saving replaces the laps on the timer before you save the race on Run.
