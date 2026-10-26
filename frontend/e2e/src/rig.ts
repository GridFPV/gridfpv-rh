/**
 * The rig: RotorHazard driven without a browser (T1, #30). Writes go over RotorHazard's own
 * socket events, exactly as its pages and our SPA send them; RotorHazard never acks a
 * write and a handler that raises fails silently, so every write here is followed by a
 * readback through the JSON API (`/api/...`) or a `load_data` round trip, and resolves only
 * when RotorHazard shows what we sent.
 *
 * Works against RotorHazard 4.4.0 (no socket auth). RotorHazard main adds socket
 * authentication; that is #34.
 */
import { io, type Socket } from 'socket.io-client';

export interface Credentials {
  user: string;
  pass: string;
}

export interface ApiPilot {
  id: number;
  callsign: string;
  name: string;
  team: string;
  phonetic: string;
}

export interface ApiHeat {
  heat_id: number;
  displayname: string;
  class_id: number;
  /** node index → pilot id */
  nodes_pilots: Record<string, number>;
  locked: boolean;
}

export interface ApiRaceLap {
  id: number;
  lap_time_stamp: number;
  lap_time: number;
  deleted: boolean;
}

export interface ApiRaceNode {
  callsign: string;
  pilot_id: number;
  node_index: number;
  laps: ApiRaceLap[];
}

/** One saved race (`/api/race/<heat>/<round>`), with the heat and round it was looked up by. */
export interface ApiRace {
  heat_id: number;
  round_id: number;
  start_time_formatted: string;
  nodes: ApiRaceNode[];
  leaderboard: unknown;
}

/** `/api/race/all`: per heat, how many rounds have been saved. */
export interface ApiHeatRounds {
  id: number;
  rounds: number;
}

export interface Status {
  current_heat: number;
  num_nodes: number;
  race_status: number;
}

/** A heat as RotorHazard's `heat_data` event describes it, trimmed to what seeding needs. */
export interface HeatSlot {
  id: number;
  node_index: number | null;
  pilot_id: number;
  method: number;
}

export interface HeatData {
  id: number;
  name: string;
  displayname: string;
  class_id: number;
  slots: HeatSlot[];
}

/** RotorHazard's RaceStatus (RHRace.py). */
export const RACE = { READY: 0, RACING: 1, DONE: 2, STAGING: 3 } as const;

/** Slot method: a pilot assigned directly (RotorHazard's ProgramMethod.ASSIGN). */
const SLOT_ASSIGN = 0;

export class Rig {
  private socket: Socket | null = null;
  private readonly authHeader: string;

  constructor(
    readonly url: string,
    creds: Credentials
  ) {
    this.authHeader = 'Basic ' + Buffer.from(`${creds.user}:${creds.pass}`).toString('base64');
  }

  // ---- connection ---------------------------------------------------------------------

