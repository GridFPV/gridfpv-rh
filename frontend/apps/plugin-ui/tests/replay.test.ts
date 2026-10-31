import { describe, expect, it } from 'vitest';
import {
  findSavedRace,
  lapsAt,
  lapStamps,
  parseReplayQuery,
  rankRows,
  replayLayout,
  replayQuery,
  replayStatus
} from '../src/lib/replay.js';
import { overlayRow, overlayTitle, phaseLabel } from '../src/lib/overlay.js';
import { clockView, RACE_STATUS, type MarshalLap, type RaceListHeat } from '../src/lib/race.js';
import { START_BEHAVIOR, WIN_CONDITION, type RaceFormat } from '../src/lib/setup.js';

const lap = (stampMs: number, deleted = false): MarshalLap => ({
  stampMs,
  timeMs: 0,
  deleted,
  source: 0,
  peakRssi: null
});

const list: RaceListHeat[] = [
  {
    heatId: 4,
    classId: 2,
    name: 'RaceGOW 2 Track 4',
    rounds: [
      { round: 1, raceId: 11, formatId: 5, startTime: 100, startTimeFormatted: '', pilots: [] },
      { round: 2, raceId: 13, formatId: 5, startTime: 200, startTimeFormatted: '', pilots: [] }
    ]
  }
];

const format = (over: Partial<RaceFormat> = {}): RaceFormat => ({
  id: 5,
  name: 'RaceGOW',
  unlimitedTime: true,
  raceTimeSec: 0,
  lapGraceSec: -1,
  stagingFixedTones: 0,
  startDelayMin: 1000,
  startDelayMax: 0,
  stagingDelayTones: 0,
  startBehavior: START_BEHAVIOR.HOLESHOT,
  winCondition: WIN_CONDITION.FASTEST_CONSECUTIVE,
  numberLapsWin: 0,
  teamRacingMode: 0,
  pointsMethod: null,
  pointsSettings: null,
  locked: false,
  ...over
});

describe('the replay query', () => {
  it('names a saved race by heat and round, or by race id; anything else is the live overlay', () => {
    expect(parseReplayQuery('?heat=4&round=2&t=1500')).toEqual({
      raceId: null,
      heatId: 4,
      round: 2,
      t: 1500,
      end: null,
      layout: null,
      pilotId: null
    });
    expect(parseReplayQuery('race=13&end=61000&layout=solo&pilot=7')).toMatchObject({
      raceId: 13,
      t: 0,
      end: 61000,
      layout: 'solo',
      pilotId: 7
    });
    expect(parseReplayQuery('?heat=4')).toBeNull();
    expect(parseReplayQuery('')).toBeNull();
    expect(parseReplayQuery('?layout=field')).toBeNull();
    expect(parseReplayQuery('?heat=4&round=2&layout=sideways')?.layout).toBeNull();
  });
  it('round-trips through replayQuery, leaving t out at 0', () => {
    const q = replayQuery({ heatId: 4, round: 2, end: 61000, layout: 'solo' });
    expect(q).toBe('?heat=4&round=2&end=61000&layout=solo');
    expect(parseReplayQuery(q)).toMatchObject({ heatId: 4, round: 2, t: 0, end: 61000 });
    expect(replayQuery({ heatId: 4, round: 1, t: 2500.7 })).toBe('?heat=4&round=1&t=2500');
  });
  it('finds the race either way, and nothing for a round that was never saved', () => {
    const byRound = findSavedRace(list, parseReplayQuery('?heat=4&round=2')!);
    expect(byRound?.round.raceId).toBe(13);
    expect(findSavedRace(list, parseReplayQuery('?race=11')!)?.round.round).toBe(1);
    expect(findSavedRace(list, parseReplayQuery('?heat=4&round=3')!)).toBeUndefined();
    expect(findSavedRace(list, parseReplayQuery('?race=99')!)).toBeUndefined();
  });
});

describe('the race at time t', () => {
  const saved = findSavedRace(list, parseReplayQuery('?heat=4&round=2')!)!;
  it('is staging before zero, racing after, stopped from `end`, and the clock reads race time', () => {
    const f = format();
    const staging = replayStatus(saved, f, -2000, null);
    expect(staging.status).toBe(RACE_STATUS.STAGING);
    expect(clockView(staging, 0, -2000, null)).toMatchObject({ phase: 'staging', text: '0:02.0' });

    const racing = replayStatus(saved, f, 4350, 61000);
    expect(racing).toMatchObject({
      status: RACE_STATUS.RACING,
      heatId: 4,
      nextRound: 2,
      unlimitedTime: true
    });
    expect(clockView(racing, 0, 4350, 61000)).toMatchObject({
      phase: 'racing',
      text: '0:04.3',
      raceMs: 4350
    });
    expect(phaseLabel(racing.status, 'racing')).toBe('LIVE');

    // Past the end the clock holds where the race stopped, however far t goes.
    const done = replayStatus(saved, f, 70000, 61000);
    expect(done.status).toBe(RACE_STATUS.DONE);
    expect(clockView(done, 0, 70000, 61000).text).toBe('1:01.0');
    expect(clockView(replayStatus(saved, f, 90000, 61000), 0, 90000, 61000).text).toBe('1:01.0');
    expect(phaseLabel(done.status, 'done')).toBe('FINISHED');
  });
  it('counts a timed format down, and reads overtime past the clock', () => {
    const f = format({ unlimitedTime: false, raceTimeSec: 120 });
    const r = replayStatus(saved, f, 30000, null);
    expect(clockView(r, 0, 30000, null).text).toBe('1:30.0');
    expect(clockView(replayStatus(saved, f, 125000, null), 0, 125000, null).phase).toBe('overtime');
  });
  it('without the format assumes an unlimited clock', () => {
    expect(replayStatus(saved, undefined, 0, null).unlimitedTime).toBe(true);
  });
});

