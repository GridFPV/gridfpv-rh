import { describe, expect, it } from 'vitest';
import { detectCrossings, traceRange } from '../src/lib/crossings.js';

/** Build a trace from (time, rssi) pairs. */
function trace(pairs: Array<[number, number]>) {
  return { times: pairs.map((p) => p[0]), values: pairs.map((p) => p[1]) };
}

describe('detectCrossings', () => {
  it('finds one pass: opens above enter, times at the peak plateau midpoint, closes below exit', () => {
    const t = trace([
      [0, 20],
      [1, 30],
      [2, 80], // > enter 70 → opens at t=2
      [3, 100], // peak first
      [4, 100], // peak last (plateau 3..4 → at 3.5)
      [5, 60],
      [6, 40] // < exit 50 → closes at t=6
    ]);
    expect(detectCrossings(t, 70, 50)).toEqual([
      { start: 2, end: 6, at: 3.5, peak: 100, open: false }
    ]);
  });

  it('reports two passes separately and resets the peak between them', () => {
    const t = trace([
      [0, 10],
      [1, 90],
      [2, 10],
      [3, 75],
      [4, 10]
    ]);
    const c = detectCrossings(t, 70, 50);
    expect(c.map((x) => x.peak)).toEqual([90, 75]);
    expect(c.map((x) => x.at)).toEqual([1, 3]);
  });

  it('merges a bounce when exit is low enough that RSSI never drops below it', () => {
    // The "5–6 crossings per gate pass" problem: a dip between 90 and 80 only splits the
    // pass when exit sits above the dip.
    const t = trace([
      [0, 10],
      [1, 90],
      [2, 62],
      [3, 85],
      [4, 58],
      [5, 88],
      [6, 10]
    ]);
    expect(detectCrossings(t, 70, 65)).toHaveLength(3);
    expect(detectCrossings(t, 70, 50)).toHaveLength(1);
  });

  it('flags a crossing still open at the end of the data', () => {
    const t = trace([
      [0, 10],
      [1, 90],
      [2, 95]
    ]);
    expect(detectCrossings(t, 70, 50)).toEqual([{ start: 1, end: 2, at: 2, peak: 95, open: true }]);
  });

  it('is empty when RSSI never exceeds enter', () => {
    expect(
      detectCrossings(
        trace([
          [0, 10],
          [1, 69],
          [2, 10]
        ]),
        70,
        50
      )
    ).toEqual([]);
    expect(detectCrossings({ times: [], values: [] }, 70, 50)).toEqual([]);
  });
});

describe('traceRange', () => {
  it('gives min and max, or null for an empty trace', () => {
    expect(
      traceRange(
        trace([
          [0, 5],
          [1, 50],
          [2, 20]
        ])
      )
    ).toEqual({ min: 5, max: 50 });
    expect(traceRange({ times: [], values: [] })).toBeNull();
  });
});
