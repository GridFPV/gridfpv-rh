import { describe, expect, it } from 'vitest';
import { addLabel, applyRoster, rosterMissing } from '../src/lib/roster.js';

const payload = {
  pilots: [
    {
      id: 'b',
      callsign: 'bee',
      name: 'B',
      team: '',
      color: '',
      phonetic: '',
      attributes: { mgp: '7' },
      last_seen: '2026-10-27',
      in_event: false
    },
    {
      id: 'a',
      callsign: 'Ace',
      name: 'A',
      team: 'Red',
      color: '#123',
      phonetic: 'ace',
      attributes: null,
      last_seen: '',
      in_event: true
    }
  ],
  path: '/x/roster.json'
};

describe('applyRoster', () => {
  it('maps and sorts by callsign', () => {
    const r = applyRoster(payload);
    expect(r.map((p) => p.callsign)).toEqual(['Ace', 'bee']);
    expect(r[0]).toMatchObject({ id: 'a', team: 'Red', inEvent: true, attributes: {} });
    expect(r[1].attributes).toEqual({ mgp: '7' });
    expect(applyRoster(null)).toEqual([]);
  });
});

describe('rosterMissing and addLabel', () => {
  it('offers only pilots not in the event', () => {
    const missing = rosterMissing(applyRoster(payload));
    expect(missing.map((p) => p.callsign)).toEqual(['bee']);
    expect(addLabel([])).toBe('Add pilots');
    expect(addLabel(missing)).toBe('Add bee');
    expect(addLabel([...missing, ...missing])).toBe('Add 2 pilots');
  });
});
