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

export type BracketKind = 'single' | 'double' | 'mains';

export type BracketPlan = {
  kind: BracketKind;
  pilots: number;
  seats: number;
  /** Single/double: how many go on from each heat. Mains: bump-ups from the main below. */
  advance: number;
  rounds: PlanRound[];
};

export const BRACKET_KINDS: Array<{ id: BracketKind; label: string; blurb: string }> = [
  {
    id: 'single',
    label: 'Single elimination',
    blurb: 'The top few of each heat go on; everyone else is out. Quarters, semis, final.'
  },
  {
    id: 'double',
    label: 'Double elimination',
    blurb:
      'Lose once and you drop to the losers bracket; lose twice and you are out. Both brackets meet in the final.'
  },
  {
    id: 'mains',
    label: 'Letter mains',
    blurb:
      'A-main, B-main, C-main… from the ranking, run lowest main first; the top of each main bumps up into the next.'
  }
];

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

/** Chunk an ordered list of seeds into heats of `seats`, padding the last with empties. */
function chunkHeats(seeds: SeedRef[], seats: number): PlanHeat[] {
  const out: PlanHeat[] = [];
  for (let i = 0; i < seeds.length; i += seats) {
    const chunk = seeds.slice(i, i + seats);
    out.push({ name: null, seeds: Array.from({ length: seats }, (_, p) => chunk[p] ?? null) });
  }
  return out;
}

const flown = (h: PlanHeat) => h.seeds.filter((s) => s != null).length;

/** Places `from`..`to` of every heat of round `r` (indexes into the plan), in bracket order. */
function places(
  round: PlanHeat[],
  r: number,
  from: number,
  to: (h: PlanHeat) => number
): SeedRef[] {
  const out: SeedRef[] = [];
  for (const h of foldOrder(round.length)) {
    const last = to(round[h]);
    for (let rank = from; rank <= last; rank++) out.push({ kind: 'heat', round: r, heat: h, rank });
  }
  return out;
}

/**
 * Double elimination for multi-pilot heats, the MultiGP shape: the top `advance` of a
 * winners heat go on, the rest drop to the losers bracket; the top `advance` of a losers
 * heat go on, the rest are out. After each winners round the losers bracket absorbs that
 * round's losers — reducing itself first when they would not fit in as many heats as the
 * winners round had — until both brackets are one heat, then the final takes the top
 * `advance` of each. 16 pilots, 4 up, top 2: 14 heats.
 */
