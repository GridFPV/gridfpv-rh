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

import { doubleElimination, letterMains } from '../src/lib/bracket.js';

describe('doubleElimination', () => {
  it('16 pilots, 4 up, top 2: the 14-heat MultiGP shape', () => {
    const p = doubleElimination({ pilots: 16, seats: 4, advance: 2 });
    expect(p.rounds.map((r) => [r.name, r.heats.length])).toEqual([
      ['Winners round 1', 4],
      ['Losers round 1', 2],
      ['Winners round 2', 2],
      ['Losers round 2', 2],
      ['Winners final', 1],
      ['Losers round 3', 1],
      ['Losers final', 1],
      ['Final', 1]
    ]);
    expect(planSize(p).heats).toBe(14);
    expect(describePlan(p)).toBe(
      '8 rounds, 14 heats: winners 4 → 2 → 1, losers 2 → 2 → 1 → 1, then the final'
    );
    expect(p.rounds.flatMap((r) => r.heats.map((h) => h.name))).toEqual([
      'W1',
      'W2',
      'W3',
      'W4',
      'L5',
      'L6',
      'W7',
      'W8',
      'L9',
      'L10',
      'W11',
      'L12',
      'L13',
      'Final'
    ]);
    // Losers round 1 = 3rd and 4th of the winners heats, first against last.
    expect(p.rounds[1].heats[0].seeds).toEqual([
      { kind: 'heat', round: 0, heat: 0, rank: 3 },
      { kind: 'heat', round: 0, heat: 0, rank: 4 },
      { kind: 'heat', round: 0, heat: 3, rank: 3 },
      { kind: 'heat', round: 0, heat: 3, rank: 4 }
    ]);
    // Losers final = top 2 of losers round 3 + 3rd/4th of the winners final.
    expect(p.rounds[6].heats[0].seeds).toEqual([
      { kind: 'heat', round: 5, heat: 0, rank: 1 },
      { kind: 'heat', round: 5, heat: 0, rank: 2 },
      { kind: 'heat', round: 4, heat: 0, rank: 3 },
      { kind: 'heat', round: 4, heat: 0, rank: 4 }
    ]);
    // Final = top 2 of each bracket's final.
    expect(p.rounds[7].heats[0].seeds).toEqual([
      { kind: 'heat', round: 4, heat: 0, rank: 1 },
      { kind: 'heat', round: 4, heat: 0, rank: 2 },
      { kind: 'heat', round: 6, heat: 0, rank: 1 },
      { kind: 'heat', round: 6, heat: 0, rank: 2 }
    ]);
    // Every heat of a round points only at earlier rounds.
    p.rounds.forEach((r, i) =>
      r.heats.forEach((h) =>
        h.seeds.forEach((s) => {
          if (s?.kind === 'heat') expect(s.round).toBeLessThan(i);
        })
      )
    );
  });
  it('8 pilots: 6 heats', () => {
    const p = doubleElimination({ pilots: 8, seats: 4, advance: 2 });
    expect(p.rounds.map((r) => [r.name, r.heats.length])).toEqual([
      ['Winners round 1', 2],
      ['Losers round 1', 1],
      ['Winners final', 1],
      ['Losers final', 1],
      ['Final', 1]
    ]);
  });
  it('refuses shapes that cannot work', () => {
    expect(() => doubleElimination({ pilots: 4, seats: 4, advance: 2 })).toThrow(BracketError);
    expect(() => doubleElimination({ pilots: 16, seats: 4, advance: 3 })).toThrow(BracketError);
  });
});

describe('letterMains', () => {
  it('10 pilots, 4 seats, 2 bump-ups: D to A', () => {
    const p = letterMains({ pilots: 10, seats: 4, bumps: 2 });
    expect(p.rounds.map((r) => r.name)).toEqual(['D-main', 'C-main', 'B-main', 'A-main']);
    expect(describePlan(p)).toBe('4 mains: D, C, B, A');
    expect(p.rounds[0].heats[0].seeds).toEqual([
      { kind: 'class', rank: 7 },
      { kind: 'class', rank: 8 },
      { kind: 'class', rank: 9 },
      { kind: 'class', rank: 10 }
    ]);
    expect(p.rounds[1].heats[0].seeds).toEqual([
      { kind: 'class', rank: 5 },
      { kind: 'class', rank: 6 },
      { kind: 'heat', round: 0, heat: 0, rank: 1 },
      { kind: 'heat', round: 0, heat: 0, rank: 2 }
    ]);
    expect(p.rounds[3].heats[0].seeds).toEqual([
      { kind: 'class', rank: 1 },
      { kind: 'class', rank: 2 },
      { kind: 'heat', round: 2, heat: 0, rank: 1 },
      { kind: 'heat', round: 2, heat: 0, rank: 2 }
    ]);
  });
  it('a short last main only bumps what flew', () => {
    const p = letterMains({ pilots: 5, seats: 4, bumps: 2 });
    expect(p.rounds.map((r) => r.name)).toEqual(['B-main', 'A-main']);
    expect(p.rounds[0].heats[0].seeds.filter(Boolean)).toHaveLength(3); // ranks 3,4,5
    expect(p.rounds[1].heats[0].seeds).toEqual([
      { kind: 'class', rank: 1 },
      { kind: 'class', rank: 2 },
      { kind: 'heat', round: 0, heat: 0, rank: 1 },
      { kind: 'heat', round: 0, heat: 0, rank: 2 }
    ]);
    expect(letterMains({ pilots: 4, seats: 4, bumps: 1 }).rounds).toHaveLength(1);
  });
  it('16 pilots, 1 bump-up: five mains', () => {
    expect(letterMains({ pilots: 16, seats: 4, bumps: 1 }).rounds.map((r) => r.name)).toEqual([
      'E-main',
      'D-main',
      'C-main',
      'B-main',
      'A-main'
    ]);
    expect(() => letterMains({ pilots: 16, seats: 4, bumps: 4 })).toThrow(BracketError);
  });
});
