/**
 * The stages board (#15): a RotorHazard class seen as a stage of the day. Rows are its
 * heats, columns are rounds, a cell is one race. These helpers say what state a stage is
 * in and how many columns it needs; the screen draws them. Pure, so tests cover the
 * states without a timer.
 */
import { isAceStage, STAGE_ACE, STAGE_ATTR, stageTally } from './ace.js';
import { racesFor, type RankRow, type Results } from './results.js';
import {
  HEAT_STATUS,
  ROUND_TYPE,
  SLOT_METHOD,
  WIN_CONDITION_LABELS,
  classById,
  heatById,
  ordinal,
  pilotById,
  type Heat,
  type RaceClass,
  type RaceFormat,
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
/** Seeded seats whose pilot is not known yet. */
export function unresolvedSeats(h: Heat): number {
  return h.slots.filter((s) => s.nodeIndex != null && isDynamic(s) && !s.pilotId).length;
}

/** Seeded and not confirmed yet, or confirmed with seats still waiting: Seed now applies. */
export function needsSeeding(h: Heat): boolean {
  if (!isSeededHeat(h) || h.locked) return false;
  return h.status !== HEAT_STATUS.CONFIRMED || unresolvedSeats(h) > 0;
}

/** What a round of a bracket is, read off its heat names: `winners`, `losers`, `the final`, `C-main semifinals`. */
export function roundLabel(heats: Heat[]): string {
  const names = heats.map(heatShortName);
  if (!names.length) return '';
  if (names.length === 1 && names[0] === 'Final') return 'the final';
  if (names.every((n) => /^W\d+$/.test(n))) return 'winners';
  if (names.every((n) => /^L\d+$/.test(n))) return 'losers';
  if (names.every((n) => /^[WL]\d+$/.test(n))) return 'winners and losers';
  if (names.every((n) => /^Semi /.test(n))) return 'semifinals';
  if (names.every((n) => /^Quarter /.test(n))) return 'quarterfinals';
  // Letter mains: `C Semi 1`, `C Final`, `C Heat 2` — all of one main.
  const main = names.map(
    (n) => /^([A-Z]) (?:Final|Semi \d+|Quarter \d+|Heat \d+|W\d+|L\d+)$/.exec(n)?.[1]
  );
  if (main[0] && main.every((m) => m === main[0])) {
    const L = `${main[0]}-main`;
    if (names.length === 1 && names[0].endsWith('Final')) return `${L} final`;
    if (names.every((n) => / W\d+$/.test(n))) return `${L} winners`;
    if (names.every((n) => / L\d+$/.test(n))) return `${L} losers`;
    if (names.every((n) => / [WL]\d+$/.test(n))) return `${L} winners and losers`;
    if (names.every((n) => n.includes(' Semi '))) return `${L} semifinals`;
    if (names.every((n) => n.includes(' Quarter '))) return `${L} quarterfinals`;
    return L;
  }
  return '';
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
  // Chase the Ace ends when the ace is decided, however many rounds that took.
  if (isAceStage(cls) && stageTally(cls, heats, results).ace) return 'done';
  // Grouped rounds: every heat flies once. Races per heat: every heat flies `rounds` times.
  const needed = cls.roundType === ROUND_TYPE.GROUPED ? 1 : cls.rounds;
  if (needed > 0 && raced.every((n) => n >= needed)) return 'done';
  // A seeded heat that is confirmed with every seat known can race; a bracket's first round
  // being ready counts as seeded even while later rounds wait on results.
  const ready = heats.some(
    (h) => isSeededHeat(h) && h.status === HEAT_STATUS.CONFIRMED && unresolvedSeats(h) === 0
  );
  if (heats.some(needsSeeding) && !anyRaced) return ready ? 'seeded' : 'plan';
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

/**
 * Up to this many round columns the board is a grid (rows × rounds). Past it — RaceGOW's
 * one heat and thirty rounds, Chase the Ace — each heat shows its rounds as a wrapping
 * strip under the lineup instead, so nothing scrolls sideways.
 */
export const GRID_MAX_ROUNDS = 6;
export type BoardLayout = 'grid' | 'strip';
/** An unlimited stage is a strip from its first race, so the layout never flips mid-day. */
export function boardLayout(columns: number, unlimited = false): BoardLayout {
  return unlimited || columns > GRID_MAX_ROUNDS ? 'strip' : 'grid';
}

/** The stage standings in one line: `1 Vortex · 2 Pixel · 3 Blitz`, cut at `max`. */
export function standingsLine(ranking: RankRow[] | undefined, max = 8): string {
  if (!ranking?.length) return '';
  const shown = ranking.slice(0, max).map((r) => `${r.position ?? ''} ${r.callsign}`.trim());
  return shown.join(' · ') + (ranking.length > max ? ' · …' : '');
}

/** The next unraced round of a heat, 1-based; null when the stage's rounds are all flown. */
export function nextRound(
  cls: RaceClass,
  heat: Heat,
  results: Results,
  stageHeats: Heat[] = [heat]
): number | null {
  const races = racesFor(results, heat.id);
  // A decided Chase the Ace has no next round for any of its heats (#52).
  if (isAceStage(cls) && stageTally(cls, stageHeats, results).ace) return null;
  const n = races.length + 1;
  if (cls.rounds > 0 && n > cls.rounds) return null;
  return n;
}

/** A heat's name without RotorHazard's "Round N / " prefix, for use inside a round section. */
export function heatShortName(h: Heat): string {
  return h.name || h.autoName || h.displayName.replace(/^Round \d+ \/ /, '');
}

/** A grouped stage's heats by round (group id), in order; rounds with no heats are kept empty. */
export function roundsOf(heats: Heat[]): Heat[][] {
  const out: Heat[][] = [];
  for (const h of heats) {
    const g = h.groupId ?? 0;
    while (out.length <= g) out.push([]);
    out[g].push(h);
  }
  return out;
}

/**
 * A bracket stage: races per heat with one round, where heats seed from each other. The
 * bracket's rounds are not stored — RotorHazard's grouped rounds mean "fly everyone again
 * next round" (it clones a flown heat into the next group), which a bracket is not — so
 * they are read off the seeding graph: a heat seeded only from the ranking is round 1,
 * any other heat is one round after the latest heat it draws from.
 */
export function isBracketStage(cls: RaceClass, heats: Heat[]): boolean {
  if (cls.roundType === ROUND_TYPE.GROUPED || cls.rounds !== 1) return false;
  const ids = new Set(heats.map((h) => h.id));
  return heats.some((h) =>
    h.slots.some(
      (s) => s.method === SLOT_METHOD.HEAT_RESULT && s.seedId != null && ids.has(s.seedId)
    )
  );
}

/** Heats of a bracket stage by derived round, in order. */
export function bracketRounds(heats: Heat[]): Heat[][] {
  const byId = new Map(heats.map((h) => [h.id, h]));
  const depth = new Map<number, number>();
  const visiting = new Set<number>();
  const depthOf = (h: Heat): number => {
    const known = depth.get(h.id);
    if (known != null) return known;
    if (visiting.has(h.id)) return 0; // a cycle; never from our generators
    visiting.add(h.id);
    let d = 0;
    for (const s of h.slots) {
      if (s.method !== SLOT_METHOD.HEAT_RESULT || s.seedId == null) continue;
      const src = byId.get(s.seedId);
      if (src) d = Math.max(d, depthOf(src) + 1);
    }
    visiting.delete(h.id);
    depth.set(h.id, d);
    return d;
  };
  const out: Heat[][] = [];
  for (const h of heats) {
    const d = depthOf(h);
    while (out.length <= d) out.push([]);
    out[d].push(h);
  }
  return out;
}

/** Seats that have a frequency (the ones a generator should fill), as node indexes. */
export function activeSeatIndexes(seats: Array<{ index: number; frequency: number }>): number[] {
  return seats.filter((s) => s.frequency > 0).map((s) => s.index);
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
        const srcHeat =
          s.method === SLOT_METHOD.HEAT_RESULT ? heatById(setup, s.seedId ?? -1) : undefined;
        const from =
          s.method === SLOT_METHOD.HEAT_RESULT
            ? srcHeat
              ? heatShortName(srcHeat)
              : 'a heat'
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
  /** Set once at creation (RotorHazard converts heats on a switch). Grouped = fly everyone again each round. */
  grouped: boolean;
  /** Class attributes to set, e.g. the Grid stage type (#37). */
  attributes?: Record<string, string>;
};

export const STAGE_TEMPLATES: StageTemplate[] = [
  {
    id: 'practice',
    label: 'Practice',
    description: 'Open practice: no time limit, no ranking, one heat to put pilots in.',
    formatMatch: /practice/i,
    rounds: 0,
    rank: '',
    heats: 1,
    grouped: false
  },
  {
    id: 'qualifying',
    label: 'Qualifying',
    description:
      'Every heat flies the same number of rounds; ranked by the format (fastest consecutive laps).',
    formatMatch: /consecutive|qualif/i,
    rounds: 3,
    rank: 'Laps_Time__Best_X_Rounds',
    heats: 'pilots',
    grouped: false
  },
  {
    id: 'bracket',
    label: 'Bracket',
    description:
      'Heats seeded from an earlier stage, each flown once. Build it with Generate bracket… or by hand.',
    formatMatch: /standard/i,
    rounds: 1,
    rank: 'Last_Heat_Position',
    heats: 0,
    grouped: false
  },
  {
    id: 'ace',
    label: 'Chase the Ace',
    description: 'One heat raced again and again until someone has won twice: the ace.',
    formatMatch: /standard/i,
    rounds: 0,
    rank: 'Last_Heat_Position',
    heats: 1,
    grouped: false,
    attributes: { [STAGE_ATTR]: STAGE_ACE }
  },
  {
    id: 'blank',
    label: 'Blank stage',
    description: 'Set everything yourself.',
    formatMatch: /standard/i,
    rounds: 1,
    rank: '',
    heats: 0,
    grouped: false
  }
];

/**
 * What RotorHazard does with no rank method: it ranks the class by its format's win
 * condition. The empty choice is labelled with that, so "fastest consecutive" is findable (#46).
 */
export function defaultRankLabel(format: RaceFormat | undefined): string {
  const win = format ? WIN_CONDITION_LABELS[format.winCondition] : undefined;
  return win
    ? `By the format's win condition (${win.toLowerCase()})`
    : "By the format's win condition (RotorHazard default)";
}

/** How many heats seat every active pilot, `seats` at a time. */
export function heatsForPilots(activePilots: number, seats: number): number {
  if (seats <= 0) return 0;
  return Math.max(1, Math.ceil(activePilots / seats));
}

/**
 * After a save, what RotorHazard loaded next (RHData.get_next_heat_id, by the stage's heat
 * advance and round type), in words for the Run page: the same heat again at its next round,
 * another heat, a grouped stage's next-round heat, or nothing (practice) when the stage is
 * done and no later stage has a heat.
 */
export function nextUpText(
  setup: Setup,
  lastHeatId: number,
  current: { heatId: number; nextRound: number }
): string {
  if (!current.heatId)
    return 'Next: nothing loaded. RotorHazard found no heat to advance to; pick one, or race in practice.';
  const heat = setup.heats.find((h) => h.id === current.heatId);
  if (!heat) return `Next: heat ${current.heatId}.`;
  const cls = setup.classes.find((c) => c.id === heat.classId);
  if (cls && cls.roundType === ROUND_TYPE.GROUPED)
    return `Next: ${heatShortName(heat)} in Round ${(heat.groupId ?? 0) + 1} of ${cls.displayName}.`;
  const round = current.nextRound || 1;
  const of = cls && cls.rounds > 0 ? ` of ${cls.rounds}` : '';
  if (heat.id === lastHeatId) return `Next: ${heat.displayName} again, round ${round}${of}.`;
  return `Next: ${heat.displayName}, round ${round}${of}.`;
}
