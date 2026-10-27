# Run

Race day in one screen. RotorHazard does the timing; this page drives it and shows what it
sees, with sound, so its own Run page can stay closed.

## On the timer

Pick the heat in the box at the top. The board on the Stages page says which heat is next,
and the picker follows RotorHazard: after a save it moves to the heat RotorHazard loaded.
"Practice — no heat" times whoever is on a seat; RotorHazard never saves practice laps, so
Save is greyed and Stop then Discard clears them.

Under the picker, one line says what RotorHazard will race with: the seat profile, the
minimum lap time and what happens to short laps, and the format on the timer. Each is a
link to the page that sets it (Seats, Event, Formats); **edit** on the format opens it here.

If the heat is seeded from results, RotorHazard shows its **heat plan** first: who lands on
which seat and where they came from. **Confirm** loads it, **Reseed** asks RotorHazard to
work it out again, **Cancel** leaves the timer as it was.

A pilot seated on a seat whose frequency is Off gets a warning in the header and on the
seat card: RotorHazard would race them and time nothing. Set a channel on the Seats page or
move the pilot.

## Start, Stop, Save, Discard

**Start** stages the race: RotorHazard counts down the format's staging delay, with tones,
then the start tone. The big clock counts the race as RotorHazard's does. **Stop** ends it.
**Save** stores the laps as a round of the heat and RotorHazard moves to the next heat by
the stage's rules; the Last race card says what it loaded ("Next: …"). **Discard** clears
the laps instead (it asks first when there are laps).

## Scheduled start and the format in practice

Under the buttons, enter minutes and seconds and press **Schedule start**: RotorHazard
counts down and stages the race itself when the time is up, as its own Run page's Schedule
Race does. The header shows "Starts in m:ss"; with sound on, RotorHazard's countdown
callouts are spoken ("Next race begins in 1 minute", 30, 10 and 5 seconds). **Cancel
start** calls it off.

In practice, or when the heat's stage has no format of its own, a **Race format** box in
the header picks the format RotorHazard times with. A stage with a format fixes it.

## Seat cards

One card per seat with a frequency. During a race each shows the pilot's position (from
RotorHazard's leaderboard), laps flown, last and best lap, "crossing" while the quad is
over the gate and "finished" once the pilot is done. Every lap is a chip: click one to
delete it (RotorHazard renumbers the rest; it asks first), click a deleted one to restore
it. **+ Lap** registers a pass on that seat now, exactly as RotorHazard's own + Lap button
does, for a crossing the gate missed. **tune** opens that seat's tuning page.

## Sound

Click anywhere once to enable sound (browsers insist). Then the page plays what
RotorHazard's own Run page would: staging tones, the start, lap callouts, the final-second
beeps, "10 seconds", the leader and winner cues, using RotorHazard's audio settings for this
browser. A page opened or reloaded mid-race picks the race up where it is.

## Sound settings

**Sound settings…** opens RotorHazard's Audio Control panel, here: the voice and its
language, a test line to play, which callouts to speak (callsign, lap number, lap time,
race clock, team totals, winner, laps after a pilot is done, split timer, race leader), the
voice volume, rate and pitch, the tone and indicator-beep volumes, the beeps (first pass,
crossings, manual lap, leader lap, winner, cluster connect) and MP3 tones. These are
RotorHazard's own per-browser settings: the same keys its page reads, so both play the
same. **Export** writes RotorHazard's settings file, **Import** reads one, **Set audio
settings to defaults** puts everything back.

## Display and callouts

The same dialog holds RotorHazard's Display Settings for this browser: show each lap's
time since the start or since the first pass, newest lap first, and whether to show the
RSSI readout. And its Callouts: lines the director can have spoken on every connected
page (RotorHazard's own included) with ▶, kept on the timer; **Add callout** adds a line,
× removes it.

## Messages

Type a line under the sound row and press **Send message**: every connected page shows
it, RotorHazard's own included, as RotorHazard's Send Message panel does. Tick **Pop-up
alert** for one that stays until dismissed.

A message sent from RotorHazard, or from here, shows as a banner. A plain one goes by itself after about
8 seconds; one marked "interrupt" stays until you dismiss it. Either goes when another heat
is picked or a new race is staged.
