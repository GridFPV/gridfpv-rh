/**
 * RotorHazard's Results page as data (RHUI.emit_result_data → results.html): every class's
 * summary (its ranking when the class has a rank method, else its three leaderboards), each
 * heat's summary leaderboard and its rounds' leaderboards, and the event totals. The
 * leaderboard columns follow rotorhazard.js build_leaderboard: rank, pilot, (team), (starts),
 * laps, total, average, fastest (+ source), consecutives (+ source), (points on a round).
 * lib/results.ts keeps the slimmer view the Stages board uses; this is the full page.
 */
type Raw = Record<string, unknown>;
const num = (v: unknown, d = 0) => (v == null || v === '' ? d : Number(v));
const str = (v: unknown) => (v == null ? '' : String(v));
/** RotorHazard shows an em dash for a time it has not got (build_leaderboard). */
const textOrDash = (v: unknown) => {
  const s = str(v);
  return !s || s === '0:00.000' ? '—' : s;
};

export type BoardRow = {
  pilotId: number;
  callsign: string;
  team: string;
  position: number | null;
  starts: number;
  laps: string;
  total: string;
  average: string;
  fastest: string;
  /** Where the fastest lap was flown ("Heat 1 / Round 2") when the board spans races. */
  fastestSource: string;
  consecutives: string;
  consecutivesBase: number;
  consecutivesSource: string;
  points: string;
};
export type BoardMeta = {
  primary: 'by_race_time' | 'by_fastest_lap' | 'by_consecutives';
  teamRacing: boolean;
  /** RotorHazard StartBehavior: 0 hole shot, 1 first lap counts, 2 staggered start. */
  startBehavior: number;
  consecutivesCount: number;
};
export type Boards = {
  meta: BoardMeta;
  byRaceTime: BoardRow[];
  byFastestLap: BoardRow[];
  byConsecutives: BoardRow[];
};
export type RankingBoard = {
  methodLabel: string;
  /** The method's own columns after rank and pilot (rotorhazard.js build_ranking), #84. */
  fields: Array<{ name: string; label: string }>;
  teamRacing: boolean;
  rows: Array<Raw & { position: number | null; callsign: string; team: string }>;
};
export type RoundBoards = { round: number; startTime: string; boards: Boards };
export type HeatBoards = {
  heatId: number;
  displayName: string;
  classId: number;
  summary: Boards;
  rounds: RoundBoards[];
};
export type ClassBoards = {
  classId: number;
  name: string;
  /** The class's rank method result, when it has one; RotorHazard shows it as the summary. */
  ranking: RankingBoard | null;
  summary: Boards;
  heats: HeatBoards[];
};
export type ResultBoards = {
  classes: ClassBoards[];
  /** Heats with no class, as RotorHazard's "Unclassified" panel. */
  unclassified: HeatBoards[];
  event: Boards | null;
};

