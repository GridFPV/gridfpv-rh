import { describe, expect, it } from 'vitest';
import {
  applyConfigUpdate,
  applyLowerAmount,
  applyLowerDuration,
  emptyTuning,
  loweredLevels,
  loweredText,
  planLowering,
  tuningProblem
} from '../src/lib/tuning.js';
import { emptySeat } from '../src/lib/seats.js';

const seat = (
  index: number,
  enter: number | null,
  exit: number | null,
  rssi = 0,
  frequency = 5658
) => ({
  ...emptySeat(index),
  frequency,
  enter,
  exit,
  rssi
});

describe('tuning readbacks', () => {
  it("reads calibration mode from RotorHazard's config payload, as its page stores it (a string)", () => {
    const t = applyConfigUpdate(emptyTuning(), { config: { TIMING: { calibrationMode: '1' } } });
    expect(t.calibrationMode).toBe(1);
    expect(
      applyConfigUpdate(t, { config: { TIMING: { calibrationMode: 0 } } }).calibrationMode
    ).toBe(0);
    expect(applyConfigUpdate(t, { config: { LED: {} } })).toEqual(t); // not ours: untouched
  });
  it('reads the lowering values', () => {
    let t = applyLowerAmount(emptyTuning(), { start_thresh_lower_amount: 30 });
    t = applyLowerDuration(t, { start_thresh_lower_duration: '5' });
    expect([t.lowerAmount, t.lowerDuration]).toEqual([30, 5]);
  });
});

describe('tuningProblem', () => {
  it("takes RotorHazard's own ranges", () => {
    expect(tuningProblem('amount', 0)).toBeNull();
    expect(tuningProblem('amount', '200')).toBeNull();
    expect(tuningProblem('duration', 999)).toBeNull();
  });
  it('names the box and the range', () => {
    expect(tuningProblem('amount', 201)).toBe('Amount must be 0–200 percent.');
    expect(tuningProblem('amount', -1)).toBe('Amount must be 0–200 percent.');
    expect(tuningProblem('duration', 1000)).toBe('Duration must be 0–999 seconds.');
    expect(tuningProblem('duration', 2.5)).toBe('Duration must be a whole number of seconds.');
    expect(tuningProblem('amount', '')).toBe('Amount needs a value (0 turns lowering off).');
    expect(tuningProblem('amount', null)).toBe('Amount needs a value (0 turns lowering off).');
  });
});

describe('start-of-race lowering (RHRace.py)', () => {
  it('drops both levels by int((enter − exit) × amount / 100)', () => {
    expect(loweredLevels(seat(1, 100, 80), 30)).toEqual({ enter: 94, exit: 74 });
    expect(loweredLevels(seat(1, 100, 82), 30)).toEqual({ enter: 95, exit: 77 }); // 5.4 → 5
    expect(loweredText({ enter: 94, exit: 76 }, 5)).toBe('Lowered to 94/76 for 5 s at start');
  });
  it('leaves a seat alone when RotorHazard would', () => {
    expect(loweredLevels(seat(1, 100, 80, 100), 30)).toBeNull(); // RSSI not below enter
    expect(loweredLevels(seat(1, 100, 80, 0, 0), 30)).toBeNull(); // off
    expect(loweredLevels(seat(1, 100, 80), 0)).toBeNull(); // lowering off
    expect(loweredLevels(seat(1, 81, 80), 30)).toBeNull(); // diff 0
    expect(loweredLevels(seat(1, null, 80), 30)).toBeNull();
  });
  it('floors exit at 0 and refuses an enter outside the RSSI scale', () => {
    expect(loweredLevels(seat(1, 100, 2), 50)).toEqual({ enter: 51, exit: 0 });
    expect(loweredLevels(seat(1, 10, 0), 200)).toBeNull(); // enter would be −10
  });
  it('plans the seats with a pilot on them; a practice race (no pilots on the nodes) lowers nothing', () => {
    const seats = [seat(0, 100, 80), seat(1, 100, 80), seat(2, 100, 80, 0, 0)];
    const tuning = { calibrationMode: 1 as const, lowerAmount: 30, lowerDuration: 5 };
    expect(planLowering(seats, tuning, new Set([0, 1, 2]))).toEqual({
      seats: { 0: { enter: 94, exit: 74 }, 1: { enter: 94, exit: 74 } },
      duration: 5
    });
    expect(planLowering(seats, tuning, new Set([1]))?.seats).toEqual({
      1: { enter: 94, exit: 74 }
    });
    expect(planLowering(seats, tuning, new Set())).toBeNull();
    expect(planLowering(seats, { ...tuning, lowerDuration: 0 }, new Set([0, 1]))).toBeNull();
    expect(planLowering(seats, { ...tuning, lowerAmount: 0 }, new Set([0, 1]))).toBeNull();
    expect(planLowering(seats, tuning, new Set([2]))).toBeNull();
  });
});
