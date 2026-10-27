# Seats

Every seat (RotorHazard calls them nodes) has a channel and two thresholds, enter and
exit, kept together in a frequency **profile**. This page sets all of it and reads every
change back from RotorHazard before it says "confirmed"; RotorHazard's own Settings page
(Frequency Setup, Sensor Tuning) and its Run page's per-seat tuning show the same values
and can stay closed. Top to bottom: the profile bar, the Calibration panel, the quick
Channels row with presets, then one card per seat.

## Profiles

The bar at the top names the active profile. Every channel and threshold on this page
belongs to it, and RotorHazard retunes every seat when you switch. **Edit** renames or
describes it. **New** makes a copy of the active profile under a name you type (that is
the only way RotorHazard makes one), and switches to it. **Delete** removes the active
profile and RotorHazard falls back to its first; the last profile cannot be deleted. A
profile cannot take a name another profile already has: RotorHazard would allow it and
then list two identical entries, so Create and Save stay off with the reason beside the
name.

## Channels

The **Channels** row sets each seat's channel from one dropdown: the analog bands first,
RotorHazard's other channel sets under Other, **Off** for a seat nobody flies, and
**Custom…** for a frequency typed in MHz (RotorHazard stores those without a band tag; a
custom frequency that sits on a table channel gets that channel's name). A pilot seated on
an Off seat is flagged on the Run page: RotorHazard would race them and time nothing.

A **preset** is just channels on seats, not tuning. Built-in presets cover the usual
raceband splits; **Save current…** keeps the channels as they are now under a name of your
own, **Apply** writes a preset seat by seat (each confirmed; the channel in the heat's
profile is what RotorHazard races with), **Delete** removes a custom one. Under the row,
the **IMD** badge rates the channels in use as RotorHazard's IMDTabler does and names the
worst pair, so a bad mix is seen before anyone flies.

## Seat cards

One card per seat: its number and channel, a status pill (Off, Untuned, Ready, Crossing)
and a live bar of the seat's RSSI with the enter and exit marks on it. The card's own
channel box is the same dropdown as the row above.

**Enter** and **Exit** are RotorHazard's enter-at and exit-at levels: a pass starts when
the signal rises above enter and ends when it drops below exit. RotorHazard does not
announce a level changed from its own Settings page, so this page asks for the current
pair every few seconds while it is open, and again as a race stages and starts. Type a value and press
Enter or leave the box; the pair is written together once both are sane. They take whole
numbers from 1 to 255 (RotorHazard's RSSI scale), exit above 0 and below enter; anything
else is refused with the box named and RotorHazard's values come back. **Copy…** writes
this seat's enter and exit to other seats, all or a chosen few, each confirmed. **Tune**
opens the seat's tuning page.

## Tune: capture, trace, nudges

The tuning page records a seat's signal while a pilot flies through the gate, then lets
you set the thresholds on the recording instead of on guesswork. **Start capture**, fly a
few passes, **Stop capture** (one seat records at a time; the page says which). The trace
shows the recording with the enter and exit lines on it: drag a line, or use the **−** and
**+** nudges beside each number. Green bands are the passes these thresholds would record,
blue ticks are the crossings the firmware itself saw, and the list under the trace gives
each pass with its peak; a pass still open at the end of the recording is marked. Each
released drag or run of nudges writes the pair to RotorHazard and is confirmed by readback,
so what the trace shows is what the seat has. Enter cannot be nudged past 255. Close the
page to return to the cards; the link `/grid/seats/N` survives a refresh.

## Calibration

The **Calibration** panel holds RotorHazard's Sensor Tuning settings.

**Calibration mode.** *Manual* leaves enter and exit as set here. *Adaptive* lets
RotorHazard set each seat's enter and exit from the pilot's best past race on that seat
whenever a heat is loaded and whenever marshalled laps are saved, so a marshal's
corrections carry forward. With Adaptive on, every card says so.

**Start-of-race lowering.** For the first *Duration* seconds after a heat's start, a seat
with a pilot in the heat whose signal is below enter has both levels lowered by *Amount*
percent of the gap between them, so a hole shot right at the start still registers; the
seat is back to its levels at its first pass, when the time is up, or when the race stops.
Practice races (no heat) are never lowered. Only the seat's node is retuned:
the profile's levels never change, and RotorHazard tells nobody what it did, so during a
race each card says what its seat was lowered to ("Lowered to 94/74 for 5 s at start",
computed as RotorHazard does: the whole-number part of (enter − exit) × amount ÷ 100 off
both). Amount takes 0–200, Duration 0–999; 0 in either turns lowering off.

## During a race

While a race is staged or running, a banner says so and every card shows "Race on".
Channel changes and New, switch and Delete on the profile are refused with the reason:
RotorHazard would retune the seat on the spot, mid-race, and lose its passes. Enter and
exit still write live, so a seat can be tuned while it flies. Stop (then Save or Discard)
lifts the lock.

## RotorHazard agrees

RotorHazard's Settings page shows the same profile, channels, enter/exit, calibration mode
and lowering values at every step, and its Run page's per-seat tuning the same thresholds.
Nothing here needs its pages; they are there to agree.
