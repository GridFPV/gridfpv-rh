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
  const shape = { seats: 4, advance: 2, perMain: 8, bumps: 2, inner: 'single' as const };
  it('20 pilots in mains of 8: three brackets, lowest first, finals feed upward', () => {
    const p = letterMains({ pilots: 20, ...shape });
    expect(p.rounds.map((r) => r.name)).toEqual([
      'C-main semifinals',
      'C-main final',
      'B-main semifinals',
      'B-main final',
      'A-main semifinals',
      'A-main final'
    ]);
    expect(p.rounds.map((r) => r.heats.map((h) => h.name))).toEqual([
      ['C Semi 1', 'C Semi 2'],
      ['C Final'],
      ['B Semi 1', 'B Semi 2'],
      ['B Final'],
      ['A Semi 1', 'A Semi 2'],
      ['A Final']
    ]);
    expect(describePlan(p)).toBe('3 mains, 9 heats: C 2 → 1, B 2 → 1, A 2 → 1');
    expect(planSize(p)).toEqual({ heats: 9, seeds: 36 });
    // C-main: ranks 13–20, snake-seeded.
    expect(p.rounds[0].heats[0].seeds).toEqual([
      { kind: 'class', rank: 13 },
      { kind: 'class', rank: 16 },
      { kind: 'class', rank: 17 },
      { kind: 'class', rank: 20 }
    ]);
    // C Final: top 2 of each C semi.
    expect(p.rounds[1].heats[0].seeds).toEqual([
      { kind: 'heat', round: 0, heat: 0, rank: 1 },
      { kind: 'heat', round: 0, heat: 0, rank: 2 },
      { kind: 'heat', round: 0, heat: 1, rank: 1 },
      { kind: 'heat', round: 0, heat: 1, rank: 2 }
    ]);
    // B-main: ranks 7–12 direct plus the top 2 of C Final as its lowest seeds (7 and 8).
    expect(p.rounds[2].heats[0].seeds).toEqual([
      { kind: 'class', rank: 7 },
      { kind: 'class', rank: 10 },
      { kind: 'class', rank: 11 },
      { kind: 'heat', round: 1, heat: 0, rank: 2 }
    ]);
    expect(p.rounds[2].heats[1].seeds).toEqual([
      { kind: 'class', rank: 8 },
      { kind: 'class', rank: 9 },
      { kind: 'class', rank: 12 },
      { kind: 'heat', round: 1, heat: 0, rank: 1 }
    ]);
    // A-main takes the top 2 of B Final; its final is the last round.
    expect(p.rounds[4].heats[0].seeds[3]).toEqual({ kind: 'heat', round: 3, heat: 0, rank: 2 });
    expect(p.rounds[5].heats[0].seeds.map((s) => s && s.kind === 'heat' && s.round)).toEqual([
      4, 4, 4, 4
    ]);
    expect(p.perMain).toBe(8);
    expect(p.bumps).toBe(2);
  });
  it('a short lowest main is one heat, and only bumps what flew', () => {
    const p = letterMains({ pilots: 15, ...shape });
    expect(p.rounds.map((r) => r.name)).toEqual([
      'C-main final',
      'B-main semifinals',
      'B-main final',
      'A-main semifinals',
      'A-main final'
    ]);
    expect(p.rounds[0].heats[0].seeds.filter(Boolean)).toHaveLength(3); // ranks 13–15
    expect(p.rounds[1].heats.flatMap((h) => h.seeds).filter((s) => s?.kind === 'heat')).toEqual([
      { kind: 'heat', round: 0, heat: 0, rank: 2 },
      { kind: 'heat', round: 0, heat: 0, rank: 1 }
    ]);
    const tiny = letterMains({ pilots: 9, seats: 4, advance: 2, perMain: 8, bumps: 1 });
    expect(tiny.rounds[0].heats[0].seeds.filter(Boolean)).toHaveLength(2); // ranks 8, 9
    expect(tiny.rounds[1].heats.flatMap((h) => h.seeds).filter((s) => s?.kind === 'heat')).toEqual([
      { kind: 'heat', round: 0, heat: 0, rank: 1 }
    ]);
  });
  it('everyone fits one main: a single bracket named A', () => {
    const p = letterMains({ pilots: 8, ...shape });
    expect(p.rounds.map((r) => r.name)).toEqual(['A-main semifinals', 'A-main final']);
    expect(describePlan(p)).toBe('1 main, 3 heats: A 2 → 1');
  });
  it('MultiGP shape: each main a double elimination, its final feeding the main above', () => {
    const p = letterMains({ pilots: 36, seats: 4, advance: 2, perMain: 16, bumps: 4 });
    // 36 = A 12 + B 12 + C 12 direct; B and A each add 4 bump-ups to make MultiGP's 16.
    expect(describePlan(p)).toBe('3 mains, 41 heats: C 13 heats, B 14 heats, A 14 heats');
    expect(p.rounds.slice(0, 3).map((r) => r.name)).toEqual([
      'C-main winners round 1',
      'C-main losers round 1',
      'C-main winners round 2'
    ]);
    expect(p.rounds[0].heats.map((h) => h.name)).toEqual(['C W1', 'C W2', 'C W3']);
    const cFinal = p.rounds.findIndex((r) => r.name === 'C-main final');
    expect(p.rounds[cFinal].heats[0].name).toBe('C Final');
    // B winners round 1: 12 direct (ranks 13–24) and the whole C Final as seeds 13–16.
    const bw1 = p.rounds[cFinal + 1];
    expect(bw1.name).toBe('B-main winners round 1');
    expect(bw1.heats.map((h) => h.name)).toEqual(['B W1', 'B W2', 'B W3', 'B W4']);
    expect(bw1.heats.flatMap((h) => h.seeds).filter((s) => s?.kind === 'heat')).toEqual([
      { kind: 'heat', round: cFinal, heat: 0, rank: 4 },
      { kind: 'heat', round: cFinal, heat: 0, rank: 3 },
      { kind: 'heat', round: cFinal, heat: 0, rank: 2 },
      { kind: 'heat', round: cFinal, heat: 0, rank: 1 }
    ]);
    expect(bw1.heats.flatMap((h) => h.seeds).filter((s) => s?.kind === 'class')).toHaveLength(12);
    // Heat references inside a main point into that main.
    const bFinal = p.rounds.findIndex((r) => r.name === 'B-main final');
    for (const s of p.rounds[bFinal].heats[0].seeds)
      expect(s && s.kind === 'heat' && s.round > cFinal && s.round < bFinal).toBe(true);
    expect(p.rounds[p.rounds.length - 1].name).toBe('A-main final');
    expect(p.inner).toBe('double');
  });
  it('a double-elimination main that fits one heat is just its final', () => {
    const p = letterMains({ pilots: 17, seats: 4, advance: 2, perMain: 16, bumps: 2 });
    expect(p.rounds[0].name).toBe('B-main final');
    expect(p.rounds[0].heats[0].seeds.filter(Boolean)).toHaveLength(3); // ranks 15–17
    expect(p.rounds[1].name).toBe('A-main winners round 1');
  });
  it('rejects shapes that cannot work', () => {
    expect(() => letterMains({ pilots: 36, seats: 4, advance: 3, perMain: 16, bumps: 4 })).toThrow(
      BracketError
    );
    expect(() => letterMains({ pilots: 36, seats: 4, advance: 2, perMain: 4, bumps: 2 })).toThrow(
      BracketError
    );
    expect(() => letterMains({ pilots: 20, seats: 4, advance: 2, perMain: 8, bumps: 8 })).toThrow(
      BracketError
    );
    expect(() => letterMains({ pilots: 20, seats: 4, advance: 2, perMain: 8, bumps: 5 })).toThrow(
      BracketError
    );
    expect(() => letterMains({ pilots: 20, seats: 4, advance: 4, perMain: 8, bumps: 2 })).toThrow(
      BracketError
    );
    expect(() => letterMains({ pilots: 256, seats: 4, advance: 2, perMain: 3, bumps: 1 })).toThrow(
      BracketError
    );
  });
});
