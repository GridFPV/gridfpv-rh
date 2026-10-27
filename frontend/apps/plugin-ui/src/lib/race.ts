/**
 * The race side of RotorHazard's socket vocabulary (4.4.0): race status, the live laps
 * and leaderboard, the clock, and the marshal recalculation rules. Pure data and
 * functions; the store feeds them and the Run / Marshal screens read them.
 *
 * Clock: RotorHazard stamps staging and start on its own monotonic clock. The browser
 * samples that clock (`get_pi_time` → `pi_time`), keeps the median offset to
 * `performance.now()`, and runs the countdown locally — the same scheme as RotorHazard's
 * run page, so both show the same time.
 */
import type { Crossing, Trace } from './crossings.js';
import { detectCrossings } from './crossings.js';

export const RACE_STATUS = { READY: 0, RACING: 1, DONE: 2, STAGING: 3 } as const;

export type RaceStatus = {
  status: number;
  formatId: number | null;
  heatId: number;
  classId: number | null;
  unlimitedTime: boolean;
  raceTimeSec: number;
  hideStageTimer: boolean;
  /** Staging tones for this staging (stage_ready); race_status always says 0, as RotorHazard's page sees it. */
  stagingTones: number;
  /** RotorHazard's monotonic clock, seconds; null before the first staging. */
  startsAt: number | null;
  stagingAt: number | null;
  /** The round the current heat races next (1-based). */
  nextRound: number;
};

type Raw = Record<string, unknown>;
const num = (v: unknown, d = 0) => (v == null || v === '' ? d : Number(v));
const str = (v: unknown) => (v == null ? '' : String(v));

export function emptyRaceStatus(): RaceStatus {
  return {
    status: RACE_STATUS.READY,
    formatId: null,
    heatId: 0,
    classId: null,
    unlimitedTime: false,
    raceTimeSec: 0,
    hideStageTimer: false,
    stagingTones: 0,
    startsAt: null,
    stagingAt: null,
    nextRound: 0
  };
}

/** `race_status` (RHUI.emit_race_status). */
/**
 * `race_status` (RHUI.emit_race_status). Its hide_stage_timer is computed from the format
 * (min != max delay), which is true for a fixed delay; the real flag for this staging came
 * with `stage_ready`, so once staging has begun the previous value is kept (#72), as
 * RotorHazard's own page only reads the flag from stage_ready.
 */
export function applyRaceStatus(p: Raw, prev?: RaceStatus): RaceStatus {
  const status = num(p.race_status);
  const staged = prev != null && prev.startsAt != null && status !== RACE_STATUS.READY;
  return {
    status,
    formatId: p.race_format_id == null ? null : Number(p.race_format_id),
    heatId: num(p.race_heat_id),
    classId: p.race_class_id == null ? null : Number(p.race_class_id),
    unlimitedTime: Boolean(p.unlimited_time),
    raceTimeSec: num(p.race_time_sec),
    hideStageTimer: staged ? prev!.hideStageTimer : Boolean(p.hide_stage_timer),
    stagingTones: staged ? prev!.stagingTones : num(p.staging_tones),
    startsAt: p.pi_starts_at_s == null ? null : Number(p.pi_starts_at_s),
    stagingAt: p.pi_staging_at_s == null ? null : Number(p.pi_staging_at_s),
    nextRound: num(p.next_round)
  };
}

/** `stage_ready` (RHUI.emit_race_stage): staging has begun with these final times. */
export function applyStageReady(prev: RaceStatus, p: Raw): RaceStatus {
  return {
    ...prev,
    status: RACE_STATUS.STAGING,
    heatId: p.heat_id == null ? prev.heatId : num(p.heat_id),
    unlimitedTime: Boolean(p.unlimited_time),
    raceTimeSec: num(p.race_time_sec),
    hideStageTimer: Boolean(p.hide_stage_timer),
    stagingTones: num(p.staging_tones),
    startsAt: p.pi_starts_at_s == null ? prev.startsAt : Number(p.pi_starts_at_s),
    stagingAt: p.pi_staging_at_s == null ? prev.stagingAt : Number(p.pi_staging_at_s)
  };
}

// ---- live laps -------------------------------------------------------------------

