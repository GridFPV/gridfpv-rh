/**
 * Lap detection and scoring options (#35): RotorHazard's Minimum Lap Time, Minimum Lap
 * Behavior, Ignore Crossings Before, and the Consecutive Laps Base its results use. Pure
 * helpers: parsing what the director typed, and saying the rules in one line.
 */

/** RotorHazard's MinLapBehavior: 0 highlights short laps, 1 discards new ones as they land. */
export const MIN_LAP_BEHAVIOR = { HIGHLIGHT: 0, DISCARD: 1 } as const;
export type MinLapBehavior = (typeof MIN_LAP_BEHAVIOR)[keyof typeof MIN_LAP_BEHAVIOR];

export const MIN_LAP_BEHAVIOR_LABELS: Record<MinLapBehavior, string> = {
  [MIN_LAP_BEHAVIOR.HIGHLIGHT]: 'Highlight short laps',
  [MIN_LAP_BEHAVIOR.DISCARD]: 'Discard new short laps'
};

export type Timing = {
  minLapMs: number;
  minFirstCrossingMs: number;
  minLapBehavior: number;
  /** Laps in a row that "fastest consecutive" results score over. */
  consecutivesBase: number;
};

/** RotorHazard's own limits on these inputs (format.html). */
export const SECONDS_MAX = 999;
export const CONSECUTIVES_MIN = 2;
export const CONSECUTIVES_MAX = 999;
export const CONSECUTIVES_DEFAULT = 3;

/** Whole seconds in RotorHazard's range, or null when the text is not a usable number. */
export function parseSeconds(text: string | number): number | null {
  const n = Math.floor(Number(String(text).trim()));
  if (!Number.isFinite(n) || String(text).trim() === '') return null;
  if (n < 0 || n > SECONDS_MAX) return null;
  return n;
}

/** A consecutive laps base in RotorHazard's range, or null. */
export function parseConsecutivesBase(text: string | number): number | null {
  const n = Math.floor(Number(String(text).trim()));
  if (!Number.isFinite(n) || String(text).trim() === '') return null;
  if (n < CONSECUTIVES_MIN || n > CONSECUTIVES_MAX) return null;
  return n;
}

export function behaviorLabel(behavior: number): string {
  return MIN_LAP_BEHAVIOR_LABELS[behavior as MinLapBehavior] ?? 'Highlight short laps';
}

/** `Laps under 5 s are highlighted · crossings in the first 2 s ignored`; empty when nothing applies. */
export function lapRulesSummary(
  t: Pick<Timing, 'minLapMs' | 'minFirstCrossingMs' | 'minLapBehavior'>
): string {
  const parts: string[] = [];
  const minLap = Math.round(t.minLapMs / 1000);
  if (minLap > 0) {
    const verb = t.minLapBehavior === MIN_LAP_BEHAVIOR.DISCARD ? 'discarded' : 'highlighted';
    parts.push(`Laps under ${minLap} s are ${verb}`);
  }
  const first = Math.round(t.minFirstCrossingMs / 1000);
  if (first > 0) parts.push(`crossings in the first ${first} s ignored`);
  return parts.join(' · ');
}

/** `best 3 consecutive` — the phrase that qualifies a "fastest consecutive laps" format. */
export function consecutivesPhrase(base: number): string {
  return `best ${base} consecutive`;
}
