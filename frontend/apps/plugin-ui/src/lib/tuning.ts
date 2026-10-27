/**
 * RotorHazard's Sensor Tuning settings that live in its config (section TIMING), and the
 * start-of-race threshold lowering it computes from them (RHRace.py, race start):
 *
 * - `calibrationMode`           0 Manual, 1 Adaptive: when a heat is loaded and when marshalled
 *                               laps are saved, each seat's enter/exit are set from the pilot's
 *                               best past race on that seat (calibration.py auto_calibrate).
 * - `startThreshLowerAmount`    percent of the enter−exit gap both levels drop by at the start,
 * - `startThreshLowerDuration`  for this many seconds, on seats that have a pilot in the loaded
 *                               heat and whose RSSI is below enter when the race starts (a
 *                               practice race has no pilots on its nodes, so nothing is
 *                               lowered); restored at the seat's first pass, at the end of the
 *                               duration, or when the race stops. The node alone is retuned:
 *                               the profile's levels never change.
 *
 * Reads: `config_update {config: {TIMING: {calibrationMode}}}` (load_data type config),
 * `start_thresh_lower_amount {start_thresh_lower_amount}`, `start_thresh_lower_duration {…}`.
 * Writes: `set_config {section, key, value}`, `set_start_thresh_lower_amount`, `…_duration`.
 */
import { RSSI_MAX, type Seat } from './seats.js';

export type Tuning = {
  /** null until RotorHazard has answered. */
  calibrationMode: 0 | 1 | null;
  lowerAmount: number | null;
  lowerDuration: number | null;
};

export const emptyTuning = (): Tuning => ({
  calibrationMode: null,
  lowerAmount: null,
  lowerDuration: null
});

export const CALIBRATION_MODES: ReadonlyArray<{ value: 0 | 1; label: string; text: string }> = [
  {
    value: 0,
    label: 'Manual',
    text: 'Enter and exit stay as set here (and from the Tune and Marshal pages).'
  },
  {
    value: 1,
    label: 'Adaptive',
    text: "When a heat is loaded, and when marshalled laps are saved, RotorHazard sets each seat's enter and exit from the pilot's best past race on that seat."
  }
];

/** RotorHazard's own input ranges (settings.html). */
export const LOWER_AMOUNT_MAX = 200;
export const LOWER_DURATION_MAX = 999;

type Raw = Record<string, unknown>;

export function applyConfigUpdate(t: Tuning, p: Raw): Tuning {
  const timing = ((p.config as Raw | undefined)?.TIMING as Raw | undefined) ?? {};
  if (!('calibrationMode' in timing)) return t;
  const v = Number(timing.calibrationMode);
  return { ...t, calibrationMode: v === 1 ? 1 : 0 };
}

export function applyLowerAmount(t: Tuning, p: Raw): Tuning {
  return { ...t, lowerAmount: Number(p.start_thresh_lower_amount ?? 0) };
}

export function applyLowerDuration(t: Tuning, p: Raw): Tuning {
  return { ...t, lowerDuration: Number(p.start_thresh_lower_duration ?? 0) };
}

/** Why a typed lowering value cannot be written, or null (RotorHazard's page takes 0–200 / 0–999). */
export function tuningProblem(
  which: 'amount' | 'duration',
  value: string | number | null | undefined
): string | null {
  const name = which === 'amount' ? 'Amount' : 'Duration';
  const max = which === 'amount' ? LOWER_AMOUNT_MAX : LOWER_DURATION_MAX;
  const unit = which === 'amount' ? 'percent' : 'seconds';
  const s = value == null ? '' : String(value).trim();
  if (s === '') return `${name} needs a value (0 turns lowering off).`;
  const n = Number(s);
  if (!Number.isInteger(n)) return `${name} must be a whole number of ${unit}.`;
  if (n < 0 || n > max) return `${name} must be 0–${max} ${unit}.`;
  return null;
}

export type Lowered = { enter: number; exit: number };

/**
 * What RotorHazard lowers one seat to at the start, or null when it leaves the seat alone:
 * `diff = int((enter − exit) × amount / 100)` off both, exit floored at 0, only when the
 * seat is tuned, its RSSI is below enter, diff is above 0 and the new enter is a valid RSSI.
 */
export function loweredLevels(
  seat: Pick<Seat, 'frequency' | 'enter' | 'exit' | 'rssi'>,
  amount: number
): Lowered | null {
  if (!(amount > 0) || !(seat.frequency > 0) || seat.enter == null || seat.exit == null)
    return null;
  if (!(seat.rssi < seat.enter)) return null;
  const diff = Math.trunc(((seat.enter - seat.exit) * amount) / 100);
  if (diff <= 0) return null;
  const enter = seat.enter - diff;
  if (enter < 0 || enter > RSSI_MAX) return null;
  return { enter, exit: Math.max(seat.exit - diff, 0) };
}

export type LoweringPlan = { seats: Record<number, Lowered>; duration: number };

/**
 * The seats RotorHazard lowers as this race starts: those in `active` (the seats with a pilot
 * on them, as RotorHazard's current_laps lists them; empty for a practice race) that
 * `loweredLevels` changes.
 */
export function planLowering(
  seats: Seat[],
  tuning: Tuning,
  active: Set<number>
): LoweringPlan | null {
  const amount = tuning.lowerAmount ?? 0;
  const duration = tuning.lowerDuration ?? 0;
  if (!(amount > 0) || !(duration > 0)) return null;
  const plan: LoweringPlan = { seats: {}, duration };
  for (const seat of seats) {
    if (!active.has(seat.index)) continue;
    const l = loweredLevels(seat, amount);
    if (l) plan.seats[seat.index] = l;
  }
  return Object.keys(plan.seats).length ? plan : null;
}

export function loweredText(l: Lowered, duration: number): string {
  return `Lowered to ${l.enter}/${l.exit} for ${duration} s at start`;
}
