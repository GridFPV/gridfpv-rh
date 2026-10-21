import { describe, expect, it } from 'vitest';
import {
  BracketError,
  describePlan,
  foldOrder,
  planSize,
  seedLabel,
  singleElimination,
  snakeSeed
} from '../src/lib/bracket.js';

describe('snakeSeed / foldOrder', () => {
  it('snakes ranks across heats', () => {
    expect(snakeSeed(16, 4, 4)).toEqual([
      [1, 8, 9, 16],
      [2, 7, 10, 15],
      [3, 6, 11, 14],
      [4, 5, 12, 13]
    ]);
    expect(snakeSeed(5, 2, 4)).toEqual([
      [1, 4, 5],
      [2, 3]
    ]);
  });
  it('folds first against last', () => {
    expect(foldOrder(4)).toEqual([0, 3, 1, 2]);
    expect(foldOrder(3)).toEqual([0, 2, 1]);
    expect(foldOrder(1)).toEqual([0]);
  });
});

describe('singleElimination', () => {
  it('16 pilots, 4 seats, top 2: quarters → semis → final', () => {
    const p = singleElimination({ pilots: 16, seats: 4, advance: 2 });
    expect(p.rounds.map((r) => r.heats.length)).toEqual([4, 2, 1]);
    expect(p.rounds.map((r) => r.name)).toEqual(['Quarterfinals', 'Semifinals', 'Final']);
    expect(p.rounds[0].heats[0].name).toBe('Quarter 1');
    expect(p.rounds[1].heats[1].name).toBe('Semi 2');
    expect(p.rounds[2].heats[0].name).toBe('Final');
    expect(p.rounds[0].heats[0].seeds).toEqual([
      { kind: 'class', rank: 1 },
      { kind: 'class', rank: 8 },
      { kind: 'class', rank: 9 },
      { kind: 'class', rank: 16 }
    ]);
    // Semi 1 = top 2 of Quarter 1 and Quarter 4 (first against last).
    expect(p.rounds[1].heats[0].seeds).toEqual([
      { kind: 'heat', round: 0, heat: 0, rank: 1 },
      { kind: 'heat', round: 0, heat: 0, rank: 2 },
      { kind: 'heat', round: 0, heat: 3, rank: 1 },
      { kind: 'heat', round: 0, heat: 3, rank: 2 }
    ]);
    expect(p.rounds[2].heats[0].seeds.map((s) => s && s.kind === 'heat' && s.heat)).toEqual([
      0, 0, 1, 1
    ]);
    expect(describePlan(p)).toBe('3 rounds: 4 heats → 2 heats → final');
    expect(planSize(p)).toEqual({ heats: 7, seeds: 28 });
  });
  it('an odd field leaves empty seats and still shrinks', () => {
    const p = singleElimination({ pilots: 5, seats: 4, advance: 2 });
    expect(p.rounds.map((r) => r.heats.length)).toEqual([2, 1]);
    expect(p.rounds[0].heats[1].seeds).toEqual([
      { kind: 'class', rank: 2 },
      { kind: 'class', rank: 3 },
      null,
      null
    ]);
    expect(p.rounds[1].heats[0].seeds.filter(Boolean)).toHaveLength(4);
  });
  it('a field that fits one heat is just a final', () => {
    const p = singleElimination({ pilots: 3, seats: 4, advance: 2 });
    expect(p.rounds).toHaveLength(1);
    expect(p.rounds[0].name).toBe('Final');
    expect(p.rounds[0].heats[0].name).toBe('Final');
  });
  it('8 seats, top 4 of 32', () => {
    const p = singleElimination({ pilots: 32, seats: 8, advance: 4 });
    expect(p.rounds.map((r) => r.heats.length)).toEqual([4, 2, 1]);
  });
  it('refuses a bracket that cannot shrink', () => {
    expect(() => singleElimination({ pilots: 8, seats: 4, advance: 4 })).toThrow(BracketError);
    expect(() => singleElimination({ pilots: 1, seats: 4, advance: 2 })).toThrow(BracketError);
  });
  it('labels seeds in words', () => {
    const p = singleElimination({ pilots: 8, seats: 4, advance: 2 });
    const label = (r: number, h: number) => p.rounds[r].heats[h].name ?? `Heat ${h + 1}`;
    expect(seedLabel({ kind: 'class', rank: 3 }, 'Qualifying', label)).toBe('3rd in Qualifying');
    expect(seedLabel({ kind: 'heat', round: 0, heat: 1, rank: 2 }, 'Qualifying', label)).toBe(
      '2nd of Semi 2'
    );
  });
});
