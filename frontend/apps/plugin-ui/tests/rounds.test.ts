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

const heat = (id: number, name: string, classId = 3, pilots: number[] = [1, 2]): Heat =>
  ({
    id,
    name,
    displayName: name,
    autoName: '',
    classId,
    locked: false,
    status: 0,
    slots: pilots.map((pilotId, i) => ({ id: i, nodeIndex: i, pilotId, method: 0 }))
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
      callsigns: ['Ace', 'Bee'],
      pilot_ids: [1, 2]
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
      callsigns: ['Ace', 'Bee'],
      pilotIds: [1, 2]
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
  it('blocks a heat that changed stage or pilots since (#48)', () => {
    expect(restoreBlocker(d, emptyResults(), setupWith(heat(7, 'Heat A', 9)))).toBe(
      'the heat is in a different stage now'
    );
    expect(restoreBlocker(d, emptyResults(), setupWith(heat(7, 'Heat A', 3, [1, 5])))).toBe(
      "the heat's pilots are not the ones who flew it"
    );
    expect(restoreBlocker(d, emptyResults(), setupWith(heat(7, 'Heat A', 3, [2, 1])))).toBeNull();
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