  async connect(): Promise<void> {
    const socket = io(this.url, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      extraHeaders: { Authorization: this.authHeader }
    });
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`rig: no socket to ${this.url}`)), 10_000);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }

  emit(event: string, data?: unknown): void {
    if (!this.socket) throw new Error('rig: not connected');
    if (data === undefined) this.socket.emit(event);
    else this.socket.emit(event, data);
  }

  /** Ask RotorHazard for one of its data events and return the payload. */
  async loadData<T>(type: string, timeoutMs = 10_000): Promise<T> {
    const socket = this.socket;
    if (!socket) throw new Error('rig: not connected');
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off(type, handler);
        reject(new Error(`rig: no ${type} within ${timeoutMs}ms`));
      }, timeoutMs);
      const handler = (payload: T) => {
        clearTimeout(timer);
        socket.off(type, handler);
        resolve(payload);
      };
      socket.on(type, handler);
      socket.emit('load_data', { load_types: [type] });
    });
  }

  // ---- readback -----------------------------------------------------------------------

  async api<T>(path: string): Promise<T> {
    const res = await fetch(this.url + path, { headers: { Authorization: this.authHeader } });
    if (!res.ok && res.status !== 201) throw new Error(`rig: ${path} → ${res.status}`);
    return (await res.json()) as T;
  }

  async pilots(): Promise<ApiPilot[]> {
    return (await this.api<{ pilots: ApiPilot[] }>('/api/pilot/all')).pilots;
  }

  async heats(): Promise<ApiHeat[]> {
    const { heats } = await this.api<{ heats: Record<string, ApiHeat> }>('/api/heat/all');
    return Object.values(heats);
  }

  async classes(): Promise<Array<{ id: number; name: string; format: number }>> {
    return (
      await this.api<{ classes: Array<{ id: number; name: string; format: number }> }>(
        '/api/class/all'
      )
    ).classes;
  }

  /** Saved rounds per heat. */
  async rounds(): Promise<ApiHeatRounds[]> {
    return (await this.api<{ races: { heats: ApiHeatRounds[] } }>('/api/race/all')).races.heats;
  }

  async race(heatId: number, round: number): Promise<ApiRace> {
    const { race } = await this.api<{ race: Omit<ApiRace, 'heat_id' | 'round_id'> }>(
      `/api/race/${heatId}/${round}`
    );
    return { ...race, heat_id: heatId, round_id: round };
  }

  async status(): Promise<Status> {
    return (await this.api<{ status: { state: Status } }>('/api/status')).status.state;
  }

  async heatData(): Promise<HeatData[]> {
    return (await this.loadData<{ heats: HeatData[] }>('heat_data')).heats;
  }

  /**
   * Poll until `fn` returns a truthy value and return it. The label names the write being
   * confirmed, so a timeout reads "rig: RotorHazard never showed: pilot E2E Ace".
   */
  async until<T>(
    label: string,
    fn: () => Promise<T | false | null | undefined>,
    timeoutMs = 10_000,
    everyMs = 150
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > deadline) throw new Error(`rig: RotorHazard never showed: ${label}`);
      await sleep(everyMs);
    }
  }

  // ---- database -----------------------------------------------------------------------

  /** `reset_database`: 'races' | 'heats' | 'classes' | 'pilots' | 'all' | 'formats'. */
  async reset(kind: 'races' | 'heats' | 'classes' | 'pilots' | 'all' = 'all'): Promise<void> {
    // A race in progress survives a reset and would confuse the next test.
    const st = await this.status();
    if (st.race_status === RACE.STAGING || st.race_status === RACE.RACING) await this.stop();
    if (st.race_status !== RACE.READY) await this.discard();
    this.emit('reset_database', { reset_type: kind, with_archive: false });
    await this.until(`reset ${kind}`, async () => {
      const [rounds, heats, pilots] = await Promise.all([
        this.rounds(),
        this.heats(),
        this.pilots()
      ]);
      if (rounds.some((h) => h.rounds > 0)) return false;
      if (kind !== 'races' && heats.length) return false;
      if ((kind === 'pilots' || kind === 'all') && pilots.length) return false;
      return true;
    });
  }

  // ---- seeding ------------------------------------------------------------------------

  async addPilot(fields: { callsign: string; name?: string; team?: string }): Promise<number> {
    const before = new Set((await this.pilots()).map((p) => p.id));
    this.emit('add_pilot');
    const pilot = await this.until('new pilot', async () =>
      (await this.pilots()).find((p) => !before.has(p.id))
    );
    this.emit('alter_pilot', {
      pilot_id: pilot.id,
      callsign: fields.callsign,
      name: fields.name ?? fields.callsign,
      ...(fields.team ? { team_name: fields.team } : {})
    });
    await this.until(`pilot ${fields.callsign}`, async () =>
      (await this.pilots()).some((p) => p.id === pilot.id && p.callsign === fields.callsign)
    );
    return pilot.id;
  }

  async addClass(fields: { name: string; formatId?: number; rounds?: number }): Promise<number> {
    const before = new Set((await this.classes()).map((c) => c.id));
    this.emit('add_race_class');
    const cls = await this.until('new class', async () =>
      (await this.classes()).find((c) => !before.has(c.id))
    );
    this.emit('alter_race_class', {
      class_id: cls.id,
      class_name: fields.name,
      ...(fields.formatId != null ? { class_format: fields.formatId } : {}),
      ...(fields.rounds != null ? { rounds: fields.rounds } : {})
    });
    await this.until(`class ${fields.name}`, async () =>
      (await this.classes()).some((c) => c.id === cls.id && c.name === fields.name)
    );
    return cls.id;
  }

  /**
   * A heat with `pilots[i]` on seat i (0-based node index); `null` leaves a seat empty.
   * Slot ids come from RotorHazard's `heat_data`, the only place that has them.
   */
  async addHeat(fields: {
    name?: string;
    classId?: number;
    pilots: Array<number | null>;
  }): Promise<number> {
    const before = new Set((await this.heats()).map((h) => h.heat_id));
    this.emit('add_heat', fields.classId != null ? { class: fields.classId } : {});
    const heat = await this.until('new heat', async () =>
      (await this.heats()).find((h) => !before.has(h.heat_id))
    );
    if (fields.name) {
      this.emit('alter_heat', { heat: heat.heat_id, name: fields.name });
      await this.until(`heat ${fields.name}`, async () =>
        (await this.heats()).some(
          (h) => h.heat_id === heat.heat_id && h.displayname === fields.name
        )
      );
    }
    const data = (await this.heatData()).find((h) => h.id === heat.heat_id);
    if (!data) throw new Error(`rig: heat ${heat.heat_id} missing from heat_data`);
    for (const [seat, pilotId] of fields.pilots.entries()) {
      if (pilotId == null) continue;
      const slot = data.slots.find((s) => s.node_index === seat);
      if (!slot) throw new Error(`rig: heat ${heat.heat_id} has no slot for seat ${seat}`);
      this.emit('alter_heat', {
        heat: heat.heat_id,
        slot_id: slot.id,
        pilot: pilotId,
        method: SLOT_ASSIGN
      });
      await this.until(`seat ${seat + 1} = pilot ${pilotId}`, async () =>
        (await this.heats()).some(
          (h) => h.heat_id === heat.heat_id && h.nodes_pilots[String(seat)] === pilotId
        )
      );
    }
    return heat.heat_id;
  }

  /** Minimum lap time in seconds, and whether short laps are kept (highlight) or discarded. */
  async setMinLap(seconds: number, behavior: 'highlight' | 'discard' = 'highlight'): Promise<void> {
    this.emit('set_min_lap', { min_lap: seconds });
    this.emit('set_min_lap_behavior', { min_lap_behavior: behavior === 'discard' ? 1 : 0 });
  }

  // ---- the race loop ------------------------------------------------------------------

  async setHeat(heatId: number): Promise<void> {
    this.emit('set_current_heat', { heat: heatId });
    await this.until(
      `current heat ${heatId}`,
      async () => (await this.status()).current_heat === heatId
    );
  }

  /** Stage the race and wait until RotorHazard has actually started it (staging delay included). */
  async start(timeoutMs = 30_000): Promise<void> {
    this.emit('stage_race');
    await this.until('staging', async () => (await this.status()).race_status !== RACE.READY);
    await this.until(
      'racing',
      async () => (await this.status()).race_status === RACE.RACING,
      timeoutMs
    );
  }

  /** One gate pass on a seat (0-based), as RotorHazard's own debug control does. */
  lap(seat: number): void {
    this.emit('simulate_lap', { node: seat });
  }

  /**
   * Run a scripted race: `passes[seat]` is a list of gate-pass times in ms from the start.
   * The first pass is the hole shot (lap 0); every later one is a counted lap.
   */
  async fly(passes: Record<number, number[]>): Promise<void> {
    const events = Object.entries(passes)
      .flatMap(([seat, times]) => times.map((at) => ({ seat: Number(seat), at })))
      .sort((a, b) => a.at - b.at);
    const t0 = Date.now();
    for (const ev of events) {
      const wait = t0 + ev.at - Date.now();
      if (wait > 0) await sleep(wait);
      this.lap(ev.seat);
    }
  }

  async stop(): Promise<void> {
    this.emit('stop_race');
    await this.until('stopped', async () => {
      const s = (await this.status()).race_status;
      return s === RACE.DONE || s === RACE.READY;
    });
  }

  /** Save the race; resolves with the saved race once RotorHazard lists a new round for the heat. */
  async save(): Promise<ApiRace> {
    const heatId = (await this.status()).current_heat;
    const before = (await this.rounds()).find((h) => h.id === heatId)?.rounds ?? 0;
    this.emit('save_laps');
    const round = await this.until('saved race', async () => {
      const st = await this.status();
      if (st.race_status !== RACE.READY) return false;
      const now = (await this.rounds()).find((h) => h.id === heatId)?.rounds ?? 0;
      return now > before ? now : false;
    });
    return this.race(heatId, round);
  }

  async discard(): Promise<void> {
    this.emit('discard_laps');
    await this.until('discarded', async () => (await this.status()).race_status === RACE.READY);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
