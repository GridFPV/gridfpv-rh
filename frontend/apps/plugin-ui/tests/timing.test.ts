import { describe, expect, it } from 'vitest';
import {
  behaviorLabel,
  consecutivesPhrase,
  lapRulesSummary,
  MIN_LAP_BEHAVIOR,
  parseConsecutivesBase,
  parseSeconds
} from '../src/lib/timing.js';

describe('parseSeconds', () => {
  it('accepts whole seconds in RotorHazard range and floors fractions', () => {
    expect(parseSeconds('5')).toBe(5);
    expect(parseSeconds(' 12.9 ')).toBe(12);
    expect(parseSeconds(0)).toBe(0);
    expect(parseSeconds('999')).toBe(999);
  });
  it('rejects blanks, negatives, text and out-of-range', () => {
    expect(parseSeconds('')).toBeNull();
    expect(parseSeconds('-1')).toBeNull();
    expect(parseSeconds('abc')).toBeNull();
    expect(parseSeconds('1000')).toBeNull();
  });
});

describe('parseConsecutivesBase', () => {
  it('needs at least two laps in a row', () => {
    expect(parseConsecutivesBase('1')).toBeNull();
    expect(parseConsecutivesBase('2')).toBe(2);
    expect(parseConsecutivesBase('3')).toBe(3);
    expect(parseConsecutivesBase('')).toBeNull();
  });
});

describe('lapRulesSummary', () => {
  it('says what happens to short laps and early crossings', () => {
    expect(
      lapRulesSummary({
        minLapMs: 5000,
        minFirstCrossingMs: 0,
        minLapBehavior: MIN_LAP_BEHAVIOR.HIGHLIGHT
      })
    ).toBe('Laps under 5 s are highlighted');
    expect(
      lapRulesSummary({
        minLapMs: 5000,
        minFirstCrossingMs: 2000,
        minLapBehavior: MIN_LAP_BEHAVIOR.DISCARD
      })
    ).toBe('Laps under 5 s are discarded · crossings in the first 2 s ignored');
  });
  it('is empty when nothing is filtered', () => {
    expect(lapRulesSummary({ minLapMs: 0, minFirstCrossingMs: 0, minLapBehavior: 0 })).toBe('');
  });
});

describe('labels', () => {
  it('names the behaviours and falls back to highlight', () => {
    expect(behaviorLabel(0)).toBe('Highlight short laps');
    expect(behaviorLabel(1)).toBe('Discard new short laps');
    expect(behaviorLabel(7)).toBe('Highlight short laps');
    expect(consecutivesPhrase(3)).toBe('best 3 consecutive');
  });
});
