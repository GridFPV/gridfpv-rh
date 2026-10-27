import { describe, expect, it } from 'vitest';
import {
  addSyncSample,
  applyCurrentLaps,
  applyLeaderboard,
  applyRaceList,
  applyRaceStatus,
  applyStageReady,
  clockView,
  formatClockMs,
  lapsFromStored,
  RACE_STATUS,
  recalcLaps,
  syncDifferential,
  toggleLap,
  withLapTimes,
  emptyRaceStatus,
  offSeatWarnings,
  flownLaps,
  type LiveLap,
  countedLaps,
  countdownText
} from '../src/lib/race.js';

const rules = {
  minLapMs: 5000,
  minFirstCrossingMs: 0,
  minLapBehavior: 1,
  unlimitedTime: false,
  raceTimeSec: 120
};

describe('race status', () => {
  it('maps race_status and stage_ready', () => {
    const s = applyRaceStatus({
      race_status: 3,
      race_format_id: 1,
      race_heat_id: 7,
      race_class_id: 2,
      unlimited_time: false,
      race_time_sec: 120,
      hide_stage_timer: true,
      pi_starts_at_s: 1000.5,
      pi_staging_at_s: 997.5,
      next_round: 3
    });
    expect(s.status).toBe(RACE_STATUS.STAGING);
    expect(s.heatId).toBe(7);
    expect(s.startsAt).toBe(1000.5);
    expect(s.nextRound).toBe(3);
    const t = applyStageReady(s, { heat_id: 7, pi_starts_at_s: 1002, race_time_sec: 90 });
    expect(t.status).toBe(RACE_STATUS.STAGING);
    expect(t.startsAt).toBe(1002);
    expect(t.raceTimeSec).toBe(90);
  });
});

describe('clock', () => {
  const base = {
    ...applyRaceStatus({ race_status: 1, race_time_sec: 120, pi_starts_at_s: 1000 })
  };
  it('idle shows the format length', () => {
    expect(clockView({ ...base, status: 0 }, 0, 0, null).text).toBe('2:00.0');
    expect(clockView({ ...base, status: 0, unlimitedTime: true }, 0, 0, null).text).toBe('0:00.0');
  });
  it('needs sync', () => {
    expect(clockView(base, null, 0, null).phase).toBe('unsynced');
  });
  it('counts down through staging, then the race, then overtime', () => {
    // RotorHazard's clock is 1 000 000 ms; ours is at 0: differential 1 000 000.
    const diff = 1_000_000;
    const staging = { ...base, status: 3 };
    expect(clockView(staging, diff, -3000, null)).toMatchObject({
      phase: 'staging',
      text: '0:03.0'
    });
    expect(clockView({ ...staging, hideStageTimer: true }, diff, -3000, null).text).toBe('Ready');
    expect(clockView(base, diff, 1500, null)).toMatchObject({ phase: 'racing', text: '1:58.5' });
    expect(clockView(base, diff, 123_250, null)).toMatchObject({
      phase: 'overtime',
      text: '-0:03.2'
    });
    expect(clockView({ ...base, unlimitedTime: true }, diff, 61_100, null).text).toBe('1:01.1');
  });
  it('holds where it stopped', () => {
    const done = { ...base, status: 2 };
    expect(clockView(done, 1_000_000, 90_000, 30_000).text).toBe('1:30.0');
  });
  it('formats', () => {
    expect(formatClockMs(0)).toBe('0:00.0');
    expect(formatClockMs(65_432)).toBe('1:05.4');
    expect(formatClockMs(-900)).toBe('-0:00.9');
  });
});

describe('clock sync', () => {
  it('keeps samples that agree with the fastest one, median offset', () => {
    let s = addSyncSample([], 1000, 0, 40); // diff = 1e6 - 40 - 20
    s = addSyncSample(s, 1000.09, 100, 120); // diff = 1000090 - 120 - 10 = 999 960
    s = addSyncSample(s, 1005, 200, 1200); // slow and far off: dropped
    expect(s).toHaveLength(2); // 999 940 is within the fastest sample's ±20 window
    expect(syncDifferential(s)).toBe((999_940 + 999_960) / 2);
    expect(syncDifferential([])).toBeNull();
  });
});

