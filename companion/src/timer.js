/**
 * RotorHazard over its socket, the way Grid's own pages talk to it: the race status and the
 * stage-ready event (status, heat, the start and staging stamps on the timer's clock), the
 * saved-race list, the results version, the plugin's deleted-races notices, a pilot's saved
 * race, and the clock sync. Read-only but for `get_*`/`load_data` requests.
 */
import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import { io } from "socket.io-client";
import { SYNC_SAMPLES, addSample, differential } from "./clock.js";

export const RACE = Object.freeze({ READY: 0, RACING: 1, DONE: 2, STAGING: 3 });

export class Timer extends EventEmitter {
  constructor(
    url,
    { user = "", pass = "", log = () => {}, syncEveryMs = 400 } = {},
  ) {
    super();
    this.url = url;
    this.auth = user
      ? "Basic " + Buffer.from(`${user}:${pass}`).toString("base64")
      : null;
    this.log = log;
    this.syncEveryMs = syncEveryMs;
    this.socket = null;
    this.samples = [];
    this.differential = null;
    this.race = null;
    this.raceList = [];
    this.pending = [];
  }

  connect() {
    const opts = {
      path: "/socket.io",
      transports: ["websocket"],
      reconnection: true,
      forceNew: true,
    };
    if (this.auth) opts.extraHeaders = { Authorization: this.auth };
    const s = (this.socket = io(this.url, opts));
    s.on("connect", () => {
      this.log(`timer: connected to ${this.url}`);
      this.samples = [];
      this.differential = null;
      this.syncClock();
      s.emit("load_data", { load_types: ["race_status", "race_list"] });
      this.emit("connected");
    });
    s.on("disconnect", (why) => {
      this.log(`timer: disconnected (${why})`);
      this.emit("disconnected");
    });
    s.on("connect_error", (e) =>
      this.log(`timer: connect error: ${e.message}`),
    );
    s.on("pi_time", (p) => this.onPiTime(p));
    s.on("race_status", (p) => {
      this.race = {
        status: Number(p.race_status),
        heatId: Number(p.race_heat_id ?? 0),
        nextRound: Number(p.next_round ?? 0),
        startsAt: p.pi_starts_at_s == null ? null : Number(p.pi_starts_at_s),
        stagingAt: p.pi_staging_at_s == null ? null : Number(p.pi_staging_at_s),
      };
      this.emit("race_status", this.race);
    });
    s.on("stage_ready", (p) => {
      // Staging began, with the final stamps; race_status still says Ready at this point.
      this.race = {
        ...(this.race ?? {}),
        status: RACE.STAGING,
        heatId:
          p.heat_id == null ? (this.race?.heatId ?? 0) : Number(p.heat_id),
        startsAt:
          p.pi_starts_at_s == null
            ? (this.race?.startsAt ?? null)
            : Number(p.pi_starts_at_s),
        stagingAt:
          p.pi_staging_at_s == null
            ? (this.race?.stagingAt ?? null)
            : Number(p.pi_staging_at_s),
      };
      this.emit("stage_ready", this.race);
    });
    s.on("race_list", (p) => {
      this.raceList = parseRaceList(p);
      this.emit("race_list", this.raceList);
    });
    s.on("result_data", () => this.emit("result_data"));
    s.on("gridfpv_races_deleted", (p) => this.emit("races_deleted", p));
    s.on("race_details", (p) => this.resolvePending("race_details", p));
    return this;
  }

  close() {
    this.socket?.close();
    this.socket = null;
  }

  // ---- clock ----
  syncClock() {
    this.syncLeft = SYNC_SAMPLES;
    this.sendPiTime();
  }
  sendPiTime() {
    if (!this.socket || this.piSentAt != null) return;
    this.piSentAt = performance.now();
    this.socket.emit("get_pi_time");
  }
  onPiTime(p) {
    if (this.piSentAt == null) return;
    this.samples = addSample(
      this.samples,
      Number(p.pi_time_s),
      this.piSentAt,
      performance.now(),
    );
    this.piSentAt = null;
    this.differential = differential(this.samples);
    if (--this.syncLeft > 0)
      setTimeout(() => this.sendPiTime(), this.syncEveryMs);
    else this.emit("synced", this.differential);
  }
  /** A timer stamp (s) as local performance.now() ms, or null before the first sync. */
  localMs(piTimeS) {
    return this.differential == null || piTimeS == null
      ? null
      : piTimeS * 1000 - this.differential;
  }

  // ---- requests with an answer ----
  resolvePending(event, payload) {
    const i = this.pending.findIndex(
      (w) => w.event === event && w.match(payload),
    );
    if (i < 0) return;
    const [w] = this.pending.splice(i, 1);
    clearTimeout(w.timer);
    w.resolve(payload);
  }
  ask(emitEvent, data, answerEvent, match, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      const w = { event: answerEvent, match, resolve };
      w.timer = setTimeout(() => {
        this.pending = this.pending.filter((x) => x !== w);
        reject(new Error(`timer: no ${answerEvent} for ${emitEvent}`));
      }, timeoutMs);
      this.pending.push(w);
      this.socket.emit(emitEvent, data);
    });
  }
  /** One pilot's saved race: its laps (stamps, deleted flags). */
  async pilotRace(pilotraceId) {
    const p = await this.ask(
      "get_pilotrace",
      { pilotrace_id: pilotraceId },
      "race_details",
      (x) => Number(x.pilotrace_id) === pilotraceId,
    );
    return {
      pilotraceId,
      pilotId: Number(p.pilot_id ?? 0),
      laps: (p.laps ?? []).map((l) => ({
        stampMs: Number(l.lap_time_stamp),
        deleted: Boolean(l.deleted),
      })),
    };
  }
  /** Ask for the saved-race list again; resolves with it. */
  refreshRaceList() {
    return new Promise((resolve) => {
      this.once("race_list", resolve);
      this.socket.emit("load_data", { load_types: ["race_list"] });
    });
  }
}

/** `race_list`: heats → rounds, with each round's race id and pilot races. */
export function parseRaceList(p) {
  const heats = p?.heats ?? {};
  return Object.values(heats).map((h) => ({
    heatId: Number(h.heat_id),
    classId: Number(h.class_id ?? 0),
    name: String(h.displayname ?? ""),
    rounds: Object.entries(h.rounds ?? {})
      .map(([round, r]) => ({
        round: Number(round),
        raceId: Number(r.race_id),
        pilotraces: (r.pilotraces ?? []).map((x) => ({
          pilotraceId: Number(x.pilotrace_id),
          pilotId: Number(x.pilot_id ?? 0),
          node: Number(x.node_index ?? 0),
        })),
      }))
      .sort((a, b) => a.round - b.round),
  }));
}

/** The rounds a heat has saved, from a race list. */
export function roundsOf(raceList, heatId) {
  return raceList.find((h) => h.heatId === heatId)?.rounds ?? [];
}

/** The stamps of every scored crossing in a saved race (hole shot dropped per pilot), sorted — what the page's `lapStamps` is. */
export function scoredStamps(pilotRaces, firstLapCounts = false) {
  const out = [];
  for (const pr of pilotRaces) {
    const counted = pr.laps
      .filter((l) => !l.deleted)
      .sort((a, b) => a.stampMs - b.stampMs);
    for (const l of firstLapCounts ? counted : counted.slice(1))
      out.push(l.stampMs);
  }
  return out.sort((a, b) => a - b);
}