export type LiveLap = {
  /** Index into RotorHazard's lap list for this seat (delete_lap / restore_deleted_lap). */
  index: number;
  /** Lap number as shown (0 = holeshot), -1 for a late lap. */
  number: number;
  timeMs: number;
  formatted: string;
  /** Milliseconds since the race start. */
  stampMs: number;
  deleted: boolean;
  late: boolean;
  source: number | string | null;
};

export type LiveSeat = {
  laps: LiveLap[];
  fastestIndex: number | null;
  pilot: { id: number; callsign: string } | null;
  finished: boolean;
};

/** `current_laps` (RHRace.build_laps_list), one entry per seat. */
export function applyCurrentLaps(p: Raw): LiveSeat[] {
  const current = (p.current as Raw | undefined) ?? {};
  const seats = (current.node_index as Raw[] | undefined) ?? [];
  return seats.map((s) => {
    const pilot = s.pilot as Raw | null | undefined;
    return {
      laps: ((s.laps as Raw[] | undefined) ?? []).map((l) => ({
        index: num(l.lap_index),
        number: num(l.lap_number),
        timeMs: num(l.lap_time),
        formatted: str(l.lap_time_formatted),
        stampMs: num(l.lap_time_stamp),
        deleted: Boolean(l.deleted),
        late: Boolean(l.late_lap),
        source: (l.source as number | string | null | undefined) ?? null
      })),
      fastestIndex: s.fastest_lap_index == null ? null : Number(s.fastest_lap_index),
      pilot: pilot ? { id: num(pilot.id), callsign: str(pilot.callsign) } : null,
      finished: Boolean(s.finished_flag)
    };
  });
}

/** Laps that count: not deleted. */
export function countedLaps(seat: LiveSeat): LiveLap[] {
  return seat.laps.filter((l) => !l.deleted);
}
/**
 * Laps flown, as RotorHazard's leaderboard counts them: not deleted, not the hole shot
 * (lap 0, only in hole-shot start behaviour) and not a late lap (RotorHazard numbers it −1).
 */
export function flownLaps(seat: LiveSeat): LiveLap[] {
  return seat.laps.filter((l) => !l.deleted && l.number > 0);
}

// ---- leaderboard -----------------------------------------------------------------

export type LeaderRow = {
  pilotId: number;
  callsign: string;
  team: string;
  node: number | null;
  laps: number;
  totalTime: string;
  fastestLap: string;
  lastLap: string;
  consecutives: string;
  consecutivesBase: number;
  /** RotorHazard ranks a pilot only once they have a lap; null until then (#76). */
  position: number | null;
  behind: string;
};

export type Leaderboard = {
  heatId: number;
  round: number;
  name: string;
  statusMsg: string;
  /** Which list ranks this race: by_race_time, by_fastest_lap, by_consecutives. */
  primary: string;
  rows: LeaderRow[];
  winCondition: number | null;
  consecutivesCount: number;
};

/** One of `leaderboard`'s `current` / `last_race` entries (RHUI.emit_current_leaderboard). */
export function parseLeaderboard(raw: Raw | null | undefined): Leaderboard | null {
  if (!raw) return null;
  const lb = (raw.leaderboard as Raw | undefined) ?? {};
  const meta = (lb.meta as Raw | undefined) ?? {};
  const primary = str(meta.primary_leaderboard) || 'by_race_time';
  const rows = (lb[primary] as Raw[] | undefined) ?? [];
  return {
    heatId: num(raw.heat),
    round: num(raw.round),
    name: str(raw.displayname),
    statusMsg: str(raw.status_msg),
    primary,
    rows: rows.map((r) => ({
      pilotId: num(r.pilot_id),
      callsign: str(r.callsign),
      team: str(r.team_name),
      node: r.node == null ? null : Number(r.node),
      laps: num(r.laps),
      totalTime: str(r.total_time),
      fastestLap: str(r.fastest_lap),
      lastLap: str(r.last_lap),
      consecutives: str(r.consecutives),
      consecutivesBase: num(r.consecutives_base),
      position: r.position == null || r.position === '' ? null : Number(r.position),
      behind: str(r.time_behind ?? r.behind)
    })),
    winCondition: meta.win_condition == null ? null : Number(meta.win_condition),
    consecutivesCount: num(meta.consecutives_count)
  };
}

export function applyLeaderboard(p: Raw): {
  current: Leaderboard | null;
  last: Leaderboard | null;
} {
  return {
    current: parseLeaderboard(p.current as Raw | undefined),
    last: parseLeaderboard(p.last_race as Raw | undefined)
  };
}

