/**
 * Standard channel sets to fill a profile from — the same ones RotorHazard's settings page
 * offers (R1367, IMD5C, IMD6C, Raceband 8, from `server.py: on_set_frequency_preset`), plus
 * MultiGP's ETBest6. Each is a list of seats; seats past the end are turned off, exactly as
 * RotorHazard pads its presets.
 */
import { frequencyFor } from './channels.js';

export type PresetSeat = { band: string | null; channel: number | null; frequency: number };

export type Preset = {
  id: string;
  name: string;
  /** Band+channel keys from RotorHazard's table, e.g. `R1`. */
  keys: string[];
};

export const PRESETS: readonly Preset[] = [
  { id: 'RB-4', name: 'R1367 · 4 seats', keys: ['R1', 'R3', 'R6', 'R7'] },
  { id: 'IMD5C', name: 'IMD5C · 5 seats', keys: ['R1', 'R2', 'F2', 'F4', 'E5'] },
  {
    id: 'IMD6C',
    name: 'IMD6C · 6 seats (RotorHazard default)',
    keys: ['R1', 'R2', 'F2', 'F4', 'R7', 'R8']
  },
  {
    id: 'ET6minus1',
    name: 'ET6minus1 · 5 seats (MultiGP)',
    keys: ['E4', 'E2', 'F2', 'E6', 'E8']
  },
  {
    id: 'ETBest6',
    name: 'ETBest6 · 6 seats (MultiGP)',
    keys: ['E4', 'E2', 'F2', 'A4', 'E6', 'E8']
  },
  { id: 'RB-8', name: 'Raceband 1–8', keys: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8'] }
];

const OFF: PresetSeat = { band: null, channel: null, frequency: 0 };

function parseKey(key: string): PresetSeat {
  const m = /^([A-Z]+)(\d+)$/.exec(key);
  if (!m) throw new Error(`bad preset key ${key}`);
  const band = m[1];
  const channel = Number(m[2]);
  const frequency = frequencyFor(band, channel);
  if (!frequency) throw new Error(`preset key ${key} is not in RotorHazard's table`);
  return { band, channel, frequency };
}

/** The per-seat plan for a preset on a timer with `seatCount` seats; extra seats are Off. */
export function presetSeats(preset: Preset, seatCount: number): PresetSeat[] {
  const out = preset.keys.slice(0, seatCount).map(parseKey);
  while (out.length < seatCount) out.push(OFF);
  return out;
}
