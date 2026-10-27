# Event

The event is RotorHazard's name and description, plus the details it has no field for:
date, venue, organizer and notes. **Edit** changes them; the name must be usable as a file
name, because the archive is a file named after the event (no `/`, `\`, `:`, `*`, `?`,
`"`, `<`, `>` or `|`).

## Scoring and lap detection

- **Consecutive laps base**: formats that rank by fastest consecutive laps score each
  pilot's best run of this many laps in a row. Changing it recalculates results.
- **Minimum lap time**: laps shorter than this are either **highlighted** (kept, for the
  marshal to judge) or **discarded** as they happen.
- **Ignore crossings before**: gate passes in the first seconds of a race are ignored
  (a take-off right under the gate).

Each saves as you leave the field and is confirmed by RotorHazard. RotorHazard's Format
page, Event panel, shows the same values.

## New event

**New event** archives the current database first, under the event's name, and only then
clears races, heats and classes (pilots too, unless you keep them). Formats, frequency
profiles, teams and presets always stay. If the archive cannot be made, nothing is reset
and the banner says so.

## Archives

RotorHazard's database backups. **Restore** replaces everything with one; **Archive now**
takes one without resetting. Backups GridFPV takes before a race delete are listed apart
as safety copies, and are not offered to restore from here.
