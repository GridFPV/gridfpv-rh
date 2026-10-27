/**
 * Pure reducers over RotorHazard's seat-related socket payloads. The store applies them;
 * tests exercise them directly. Shapes are RotorHazard 4.4.0's (RHUI.py / server.py):
 *
 * - `frequency_data`            { fdata: [{ band, channel, frequency }] }   (active profile)
 * - `enter_and_exit_at_levels`  { enter_at_levels: [], exit_at_levels: [] }  (active profile)
 * - `heartbeat`                 { current_rssi: [], frequency: [], crossing_flag: [] } (what the
 *                               node actually reports — the readback for a channel write)
 * - `node_data`                 { node_peak_rssi, node_nadir_rssi, pass_peak_rssi, pass_nadir_rssi }
 * - `node_crossing_change`      { node_index, crossing_flag }
 * - `node_tuning`               { profile_ids, profile_names, current_profile, profile_name,
 *                                 profile_description }
 */

import { RACE_STATUS } from './race.js';

export type Seat = {
  index: number;
  /** From the active profile (what we asked for). */
  frequency: number;
  band: string | null;
  channel: number | null;
  enter: number | null;
  exit: number | null;
  /** From the heartbeat (what the node reports). */
  rssi: number;
  nodeFrequency: number | null;
  crossing: boolean;
  peak: number | null;
  nadir: number | null;
  passPeak: number | null;
  passNadir: number | null;
};

export type Profile = { id: number; name: string };

export type Profiles = {
  list: Profile[];
  currentId: number | null;
  name: string;
  description: string;
};

export function emptySeat(index: number): Seat {
  return {
    index,
    frequency: 0,
    band: null,
    channel: null,
    enter: null,
    exit: null,
    rssi: 0,
    nodeFrequency: null,
    crossing: false,
    peak: null,
    nadir: null,
    passPeak: null,
    passNadir: null
  };
}

/** Grow (never shrink) the seat list to `n` entries. */
export function ensureSeats(seats: Seat[], n: number): Seat[] {
  if (seats.length >= n) return seats;
  const out = seats.slice();
  for (let i = seats.length; i < n; i++) out.push(emptySeat(i));
  return out;
}

type FData = Array<{ band: string | null; channel: number | null; frequency: number }>;

export function applyFrequencyData(seats: Seat[], fdata: FData): Seat[] {
  const out = ensureSeats(seats, fdata.length);
  return out.map((s, i) =>
    i < fdata.length
      ? {
          ...s,
          frequency: Number(fdata[i].frequency) || 0,
          band: fdata[i].band ?? null,
          channel: fdata[i].channel == null ? null : Number(fdata[i].channel)
        }
      : s
  );
}

export function applyLevels(
  seats: Seat[],
  payload: { enter_at_levels: Array<number | null>; exit_at_levels: Array<number | null> }
): Seat[] {
  const n = Math.max(payload.enter_at_levels.length, payload.exit_at_levels.length);
  const out = ensureSeats(seats, n);
  return out.map((s, i) => ({
    ...s,
    enter: i < payload.enter_at_levels.length ? toLevel(payload.enter_at_levels[i]) : s.enter,
    exit: i < payload.exit_at_levels.length ? toLevel(payload.exit_at_levels[i]) : s.exit
  }));
}

function toLevel(v: number | null | undefined): number | null {
  return v == null ? null : Number(v);
}

export function applyHeartbeat(
  seats: Seat[],
  payload: { current_rssi: number[]; frequency?: number[]; crossing_flag?: boolean[] }
): Seat[] {
  const out = ensureSeats(seats, payload.current_rssi.length);
  return out.map((s, i) =>
    i < payload.current_rssi.length
      ? {
          ...s,
          rssi: Number(payload.current_rssi[i]) || 0,
          nodeFrequency: payload.frequency ? Number(payload.frequency[i]) : s.nodeFrequency,
          crossing: payload.crossing_flag ? Boolean(payload.crossing_flag[i]) : s.crossing
        }
      : s
  );
}

