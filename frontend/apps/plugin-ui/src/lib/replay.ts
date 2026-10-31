/**
 * The replay-mode overlay (#96, phase 1): the race overlay drawn from a *saved* race at a
 * chosen moment, instead of from the live timer. Pure data and functions; `ReplayOverlay`
 * feeds them and `OverlayPanel` draws the result, the same panel the live page uses.
 *
 * Why: racegow video is recorded clean and the overlay is composited onto the file
 * afterwards, from the race as it stands *after* marshalling. A headless browser opens
 * `/grid/live/race?heat=H&round=R`, calls `window.gridfpvReplay.seek(ms)` once per frame
 * and screenshots: frame N is race time N/fps, nothing drifts, and nothing waits on a wall
 * clock. The same URL with `t=` is a still, for a human to check a frame.
 *
 * Time here is **race time**: milliseconds from the start signal, negative while staging,
 * the same axis as RotorHazard's lap stamps (`lap_time_stamp`). The recording's own offset
 * to that axis lives in the sidecar the OBS script writes (phase 2); this module never
 * sees a video.
 */
import {
  RACE_STATUS,
  type MarshalLap,
  type RaceListHeat,
  type RaceListRound,
  type RaceStatus
} from './race.js';
import { START_BEHAVIOR, WIN_CONDITION, type RaceFormat } from './setup.js';
import type { OverlayRow } from './overlay.js';

export type ReplayLayout = 'solo' | 'field';

/** What the URL asked for: which saved race, and how to draw it. */
export type ReplayQuery = {
  /** The saved race by id, or … */
  raceId: number | null;
  /** … by heat and round, as Marshal links name a race. */
  heatId: number | null;
  round: number | null;
  /** Race time to show first (ms); `seek` moves it. */
  t: number;
  /** Race time the race was stopped (ms): the clock freezes there and the phase reads FINISHED. */
  end: number | null;
  /** Race time staging began (ms, negative); before it the timer was idle, so the panel reads READY. */
  staging: number | null;
  /** Force the one-pilot or the table layout; null picks by how many pilots have a record. */
  layout: ReplayLayout | null;
  /** The pilot the solo layout follows when several raced; null = the first row. */
  pilotId: number | null;
};

