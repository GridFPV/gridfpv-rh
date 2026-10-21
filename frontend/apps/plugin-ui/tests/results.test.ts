import { describe, expect, it } from 'vitest';
import { applyResultData, raceFor, racesFor, winnerOf } from '../src/lib/results.js';

const payload = {
  heats: {
    '1': {
      heat_id: 1,
      displayname: 'Qualifying 1',
      rounds: [
        {
          id: 2,
          start_time_formatted: '2026-10-21 01:20:00.000',
          leaderboard: {
            meta: { primary_leaderboard: 'by_race_time' },
            by_race_time: [
              {
                pilot_id: 3,
                callsign: 'Pixel',
                position: 1,
                laps: 3,
                total_time: '1:02.1',
                fastest_lap: '0:20.0',
                node: 1
              },
              {
                pilot_id: 2,
                callsign: 'Vortex',
                position: 2,
                laps: 3,
                total_time: '1:03.5',
                fastest_lap: '0:20.5',
                node: 0
              }
            ]
          }
        },
        {
          id: 1,
          start_time_formatted: '2026-10-21 01:16:09.253',
          leaderboard: {
            meta: { primary_leaderboard: 'by_race_time' },
            by_race_time: [
              {
                pilot_id: 2,
                callsign: 'Vortex',
                laps: 2,
                total_time: '0:02.8',
                fastest_lap: '0:01.4',
                node: 0
              }
            ]
          }
        }
      ]
    }
  },
  classes: {
    '1': {
      id: 1,
      ranking: {
        ranking: [
          { pilot_id: 2, callsign: 'Vortex', position: 1 },
          { pilot_id: 3, callsign: 'Pixel', position: 2 }
        ]
      }
    }
  }
};

describe('applyResultData', () => {
  it('keeps saved rounds per heat, sorted by round, with positions', () => {
    const r = applyResultData(payload);
    expect(racesFor(r, 1).map((x) => x.round)).toEqual([1, 2]);
    expect(raceFor(r, 1, 2)?.rows.map((x) => [x.callsign, x.position])).toEqual([
      ['Pixel', 1],
      ['Vortex', 2]
    ]);
    // A row without a position gets its leaderboard order.
    expect(raceFor(r, 1, 1)?.rows[0].position).toBe(1);
    expect(winnerOf(raceFor(r, 1, 2)!)?.callsign).toBe('Pixel');
  });
  it('keeps the class ranking', () => {
    const r = applyResultData(payload);
    expect(r.ranking[1].map((x) => x.callsign)).toEqual(['Vortex', 'Pixel']);
  });
  it('copes with an empty cache', () => {
    const r = applyResultData(null);
    expect(racesFor(r, 9)).toEqual([]);
    expect(applyResultData({ heats: {}, classes: {} }).ranking).toEqual({});
  });
});
