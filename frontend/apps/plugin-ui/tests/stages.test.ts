import { describe, expect, it } from 'vitest';
import { emptyResults, type Results } from '../src/lib/results.js';
import {
  heatsForPilots,
  nextRound,
  roundColumns,
  seatChips,
  stageState
} from '../src/lib/stages.js';
import {
  emptySetup,
  HEAT_STATUS,
  SLOT_METHOD,
  type Heat,
  type RaceClass,
  type Slot
} from '../src/lib/setup.js';

const cls = (rounds: number): RaceClass => ({
  id: 1,
  name: 'Quali',
  displayName: 'Quali',
  description: '',
  formatId: 1,
  winCondition: '',
  rankMethodLabel: null,
  rounds,
  heatAdvanceType: 0,
  roundType: 0,
  order: null,
  locked: false,
  attributes: {}
});
const slot = (nodeIndex: number, over: Partial<Slot> = {}): Slot => ({
  id: nodeIndex + 1,
  nodeIndex,
  pilotId: 0,
  method: SLOT_METHOD.NONE,
  seedRank: null,
  seedId: null,
  ...over
});
const heat = (id: number, slots: Slot[]): Heat => ({
  id,
  displayName: `Heat ${id}`,
  name: '',
  autoName: `Heat ${id}`,
  classId: 1,
  groupId: null,
  order: null,
  status: 0,
  autoFrequency: false,
  active: true,
  nextRound: 1,
  dynamic: false,
  locked: false,
  slots,
  attributes: {}
});
const raced = (heatId: number, rounds: number): Results => {
  const r = emptyResults();
  r.races[heatId] = Array.from({ length: rounds }, (_, i) => ({
    heatId,
    round: i + 1,
    startTime: '',
    rows: []
  }));
  return r;
};

describe('stageState', () => {
  const seated = heat(1, [slot(0, { method: SLOT_METHOD.ASSIGN, pilotId: 5 }), slot(1)]);
  it('empty → ready → running → done', () => {
    expect(stageState(cls(2), [], emptyResults())).toBe('empty');
    expect(stageState(cls(2), [seated], emptyResults())).toBe('ready');
    expect(stageState(cls(2), [seated], raced(1, 1))).toBe('running');
    expect(stageState(cls(2), [seated], raced(1, 2))).toBe('done');
  });
  it('plan until a seeded heat is confirmed, seeded once it is', () => {
    const waiting = heat(2, [slot(0, { method: SLOT_METHOD.HEAT_RESULT, seedId: 1, seedRank: 1 })]);
    expect(stageState(cls(1), [waiting], emptyResults())).toBe('plan');
    // A projected pilot is still only a guess until confirmed.
    const projected = {
      ...heat(2, [slot(0, { method: SLOT_METHOD.HEAT_RESULT, seedId: 1, seedRank: 1, pilotId: 5 })]),
      status: HEAT_STATUS.PROJECTED
    };
    expect(stageState(cls(1), [projected], emptyResults())).toBe('plan');
    const confirmed = { ...projected, status: HEAT_STATUS.CONFIRMED };
    expect(stageState(cls(1), [confirmed], emptyResults())).toBe('seeded');
  });
  it('unlimited rounds never reach done', () => {
    expect(stageState(cls(0), [seated], raced(1, 7))).toBe('running');
  });
});

describe('columns and next round', () => {
  const h = heat(1, [slot(0)]);
  it('draws the round count, or more if extra rounds were raced', () => {
    expect(roundColumns(cls(3), [h], emptyResults())).toBe(3);
    expect(roundColumns(cls(3), [h], raced(1, 4))).toBe(4);
    expect(roundColumns(cls(0), [h], raced(1, 2))).toBe(3);
  });
  it('knows the next round and when there is none', () => {
    expect(nextRound(cls(2), h, emptyResults())).toBe(1);
    expect(nextRound(cls(2), h, raced(1, 1))).toBe(2);
    expect(nextRound(cls(2), h, raced(1, 2))).toBeNull();
    expect(nextRound(cls(0), h, raced(1, 9))).toBe(10);
  });
});

describe('seatChips', () => {
  const setup = {
    ...emptySetup(),
    pilots: [
      { id: 5, callsign: 'Nova', name: 'N', phonetic: '', team: '', color: '', active: true, locked: false, attributes: {} }
    ],
    heats: [heat(1, [])]
  };
  it('labels pilots, seeds, pending seeds and empties', () => {
    const h = heat(2, [
      slot(1),
      slot(0, { method: SLOT_METHOD.ASSIGN, pilotId: 5 }),
      slot(2, { method: SLOT_METHOD.HEAT_RESULT, seedId: 1, seedRank: 2 }),
      slot(3, { method: SLOT_METHOD.CLASS_RESULT, seedId: 1, seedRank: 1, pilotId: 5 }),
      { ...slot(9), nodeIndex: null }
    ]);
    expect(seatChips(setup, h).map((c) => [c.seat, c.kind, c.text])).toEqual([
      [1, 'pilot', 'Nova'],
      [2, 'empty', '—'],
      [3, 'pending', '2nd of Heat 1'],
      [4, 'projected', 'Nova']
    ]);
    const confirmed = { ...h, status: HEAT_STATUS.CONFIRMED };
    expect(seatChips(setup, confirmed)[3].kind).toBe('seed');
  });
});

describe('heatsForPilots', () => {
  it('rounds up and never returns zero', () => {
    expect(heatsForPilots(9, 4)).toBe(3);
    expect(heatsForPilots(8, 4)).toBe(2);
    expect(heatsForPilots(0, 4)).toBe(1);
    expect(heatsForPilots(5, 0)).toBe(0);
  });
});