export function doubleElimination(opts: {
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
  if (advance * 2 > seats)
    throw new BracketError(
      'Twice the advancing count must fit one heat, so both brackets can meet in the final.'
    );
  if (pilots <= seats)
    throw new BracketError(
      'A double elimination needs more pilots than one heat holds; use a single final instead.'
    );

  const rounds: PlanRound[] = [];
  const push = (name: string, heats: PlanHeat[], tag: string) => {
    rounds.push({ name, heats: heats.map((h, i) => ({ ...h, name: `${tag}${i + 1}` })) });
    return rounds.length - 1;
  };
  let heatNo = 0;
  const number = (heats: PlanHeat[], side: 'W' | 'L') =>
    heats.map((h) => ({ ...h, name: `${side}${++heatNo}` }));

  // Winners round 1.
  let wbIndex = rounds.length;
  let wb: PlanHeat[] = snakeSeed(pilots, Math.ceil(pilots / seats), seats).map((ranks) => ({
    name: null,
    seeds: Array.from({ length: seats }, (_, p) =>
      p < ranks.length ? { kind: 'class' as const, rank: ranks[p] } : null
    )
  }));
  rounds.push({ name: 'Winners round 1', heats: number(wb, 'W') });
  let wbRound = 1;
  let lbRound = 0;
  let pool: SeedRef[] = []; // losers-bracket pilots waiting for their next heat
  let lbIndex = -1;

  const lbPlay = (seeds: SeedRef[], name: string): SeedRef[] => {
    const heats = number(chunkHeats(seeds, seats), 'L');
    rounds.push({ name, heats });
    lbIndex = rounds.length - 1;
    return places(heats, lbIndex, 1, (h) => Math.min(advance, flown(h)));
  };

  for (;;) {
    // This winners round's losers.
    const losers = places(rounds[wbIndex].heats, wbIndex, advance + 1, flown);
    const wbHeats = rounds[wbIndex].heats.length;
    const winnersDone = wbHeats === 1;
    // Reduce the pool until it and the losers fit in as many heats as the winners round had.
    while (pool.length && pool.length + losers.length > seats * wbHeats) {
      const before = pool.length;
      pool = lbPlay(pool, `Losers round ${++lbRound}`);
      if (pool.length >= before) throw new BracketError('The losers bracket does not shrink.');
    }
    pool = lbPlay([...pool, ...losers], winnersDone ? 'Losers final' : `Losers round ${++lbRound}`);
    if (winnersDone) break;
    // Next winners round.
    const winners = places(rounds[wbIndex].heats, wbIndex, 1, (h) => Math.min(advance, flown(h)));
    wb = chunkHeats(winners, seats);
    wbRound++;
    rounds.push({
      name: wb.length === 1 ? 'Winners final' : `Winners round ${wbRound}`,
      heats: number(wb, 'W')
    });
    wbIndex = rounds.length - 1;
  }
  // The losers final must be one heat; reduce until it is.
  while (rounds[lbIndex].heats.length > 1) {
    rounds[lbIndex].name = `Losers round ${++lbRound}`;
    pool = lbPlay(pool, 'Losers final');
  }
  const final: SeedRef[] = [
    ...places(rounds[wbIndex].heats, wbIndex, 1, (h) => Math.min(advance, flown(h))),
    ...places(rounds[lbIndex].heats, lbIndex, 1, (h) => Math.min(advance, flown(h)))
  ];
  push('Final', chunkHeats(final, seats), 'Final');
  rounds[rounds.length - 1].heats[0].name = 'Final';
  return { kind: 'double', pilots, seats, advance, rounds };
}

/**
 * Letter mains (A-main, B-main, …): the ranking fills the mains from the top, `seats - bumps`
 * direct qualifiers each, the last main taking whoever is left. Mains run lowest first; the
 * top `bumps` of each main bump up into the main above. One heat per round.
 */
export function letterMains(opts: { pilots: number; seats: number; bumps: number }): BracketPlan {
  const { pilots, seats, bumps } = opts;
  if (!Number.isInteger(pilots) || pilots < 2) throw new BracketError('Need at least 2 pilots.');
  if (!Number.isInteger(seats) || seats < 2)
    throw new BracketError('Need at least 2 seats per heat.');
  if (!Number.isInteger(bumps) || bumps < 1)
    throw new BracketError('At least 1 pilot must bump up.');
  if (bumps >= seats) throw new BracketError('Fewer pilots must bump up than there are seats.');
  const direct = seats - bumps;
  const mains = pilots <= seats ? 1 : 1 + Math.ceil((pilots - seats) / direct);
  if (mains > 26)
    throw new BracketError('That is more than 26 mains; use fewer pilots or bigger heats.');
  const letter = (i: number) => String.fromCharCode(65 + i); // 0 = A
  // Direct ranks per main, A first.
  const directRanks: number[][] = [];
  let rank = 1;
  for (let m = 0; m < mains; m++) {
    const n = m === mains - 1 ? pilots - rank + 1 : direct;
    directRanks.push(Array.from({ length: n }, (_, i) => rank + i));
    rank += n;
  }
  // Rounds run lowest main first.
  const rounds: PlanRound[] = [];
  for (let m = mains - 1; m >= 0; m--) {
    const seeds: SeedRef[] = directRanks[m].map((r) => ({ kind: 'class' as const, rank: r }));
    if (m < mains - 1) {
      const below = rounds.length - 1;
      const flownBelow = flown(rounds[below].heats[0]);
      for (let r = 1; r <= Math.min(bumps, flownBelow); r++)
        seeds.push({ kind: 'heat', round: below, heat: 0, rank: r });
    }
    rounds.push({
      name: `${letter(m)}-main`,
      heats: [
        {
          name: `${letter(m)}-main`,
          seeds: Array.from({ length: seats }, (_, p) => seeds[p] ?? null)
        }
      ]
    });
  }
  return { kind: 'mains', pilots, seats, advance: bumps, rounds };
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

/** `3 rounds: 4 heats → 2 heats → final`. */
export function describePlan(plan: BracketPlan): string {
  const n = plan.rounds.length;
  const heats = planSize(plan).heats;
  if (plan.kind === 'mains')
    return `${n} main${n === 1 ? '' : 's'}: ${plan.rounds.map((r) => r.name.replace('-main', '')).join(', ')}`;
  if (plan.kind === 'double') {
    const side = (re: RegExp) =>
      plan.rounds
        .filter((r) => re.test(r.name))
        .map((r) => r.heats.length)
        .join(' → ');
    return `${n} rounds, ${heats} heats: winners ${side(/^Winners/)}, losers ${side(/^Losers/)}, then the final`;
  }
  const shape = plan.rounds
    .map((r) => (r.heats.length === 1 ? 'final' : `${r.heats.length} heats`))
    .join(' → ');
  return `${n} round${n === 1 ? '' : 's'}: ${shape}`;
}
