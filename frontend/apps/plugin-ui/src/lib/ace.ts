/**
 * Chase the Ace (#37): one heat raced again and again until a pilot has won twice (or twice
 * in a row), who is the ace. RotorHazard has no such thing: it sees a normal class ranked by
 * last heat position, so its own Results page agrees once the deciding race is the last one.
 * The stage type lives on the class as the plugin's `gridfpv_stage` attribute.
 */
import type { RaceResult, Results } from './results.js';
import { racesFor, winnerOf } from './results.js';
import type { Heat, RaceClass } from './setup.js';

/** The class attribute the plugin registers; its value is the stage type. */
export const STAGE_ATTR = 'gridfpv_stage';
export const STAGE_ACE = 'ace';
export const STAGE_ACE_ROW = 'ace-row';

export type AceRule = 'twice' | 'in-a-row';

export function stageType(cls: Pick<RaceClass, 'attributes'>): string {
  const v = cls.attributes?.[STAGE_ATTR];
  return v == null ? '' : String(v);
}

export function isAceStage(cls: Pick<RaceClass, 'attributes'>): boolean {
  const t = stageType(cls);
  return t === STAGE_ACE || t === STAGE_ACE_ROW;
}

export function aceRule(cls: Pick<RaceClass, 'attributes'>): AceRule {
  return stageType(cls) === STAGE_ACE_ROW ? 'in-a-row' : 'twice';
}

export type AceWins = { pilotId: number; callsign: string; wins: number; rounds: number[] };
export type AceTally = {
  /** Every pilot who has won a round, most wins first. */
  wins: AceWins[];
  /** The ace, once a pilot has met the rule; null while the chase is on. */
  ace: { pilotId: number; callsign: string; round: number } | null;
  /** Rounds flown. */
  rounds: number;
};

/** Count wins over the saved rounds, in round order, and find the ace. */
export function aceTally(races: RaceResult[], rule: AceRule = 'twice'): AceTally {
  // Flight order: by start time when every race has one, else by round number.
  const timed = races.every((r) => r.startTime);
  const ordered = [...races].sort((a, b) =>
    timed && a.startTime !== b.startTime ? (a.startTime < b.startTime ? -1 : 1) : a.round - b.round
  );
  const byPilot = new Map<number, AceWins>();
  let ace: AceTally['ace'] = null;
  let lastWinner: number | null = null;
  for (const race of ordered) {
    const w = winnerOf(race);
    if (!w) {
      lastWinner = null;
      continue;
    }
    const row = byPilot.get(w.pilotId) ?? {
      pilotId: w.pilotId,
      callsign: w.callsign,
      wins: 0,
      rounds: []
    };
    row.wins++;
    row.rounds.push(race.round);
    byPilot.set(w.pilotId, row);
    if (!ace) {
      const met = rule === 'in-a-row' ? lastWinner === w.pilotId : row.wins >= 2;
      if (met) ace = { pilotId: w.pilotId, callsign: w.callsign, round: race.round };
    }
    lastWinner = w.pilotId;
  }
  const wins = [...byPilot.values()].sort((a, b) => b.wins - a.wins || a.rounds[0] - b.rounds[0]);
  return { wins, ace, rounds: ordered.length };
}

/**
 * Every saved round of a stage's heats in the order they were flown (#63): by start time
 * (RotorHazard's `start_time_formatted`, "YYYY-MM-DD HH:MM:SS.mmm", which sorts as text),
 * then by round within a heat when two share one.
 */
export function stageRaces(heats: Heat[], results: Results): RaceResult[] {
  return heats
    .flatMap((h) => racesFor(results, h.id))
    .sort((a, b) =>
      a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : a.round - b.round
    );
}

/** The stage's tally, over all its heats. */
export function stageTally(cls: RaceClass, heats: Heat[], results: Results): AceTally {
  return aceTally(stageRaces(heats, results), aceRule(cls));
}

/** Rounds flown after the deciding one: they change RotorHazard's last-heat ranking (#52). */
export function roundsAfterAce(t: AceTally): number {
  return t.ace ? Math.max(0, t.rounds - t.ace.round) : 0;
}

/** One line for the board: who has won what, or who the ace is. */
export function aceLine(t: AceTally, rule: AceRule = 'twice'): string {
  if (t.ace) {
    const after = roundsAfterAce(t);
    const base = `${t.ace.callsign} is the ace — decided in round ${t.ace.round}`;
    return after
      ? `${base} · ${after} round${after === 1 ? '' : 's'} flown since: RotorHazard ranks by the last heat, not the ace`
      : base;
  }
  if (t.wins.length === 0)
    return rule === 'in-a-row' ? 'First to win two rounds in a row' : 'First to win two rounds';
  const parts = t.wins.map((w) => `${w.callsign} ${w.wins}`);
  return `Wins: ${parts.join(' · ')}`;
}