describe('the laps scored by time t', () => {
  // Crossings at 0.5 s (hole shot), 2.0 s, 3.6 s and 5.9 s; the 3.6 s one marshalled away.
  const laps = [lap(500), lap(2000), lap(3600, true), lap(5900)];
  it('shows a lap from its crossing on, with a deleted crossing folded into the next lap', () => {
    expect(lapsAt(laps, 1999, START_BEHAVIOR.HOLESHOT)).toEqual([]);
    expect(lapsAt(laps, 2000, START_BEHAVIOR.HOLESHOT)).toEqual([1500]);
    expect(lapsAt(laps, 4000, START_BEHAVIOR.HOLESHOT)).toEqual([1500]);
    expect(lapsAt(laps, 5900, START_BEHAVIOR.HOLESHOT)).toEqual([1500, 3900]);
    expect(lapsAt(laps, 10 ** 9, START_BEHAVIOR.HOLESHOT)).toEqual([1500, 3900]);
  });
  it('counts the first crossing as lap 1 when the format says so', () => {
    expect(lapsAt(laps, 2000, START_BEHAVIOR.FIRST_LAP)).toEqual([500, 1500]);
    expect(lapsAt(laps, 400, START_BEHAVIOR.FIRST_LAP)).toEqual([]);
  });
  it('is unmoved by stored order and a deleted hole shot', () => {
    const shuffled = [lap(2000), lap(500), lap(5900), lap(3600, true)];
    expect(lapsAt(shuffled, 6000, START_BEHAVIOR.HOLESHOT)).toEqual([1500, 3900]);
    // The hole shot deleted: the next crossing becomes the hole shot.
    expect(lapsAt([lap(500, true), lap(2000), lap(3600)], 6000, START_BEHAVIOR.HOLESHOT)).toEqual([
      1600
    ]);
  });
  it('lists where frames change, across pilots, sorted', () => {
    expect(lapStamps([{ laps }, { laps: [lap(700), lap(2500)] }], START_BEHAVIOR.HOLESHOT)).toEqual(
      [2000, 2500, 5900]
    );
    expect(lapStamps([{ laps: [] }], START_BEHAVIOR.HOLESHOT)).toEqual([]);
  });
});

describe('ranking and layout', () => {
  const id = (seat: number, name: string) => ({ seat, pilotId: seat + 1, name, color: '' });
  it('ranks most laps in the least time, best lap, or best run in a row, as the format scores', () => {
    const a = overlayRow(id(0, 'A'), [2000, 2100, 2200], 3);
    const b = overlayRow(id(1, 'B'), [1500, 2800], 3);
    const c = overlayRow(id(2, 'C'), [1400, 1400, 1400], 3);
    expect(
      rankRows([a, b, c], WIN_CONDITION.MOST_PROGRESS).map((r) => [r.name, r.position])
    ).toEqual([
      ['C', 1],
      ['A', 2],
      ['B', 3]
    ]);
    expect(rankRows([a, b, c], WIN_CONDITION.FASTEST_LAP).map((r) => r.name)).toEqual([
      'C',
      'B',
      'A'
    ]);
    // B has no 3 in a row yet: last, whatever its best lap.
    expect(rankRows([b, a, c], WIN_CONDITION.FASTEST_CONSECUTIVE).map((r) => r.name)).toEqual([
      'C',
      'A',
      'B'
    ]);
    // Practice formats rank no one.
    expect(rankRows([b, a], WIN_CONDITION.NONE).map((r) => [r.name, r.position])).toEqual([
      ['A', null],
      ['B', null]
    ]);
  });
  it('gives one pilot the long form unless the URL says otherwise', () => {
    expect(replayLayout(parseReplayQuery('?race=1')!, 1)).toBe('solo');
    expect(replayLayout(parseReplayQuery('?race=1')!, 3)).toBe('field');
    expect(replayLayout(parseReplayQuery('?race=1&layout=field')!, 1)).toBe('field');
    expect(replayLayout(parseReplayQuery('?race=1&layout=solo')!, 3)).toBe('solo');
  });
});

describe('the title line', () => {
  it('is the run name in RaceGOW mode, and heat · round · class · event otherwise', () => {
    const racegow = { on: true, template: 'RaceGOW {season} {track} Round {round}', season: 2 };
    expect(
      overlayTitle({
        racegow,
        heatName: 'RaceGOW 2 Track 4',
        className: 'Track 4',
        round: 7,
        eventName: 'x',
        practice: false
      })
    ).toBe('RaceGOW 2 Track 4 Round 7');
    const off = { ...racegow, on: false };
    expect(
      overlayTitle({
        racegow: off,
        heatName: 'Heat 3',
        className: 'Open',
        round: 2,
        eventName: 'Club night',
        practice: false
      })
    ).toBe('Heat 3 · Round 2 · Open · Club night');
    expect(
      overlayTitle({
        racegow: off,
        heatName: '',
        className: '',
        round: 0,
        eventName: '',
        practice: true
      })
    ).toBe('Practice');
    expect(
      overlayTitle({
        racegow: off,
        heatName: '',
        className: '',
        round: 0,
        eventName: 'Club',
        practice: false
      })
    ).toBe('Club');
    // RaceGOW with no heat (practice) falls back to the plain line.
    expect(
      overlayTitle({
        racegow,
        heatName: '',
        className: '',
        round: 0,
        eventName: '',
        practice: true
      })
    ).toBe('Practice');
  });
});
