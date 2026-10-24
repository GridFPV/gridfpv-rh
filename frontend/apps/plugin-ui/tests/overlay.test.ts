import { describe, expect, it } from 'vitest';
import {
  bestConsecutive,
  formatLapMs,
  inWindow,
  overlayRoute,
  overlayUrl,
  parseOverlayRoute,
  phaseLabel,
  racingLaps
} from '../src/lib/overlay.js';
import { RACE_STATUS, type LiveSeat } from '../src/lib/race.js';
import { applyResultData } from '../src/lib/results.js';

describe('overlay routes', () => {
  it('names the overlay and its contrast', () => {
    expect(overlayRoute('race')).toBe('live/race');
    expect(overlayRoute('race', 'light')).toBe('live/race/light');
    expect(parseOverlayRoute('live/race')).toEqual({ name: 'race', theme: 'dark' });
    expect(parseOverlayRoute('live/race/light')).toEqual({ name: 'race', theme: 'light' });
    expect(parseOverlayRoute('run')).toBeNull();
    expect(parseOverlayRoute('live')).toBeNull();
  });
  it('builds the OBS URL from the address the browser used', () => {
    expect(overlayUrl('http://10.42.0.1:5000', 'race')).toBe(
      'http://10.42.0.1:5000/grid/live/race'
    );
    expect(overlayUrl('http://recon-nh.home.ntninja.com:5000', 'race', 'light')).toBe(
      'http://recon-nh.home.ntninja.com:5000/grid/live/race/light'
    );
  });
});

describe('best consecutive', () => {
  it('finds the fastest run and ties go to the earliest', () => {
    expect(bestConsecutive([5000, 4000, 4500, 3900, 4100], 3)).toEqual({
      start: 1,
      laps: [4000, 4500, 3900],
      totalMs: 12400
    });
    expect(bestConsecutive([4000, 4000, 4000, 4000], 2)?.start).toBe(0);
    expect(bestConsecutive([4000, 4000], 3)).toBeUndefined();
    expect(bestConsecutive([4000], 0)).toBeUndefined();
  });
  it('knows which laps sit in the window', () => {
    const w = bestConsecutive([5000, 4000, 4500, 3900], 2);
    expect([0, 1, 2, 3].map((i) => inWindow(i, w))).toEqual([false, false, true, true]);
    expect(inWindow(0, undefined)).toBe(false);
  });
});

describe('laps and labels', () => {
  const seat: LiveSeat = {
    pilot: { id: 1, callsign: 'Nova' },
    fastestIndex: 2,
    finished: false,
    laps: [
      {
        index: 0,
        number: 0,
        timeMs: 1200,
        formatted: '0:01.200',
        stampMs: 1200,
        deleted: false,
        late: false,
        source: 0
      },
      {
        index: 1,
        number: 1,
        timeMs: 4000,
        formatted: '0:04.000',
        stampMs: 5200,
        deleted: false,
        late: false,
        source: 0
      },
      {
        index: 2,
        number: 2,
        timeMs: 3900,
        formatted: '0:03.900',
        stampMs: 9100,
        deleted: true,
        late: false,
        source: 0
      },
      {
        index: 3,
        number: -1,
        timeMs: 3000,
        formatted: '0:03.000',
        stampMs: 12100,
        deleted: false,
        late: true,
        source: 0
      }
    ]
  };
  it('scores only real, kept laps', () => {
    expect(racingLaps(seat).map((l) => l.index)).toEqual([1]);
  });
  it('prints times like RotorHazard', () => {
    expect(formatLapMs(4535.35)).toBe('0:04.535');
    expect(formatLapMs(71372.073)).toBe('1:11.372');
    expect(formatLapMs(null)).toBe('—');
  });
  it('labels the phase', () => {
    expect(phaseLabel(RACE_STATUS.READY, 'idle')).toBe('READY');
    expect(phaseLabel(RACE_STATUS.STAGING, 'staging')).toBe('STAGING');
    expect(phaseLabel(RACE_STATUS.RACING, 'racing')).toBe('LIVE');
    expect(phaseLabel(RACE_STATUS.RACING, 'overtime')).toBe('TIME UP');
    expect(phaseLabel(RACE_STATUS.DONE, 'done')).toBe('FINISHED');
  });
});

describe('best of the day per heat', () => {
  it('reads the heat leaderboard raw figures', () => {
    const r = applyResultData({
      heats: {
        4: {
          heat_id: 4,
          rounds: [],
          leaderboard: {
            meta: { primary_leaderboard: 'by_consecutives', consecutives_count: 3 },
            by_consecutives: [
              {
                pilot_id: 5,
                callsign: 'Nova',
                starts: 2,
                laps: 7,
                consecutives_raw: 11372.073,
                consecutives_base: 3,
                fastest_lap_raw: 3283.6
              },
              {
                pilot_id: 6,
                callsign: 'Jinx',
                starts: 1,
                laps: 2,
                consecutives_raw: 0,
                consecutives_base: 3,
                fastest_lap_raw: 4100
              }
            ]
          }
        }
      },
      classes: {}
    });
    expect(r.heatBest[4]).toEqual([
      {
        pilotId: 5,
        callsign: 'Nova',
        starts: 2,
        laps: 7,
        consecutivesMs: 11372.073,
        consecutivesBase: 3,
        fastestLapMs: 3283.6
      },
      {
        pilotId: 6,
        callsign: 'Jinx',
        starts: 1,
        laps: 2,
        consecutivesMs: null,
        consecutivesBase: 3,
        fastestLapMs: 4100
      }
    ]);
  });
});
