/**
 * Saved races, as RotorHazard's `result_data` reports them (RHUI.emit_result_data: the
 * page cache — heats → rounds → leaderboards, plus each class's ranking). Only what the
 * board needs is kept: who flew each saved round and where they finished, and the
 * class standings. RotorHazard broadcasts result_data after every saved race, so the
 * board follows the day without polling.
 */

export type ResultRow = {
  pilotId: number;
  callsign: string;
  /** Finishing position on the round's primary leaderboard, 1 = winner. */
  position: number;
  laps: number;
  totalTime: string;
  fastestLap: string;
  node: number | null;
};

export type RaceResult = {
  heatId: number;
  /** RotorHazard's round number, 1-based. */
  round: number;
  startTime: string;
  rows: ResultRow[];
};

export type RankRow = { pilotId: number; callsign: string; position: number | null };

export type Results = {
  /** Saved races by heat id, sorted by round. */
  races: Record<number, RaceResult[]>;
  /** Class standings by class id, as ranked by the class's rank method. */
  ranking: Record<number, RankRow[]>;
};

export function emptyResults(): Results {
  return { races: {}, ranking: {} };
}

type Raw = Record<string, unknown>;
const num = (v: unknown, d = 0) => (v == null || v === '' ? d : Number(v));
const str = (v: unknown) => (v == null ? '' : String(v));

function rowsOf(leaderboard: Raw | undefined): ResultRow[] {
  if (!leaderboard) return [];
  const meta = (leaderboard.meta as Raw | undefined) ?? {};
  const primary = str(meta.primary_leaderboard) || 'by_race_time';
  const rows = (leaderboard[primary] as Raw[] | undefined) ?? [];
  return rows.map((r, i) => ({
    pilotId: num(r.pilot_id),
    callsign: str(r.callsign),
    position: num(r.position, i + 1),
    laps: num(r.laps),
    totalTime: str(r.total_time),
    fastestLap: str(r.fastest_lap),
    node: r.node == null ? null : Number(r.node)
  }));
}

export function applyResultData(payload: { heats?: Raw; classes?: Raw } | null): Results {
  const out = emptyResults();
  const heats = (payload?.heats as Record<string, Raw> | undefined) ?? {};
  for (const [key, h] of Object.entries(heats)) {
    const heatId = num(h.heat_id, Number(key));
    const rounds = ((h.rounds as Raw[] | undefined) ?? []).map((r) => ({
      heatId,
      round: num(r.id),
      startTime: str(r.start_time_formatted),
      rows: rowsOf(r.leaderboard as Raw | undefined)
    }));
    rounds.sort((a, b) => a.round - b.round);
    out.races[heatId] = rounds;
  }
  const classes = (payload?.classes as Record<string, Raw> | undefined) ?? {};
  for (const [key, c] of Object.entries(classes)) {
    const classId = num(c.id, Number(key));
    const ranking = (c.ranking as Raw | undefined)?.ranking as Raw[] | undefined;
    out.ranking[classId] = (ranking ?? []).map((r, i) => ({
      pilotId: num(r.pilot_id),
      callsign: str(r.callsign),
      position: r.position == null ? i + 1 : Number(r.position)
    }));
  }
  return out;
}

export function racesFor(results: Results, heatId: number): RaceResult[] {
  return results.races[heatId] ?? [];
}

export function raceFor(results: Results, heatId: number, round: number): RaceResult | undefined {
  return racesFor(results, heatId).find((r) => r.round === round);
}

/** The round's winner: position 1 on its primary leaderboard. */
export function winnerOf(race: RaceResult): ResultRow | undefined {
  return race.rows.find((r) => r.position === 1) ?? race.rows[0];
}
