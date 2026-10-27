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
       3 laps" format. RotorHazard's Format page, Race Formats selector, offers both.
5. [ ] **Stages**: add stages Open Practice (open practice format, no limit), Qualifying
       (the qualifying format, 2 rounds, ranked by fastest consecutive), Final (the final
       format). RotorHazard's Classes and Heats panel shows three classes with those formats.
6. [ ] **Heats**: in Qualifying, add heats and seat every pilot by hand. RotorHazard's
       Classes and Heats panel shows the same lineups on the same seats.
7. [ ] **Generators**: in Final, generate a bracket from the top N of Qualifying. The
       preview matches what lands in RotorHazard.
8. [ ] **Seed now**: after a Qualifying round is flown, Seed now on Final fills the seats;
       RotorHazard shows the seeded pilots.
9. [ ] **Rounds**: on the board, click a raced cell, *Delete race…*, *Confirm delete*: the
       notice names RotorHazard's backup file, the cell empties, the race appears under
       *Deleted races*. RotorHazard's Results page no longer shows that round. *Restore*: the
       cell and RotorHazard's Results page show the round again with the same laps. Click a
       heat's next-round cell: RotorHazard's Run page shows that heat loaded.
10. [ ] **Chase the Ace**: add the stage, fly it (simulated), the ace is declared when a
        pilot wins twice; RotorHazard's Results page ranks the class by last heat position.
11. [ ] **New event**: archive and start a new event from Grid; pilots survive (roster);
        RotorHazard's Data management shows the archive.

RotorHazard's Format page was not needed for any step: pass.

## T3 — Run, race-day complete

To be written when T3 starts: a practice session with sound on, RotorHazard's Run page
closed: pick heat, stage, tones, laps called out, clock counts, stop, save, next heat
offered as the board says.

## T4 — Marshal and Results parity

To be written when T4 starts.
