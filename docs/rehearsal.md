# Race-day rehearsal checklists

Every tier of the plan (issue #2) closes only after its checklist here passed twice: once
on the dev rig (`make rig-up`, pilots and heats seeded, laps simulated with the e2e rig
helper or RotorHazard's own "simulate lap" buttons), and once in a live session on a real
timer. The live session gets a log issue; see `live-log.md`.

Each step says what to do in Grid and what RotorHazard's own page must show afterwards.
"RotorHazard agrees" is the whole point: our UX, RotorHazard's data model. If a step needs
RotorHazard's page to *do* something, the tier is not done.

Tick the boxes in a copy of the checklist pasted into the tier's issue, with the date, the
RotorHazard version, and the plugin version.

## T1 — harness (no rehearsal; the harness is the gate)

## T2 — event management

Setup: RotorHazard fresh (`Settings → Data management → Reset all` or a new event from
Grid), pilots added in Grid.

1. [ ] **Event**: open `/grid/event`, Edit, set the name, date, venue. RotorHazard's
       Event page shows the name.
2. [ ] **Event options**: on `/grid/event` set Consecutive laps base to 3, Minimum lap time
       to 5 s, Short laps to *Discard new short laps*, Ignore crossings before to 2 s; each
       confirms as it lands. RotorHazard's Format page, Event panel, shows the same four
       values. A Formats card ranking by consecutives says "(best 3 consecutive)".
3. [ ] **Pilots**: add every pilot with callsign and name; set two teams on the Teams page.
       RotorHazard's Format page, Pilots panel, lists them with the team.
4. [ ] **Formats**: create a "Qualifying — best 3 laps, 2:00" format and a "Final, first to
       3 laps" format; on the Final set Points to *Position* with "10,8,6,4". RotorHazard's
       Format page, Race Formats selector, offers both, and the Final's points gear shows
       10,8,6,4.
5. [ ] **Stages**: add stages Open Practice (open practice format, no limit), Qualifying
       (the qualifying format, 2 rounds, ranked by fastest consecutive), Final (the final
       format). RotorHazard's Classes and Heats panel shows three classes with those formats.
6. [ ] **Heats**: in Qualifying, add heats and seat every pilot by hand. RotorHazard's
       Classes and Heats panel shows the same lineups on the same seats.
7. [ ] **Generators**: in Final, generate a bracket from the top N of Qualifying. The
       preview matches what lands in RotorHazard.
8. [ ] **Seed now**: after a Qualifying round is flown, Seed now on Final fills the seats;
       RotorHazard shows the seeded pilots.
8b. [ ] **Raced entities**: open a raced heat: seats are locked; *Unlock seats…* warns, then
        a seat can be changed and RotorHazard's Classes and Heats panel shows it. On a raced
        stage, *Unlock…* then change its format; RotorHazard's panel shows the new format.
        Edit a raced format: the dialog warns that results recalculate.
9. [ ] **Rounds**: on the board, click a raced cell, *Delete race…*, *Confirm delete*: the
       notice names RotorHazard's backup file, the cell empties, the race appears under
       *Deleted races*. RotorHazard's Results page no longer shows that round. *Restore*: the
       cell and RotorHazard's Results page show the round again with the same laps. Click a
       heat's next-round cell: RotorHazard's Run page shows that heat loaded.
10. [ ] **Chase the Ace**: Add stage → Chase the Ace, seat the heat, fly it (simulated) until a
        pilot has won twice: the stage card says who the ace is and turns Done; the heat's
        next-round cell disappears. RotorHazard's Format page shows the class with "GridFPV
        stage: ace"; its Results page ranks the class by last heat position with the ace first.
11. [ ] **New event**: first rename the event to one with a date, e.g. "Club Night 10/27": the
        Edit dialog refuses the "/" and says why; use "Club Night 10-27". Archive and start a
        new event from Grid; the banner names the archive file; pilots survive: *Add from
        roster* on the Pilots page offers every pilot from earlier events, ticked;
        RotorHazard's `list_backups` answer (the rig helper, or its Format page after a
        reload) lists the archive, and its Classes and Heats panel is empty.

12. [ ] **Help, offline**: with the laptop's internet off, open `/grid/help` and the ? on
        Event, Pilots, Teams, Formats and Stages: every page renders, the checklists too.

13. [ ] **Grouped stage settings**: add a stage with Grouped rounds, 2 rounds and 0 heats: it
        gets one heat (RotorHazard cannot hold an empty grouped stage). Set *After a race* to
        None: RotorHazard confirms and keeps None. Delete that heat, then change Rounds: Grid
        refuses with "Add a heat first…" and RotorHazard's log shows no exception.

RotorHazard's Format page was not needed for any step: pass.

## T3 — Run, race-day complete

A practice session with sound on and RotorHazard's own Run page closed. Each step names
what Grid shows and what RotorHazard (its API, or its own page opened only to check)
agrees on. Numbers in brackets are the issues the step proves.

Setup: the rig (`make rig-up`, `make build`), one browser on `/grid/run`, speakers on; a
second browser kept on RotorHazard's own Run page only for the "agrees" checks. Pilots
Ace, Bee, Cal; a per-heat stage "Quali" (2 rounds, advance Next heat) with heats Q1 (Ace
seat 2, Bee seat 3) and Q2 (Bee seat 2, Ace seat 3); a grouped stage "Mains" (2 rounds,
advance Next round) with one heat.

1. [ ] **Sound on.** Open `/grid/run`, click once: the banner goes. Open Sound settings…:
       set Race clock to Always and Pilot lap time to Always, Play the test line (hear it),
       Export, then Import the file, Set audio settings to defaults; RotorHazard's own Run
       page (same browser) shows the same Audio Control panel values each time (#38).
2. [ ] **Race settings strip.** Under the heat picker: profile, minimum lap and short-lap
       rule, format on the timer; the links land on Seats, Event, Formats; **edit** opens
       the format dialog (close it).
3. [ ] **Practice.** With "Practice — no heat" the header says RotorHazard does not save
       practice laps and Save is greyed; pick "First to 3 Laps" in the Race format box
       (RotorHazard's page shows the same). Start, fly a lap, Stop, Discard (#50).
4. [ ] **Off seat.** Put Cal on a seat whose frequency is Off (Seats page) in Q1: the header
       and the seat card say Cal will not be timed; move Cal off the heat; the warning goes
       (#70).
5. [ ] **Pick Q1.** The picker loads it on RotorHazard; "Round 1 of 2 · Quali" in the
       header; no Leaderboard card while Ready (#47).
6. [ ] **Scheduled start.** Schedule 0:30: "Starts in 0:29", hear "Next race begins in 30
       seconds"; Cancel start; RotorHazard's scheduled flag follows. Schedule 0:10: hear 10
       and 5 seconds, RotorHazard stages the race by itself.
7. [ ] **Tones and clock.** Staging tones, the start tone, the big clock counting as
       RotorHazard's; laps called out as they land ("Ace, lap 1, …"); "10 seconds", the
       final-second beeps, the expiry tone (#38, #72).
8. [ ] **Seat status and manual lap.** During the race each card shows position, laps,
       last and best, "crossing" over the gate; press **+ Lap** on Bee: a chip lands with
       the node tone if "beep on manual lap" is set; click a lap chip to delete it, the
       deleted chip to restore it (#49). Cal's card (if seated, no laps) shows "—" (#76).
9. [ ] **Reload mid-race.** Reload the page while racing, click once: cues resume, nothing
       replayed (#73).
10. [ ] **Stop, Save, next heat.** Stop, Save: "Race saved."; the Last race card says
        "Next: Q2, round 1 of 2." and the picker shows Q2; the Stages board marks Q2 next;
        RotorHazard's current heat is Q2. Race Q2 and Save: "Next: Q1, round 2 of 2."
11. [ ] **Grouped stage.** Pick the Mains heat (heat plan if seeded: Confirm, #69). Race and
        Save: "Next: <heat> in Round 2 of Mains." and RotorHazard made the round-2 copy
        (#58).
12. [ ] **Messages.** Send "Pilots to the line": the banner shows here and on RotorHazard's
        page and goes by itself after about 8 seconds; with Pop-up alert it stays until
        dismissed on both; picking another heat clears it (#71).
13. [ ] **Display and callouts.** Tick Lap order reversed and Time since start: chips newest
        first with "@m:ss.sss"; add a callout and press ▶: every page speaks it;
        RotorHazard's Callouts panel lists it.
14. [ ] **Volume floor and MP3.** Tone volume to 0: no beeps at all; tick Use MP3 tones:
        RotorHazard's stage.mp3 / buzzer.mp3 play instead (#74, #75). Set audio settings to
        defaults.

RotorHazard's Run page was not needed for any step except to agree: pass.

## T4 — Marshal and Results parity

A marshalling session after a race, with RotorHazard's own Marshal and Results pages opened
only to agree. Numbers in brackets are the issues the step proves.

Setup: the rig, pilots Ace (seat 1, the seat with a real signal recording) and Bee (seat 2),
a stage "Marshal" with heats M1 (Ace seat 1, Bee seat 2) and M2 (same seats); race M1 once
with a few passes on seat 2 and save it.

1. [ ] **Load the race.** Open `/grid/marshal`: the latest race is picked; choose Ace. The
       trace shows the recording, the ticks the passes the timer recorded, the table the laps
       to the millisecond with "timer" as their source.
2. [ ] **Recalculate.** Change enter by one in its box and put it back: the laps are found
       again from the recording, now "recalc" (the count can differ from what the timer
       scored live; that is RotorHazard's recalculation too). Raise enter above some
       crossing peaks: those laps vanish; put it back. Lower exit below the dip between the
       first two crossings: they merge into one; put it back. RotorHazard's Marshal page,
       same thresholds, shows the same laps lap for lap at every step (#56).
3. [ ] **Options.** On Event set Ignore crossings before to 5 s and Minimum lap to 2 s,
       Discard; recalculate: the early and short laps are deleted here, while RotorHazard's
       page (reading both as 0) deletes none. Save laps: RotorHazard's `/api/race` holds
       what this page showed. Put the options back (#56).
4. [ ] **Laps.** Click a lap to delete it, click again to restore it. Manual lap 7.5, Add
       lap: a "manual" lap at 0:07.500 with the lap times re-measured. Delete one lap, Clean
       deleted laps: it is gone from the list. Save laps: RotorHazard's saved race has the
       manual lap at exactly 7500 with source manual and no flagged lap.
5. [ ] **Thresholds.** Load from seat: the seat's enter/exit fill the boxes. Use these
       thresholds on the seat: the Seats page shows them on seat 1.
6. [ ] **Reassign.** Move to heat M2, Reassign: the race is listed under M2 (round 1) on the
       Stages board and on RotorHazard's Results page; M1 has no round.
7. [ ] **Results.** Open `/grid/results`: the stage's summary (race totals, fastest laps,
       fastest consecutive laps), the heat summary and round 1 under M2, the event totals.
       RotorHazard's Results page shows the same boards, cell for cell: rank, pilot, laps,
       total, average, fastest, consecutives.
8. [ ] **Stopped race.** On Run, pick M1 again, start, fly a few passes, stop (do not save);
       on Marshal pick "Stopped race, not saved yet", delete a lap, Save laps; back on Run
       the lap is gone before the race is saved. (RotorHazard offers this only for a heat,
       never for a practice race; a stopped practice race is not listed.)

RotorHazard's Marshal and Results pages were not needed for any step except to agree: pass.


## T5 — Seats, race-day safe

A tuning session with RotorHazard's own Settings page opened only to agree. Numbers in
brackets are the issues the step proves.

Setup: the rig, one browser on `/grid/seats`; a second browser on RotorHazard's Settings
page (Frequency Setup and Sensor Tuning panels open) only for the "agrees" checks. One
pilots Ace on seat 1 (the seat with a real signal) and Bee on seat 2, a heat with both
loaded on Run.

1. [ ] **Race on.** Start the race from Run, come back to Seats: a banner says channel and
       profile changes are refused until the race stops, every card says "Race on". Pick
       another channel on seat 2, click New, pick another profile, click Delete: each is
       refused with the reason and the controls snap back; RotorHazard's Frequency Setup
       and profile dropdown are unchanged. Type a new enter/exit on seat 2: written, shown
       on RotorHazard's Sensor Tuning. Stop and discard on Run: the banner goes, the same
       channel change is confirmed and RotorHazard shows it (#87).
2. [ ] **Refusals.** On seat 2 type 300 into Enter: refused, "Enter must be 255 or less",
       the box shows RotorHazard's value again and its Sensor Tuning is unchanged. Clear
       Enter: refused naming Enter. Type 0 into Exit: refused naming Exit. Profile → New,
       the active profile's own name: Create stays off with the reason; a new name is
       created and listed on RotorHazard's page; Edit it to the first profile's name: Save
       stays off; Delete it (#88, #89).
3. [ ] **Calibration.** In the Calibration panel set Calibration mode to Manual: confirmed,
       RotorHazard's Sensor Tuning shows Manual and the cards' "Adaptive" line goes; back to
       Adaptive. Set lowering Amount 30 and Duration 5: confirmed, RotorHazard's page shows
       both. Start the heat from Run (Bee on seat 2, 100/80 pinned) and come back: seat 2
       says "Lowered to 94/74 for 5 s at start", RotorHazard's log says the same for node 2,
       its Sensor Tuning still shows 100/80; a practice race shows no such line, as
       RotorHazard lowers nothing without pilots. Stop, discard; set Amount back to 0 (#57).
4. [ ] **Help.** The `?` on Seats opens its help page: profiles, channels and presets, the
       cards, the Tune page, calibration and lowering, and what a race locks are all there,
       with no network (#41).

RotorHazard's Settings page was not needed for any step except to agree: pass.
