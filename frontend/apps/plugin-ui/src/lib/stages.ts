/**
 * The stages board (#15): a RotorHazard class seen as a stage of the day. Rows are its
 * heats, columns are rounds, a cell is one race. These helpers say what state a stage is
 * in and how many columns it needs; the screen draws them. Pure, so tests cover the
 * states without a timer.
 */
import { racesFor, type Results } from './results.js';
import {
  ordinal,
  pilotById,
  SLOT_METHOD,
  HEAT_STATUS,
  heatById,
  classById,
  type Heat,
  type RaceClass,
  type Setup,
  type Slot
} from './setup.js';

export type StageState = 'empty' | 'plan' | 'seeded' | 'ready' | 'running' | 'done';

export const STAGE_STATE_LABELS: Record<StageState, string> = {
  empty: 'No heats',
  plan: 'Plan',
  seeded: 'Seeded',
  ready: 'Ready',
  running: 'In progress',
  done: 'Done'
};

const isDynamic = (s: Slot) =>
  s.method === SLOT_METHOD.HEAT_RESULT || s.method === SLOT_METHOD.CLASS_RESULT;

/** A heat whose seats fill from results. */
export function isSeededHeat(h: Heat): boolean {
  return h.slots.some((s) => s.nodeIndex != null && isDynamic(s));
}
/** Seeded and not yet confirmed (RotorHazard won't race it until it is). */
export function needsSeeding(h: Heat): boolean {
  return isSeededHeat(h) && h.status !== HEAT_STATUS.CONFIRMED && !h.locked;
}

/**
 * - empty: no heats yet
 * - plan: some heat fills from results and is not confirmed yet (a bracket before quali is done)
 * - seeded: every seeded heat is confirmed — RotorHazard will race it
 * - ready: every seat is a named pilot or empty, nothing raced
 * - running: at least one race saved, more to go
 * - done: every heat has raced the stage's round count
 */
export function stageState(cls: RaceClass, heats: Heat[], results: Results): StageState {
  if (heats.length === 0) return 'empty';
  const raced = heats.map((h) => racesFor(results, h.id).length);
  const anyRaced = raced.some((n) => n > 0);
  if (cls.rounds > 0 && raced.every((n) => n >= cls.rounds)) return 'done';
  if (heats.some(needsSeeding) && !anyRaced) return 'plan';
  if (anyRaced) return 'running';
  if (heats.some(isSeededHeat)) return 'seeded';
  return 'ready';
}

/** Columns to draw: the stage's round count, or one past what has raced when unlimited. */
export function roundColumns(cls: RaceClass, heats: Heat[], results: Results): number {
  const raced = Math.max(0, ...heats.map((h) => racesFor(results, h.id).length));
  if (cls.rounds > 0) return Math.max(cls.rounds, raced);
  return raced + 1;
}

/** The next unraced round of a heat, 1-based; null when the stage's rounds are all flown. */
export function nextRound(cls: RaceClass, heat: Heat, results: Results): number | null {
  const n = racesFor(results, heat.id).length + 1;
  if (cls.rounds > 0 && n > cls.rounds) return null;
  return n;
}

export type SeatChip = {
  seat: number;
  text: string;
  /** seed = confirmed from a result; projected = RotorHazard's current guess, not confirmed. */
  kind: 'pilot' | 'seed' | 'projected' | 'pending' | 'empty';
  title: string;
};

/** One chip per seat for the board's lineup column. */
export function seatChips(setup: Setup, heat: Heat): SeatChip[] {
  return heat.slots
    .filter((s) => s.nodeIndex != null)
    .sort((a, b) => (a.nodeIndex ?? 0) - (b.nodeIndex ?? 0))
    .map((s) => {
      const seat = (s.nodeIndex ?? 0) + 1;
      const pilot = s.pilotId ? pilotById(setup, s.pilotId) : undefined;
      if (s.method === SLOT_METHOD.ASSIGN && pilot)
        return { seat, text: pilot.callsign || pilot.name, kind: 'pilot', title: `Seat ${seat}` };
      if (isDynamic(s)) {
        const from =
          s.method === SLOT_METHOD.HEAT_RESULT
            ? (heatById(setup, s.seedId ?? -1)?.displayName ?? 'a heat')
            : (classById(setup, s.seedId ?? -1)?.displayName ?? 'the class');
        const rule = `${ordinal(s.seedRank ?? 1)} ${s.method === SLOT_METHOD.HEAT_RESULT ? 'of' : 'in'} ${from}`;
        if (pilot)
          return {
            seat,
            text: pilot.callsign || pilot.name,
            kind: heat.status === HEAT_STATUS.CONFIRMED ? 'seed' : 'projected',
            title: `Seat ${seat}: ${rule}${heat.status === HEAT_STATUS.CONFIRMED ? '' : ' (not confirmed yet)'}`
          };
        return { seat, text: rule, kind: 'pending', title: `Seat ${seat}: waiting on ${from}` };
      }
      return { seat, text: '—', kind: 'empty', title: `Seat ${seat}: empty` };
    });
}

/** Stage templates for "Add stage": what a race director usually wants, in one step. */
export type StageTemplate = {
  id: string;
  label: string;
  description: string;
  /** Picks the default format by name, from RotorHazard's list. */
  formatMatch: RegExp;
  rounds: number;
  /** A rank method name, or '' for none. */
  rank: string;
  /** Heats to create: a number, or 'pilots' for enough heats to seat every active pilot. */
  heats: number | 'pilots';
};

export const STAGE_TEMPLATES: StageTemplate[] = [
  {
    id: 'practice',
    label: 'Practice',
    description: 'Open practice: no time limit, no ranking, one heat to put pilots in.',
    formatMatch: /practice/i,
    rounds: 0,
    rank: '',
    heats: 1
  },
  {
    id: 'qualifying',
    label: 'Qualifying',
    description: 'Every heat flies the same number of rounds; ranked by best rounds.',
    formatMatch: /standard/i,
    rounds: 3,
    rank: 'Laps_Time__Best_X_Rounds',
    heats: 'pilots'
  },
  {
    id: 'bracket',
    label: 'Bracket',
    description: 'Heats seeded from an earlier stage. Add heats by hand or with a generator.',
    formatMatch: /standard/i,
    rounds: 1,
    rank: 'Last_Heat_Position',
    heats: 0
  },
  {
    id: 'ace',
    label: 'Chase the Ace',
    description: 'One heat raced again and again until someone wins twice in a row.',
    formatMatch: /standard/i,
    rounds: 0,
    rank: 'Last_Heat_Position',
    heats: 1
  },
  {
    id: 'blank',
    label: 'Blank stage',
    description: 'Set everything yourself.',
    formatMatch: /standard/i,
    rounds: 1,
    rank: '',
    heats: 0
  }
];

/** How many heats seat every active pilot, `seats` at a time. */
export function heatsForPilots(activePilots: number, seats: number): number {
  if (seats <= 0) return 0;
  return Math.max(1, Math.ceil(activePilots / seats));
}
