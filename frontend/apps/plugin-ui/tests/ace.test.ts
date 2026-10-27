import { describe, expect, it } from 'vitest';
import { aceLine, aceRule, aceTally, isAceStage, stageType } from '../src/lib/ace.js';
import type { RaceResult } from '../src/lib/results.js';

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
