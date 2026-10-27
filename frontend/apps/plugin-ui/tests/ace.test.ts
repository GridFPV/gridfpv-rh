import { describe, expect, it } from 'vitest';
import {
  aceLine,
  aceRule,
  aceTally,
  isAceStage,
  roundsAfterAce,
  stageTally,
  stageType
} from '../src/lib/ace.js';
import { emptyResults, type RaceResult } from '../src/lib/results.js';
import type { Heat, RaceClass } from '../src/lib/setup.js';

const race = (round: number, winner: string, pilotId: number): RaceResult => ({
  heatId: 1,
  round,
  startTime: '',
  rows: [
    { pilotId, callsign: winner, position: 1, laps: 3, totalTime: '', fastestLap: '', node: 1 },
    { pilotId: 99, callsign: 'Other', position: 2, laps: 2, totalTime: '', fastestLap: '', node: 2 }
  ]
});

describe('stage type', () => {
  it('reads the plugin attribute', () => {
    expect(stageType({ attributes: {} })).toBe('');
    expect(isAceStage({ attributes: { gridfpv_stage: 'ace' } })).toBe(true);
    expect(isAceStage({ attributes: { gridfpv_stage: 'ace-row' } })).toBe(true);
    expect(isAceStage({ attributes: { gridfpv_stage: 'bracket' } })).toBe(false);
    expect(aceRule({ attributes: { gridfpv_stage: 'ace' } })).toBe('twice');
    expect(aceRule({ attributes: { gridfpv_stage: 'ace-row' } })).toBe('in-a-row');
  });
});

describe('aceTally', () => {
  it('counts wins and declares the first pilot to two', () => {
    const t = aceTally([race(1, 'Ace', 1), race(2, 'Bee', 2), race(3, 'Ace', 1)]);
    expect(t.wins).toEqual([
      { pilotId: 1, callsign: 'Ace', wins: 2, rounds: [1, 3] },
      { pilotId: 2, callsign: 'Bee', wins: 1, rounds: [2] }
    ]);
    expect(t.ace).toEqual({ pilotId: 1, callsign: 'Ace', round: 3 });
    expect(t.rounds).toBe(3);
  });
  it('in-a-row needs back-to-back wins', () => {
    const races = [race(1, 'Ace', 1), race(2, 'Bee', 2), race(3, 'Ace', 1)];
    expect(aceTally(races, 'in-a-row').ace).toBeNull();
    expect(aceTally([...races, race(4, 'Ace', 1)], 'in-a-row').ace?.round).toBe(4);
  });
  it('orders rounds by number whatever order they arrive in', () => {
    const t = aceTally([race(3, 'Ace', 1), race(1, 'Bee', 2), race(2, 'Bee', 2)]);
    expect(t.ace).toEqual({ pilotId: 2, callsign: 'Bee', round: 2 });
  });
  it('is empty with no races', () => {
    expect(aceTally([])).toEqual({ wins: [], ace: null, rounds: 0 });
  });
  it('a round nobody finished is no win: it breaks a streak and never declares the ace (#52)', () => {
    const empty = (round: number): RaceResult => ({
      heatId: 1,
      round,
      startTime: '',
      rows: [
        {
          pilotId: 1,
          callsign: 'Ace',
          position: 1,
          laps: 0,
          totalTime: '',
          fastestLap: '',
          node: 1
        },
        {
          pilotId: 2,
          callsign: 'Bee',
          position: 2,
          laps: 0,
          totalTime: '',
          fastestLap: '',
          node: 2
        }
      ]
    });
    // Under "any two": the empty round credits nobody.
    const t = aceTally([race(1, 'Ace', 1), race(2, 'Bee', 2), race(3, 'Ace', 1)], 'in-a-row');
    expect(t.ace).toBeNull();
    const t2 = aceTally(
      [race(1, 'Ace', 1), race(2, 'Bee', 2), race(3, 'Ace', 1), empty(4)],
      'in-a-row'
    );
    expect(t2.ace).toBeNull();
    expect(t2.wins.map((w) => [w.callsign, w.wins])).toEqual([
      ['Ace', 2],
      ['Bee', 1]
    ]);
    // Mid-streak: Ace, empty, Ace is not two in a row.
    expect(aceTally([race(1, 'Ace', 1), empty(2), race(3, 'Ace', 1)], 'in-a-row').ace).toBeNull();
    expect(aceTally([race(1, 'Ace', 1), empty(2), race(3, 'Ace', 1)], 'twice').ace?.round).toBe(3);
    expect(aceTally([empty(1), empty(2)]).ace).toBeNull();
  });
  it('rounds flown after the ace keep the ace and are counted (#52)', () => {
    const t = aceTally([
      race(1, 'Ace', 1),
      race(2, 'Ace', 1),
      race(3, 'Bee', 2),
      race(4, 'Bee', 2)
    ]);
    expect(t.ace).toEqual({ pilotId: 1, callsign: 'Ace', round: 2 });
    expect(roundsAfterAce(t)).toBe(2);
    expect(aceLine(t)).toBe(
      'Ace is the ace — decided in round 2 · 2 rounds flown since: RotorHazard ranks by the last heat, not the ace'
    );
  });
  it('a second heat added later is tallied after the rounds already flown (#63)', () => {
    const at = (r: RaceResult, t: string): RaceResult => ({ ...r, startTime: t });
    const cls = { id: 1, attributes: { gridfpv_stage: 'ace-row' } } as unknown as RaceClass;
    const heats = [{ id: 1 }, { id: 2 }] as Heat[];
    // Heat 1: Ace, Bee, Ace, Ace → Ace is the ace in round 4. Then heat 2's round 1: Bee wins.
    const h1 = [
      at(race(1, 'Ace', 1), '2026-10-27 10:00:00.000'),
      at(race(2, 'Bee', 2), '2026-10-27 10:05:00.000'),
      at(race(3, 'Ace', 1), '2026-10-27 10:10:00.000'),
      at(race(4, 'Ace', 1), '2026-10-27 10:15:00.000')
    ];
    const h2 = [at({ ...race(1, 'Bee', 2), heatId: 2 }, '2026-10-27 10:20:00.000')];
    const t = stageTally(cls, heats, { ...emptyResults(), races: { 1: h1, 2: h2 } });
    expect(t.ace).toEqual({ pilotId: 1, callsign: 'Ace', round: 4 });
    expect(t.rounds).toBe(5);
  });
  it('stageTally reads every heat of the stage, not only the first (#52)', () => {
    const cls = { id: 1, attributes: { gridfpv_stage: 'ace' } } as unknown as RaceClass;
    const heats = [{ id: 1 }, { id: 2 }] as Heat[];
    const results = {
      ...emptyResults(),
      races: { 1: [race(1, 'Ace', 1)], 2: [{ ...race(2, 'Ace', 1), heatId: 2 }] }
    };
    expect(stageTally(cls, heats, results).ace?.round).toBe(2);
  });
});

describe('aceLine', () => {
  it('says the rule, the tally, then the ace', () => {
    expect(aceLine(aceTally([]))).toBe('First to win two rounds');
    expect(aceLine(aceTally([], 'in-a-row'), 'in-a-row')).toBe('First to win two rounds in a row');
    expect(aceLine(aceTally([race(1, 'Ace', 1), race(2, 'Bee', 2)]))).toBe('Wins: Ace 1 · Bee 1');
    expect(aceLine(aceTally([race(1, 'Ace', 1), race(2, 'Ace', 1)]))).toBe(
      'Ace is the ace — decided in round 2'
    );
  });
});