/** "Heat 1 / Round 2" for a figure flown in a round, the heat alone otherwise, "None" without one. */
function sourceText(v: unknown): string {
  const s = v as Raw | null | undefined;
  if (!s) return 'None';
  const name = str(s.displayname);
  // RotorHazard appends the round only when it is truthy (#83); a grouped heat's round 0 is not.
  const round = num(s.round) > 0 ? `Round ${num(s.round)}` : '';
  return [name, round].filter(Boolean).join(' / ');
}
function rowOf(r: Raw): BoardRow {
  return {
    pilotId: num(r.pilot_id),
    callsign: str(r.callsign),
    team: str(r.team_name),
    position: r.position == null || r.position === '' ? null : Number(r.position),
    starts: num(r.starts),
    laps: str(r.laps) || '0',
    total: textOrDash(r.total_time),
    average: textOrDash(r.average_lap),
    fastest: textOrDash(r.fastest_lap),
    fastestSource: sourceText(r.fastest_lap_source),
    consecutives: textOrDash(r.consecutives),
    consecutivesBase: num(r.consecutives_base),
    consecutivesSource: sourceText(r.consecutives_source),
    points: r.points == null ? '' : str(r.points)
  };
}
export function boardsOf(lb: Raw | null | undefined): Boards {
  const meta = ((lb?.meta as Raw | undefined) ?? {}) as Raw;
  const primary = str(meta.primary_leaderboard) as BoardMeta['primary'];
  const rows = (k: string) => (((lb?.[k] as Raw[] | undefined) ?? []) as Raw[]).map(rowOf);
  return {
    meta: {
      primary: ['by_race_time', 'by_fastest_lap', 'by_consecutives'].includes(primary)
        ? primary
        : 'by_race_time',
      teamRacing: num(meta.team_racing_mode) === 1,
      startBehavior: num(meta.start_behavior),
      consecutivesCount: num(meta.consecutives_count)
    },
    byRaceTime: rows('by_race_time'),
    byFastestLap: rows('by_fastest_lap'),
    byConsecutives: rows('by_consecutives')
  };
}
/** The board RotorHazard shows first for this leaderboard (its primary). */
export function primaryRows(b: Boards): BoardRow[] {
  return b.meta.primary === 'by_fastest_lap'
    ? b.byFastestLap
    : b.meta.primary === 'by_consecutives'
      ? b.byConsecutives
      : b.byRaceTime;
}
function rankingOf(r: Raw | null | undefined): RankingBoard | null {
  if (!r) return null;
  const meta = (r.meta as Raw | undefined) ?? {};
  const rows = ((r.ranking as Raw[] | undefined) ?? []).map((x) => ({
    ...x,
    position: x.position == null ? null : Number(x.position),
    callsign: str(x.callsign),
    team: str(x.team_name)
  }));
  if (!rows.length) return null;
  const fields = ((meta.rank_fields as Raw[] | undefined) ?? []).map((f) => ({
    name: str(f.name),
    label: str(f.label)
  }));
  return {
    methodLabel: str(meta.method_label),
    fields,
    teamRacing: num(meta.team_racing_mode) === 1,
    rows
  };
}
function heatOf(key: string, h: Raw): HeatBoards {
  const rounds = ((h.rounds as Raw[] | undefined) ?? []).map((r) => ({
    round: num(r.id),
    startTime: str(r.start_time_formatted),
    boards: boardsOf(r.leaderboard as Raw | undefined)
  }));
  rounds.sort((a, b) => a.round - b.round);
  return {
    heatId: num(h.heat_id, Number(key)),
    displayName: str(h.displayname) || `Heat ${num(h.heat_id, Number(key))}`,
    classId: 0, // set from heats_by_class
    summary: boardsOf(h.leaderboard as Raw | undefined),
    rounds
  };
}
/** result_data, whole: classes with their heats and rounds, unclassified heats, event totals. */
export function applyResultBoards(
  payload: { heats?: Raw; heats_by_class?: Raw; classes?: Raw; event_leaderboard?: Raw } | null
): ResultBoards {
  const heats = Object.entries((payload?.heats as Record<string, Raw> | undefined) ?? {}).map(
    ([k, h]) => heatOf(k, h)
  );
  // RotorHazard groups heats by class in heats_by_class (class id → heat ids; 0 = none); a
  // heat entry carries no class_id of its own.
  const byClass = (payload?.heats_by_class as Record<string, unknown[]> | undefined) ?? {};
  for (const [cid, ids] of Object.entries(byClass)) {
    for (const id of ids ?? []) {
      const h = heats.find((x) => x.heatId === Number(id));
      if (h) h.classId = Number(cid);
    }
  }
  const classes = Object.entries((payload?.classes as Record<string, Raw> | undefined) ?? {}).map(
    ([k, c]) => {
      const classId = num(c.id, Number(k));
      return {
        classId,
        name: str(c.name) || `Class ${classId}`,
        ranking: rankingOf(c.ranking as Raw | undefined),
        summary: boardsOf(c.leaderboard as Raw | undefined),
        heats: heats.filter((h) => h.classId === classId)
      };
    }
  );
  classes.sort((a, b) => a.classId - b.classId);
  return {
    classes,
    unclassified: heats.filter((h) => !h.classId),
    event: payload?.event_leaderboard ? boardsOf(payload.event_leaderboard as Raw) : null
  };
}
