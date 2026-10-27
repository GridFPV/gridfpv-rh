import { describe, expect, it } from 'vitest';
import {
  applyDeletedRaces,
  deletedLabel,
  deletedNotice,
  deletedRacesFor,
  restoreBlocker
} from '../src/lib/rounds.js';
import { emptyResults, type Results } from '../src/lib/results.js';
import { emptySetup, type Heat, type Setup } from '../src/lib/setup.js';

const heat = (id: number, name: string): Heat =>
  ({
    id,
    name,
    displayName: name,
    autoName: '',
    classId: 1,
    locked: false,
    status: 0,
    slots: []
  }) as unknown as Heat;

function setupWith(...heats: Heat[]): Setup {
  return { ...emptySetup(), heats };
}

const payload = {
  races: [
    {
      id: 'a1',
      heat_id: 7,
      round_id: 2,
      class_id: 3,
      start_time_formatted: '03:14',
      deleted_at: '03:15',
      callsigns: ['Ace', 'Bee']
    },
    {
      id: '5',
      heat_id: 8,
      round_id: 1,
      class_id: 3,
      start_time_formatted: '',
      deleted_at: '',
      callsigns: []
    }
  ],
  native: false
};

describe('applyDeletedRaces', () => {
  it('maps the plugin payload', () => {
    const list = applyDeletedRaces(payload);
    expect(list[0]).toEqual({
      id: 'a1',
      heatId: 7,
      round: 2,
      classId: 3,
      startTime: '03:14',
      deletedAt: '03:15',
      callsigns: ['Ace', 'Bee']
    });
    expect(list[1].callsigns).toEqual([]);
    expect(applyDeletedRaces(null)).toEqual([]);
  });
});

describe('deletedRacesFor', () => {
  it('keeps the races of the given heats', () => {
    const list = applyDeletedRaces(payload);
    expect(deletedRacesFor(list, [7]).map((d) => d.id)).toEqual(['a1']);
    expect(deletedRacesFor(list, [1])).toEqual([]);
  });
});

describe('restoreBlocker', () => {
  const d = applyDeletedRaces(payload)[0];
  it('allows a restore when the heat exists and the round is free', () => {
    expect(restoreBlocker(d, emptyResults(), setupWith(heat(7, 'Heat A')))).toBeNull();
  });
  it('blocks when the heat is gone or the round was raced again', () => {
    expect(restoreBlocker(d, emptyResults(), setupWith())).toBe('its heat no longer exists');
    const results: Results = {
      ...emptyResults(),
      races: { 7: [{ heatId: 7, round: 2, startTime: '', rows: [] }] }
    };
    expect(restoreBlocker(d, results, setupWith(heat(7, 'Heat A')))).toBe(
      'round 2 has been raced again'
    );
  });
});

describe('labels', () => {
  it('names the heat, round and pilots', () => {
    const [a, b] = applyDeletedRaces(payload);
    expect(deletedLabel(a, setupWith(heat(7, 'Heat A')))).toBe('Heat A · round 2 · Ace, Bee');
    expect(deletedLabel(b, setupWith())).toBe('Heat 8 · round 1');
  });
  it('says whether a backup was taken', () => {
    expect(deletedNotice('db_1.db')).toContain('(db_1.db)');
    expect(deletedNotice(null)).toContain('could not back up');
  });
});