export function applyNodeData(
  seats: Seat[],
  payload: {
    node_peak_rssi: number[];
    node_nadir_rssi: number[];
    pass_peak_rssi: number[];
    pass_nadir_rssi: number[];
  }
): Seat[] {
  const out = ensureSeats(seats, payload.node_peak_rssi.length);
  return out.map((s, i) =>
    i < payload.node_peak_rssi.length
      ? {
          ...s,
          peak: Number(payload.node_peak_rssi[i]),
          nadir: Number(payload.node_nadir_rssi[i]),
          passPeak: Number(payload.pass_peak_rssi[i]),
          passNadir: Number(payload.pass_nadir_rssi[i])
        }
      : s
  );
}

export function applyCrossingChange(
  seats: Seat[],
  payload: { node_index: number; crossing_flag: boolean }
): Seat[] {
  if (payload.node_index < 0 || payload.node_index >= seats.length) return seats;
  return seats.map((s, i) =>
    i === payload.node_index ? { ...s, crossing: Boolean(payload.crossing_flag) } : s
  );
}

export function applyNodeTuning(payload: {
  profile_ids: number[];
  profile_names: string[];
  current_profile: number;
  profile_name: string;
  profile_description: string | null;
}): Profiles {
  return {
    list: payload.profile_ids.map((id, i) => ({
      id: Number(id),
      name: payload.profile_names[i] ?? ''
    })),
    currentId: payload.current_profile == null ? null : Number(payload.current_profile),
    name: payload.profile_name ?? '',
    description: payload.profile_description ?? ''
  };
}

/** A seat's tuning status for the card's pill. */
/**
 * Why Seats refuses a channel or profile change right now, or null when it may go ahead (#87).
 * RotorHazard itself takes `set_frequency` / `set_profile` / `add_profile` / `delete_profile`
 * at any time and retunes the node on the spot, mid-race; a staged or running race would lose
 * the seat's passes. Threshold edits are not locked: they are live tuning.
 */
export function raceLockReason(status: number): string | null {
  if (status === RACE_STATUS.STAGING)
    return 'Not written: a race is staged. RotorHazard would retune the seat as it starts; stop the race first. Thresholds still write live.';
  if (status === RACE_STATUS.RACING)
    return 'Not written: a race is running. RotorHazard would retune the seat mid-race; stop (then save or discard) first. Thresholds still write live.';
  return null;
}

/** RotorHazard's RSSI scale: node levels run 0–255 (`is_valid_rssi`). */
export const RSSI_MAX = 255;

/**
 * Why a typed enter/exit pair cannot be written, or null when RotorHazard would take it
 * (#77, #88). RotorHazard's own handler takes any int and an empty box as 0, so the check
 * lives here: both present and whole, both within 0–255, exit above 0, enter above exit.
 */
export function levelsProblem(
  enter: string | number | null | undefined,
  exit: string | number | null | undefined
): string | null {
  // A number input bound in Svelte holds a number, or null once emptied.
  const e = enter == null ? '' : String(enter).trim();
  const x = exit == null ? '' : String(exit).trim();
  if (e === '') return 'Enter needs a value.';
  if (x === '') return 'Exit needs a value.';
  const en = Number(e);
  const ex = Number(x);
  if (!Number.isInteger(en)) return 'Enter must be a whole number.';
  if (!Number.isInteger(ex)) return 'Exit must be a whole number.';
  if (en > RSSI_MAX) return `Enter must be ${RSSI_MAX} or less (RSSI levels run 0–${RSSI_MAX}).`;
  if (ex > RSSI_MAX) return `Exit must be ${RSSI_MAX} or less (RSSI levels run 0–${RSSI_MAX}).`;
  if (ex < 1) return 'Exit must be above 0.';
  if (en <= ex) return 'Enter must be above Exit.';
  return null;
}

/**
 * The profile that already carries this name (case-insensitive, trimmed), or null (#89).
 * RotorHazard allows duplicate names and its page then lists two identical entries; ours
 * refuses to make one. `exceptId` leaves the profile being renamed out of the check.
 */
export function profileNameTaken(
  list: Profile[],
  name: string,
  exceptId: number | null = null
): Profile | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  return list.find((p) => p.id !== exceptId && p.name.trim().toLowerCase() === n) ?? null;
}

export type SeatStatus = 'off' | 'untuned' | 'idle' | 'crossing';

export function seatStatus(seat: Seat): SeatStatus {
  if (!seat.frequency) return 'off';
  if (seat.crossing) return 'crossing';
  if (seat.enter == null || seat.exit == null || seat.enter <= seat.exit) return 'untuned';
  return 'idle';
}