describe('live laps and leaderboard', () => {
  it('maps current_laps', () => {
    const seats = applyCurrentLaps({
      current: {
        node_index: [
          {
            laps: [
              {
                lap_index: 0,
                lap_number: 0,
                lap_time: 2500,
                lap_time_formatted: '0:02.500',
                lap_time_stamp: 2500,
                deleted: false,
                late_lap: false,
                source: 0
              },
              {
                lap_index: 1,
                lap_number: 1,
                lap_time: 9000,
                lap_time_formatted: '0:09.000',
                lap_time_stamp: 11500,
                deleted: true,
                late_lap: false,
                source: 0
              }
            ],
            fastest_lap_index: 1,
            pilot: { id: 4, callsign: 'Nova', name: 'N' },
            finished_flag: false
          },
          { laps: [], fastest_lap_index: null, pilot: null, finished_flag: false }
        ]
      }
    });
    expect(seats).toHaveLength(2);
    expect(seats[0].pilot?.callsign).toBe('Nova');
    expect(seats[0].laps[1]).toMatchObject({ index: 1, deleted: true, stampMs: 11500 });
  });
  it('maps the primary leaderboard', () => {
    const lb = applyLeaderboard({
      current: {
        heat: 7,
        round: 2,
        displayname: 'Heat 1',
        status_msg: '',
        leaderboard: {
          meta: { primary_leaderboard: 'by_fastest_lap', win_condition: 3, consecutives_count: 3 },
          by_fastest_lap: [
            {
              pilot_id: 4,
              callsign: 'Nova',
              laps: 3,
              total_time: '0:40.1',
              fastest_lap: '0:12.0',
              position: 1,
              node: 0
            }
          ],
          by_race_time: []
        }
      },
      last_race: null
    });
    expect(lb.current?.primary).toBe('by_fastest_lap');
    expect(lb.current?.rows[0]).toMatchObject({ callsign: 'Nova', position: 1, node: 0 });
    expect(lb.last).toBeNull();
  });
});

describe('marshal recalculation', () => {
  // A trace with three clean passes at t = 102, 110 and 112 s (race start 100 s).
  const times: number[] = [];
  const values: number[] = [];
  for (let i = 990; i < 1250; i++) {
    times.push(i / 10);
    // a 5-sample plateau centred on each pass
    const peak = [1020, 1100, 1120].some((p) => Math.abs(i - p) <= 2) ? 90 : 20;
    values.push(peak);
  }
  it('finds passes and applies the minimum lap rule', () => {
    const laps = recalcLaps({ times, values }, 60, 40, 100, rules);
    expect(laps.map((l) => Math.round(l.stampMs))).toEqual([2000, 10000, 12000]);
    expect(laps.map((l) => l.deleted)).toEqual([false, false, true]); // 12 s is 2 s after 10 s
    expect(laps.map((l) => Math.round(l.timeMs))).toEqual([2000, 8000, 2000]);
    expect(laps[0].source).toBe(2);
  });
  it('keeps laps under the minimum when the timer is set to keep them', () => {
    const laps = recalcLaps({ times, values }, 60, 40, 100, { ...rules, minLapBehavior: 0 });
    expect(laps.map((l) => l.deleted)).toEqual([false, false, false]);
  });
  it('drops passes before the start and late laps after the first', () => {
    const laps = recalcLaps({ times, values }, 60, 40, 103, { ...rules, raceTimeSec: 8 });
    // 102 s is before this start; 110 s (7 s) counts; 112 s (9 s) is the first lap past time,
    // it counts; nothing after.
    expect(laps.map((l) => Math.round(l.stampMs))).toEqual([7000, 9000]);
    expect(laps.map((l) => l.deleted)).toEqual([false, true]); // min lap: 9 s < 7 s + 5 s
    const tight = recalcLaps({ times, values }, 60, 40, 100, {
      ...rules,
      minLapMs: 1000,
      raceTimeSec: 9
    });
    // 10 s is the first pass after time ran out: it counts; 12 s is deleted.
    expect(tight.map((l) => l.deleted)).toEqual([false, false, true]);
  });
  it('toggles and renumbers lap times', () => {
    const stored = lapsFromStored([
      { lap_time_stamp: 2000, lap_time: 2000, deleted: false, source: 0 },
      { lap_time_stamp: 10000, lap_time: 8000, deleted: false, source: 0 },
      { lap_time_stamp: 20000, lap_time: 10000, deleted: false, source: 0 }
    ]);
    const t = toggleLap(stored, 1);
    expect(t[1].deleted).toBe(true);
    expect(t[2].timeMs).toBe(18000);
    expect(withLapTimes(t)[2].timeMs).toBe(18000);
  });
});

