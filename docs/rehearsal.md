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

A practice session with sound on and RotorHazard's own Run page closed. Items are added
as they land; the full run-through (pick heat, stage, tones, laps called out, clock, stop,
save, next heat as the board says) is written at the end of the tier.

- [ ] **Messages.** From a second browser on RotorHazard's Run page, send a plain message:
      it shows on Grid's Run page and goes by itself after about 8 seconds. Send one with
      "interrupt" ticked: it stays until you dismiss it or pick another heat (#71).
- [ ] **Off seat.** Put a pilot on a seat whose frequency is Off (Seats page). Pick that
      heat on Run: the header and the seat card both say the pilot will not be timed. Fix the
      frequency or move the pilot; the warning goes (#70).
- [ ] **Practice.** Pick "Practice — no heat". The header says RotorHazard does not save
      practice laps and Save is greyed. Start, fly a lap or two, Stop, Discard (#50).
- [ ] **Leaderboard.** While Ready there is no leaderboard card; once a race has laps the
      card appears, listing seats that have a pilot or laps, never an empty seat by its
      frequency (#47).
- [ ] **Volume floor.** In RotorHazard's own Settings, drag the Tone volume slider to its
      bottom (its stored value is 0.01 with float noise); reload Grid's Run page: no beeps at
      all, the same as RotorHazard's page. Drag it up a notch: beeps again (#74).
- [ ] **MP3 tones.** Tick "Use MP3 tones" in RotorHazard's Settings and reload Grid's Run
      page: staging and final-second ticks are RotorHazard's stage.mp3, start and expiry its
      buzzer.mp3, at the tone volume; the leader and winner cues are its leader.mp3 and
      winner.mp3 (#75).
- [ ] **Reload mid-race.** Start a race, reload Grid's Run page while it runs and click once:
      the final-second ticks, the expiry tone and later lap callouts still come, and nothing
      is replayed. Reload during staging: the start tone still comes (#73).
- [ ] **Heat advance.** Save a race: the picker moves to the heat RotorHazard loaded and the
      Last race card says "Next: …" (the same heat again, the next heat, the next grouped
      round, or nothing). The Stages board marks the same race "next". Try a stage set to
      Next heat and one set to Next round.
- [ ] **Seat status.** While racing, each seat card shows position, lap count, last and best
      lap, and "crossing" while the quad is over the gate; "finished" once the pilot is done.
- [ ] **Manual lap.** While racing, press **+ Lap** on a seat card: a lap chip lands for that
      seat, with the node tone if "beep on manual lap" is set in the audio settings;
      RotorHazard's Marshal page shows the pass. **tune** on a card opens that seat's tuning.
- [ ] **Race settings strip.** Under the heat picker: profile, minimum lap and short-lap rule,
      and the format on the timer, as RotorHazard's Race Management panel shows them; the
      links land on Seats, Event and Formats; **edit** opens the format dialog.

## T4 — Marshal and Results parity

To be written when T4 starts.
