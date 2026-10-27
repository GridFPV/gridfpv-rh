import { describe, expect, it } from 'vitest';
import {
  DISPLAY_DEFAULTS,
  DISPLAY_KEYS,
  lapChips,
  readDisplayPrefs,
  saveDisplayPrefs,
  stampText
} from '../src/lib/displayPrefs.js';
import type { LiveLap } from '../src/lib/race.js';

const lap = (index: number, number: number, stampMs: number): LiveLap => ({
  index,
  number,
  timeMs: 1000,
  formatted: '0:01.000',
  stampMs,
  deleted: false,
  late: false,
  source: null
});

describe("display preferences (RotorHazard's rotorhazard.display_* keys)", () => {
  it("reads RotorHazard's JSON booleans and writes them back the same way", () => {
    const store = new Map<string, string>([
      ['rotorhazard.display_lap_id', 'true'],
      ['rotorhazard.hide_graphs', 'false']
    ]);
    const p = readDisplayPrefs({ getItem: (k) => store.get(k) ?? null });
    expect(p).toEqual({ ...DISPLAY_DEFAULTS, display_lap_id: true });
    saveDisplayPrefs(
      { setItem: (k, v) => void store.set(k, v) },
      { ...p, display_laps_reversed: true }
    );
    expect(store.get('rotorhazard.display_laps_reversed')).toBe('true');
    expect(store.size).toBe(DISPLAY_KEYS.length);
  });
  it("orders and annotates lap chips as RotorHazard's lap list does", () => {
    const laps = [lap(0, 0, 300), lap(1, 1, 1600), lap(2, 2, 2900)];
    expect(lapChips(laps, DISPLAY_DEFAULTS).map((c) => [c.label, c.extra])).toEqual([
      ['', []],
      ['', []],
      ['', []]
    ]);
    const all = {
      ...DISPLAY_DEFAULTS,
      display_lap_id: true,
      display_time_start: true,
      display_time_first_pass: true,
      display_laps_reversed: true
    };
    const chips = lapChips(laps, all);
    expect(chips.map((c) => c.lap.number)).toEqual([2, 1, 0]);
    expect(chips[0].label).toBe('L2');
    expect(chips[0].extra).toEqual(['@0:02.900', '+0:02.600']);
    expect(chips[2].label).toBe('start');
    expect(chips[2].extra).toEqual(['@0:00.300', '+0:00.000']);
    expect(stampText(61_005)).toBe('1:01.005');
  });
});
