import { describe, expect, it } from 'vitest';
import { BUILT_IN, fromWire, presetSeats } from '../src/lib/presets.js';
import { imdRating } from '../src/lib/imd.js';

const byId = (id: string) => BUILT_IN.find((p) => p.id === id)!;

describe('built-in presets', () => {
  it('resolve every key through RotorHazard’s table and pad the rest of the seats off', () => {
    for (const p of BUILT_IN) {
      const plan = presetSeats(p, 8);
      expect(plan).toHaveLength(8);
      expect(plan.filter((s) => s.frequency > 0)).toHaveLength(p.seats.length);
      expect(plan.slice(p.seats.length).every((s) => s.frequency === 0 && s.band === null)).toBe(
        true
      );
    }
  });

  it('match RotorHazard’s own preset frequencies', () => {
    const f = (id: string) => presetSeats(byId(id), 8).map((s) => s.frequency);
    expect(f('RB-4').slice(0, 4)).toEqual([5658, 5732, 5843, 5880]);
    expect(f('IMD5C').slice(0, 5)).toEqual([5658, 5695, 5760, 5800, 5885]);
    expect(f('IMD6C').slice(0, 6)).toEqual([5658, 5695, 5760, 5800, 5880, 5917]);
    expect(f('RB-8')).toEqual([5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917]);
  });

  it('rate the way the hobby expects, so the preset list is not lying about quality', () => {
    const rating = (id: string) => imdRating(byId(id).seats.map((s) => s.frequency));
    expect(rating('IMD6C')).toBe(29);
    expect(rating('ET6minus1')).toBe(98);
    expect(rating('ETBest6')).toBe(67);
    expect(rating('RB-8')).toBe(-635);
  });

  it('truncates to the timer’s seat count', () => {
    expect(presetSeats(byId('RB-8'), 4).map((s) => s.frequency)).toEqual([5658, 5695, 5732, 5769]);
  });
});

describe('custom presets', () => {
  it('come off the wire as non-builtin and keep custom frequencies', () => {
    const p = fromWire({
      id: 'abc',
      name: 'Club night',
      seats: [
        { band: 'R', channel: 1, frequency: 5658 },
        { band: null, channel: null, frequency: 5700 }
      ]
    });
    expect(p.builtin).toBe(false);
    expect(presetSeats(p, 3).map((s) => s.frequency)).toEqual([5658, 5700, 0]);
  });
});