describe('race list', () => {
  it('maps heats, rounds and pilots', () => {
    const list = applyRaceList({
      heats: {
        '7': {
          heat_id: 7,
          class_id: 2,
          displayname: 'Heat 1',
          rounds: {
            '2': {
              race_id: 12,
              format_id: 1,
              start_time: 1000,
              start_time_formatted: 'x',
              pilotraces: [
                {
                  pilotrace_id: 5,
                  pilot_id: 4,
                  callsign: 'Nova',
                  node_index: 0,
                  pilot_freq: 'R1 5658'
                }
              ]
            },
            '1': {
              race_id: 11,
              format_id: 1,
              start_time: 900,
              start_time_formatted: 'y',
              pilotraces: []
            }
          }
        }
      }
    });
    expect(list[0].rounds.map((r) => r.round)).toEqual([1, 2]);
    expect(list[0].rounds[1].pilots[0]).toMatchObject({ pilotraceId: 5, callsign: 'Nova' });
  });
});

describe("applyRaceStatus keeps stage_ready's hide flag during a race (#72)", () => {
  it('ignores the format-derived flag once staging has begun', () => {
    const staged = applyStageReady(emptyRaceStatus(), {
      pi_starts_at_s: 100,
      pi_staging_at_s: 96,
      hide_stage_timer: false,
      unlimited_time: 0,
      race_time_sec: 120
    });
    const racing = applyRaceStatus(
      { race_status: 1, hide_stage_timer: true, pi_starts_at_s: 100 },
      staged
    );
    expect(racing.hideStageTimer).toBe(false);
    const ready = applyRaceStatus({ race_status: 0, hide_stage_timer: true }, racing);
    expect(ready.hideStageTimer).toBe(true);
  });
});

describe('flownLaps', () => {
  it('leaves out the hole shot, deleted laps and late laps, like the leaderboard count', () => {
    const lap = (index: number, number: number, extra: Partial<LiveLap> = {}): LiveLap => ({
      index,
      number,
      timeMs: 1000,
      formatted: '0:01.000',
      stampMs: 1000 * (index + 1),
      deleted: false,
      late: false,
      source: null,
      ...extra
    });
    const seat = {
      laps: [
        lap(0, 0),
        lap(1, 1),
        lap(2, 2, { deleted: true }),
        lap(3, 2),
        lap(4, -1, { late: true })
      ],
      fastestIndex: 1,
      pilot: null,
      finished: false
    };
    expect(flownLaps(seat).map((l) => l.index)).toEqual([1, 3]);
    expect(countedLaps(seat).map((l) => l.index)).toEqual([0, 1, 3, 4]);
  });
});

describe('countdownText', () => {
  it('rounds up to whole seconds as m:ss and stops at zero', () => {
    expect(countdownText(65_000)).toBe('1:05');
    expect(countdownText(4_100)).toBe('0:05');
    expect(countdownText(0)).toBe('0:00');
    expect(countdownText(-500)).toBe('0:00');
  });
});

describe('offSeatWarnings (#70)', () => {
  it('names each pilot on a seat with no frequency', () => {
    const seats = [
      { index: 0, frequency: 5658 },
      { index: 7, frequency: 0 }
    ];
    const slots = [
      { nodeIndex: 0, pilotId: 1 },
      { nodeIndex: 7, pilotId: 2 },
      { nodeIndex: 7, pilotId: 0 },
      { nodeIndex: null, pilotId: 3 }
    ];
    const w = offSeatWarnings(seats, slots, (id) => ({ 1: 'Ace', 2: 'Bee' })[id] ?? '');
    expect(w).toEqual([
      {
        seat: 7,
        pilotId: 2,
        text: 'Bee is on seat 8, which has no frequency: set a channel on Seats or move the pilot.'
      }
    ]);
  });
});
