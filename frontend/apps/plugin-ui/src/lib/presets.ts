/**
 * Channel presets. A **preset** is only a layout: which channel each seat is on. A
 * **profile** (RotorHazard's record) is that plus every seat's tuning. Applying a preset
 * writes its channels into the active profile and leaves the tuning alone.
 *
 * Built-in presets are the ones RotorHazard's own settings page offers (R1367, IMD5C, IMD6C,
 * Raceband 1–8, from `server.py: on_set_frequency_preset`) plus MultiGP's sets. Custom ones
 * are whatever the director saves; the plugin keeps them in RotorHazard's database.
 */
import { frequencyFor } from './channels.js';

export type PresetSeat = { band: string | null; channel: number | null; frequency: number };

export type Preset = {
  id: string;
  name: string;
  seats: PresetSeat[];
  builtin: boolean;
};

export const OFF_SEAT: PresetSeat = { band: null, channel: null, frequency: 0 };

function fromKeys(id: string, name: string, keys: string[]): Preset {
  const seats = keys.map((key) => {
    const m = /^([A-Z]+)(\d+)$/.exec(key);
    const band = m?.[1] ?? '';
    const channel = Number(m?.[2]);
    const frequency = frequencyFor(band, channel);
    if (!frequency) throw new Error(`preset key ${key} is not in RotorHazard's table`);
    return { band, channel, frequency };
  });
  return { id, name, seats, builtin: true };
}

export const BUILT_IN: readonly Preset[] = [
  fromKeys('RB-4', 'R1367 · 4 seats', ['R1', 'R3', 'R6', 'R7']),
  fromKeys('IMD5C', 'IMD5C · 5 seats', ['R1', 'R2', 'F2', 'F4', 'E5']),
  fromKeys('IMD6C', 'IMD6C · 6 seats (RotorHazard default)', ['R1', 'R2', 'F2', 'F4', 'R7', 'R8']),
  fromKeys('ET6minus1', 'ET6minus1 · 5 seats (MultiGP)', ['E4', 'E2', 'F2', 'E6', 'E8']),
  fromKeys('ETBest6', 'ETBest6 · 6 seats (MultiGP)', ['E4', 'E2', 'F2', 'A4', 'E6', 'E8']),
  fromKeys('RB-8', 'Raceband 1–8', ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8'])
];

/** The per-seat plan for a preset on a timer with `seatCount` seats; extra seats are Off. */
export function presetSeats(preset: Preset, seatCount: number): PresetSeat[] {
  const out = preset.seats.slice(0, seatCount).map((s) => ({ ...s }));
  while (out.length < seatCount) out.push({ ...OFF_SEAT });
  return out;
}

/** A custom preset as the plugin sends it (no `builtin` flag on the wire). */
export type WirePreset = { id: string; name: string; seats: PresetSeat[] };

export function fromWire(p: WirePreset): Preset {
  return { id: p.id, name: p.name, seats: p.seats, builtin: false };
}
