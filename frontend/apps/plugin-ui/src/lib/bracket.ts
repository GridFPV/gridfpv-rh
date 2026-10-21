/**
 * Our own bracket generators (#15). A bracket is a plan: rounds of heats, each seat
 * saying where its pilot comes from — a rank in the source stage for the first round,
 * a finishing place in an earlier heat after that. The plan is pure data; the store
 * writes it into a grouped-rounds stage as RotorHazard heats with seeded slots, and
 * RotorHazard fills the names in as races save (Seed now).
 *
 * Single elimination with multi-pilot heats: the top `advance` of each heat go on, the
 * rest are out, until one heat is left — the final.
 */

export type SeedRef =
  { kind: 'class'; rank: number } | { kind: 'heat'; round: number; heat: number; rank: number };

export type PlanHeat = {
  /** A name to give the heat, or null for RotorHazard's automatic one. */
  name: string | null;
  /** One entry per seat position (0..seats-1); null = empty seat. */
  seeds: Array<SeedRef | null>;
};

export type PlanRound = { name: string; heats: PlanHeat[] };

export type BracketPlan = {
  kind: 'single';
  pilots: number;
  seats: number;
  advance: number;
  rounds: PlanRound[];
};

export class BracketError extends Error {}

/** Heats in bracket order: first against last, second against second-last, … */
export function foldOrder(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(i % 2 === 0 ? i / 2 : count - 1 - (i - 1) / 2);
  return out;
}

/**
 * Snake-seed `pilots` ranks into `heats` heats of `seats`: rank 1 in heat 1, rank 2 in
 * heat 2, … then back down, so every heat gets a fair spread of seeds.
 */
export function snakeSeed(pilots: number, heats: number, seats: number): number[][] {
  const out: number[][] = Array.from({ length: heats }, () => []);
  for (let i = 0; i < pilots; i++) {
    const row = Math.floor(i / heats);
    const col = i % heats;
    const heat = row % 2 === 0 ? col : heats - 1 - col;
    if (out[heat].length < seats) out[heat].push(i + 1);
  }
  return out;
}

function roundName(index: number, total: number): string {
  const fromEnd = total - 1 - index;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  return `Round ${index + 1}`;
}

function heatName(
  roundIndex: number,
  total: number,
  heatIndex: number,
  heats: number
): string | null {
  const fromEnd = total - 1 - roundIndex;
  if (fromEnd === 0) return heats === 1 ? 'Final' : null;
  if (fromEnd === 1) return `Semi ${heatIndex + 1}`;
  if (fromEnd === 2) return `Quarter ${heatIndex + 1}`;
  return null;
}

export function singleElimination(opts: {
  pilots: number;
  seats: number;
  advance: number;
}): BracketPlan {
  const { pilots, seats, advance } = opts;
  if (!Number.isInteger(pilots) || pilots < 2) throw new BracketError('Need at least 2 pilots.');
  if (!Number.isInteger(seats) || seats < 2)
    throw new BracketError('Need at least 2 seats per heat.');
  if (!Number.isInteger(advance) || advance < 1)
    throw new BracketError('At least 1 pilot must advance from each heat.');
  if (advance >= seats)
    throw new BracketError(
      'Fewer pilots must advance than there are seats, or the bracket never shrinks.'
    );

  // Round 1: snake-seeded from the source stage's ranking.
  const rounds: PlanHeat[][] = [];
  const firstHeats = Math.ceil(pilots / seats);
  rounds.push(
    snakeSeed(pilots, firstHeats, seats).map((ranks) => ({
      name: null,
      seeds: Array.from({ length: seats }, (_, p) =>
        p < ranks.length ? { kind: 'class' as const, rank: ranks[p] } : null
      )
    }))
  );

  // Later rounds: the advancing places of the previous round, in bracket order, chunked
  // into heats, until one heat remains.
  while (rounds[rounds.length - 1].length > 1) {
    const prev = rounds[rounds.length - 1];
    const r = rounds.length - 1;
    const advancing: SeedRef[] = [];
    for (const h of foldOrder(prev.length)) {
      const flown = prev[h].seeds.filter((s) => s != null).length;
      for (let rank = 1; rank <= Math.min(advance, flown); rank++)
        advancing.push({ kind: 'heat', round: r, heat: h, rank });
    }
    const next: PlanHeat[] = [];
    for (let i = 0; i < advancing.length; i += seats) {
      const chunk = advancing.slice(i, i + seats);
      next.push({
        name: null,
        seeds: Array.from({ length: seats }, (_, p) => chunk[p] ?? null)
      });
    }
    if (next.length >= prev.length) throw new BracketError('The bracket does not shrink.');
    rounds.push(next);
  }

  const total = rounds.length;
  return {
    kind: 'single',
    pilots,
    seats,
    advance,
    rounds: rounds.map((heats, i) => ({
      name: roundName(i, total),
      heats: heats.map((h, k) => ({ ...h, name: heatName(i, total, k, heats.length) }))
    }))
  };
}

/** `3 rounds: 4 heats → 2 heats → final`. */
export function describePlan(plan: BracketPlan): string {
  const shape = plan.rounds
    .map((r) => (r.heats.length === 1 ? 'final' : `${r.heats.length} heats`))
    .join(' → ');
  return `${plan.rounds.length} round${plan.rounds.length === 1 ? '' : 's'}: ${shape}`;
}

/** Total heats and seeded seats in a plan, for a progress count. */
export function planSize(plan: BracketPlan): { heats: number; seeds: number } {
  let heats = 0;
  let seeds = 0;
  for (const r of plan.rounds)
    for (const h of r.heats) {
      heats++;
      seeds += h.seeds.filter((s) => s != null).length;
    }
  return { heats, seeds };
}

/** A seed in words, for the preview: `1st in Qualifying`, `2nd of Quarter 3`. */
export function seedLabel(
  seed: SeedRef,
  sourceName: string,
  heatLabel: (round: number, heat: number) => string
): string {
  const ord = ordinal(seed.rank);
  if (seed.kind === 'class') return `${ord} in ${sourceName}`;
  return `${ord} of ${heatLabel(seed.round, seed.heat)}`;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