// ---- clock sync ------------------------------------------------------------------

export type SyncSample = { differential: number; response: number };
export const SYNC_SAMPLES = 10;

/**
 * Fold one `pi_time` answer into the sample set, RotorHazard's way: the offset is the
 * server's clock (ms) minus our clock at the response, less half the round trip; samples
 * are kept only while they agree with the fastest one to within its round trip.
 */
export function addSyncSample(
  samples: SyncSample[],
  piTimeS: number,
  requestedAt: number,
  respondedAt: number
): SyncSample[] {
  const response = Math.max(0, respondedAt - requestedAt);
  const sample = { differential: piTimeS * 1000 - respondedAt - response / 2, response };
  const all = [...samples, sample].sort((a, b) => a.response - b.response);
  const best = all[0];
  return all.filter(
    (s) =>
      s.differential >= best.differential - best.response &&
      s.differential <= best.differential + best.response
  );
}

/** Median offset: RotorHazard's clock (ms) minus `performance.now()`. */
export function syncDifferential(samples: SyncSample[]): number | null {
  if (!samples.length) return null;
  const a = samples.map((s) => s.differential).sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

// ---- clock view ------------------------------------------------------------------

export type ClockPhase = 'idle' | 'staging' | 'racing' | 'overtime' | 'done' | 'unsynced';

export type ClockView = {
  phase: ClockPhase;
  /** What the big display shows. */
  text: string;
  /** Milliseconds into the race (negative while staging), when known. */
  raceMs: number | null;
};

/** m:ss.sss, as RotorHazard's Marshal page shows lap times and stamps. */
export function formatLapMs(ms: number): string {
  const sign = ms < 0 ? '-' : '';
  const t = Math.round(Math.abs(ms));
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  return `${sign}${m}:${String(s).padStart(2, '0')}.${String(t % 1000).padStart(3, '0')}`;
}
export function formatClockMs(ms: number, tenths = true): string {
  const sign = ms < 0 ? '-' : '';
  const t = Math.abs(ms);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const d = Math.floor((t % 1000) / 100);
  return `${sign}${m}:${String(s).padStart(2, '0')}${tenths ? `.${d}` : ''}`;
}

/**
 * The clock as the Run screen shows it. `now` is `performance.now()`; `frozenAt` is the
 * local time the race stopped (the display holds there until the laps are saved or
 * discarded).
 */
export function clockView(
  race: RaceStatus,
  differential: number | null,
  now: number,
  frozenAt: number | null
): ClockView {
  const duration = race.raceTimeSec * 1000;
  const idleText = race.unlimitedTime ? '0:00.0' : formatClockMs(duration);
  if (race.status === RACE_STATUS.READY) return { phase: 'idle', text: idleText, raceMs: null };
  if (differential == null || race.startsAt == null)
    return { phase: 'unsynced', text: '--:--', raceMs: null };
  const localZero = race.startsAt * 1000 - differential;
  const at = race.status === RACE_STATUS.DONE && frozenAt != null ? frozenAt : now;
  const t = at - localZero;
  if (race.status === RACE_STATUS.STAGING || (race.status !== RACE_STATUS.DONE && t < 0)) {
    if (t >= 0) return { phase: 'racing', text: raceText(race, t, duration), raceMs: t };
    return {
      phase: 'staging',
      text: race.hideStageTimer ? 'Ready' : formatClockMs(-t),
      raceMs: t
    };
  }
  if (race.status === RACE_STATUS.DONE) {
    // Stopped: the clock freezes where it was; a frozen overrun still reads as time up.
    const over = !race.unlimitedTime && t > duration;
    return {
      phase: over ? 'overtime' : 'done',
      text: raceText(race, Math.max(0, t), duration),
      raceMs: t
    };
  }
  const over = !race.unlimitedTime && t > duration;
  return { phase: over ? 'overtime' : 'racing', text: raceText(race, t, duration), raceMs: t };
}

function raceText(race: RaceStatus, t: number, duration: number): string {
  if (race.unlimitedTime) return formatClockMs(t);
  const left = duration - t;
  // Never "-0:00.0": the tenth that reads zero is zero (#68).
  return formatClockMs(left > -100 && left < 0 ? 0 : left);
}

// ---- marshal ---------------------------------------------------------------------

export const MARSHAL_TYPE = { RSSI: 0, HYBRID_PASS_PEAK: 1, PASS_PEAK_ONLY: 2 } as const;
/** RotorHazard's lap sources (RHRace LapSource): realtime 0, manual 1, recalc 2, … */
export const LAP_SOURCE = { REALTIME: 0, MANUAL: 1, RECALC: 2, AUTOMATIC: 3, API: 4 } as const;

export type MarshalLap = {
  /** Milliseconds since the race start. */
  stampMs: number;
  /** Lap time: this stamp minus the previous counted stamp (the first lap's is its stamp). */
  timeMs: number;
  deleted: boolean;
  source: number;
  peakRssi: number | null;
  /** Where the crossing opened and closed on the trace (seconds), when recalculated. */
  crossingStart?: number;
  crossingEnd?: number;
};

export type MarshalRules = {
  minLapMs: number;
  minFirstCrossingMs: number;
  /** RotorHazard TIMING.MinLapBehavior: 1 discards laps under the minimum, 0 keeps them. */
  minLapBehavior: number;
  unlimitedTime: boolean;
  raceTimeSec: number;
};

/** Recompute lap times from stamps: each counted lap measures from the previous counted one. */
export function withLapTimes(laps: MarshalLap[]): MarshalLap[] {
  let last = 0;
  return laps.map((l) => {
    const timeMs = l.stampMs - last;
    if (!l.deleted) last = l.stampMs;
    return { ...l, timeMs };
  });
}

/**
 * The marshal page's "what would the timer have seen": crossings over the recorded RSSI
 * with these thresholds, then RotorHazard's race rules — reject passes before the start,
 * the minimum first crossing, the minimum lap time, and laps after time ran out (the first
 * one counts, later ones are deleted). Ported from `static/marshal.js: processRXData`.
 */
export function recalcLaps(
  trace: Trace,
  enter: number,
  exit: number,
  startTimeS: number,
  rules: MarshalRules
): MarshalLap[] {
  const out: MarshalLap[] = [];
  let last = -Infinity;
  for (const c of detectCrossings(trace, enter, exit)) {
    const stampMs = (c.at - startTimeS) * 1000;
    if (stampMs <= 0) continue; // before the start
    const lap: MarshalLap = {
      stampMs,
      timeMs: 0,
      deleted: false,
      source: LAP_SOURCE.RECALC,
      peakRssi: c.open ? null : c.peak,
      crossingStart: c.start,
      crossingEnd: c.end
    };
    if (!c.open) {
      if (stampMs < rules.minFirstCrossingMs) lap.deleted = true;
      else if (rules.minLapBehavior && stampMs < last + rules.minLapMs) lap.deleted = true;
      else last = stampMs;
    }
    out.push(lap);
  }
  return incrementalLapTimes(applyLateLaps(out, rules));
}

/** After time runs out, the first lap still counts and the rest are deleted. */
export function applyLateLaps(laps: MarshalLap[], rules: MarshalRules): MarshalLap[] {
  if (rules.unlimitedTime) return laps;
  let finished = false;
  return laps.map((l) => {
    if (finished) return { ...l, deleted: true };
    if (l.stampMs > rules.raceTimeSec * 1000) finished = true;
    return l;
  });
}

/**
 * RotorHazard's marshal.js setEnter / setExit: a threshold is clamped to the graph's range,
 * never crosses the other one, and dragging one past the other drags the other along.
 */
export function setEnterThreshold(
  _enter: number,
  exit: number,
  rssi: number,
  range = { min: 0, max: 255 }
): { enter: number; exit: number } {
  let chk = Math.max(Math.min(rssi, range.max), range.min);
  if (chk < exit) chk = exit;
  return { enter: chk, exit: rssi < exit ? rssi : exit };
}
export function setExitThreshold(
  enter: number,
  _exit: number,
  rssi: number,
  range = { min: 0, max: 255 }
): { enter: number; exit: number } {
  let chk = Math.max(Math.min(rssi, range.max), range.min);
  if (chk > enter) chk = enter;
  return { enter: rssi > enter ? rssi : enter, exit: chk };
}

/**
 * marshal.js updateIncrementalLapTimes: laps sorted by stamp; a counted lap's time measures
 * from the previous counted one (the first from the start); a deleted lap's time is 0.
 */
export function incrementalLapTimes(laps: MarshalLap[]): MarshalLap[] {
  const sorted = [...laps].sort((a, b) => a.stampMs - b.stampMs);
  let last: number | null = null;
  return sorted.map((l) => {
    if (l.deleted) return { ...l, timeMs: 0 };
    const timeMs = last == null ? l.stampMs : l.stampMs - last;
    last = l.stampMs;
    return { ...l, timeMs };
  });
}

/**
 * marshal.js recalcRace: the crossings found with these thresholds replace the recorded
 * laps, except manual (1) and API (4) laps, which survive and merge in by time.
 */
export function recalcRace(
  trace: Trace,
  enter: number,
  exit: number,
  startTimeS: number,
  rules: MarshalRules,
  existing: MarshalLap[]
): MarshalLap[] {
  const kept = existing.filter(
    (l) => l.source === LAP_SOURCE.MANUAL || l.source === LAP_SOURCE.API
  );
  return incrementalLapTimes([...recalcLaps(trace, enter, exit, startTimeS, rules), ...kept]);
}

/** marshal.js addManualLap: a lap at that many seconds (ms truncated), source manual. */
export function addManualLap(laps: MarshalLap[], seconds: number): MarshalLap[] {
  return incrementalLapTimes([
    ...laps,
    {
      stampMs: Math.trunc(seconds * 1000),
      timeMs: 0,
      deleted: false,
      source: LAP_SOURCE.MANUAL,
      peakRssi: null,
      crossingStart: 0,
      crossingEnd: 0
    }
  ]);
}

/** marshal.js cleanDeletedLaps: deleted laps are dropped, not flagged, so a save forgets them. */
export function cleanDeletedLaps(laps: MarshalLap[]): MarshalLap[] {
  return incrementalLapTimes(laps.filter((l) => !l.deleted));
}

/** Stored laps (`race_details.laps` or `current_marshal_data` seat laps) as marshal laps. */
export function lapsFromStored(raw: Raw[]): MarshalLap[] {
  return incrementalLapTimes(
    raw.map((l) => ({
      stampMs: num(l.lap_time_stamp),
      timeMs: num(l.lap_time),
      deleted: Boolean(l.deleted),
      source: num(l.source),
      peakRssi: l.peak_rssi == null ? null : Number(l.peak_rssi)
    }))
  );
}

export function toggleLap(laps: MarshalLap[], index: number): MarshalLap[] {
  return incrementalLapTimes(laps.map((l, i) => (i === index ? { ...l, deleted: !l.deleted } : l)));
}

/** Stored laps as trace ticks: where the timer actually recorded a pass. */
export function lapTicks(laps: MarshalLap[], startTimeS: number): Crossing[] {
  return laps
    .filter((l) => !l.deleted)
    .map((l) => {
      const at = startTimeS + l.stampMs / 1000;
      return { start: at - 0.05, end: at + 0.05, at, peak: l.peakRssi ?? 0, open: false };
    });
}

/** The laps as RotorHazard's `resave_laps` / `replace_current_laps` want them. */
export function lapsForSave(laps: MarshalLap[]): Raw[] {
  return laps.map((l) => ({
    lap_time_stamp: l.stampMs,
    lap_time: l.timeMs,
    lap_time_formatted: formatClockMs(l.timeMs),
    peak_rssi: l.peakRssi,
    source: l.source,
    deleted: l.deleted
  }));
}

// ---- saved races, for the marshal picker -----------------------------------------

export type RaceListPilot = {
  pilotraceId: number;
  pilotId: number;
  callsign: string;
  node: number;
  freq: string;
};
export type RaceListRound = {
  round: number;
  raceId: number;
  formatId: number | null;
  /** RotorHazard monotonic seconds. */
  startTime: number;
  startTimeFormatted: string;
  pilots: RaceListPilot[];
};
export type RaceListHeat = {
  heatId: number;
  classId: number;
  name: string;
  rounds: RaceListRound[];
};

/** `race_list` (RHUI.emit_race_list): every saved race, by heat and round. */
export function applyRaceList(p: Raw): RaceListHeat[] {
  const heats = (p.heats as Record<string, Raw> | undefined) ?? {};
  return Object.values(heats)
    .map((h) => ({
      heatId: num(h.heat_id),
      classId: num(h.class_id),
      name: str(h.displayname),
      rounds: Object.entries((h.rounds as Record<string, Raw> | undefined) ?? {})
        .map(([round, r]) => ({
          round: Number(round),
          raceId: num(r.race_id),
          formatId: r.format_id == null ? null : Number(r.format_id),
          startTime: num(r.start_time),
          startTimeFormatted: str(r.start_time_formatted),
          pilots: ((r.pilotraces as Raw[] | undefined) ?? []).map((x) => ({
            pilotraceId: num(x.pilotrace_id),
            pilotId: num(x.pilot_id),
            callsign: str(x.callsign),
            node: num(x.node_index),
            freq: str(x.pilot_freq)
          }))
        }))
        .sort((a, b) => a.round - b.round)
    }))
    .sort((a, b) => a.heatId - b.heatId);
}

export type RaceDetails = {
  pilotraceId: number;
  pilotId: number;
  callsign: string;
  node: number;
  trace: Trace;
  laps: MarshalLap[];
  enter: number;
  exit: number;
  marshalType: number;
};

/** `race_details` (server.get_pilotrace): one pilot's recorded race. */
export function applyRaceDetails(p: Raw): RaceDetails {
  return {
    pilotraceId: num(p.pilotrace_id),
    pilotId: num(p.pilot_id),
    callsign: str(p.callsign),
    node: num(p.node_index),
    trace: {
      times: ((p.history_times as number[] | undefined) ?? []).map(Number),
      values: ((p.history_values as number[] | undefined) ?? []).map(Number)
    },
    laps: lapsFromStored((p.laps as Raw[] | undefined) ?? []),
    enter: num(p.enter_at),
    exit: num(p.exit_at),
    marshalType: num(p.marshal_type)
  };
}

export type MarshalCurrent = {
  heatId: number;
  formatId: number | null;
  startTime: number;
  startTimeFormatted: string;
  seats: Array<{
    node: number;
    trace: Trace;
    laps: MarshalLap[];
    enter: number;
    exit: number;
    marshalType: number;
  }>;
};

/** `current_marshal_data` (RHUI.emit_race_marshal_data): the stopped, unsaved race. */
export function applyMarshalCurrent(p: Raw): MarshalCurrent {
  const race = (p.race as Raw | undefined) ?? {};
  const seats = (p.seats as Record<string, Raw> | undefined) ?? {};
  return {
    heatId: num(race.heat_id),
    formatId: race.format_id == null ? null : Number(race.format_id),
    startTime: num(race.start_time),
    startTimeFormatted: str(race.start_time_formatted),
    seats: Object.entries(seats)
      .map(([k, s]) => ({
        node: Number(k),
        trace: {
          times: ((s.history_times as number[] | undefined) ?? []).map(Number),
          values: ((s.history_values as number[] | undefined) ?? []).map(Number)
        },
        laps: lapsFromStored((s.laps as Raw[] | undefined) ?? []),
        enter: num(s.enter_at),
        exit: num(s.exit_at),
        marshalType: num(s.marshal_type)
      }))
      .sort((a, b) => a.node - b.node)
  };
}

/** "m:ss" for a scheduled start, never negative. */
export function countdownText(msLeft: number): string {
  const s = Math.max(0, Math.ceil(msLeft / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---- warnings before a start -------------------------------------------------------

/**
 * Pilots seated on a seat whose frequency is Off (#70): RotorHazard would race them and
 * time nothing. One line per pilot, for the seat card and the header.
 */
export function offSeatWarnings(
  seats: Array<{ index: number; frequency: number }>,
  slots: Array<{ nodeIndex: number | null; pilotId: number }>,
  callsignOf: (pilotId: number) => string
): Array<{ seat: number; pilotId: number; text: string }> {
  const out: Array<{ seat: number; pilotId: number; text: string }> = [];
  for (const slot of slots) {
    if (slot.nodeIndex == null || !slot.pilotId) continue;
    const seat = seats.find((s) => s.index === slot.nodeIndex);
    if (!seat || seat.frequency > 0) continue;
    const who = callsignOf(slot.pilotId) || `Pilot ${slot.pilotId}`;
    out.push({
      seat: slot.nodeIndex,
      pilotId: slot.pilotId,
      text: `${who} is on seat ${slot.nodeIndex + 1}, which has no frequency: set a channel on Seats or move the pilot.`
    });
  }
  return out;
}
