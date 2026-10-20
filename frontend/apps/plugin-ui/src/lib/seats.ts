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
export type SeatStatus = 'off' | 'untuned' | 'idle' | 'crossing';

export function seatStatus(seat: Seat): SeatStatus {
  if (!seat.frequency) return 'off';
  if (seat.crossing) return 'crossing';
  if (seat.enter == null || seat.exit == null || seat.enter <= seat.exit) return 'untuned';
  return 'idle';
}