const int = (v: string | null): number | null => {
  if (v == null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/**
 * `?race=` or `?heat=&round=` on the overlay URL turn the live page into a replay; any
 * other query (or none) is the live overlay, so null.
 */
export function parseReplayQuery(search: string): ReplayQuery | null {
  const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const raceId = int(p.get('race'));
  const heatId = int(p.get('heat'));
  const round = int(p.get('round'));
  if (raceId == null && (heatId == null || round == null)) return null;
  const layout = p.get('layout');
  return {
    raceId,
    heatId,
    round,
    t: int(p.get('t')) ?? 0,
    end: int(p.get('end')),
    staging: int(p.get('staging')),
    layout: layout === 'solo' || layout === 'field' ? layout : null,
    pilotId: int(p.get('pilot'))
  };
}

/** Rebuild the replay URL's query, the inverse of `parseReplayQuery`; `t` is left out at 0. */
export function replayQuery(q: Partial<ReplayQuery> & { heatId: number; round: number }): string {
  const p = new URLSearchParams();
  p.set('heat', String(q.heatId));
  p.set('round', String(q.round));
  if (q.t) p.set('t', String(Math.trunc(q.t)));
  if (q.end != null) p.set('end', String(Math.trunc(q.end)));
  if (q.staging != null) p.set('staging', String(Math.trunc(q.staging)));
  if (q.layout) p.set('layout', q.layout);
  if (q.pilotId != null) p.set('pilot', String(q.pilotId));
  return `?${p.toString()}`;
}

export type SavedRace = { heat: RaceListHeat; round: RaceListRound };

/** The saved race the query names, from RotorHazard's `race_list`. */
export function findSavedRace(
  list: readonly RaceListHeat[],
  q: ReplayQuery
): SavedRace | undefined {
  for (const heat of list) {
    for (const round of heat.rounds) {
      if (
        q.raceId != null
          ? round.raceId === q.raceId
          : heat.heatId === q.heatId && round.round === q.round
      )
        return { heat, round };
    }
  }
  return undefined;
}

/**
 * The race as `clockView` wants it, at race time `t`. Start is at 0 on a clock with no
 * differential, so `clockView(status, 0, t, end)` reads straight off the lap-stamp axis:
 * idle before `staging` (when given), staging while t < 0, racing after, and stopped
 * (frozen at `end`) once t reaches `end`. A format with a random start delay hid its
 * staging clock live, so it is hidden here too.
 */
export function replayStatus(
  saved: SavedRace,
  format: RaceFormat | undefined,
  t: number,
  end: number | null,
  staging: number | null = null
): RaceStatus {
  const stopped = end != null && t >= end;
  const idle = staging != null && t < staging;
  return {
    status: idle
      ? RACE_STATUS.READY
      : t < 0
        ? RACE_STATUS.STAGING
        : stopped
          ? RACE_STATUS.DONE
          : RACE_STATUS.RACING,
    formatId: saved.round.formatId,
    heatId: saved.heat.heatId,
    classId: saved.heat.classId || null,
    unlimitedTime: format?.unlimitedTime ?? true,
    raceTimeSec: format?.raceTimeSec ?? 0,
    hideStageTimer: (format?.startDelayMax ?? 0) > 0,
    stagingTones: 0,
    startsAt: 0,
    stagingAt: null,
    nextRound: saved.round.round
  };
}

/**
 * The laps a pilot had *scored* by race time `t`, in order, as lap times (ms): the stored
 * crossings that are not deleted and have happened, less the first one when the format
 * starts with a hole shot — RotorHazard's own count (Results.calc_leaderboard). Lap times
 * are between counted crossings, so a deleted crossing folds into the next lap, exactly as
 * the marshalled result does.
 */
export function lapsAt(laps: readonly MarshalLap[], t: number, startBehavior: number): number[] {
  const counted = laps.filter((l) => !l.deleted).sort((a, b) => a.stampMs - b.stampMs);
  const scored = startBehavior === START_BEHAVIOR.FIRST_LAP ? counted : counted.slice(1);
  const out: number[] = [];
  let last = startBehavior === START_BEHAVIOR.FIRST_LAP ? 0 : (counted[0]?.stampMs ?? 0);
  for (const l of scored) {
    if (l.stampMs > t) break;
    out.push(l.stampMs - last);
    last = l.stampMs;
  }
  return out;
}

/** Every scored crossing's race time across the pilots, sorted: where a frame changes. */
export function lapStamps(
  pilots: ReadonlyArray<{ laps: readonly MarshalLap[] }>,
  startBehavior: number
): number[] {
  const out: number[] = [];
  for (const p of pilots) {
    const counted = p.laps.filter((l) => !l.deleted).sort((a, b) => a.stampMs - b.stampMs);
    const scored = startBehavior === START_BEHAVIOR.FIRST_LAP ? counted : counted.slice(1);
    for (const l of scored) out.push(l.stampMs);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Positions at this moment, in the spirit of RotorHazard's win conditions: most laps in the
 * least time (progress), the best single lap, or the best run of laps in a row; a format
 * with no winner keeps seat order. Rows with nothing yet trail. Returns a new list, ranked
 * and in rank order, with `position` filled in.
 */
export function rankRows(rows: readonly OverlayRow[], winCondition: number): OverlayRow[] {
  const byLaps = (a: OverlayRow, b: OverlayRow) =>
    b.lapMs.length - a.lapMs.length || total(a) - total(b) || a.seat - b.seat;
  const byBest = (a: OverlayRow, b: OverlayRow) =>
    (a.best ?? Infinity) - (b.best ?? Infinity) || byLaps(a, b);
  const byWindow = (a: OverlayRow, b: OverlayRow) =>
    (a.window?.totalMs ?? Infinity) - (b.window?.totalMs ?? Infinity) || byLaps(a, b);
  const cmp =
    winCondition === WIN_CONDITION.FASTEST_LAP
      ? byBest
      : winCondition === WIN_CONDITION.FASTEST_CONSECUTIVE
        ? byWindow
        : winCondition === WIN_CONDITION.NONE
          ? (a: OverlayRow, b: OverlayRow) => a.seat - b.seat
          : byLaps;
  const ranked = [...rows].sort(cmp);
  return ranked.map((r, i) => ({
    ...r,
    position: winCondition === WIN_CONDITION.NONE ? null : i + 1
  }));
}

const total = (r: OverlayRow) => r.lapMs.reduce((s, x) => s + x, 0);

/** Which layout the panel draws: the URL's say, else one pilot gets the long form. */
export function replayLayout(q: ReplayQuery, rowCount: number): ReplayLayout {
  return q.layout ?? (rowCount === 1 ? 'solo' : 'field');
}

/** What `window.gridfpvReplay` reports: the facts a renderer plans frames from. */
export type ReplayInfo = {
  raceId: number;
  heatId: number;
  round: number;
  title: string;
  startBehavior: number;
  unlimitedTime: boolean;
  /** The race length (ms) for a timed format, null when unlimited. */
  durationMs: number | null;
  /** Race time of every scored crossing, sorted. */
  lapStamps: number[];
  /** Race time the overlay shows right now. */
  t: number;
  /**
   * Changes exactly when the panel's picture changes (the clock's tenth, the phase, a lap
   * appearing): a renderer screenshots on a new key and repeats the last frame otherwise.
   */
  key: string;
  /** The overlay's placement as drawn (corner, offsets, size): a render is stale when it changes. */
  look: string;
};
