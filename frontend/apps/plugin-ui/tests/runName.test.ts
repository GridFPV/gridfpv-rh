import { describe, expect, it } from 'vitest';
import { liveHoleshotMs, overlayRow, overlayTitle, runFileName } from '../src/lib/overlay.js';
import { holeshotAt } from '../src/lib/replay.js';
import type { LiveSeat, MarshalLap } from '../src/lib/race.js';
import { START_BEHAVIOR } from '../src/lib/setup.js';

const naming = {
  racegow: { on: false, template: 'RaceGOW {season} {track} Round {round}', season: 6 },
  heatName: 'Heat 2',
  className: 'Open',
  round: 3,
  eventName: 'Spring Cup',
  practice: false
};

describe('the run name for files', () => {
  it('reads event, class, heat, round — one heat is flown many times', () => {
    expect(runFileName(naming)).toBe('Spring Cup Open Heat 2 Round 3');
    expect(overlayTitle(naming)).toBe('Heat 2 · Round 3 · Open · Spring Cup');
  });
  it('leaves out what the timer has not got', () => {
    expect(runFileName({ ...naming, eventName: '', className: '' })).toBe('Heat 2 Round 3');
    expect(runFileName({ ...naming, heatName: '', round: 0, practice: true })).toBe(
      'Spring Cup Open Practice'
    );
  });
  it('is the RaceGOW name when that mode is on', () => {
    const rg = { ...naming, racegow: { ...naming.racegow, on: true } };
    expect(runFileName(rg)).toBe('RaceGOW 6 Open Round 3');
    expect(runFileName(rg)).toBe(overlayTitle(rg));
  });
});

const lap = (stampMs: number, deleted = false): MarshalLap =>
  ({ stampMs, timeMs: 0, deleted, source: 0, peakRssi: null }) as MarshalLap;

describe('the hole shot shown as HS', () => {
  it('is the first standing crossing once flown, in every start behaviour but first-lap-counts', () => {
    const laps = [lap(500), lap(2000), lap(3600)];
    expect(holeshotAt(laps, 499, START_BEHAVIOR.HOLESHOT)).toBeUndefined();
    expect(holeshotAt(laps, 500, START_BEHAVIOR.HOLESHOT)).toBe(500);
    expect(holeshotAt(laps, 9000, START_BEHAVIOR.STAGGERED)).toBe(500);
    expect(holeshotAt(laps, 9000, START_BEHAVIOR.FIRST_LAP)).toBeUndefined();
    expect(holeshotAt([lap(500, true), lap(2000)], 9000, START_BEHAVIOR.HOLESHOT)).toBe(2000);
    expect(holeshotAt([], 9000, START_BEHAVIOR.HOLESHOT)).toBeUndefined();
  });
  it('comes from lap 0 on a live seat, and rides on the row', () => {
    const seat = {
      laps: [
        { number: 0, timeMs: 1200, deleted: false },
        { number: 1, timeMs: 14000, deleted: false }
      ]
    } as unknown as LiveSeat;
    expect(liveHoleshotMs(seat)).toBe(1200);
    expect(
      liveHoleshotMs({ laps: [{ number: 1, timeMs: 1 }] } as unknown as LiveSeat)
    ).toBeUndefined();
    const row = overlayRow(
      { seat: 0, pilotId: 1, name: 'A', color: '' },
      [14000],
      undefined,
      null,
      1200
    );
    expect(row.holeshotMs).toBe(1200);
    expect(row.best).toBe(14000);
  });
});
