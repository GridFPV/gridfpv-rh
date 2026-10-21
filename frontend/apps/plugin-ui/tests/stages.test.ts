import { describe, expect, it } from 'vitest';
import { emptyResults, type Results } from '../src/lib/results.js';
import {
  activeSeatIndexes,
  boardLayout,
  bracketRounds,
  isBracketStage,
  heatShortName,
  heatsForPilots,
  needsSeeding,
  roundLabel,
  roundsOf,
  unresolvedSeats,
  standingsLine,
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
      ...heat(2, [
        slot(0, { method: SLOT_METHOD.HEAT_RESULT, seedId: 1, seedRank: 1, pilotId: 5 })
      ]),
      status: HEAT_STATUS.PROJECTED
    };
    expect(stageState(cls(1), [projected], emptyResults())).toBe('plan');
    const confirmed = { ...projected, status: HEAT_STATUS.CONFIRMED };
    expect(stageState(cls(1), [confirmed], emptyResults())).toBe('seeded');
    // A ready first round plus a waiting final is seeded, not plan.
    expect(stageState(cls(1), [confirmed, waiting], emptyResults())).toBe('seeded');
  });
  it('a grouped stage is done once every heat has flown once', () => {
    const grouped = { ...cls(3), roundType: 1 };
    expect(stageState(grouped, [seated], raced(1, 1))).toBe('done');
    expect(stageState(grouped, [seated, heat(2, [slot(0)])], raced(1, 1))).toBe('running');
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
      {
        id: 5,
        callsign: 'Nova',
        name: 'N',
        phonetic: '',
        team: '',
        color: '',
        active: true,
        locked: false,
        attributes: {}
      }
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

describe('layout and standings', () => {
  it('switches to the strip past six rounds', () => {
    expect(boardLayout(1)).toBe('grid');
    expect(boardLayout(6)).toBe('grid');
    expect(boardLayout(7)).toBe('strip');
    expect(boardLayout(1, true)).toBe('strip');
  });
  it('writes the standings in one line, cut at max', () => {
    const rows = [
      { pilotId: 1, callsign: 'Vortex', position: 1 },
      { pilotId: 2, callsign: 'Pixel', position: 2 },
      { pilotId: 3, callsign: 'Blitz', position: 3 }
    ];
    expect(standingsLine(rows)).toBe('1 Vortex · 2 Pixel · 3 Blitz');
    expect(standingsLine(rows, 2)).toBe('1 Vortex · 2 Pixel · …');
    expect(standingsLine(undefined)).toBe('');
  });
});

describe('grouped rounds helpers', () => {
  it('groups heats by round and strips the round prefix', () => {
    const a = {
      ...heat(1, []),
      groupId: 0,
      displayName: 'Round 1 / Quarter 1',
      autoName: 'Quarter 1'
    };
    const b = { ...heat(2, []), groupId: 2, displayName: 'Round 3 / Final', name: 'Final' };
    expect(roundsOf([a, b]).map((r) => r.map((h) => h.id))).toEqual([[1], [], [2]]);
    expect(heatShortName(a)).toBe('Quarter 1');
    expect(heatShortName(b)).toBe('Final');
    expect(heatShortName({ ...a, name: '', autoName: '' })).toBe('Quarter 1');
  });
  it('lists the seats that have a frequency', () => {
    expect(
      activeSeatIndexes([
        { index: 0, frequency: 5658 },
        { index: 1, frequency: 0 },
        { index: 2, frequency: 5760 }
      ])
    ).toEqual([0, 2]);
  });
});

describe('seeding state and round labels', () => {
  const seeded = (status: number, pilotId: number) =>
    ({
      ...heat(5, [slot(0, { method: SLOT_METHOD.HEAT_RESULT, seedId: 1, seedRank: 1, pilotId })]),
      status
    }) as Heat;
  it('a confirmed heat with seats still waiting still needs seeding', () => {
    expect(needsSeeding(seeded(HEAT_STATUS.PLANNED, 0))).toBe(true);
    expect(needsSeeding(seeded(HEAT_STATUS.CONFIRMED, 0))).toBe(true);
    expect(needsSeeding(seeded(HEAT_STATUS.CONFIRMED, 5))).toBe(false);
    expect(unresolvedSeats(seeded(HEAT_STATUS.PLANNED, 0))).toBe(1);
  });
  it('labels rounds from their heat names', () => {
    const named = (...names: string[]) => names.map((n, i) => ({ ...heat(i + 1, []), name: n }));
    expect(roundLabel(named('W1', 'W2'))).toBe('winners');
    expect(roundLabel(named('L3'))).toBe('losers');
    expect(roundLabel(named('Final'))).toBe('the final');
    expect(roundLabel(named('Semi 1', 'Semi 2'))).toBe('semifinals');
    expect(roundLabel(named('C-main'))).toBe('C-main');
    expect(roundLabel(named('Heat 1', 'Heat 2'))).toBe('');
  });
});

describe('bracket stages', () => {
  const hr = (heatId: number, rank: number): Partial<Slot> => ({
    method: SLOT_METHOD.HEAT_RESULT,
    seedId: heatId,
    seedRank: rank
  });
  const semi1 = heat(1, [slot(0, { method: SLOT_METHOD.CLASS_RESULT, seedId: 9, seedRank: 1 })]);
  const semi2 = heat(2, [slot(0, { method: SLOT_METHOD.CLASS_RESULT, seedId: 9, seedRank: 2 })]);
  const final = heat(3, [slot(0, hr(1, 1)), slot(1, hr(2, 1))]);
  const losers = heat(4, [slot(0, hr(1, 2)), slot(1, hr(2, 2))]);
  const grand = heat(5, [slot(0, hr(3, 1)), slot(1, hr(4, 1))]);
  it('reads rounds off the seeding graph', () => {
    expect(
      bracketRounds([semi1, semi2, final, losers, grand]).map((r) => r.map((h) => h.id))
    ).toEqual([[1, 2], [3, 4], [5]]);
  });
  it('is a bracket only when races-per-heat, one round, and heats seed from each other', () => {
    expect(isBracketStage(cls(1), [semi1, semi2, final])).toBe(true);
    expect(isBracketStage(cls(1), [semi1, semi2])).toBe(false);
    expect(isBracketStage(cls(3), [semi1, semi2, final])).toBe(false);
    expect(isBracketStage({ ...cls(1), roundType: 1 }, [semi1, final])).toBe(false);
  });
});
