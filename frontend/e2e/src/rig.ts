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
  seed_id?: number | null;
  seed_rank?: number | null;
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

  /** Resolve on the next broadcast of `event` (RotorHazard emits data events after writes). */
  next<T = unknown>(event: string, timeoutMs = 10_000): Promise<T> {
    const socket = this.socket;
    if (!socket) throw new Error('rig: not connected');
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off(event, handler);
        reject(new Error(`rig: no ${event} within ${timeoutMs}ms`));
      }, timeoutMs);
      const handler = (payload: T) => {
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(payload);
      };
      socket.on(event, handler);
    });
  }

  // ---- readback -----------------------------------------------------------------------

  async api<T>(path: string): Promise<T> {
    // RotorHazard answers 500 for a moment while it rebuilds results after a change or a
    // restart (calc_leaderboard in flight); ask again before giving up.
    let res = await fetch(this.url + path, { headers: { Authorization: this.authHeader } });
    for (let attempt = 0; res.status >= 500 && attempt < 8; attempt++) {
      await sleep(500);
      res = await fetch(this.url + path, { headers: { Authorization: this.authHeader } });
    }
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

  /** Seat frequencies of the active profile, from RotorHazard's `frequency_data`. */
  async frequencies(): Promise<
    Array<{ band: string | null; channel: number | null; frequency: number }>
  > {
    return (
      await this.loadData<{
        fdata: Array<{ band: string | null; channel: number | null; frequency: number }>;
      }>('frequency_data')
    ).fdata;
  }

  /** Set one seat's frequency on the active profile (0 = Off), confirmed through `frequency_data`. */
  async setFrequency(seat: number, frequency: number): Promise<void> {
    this.emit('set_frequency', { node: seat, frequency, band: null, channel: null });
    await this.until(`seat ${seat + 1} = ${frequency}`, async () => {
      const f = await this.frequencies();
      return f[seat]?.frequency === frequency;
    });
  }

  /** RotorHazard's "send message" (its Run page's Director tools): a `priority_message` broadcast. */
  async sendMessage(message: string, interrupt = false): Promise<void> {
    const seen = this.next<{ message: string }>('priority_message', 10_000);
    this.emit('broadcast_message', { message, interrupt });
    await seen;
  }

  async options(): Promise<Record<string, string | null>> {
    return (await this.api<{ options: Record<string, string | null> }>('/api/options')).options;
  }

  async formats(): Promise<Array<{ id: number; name: string }>> {
    return (await this.api<{ formats: Array<{ id: number; name: string }> }>('/api/format/all'))
      .formats;
  }

  /** Set one of RotorHazard's options (`set_option`) and wait until the API shows it. */
  async setOption(option: string, value: string): Promise<void> {
    this.emit('set_option', { option, value });
    await this.until(
      `option ${option} = ${value}`,
      async () => (await this.options())[option] === value
    );
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
    if (kind === 'all') {
      // Formats and options survive 'all'; a spec must not inherit the last run's.
      await this.resetFormats();
      await this.setOption('eventName', 'E2E event');
      await this.setLapOptions({ minLap: 10, behavior: 0, minFirstCrossing: 0, consecutives: 3 });
    }
  }

  /**
   * `reset_database formats`: back to RotorHazard's defaults. The ids are reissued from 1,
   * so they are no readback; RotorHazard broadcasts `format_data` when the reset is done.
   */
  async resetFormats(): Promise<void> {
    const done = this.next('format_data');
    this.emit('reset_database', { reset_type: 'formats', with_archive: false });
    await done;
    await this.until('default formats', async () => {
      const now = await this.formats();
      return now.length > 0 && !now.some((f) => /E2E|\(copy\)/.test(f.name));
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

  async addClass(fields: {
    name: string;
    formatId?: number;
    rounds?: number;
    /** RotorHazard's HeatAdvanceType: 0 none, 1 next heat, 2 next round. */
    heatAdvanceType?: number;
    /** RotorHazard's RoundType: 0 races per heat, 1 grouped. */
    roundType?: number;
  }): Promise<number> {
    const before = new Set((await this.classes()).map((c) => c.id));
    this.emit('add_race_class');
    const cls = await this.until('new class', async () =>
      (await this.classes()).find((c) => !before.has(c.id))
    );
    this.emit('alter_race_class', {
      class_id: cls.id,
      class_name: fields.name,
      ...(fields.formatId != null ? { class_format: fields.formatId } : {}),
      ...(fields.rounds != null ? { rounds: fields.rounds } : {}),
      ...(fields.heatAdvanceType != null ? { heat_advance_type: fields.heatAdvanceType } : {}),
      ...(fields.roundType != null ? { round_type: fields.roundType } : {})
    });
    await this.until(`class ${fields.name}`, async () =>
      (await this.classes()).some((c) => c.id === cls.id && c.name === fields.name)
    );
    return cls.id;
  }

  /**
   * Change a class's round type and/or heat advance, one field per alter_race_class as
   * RotorHazard's own panel sends them. RotorHazard 4.4.0 raises (raceclass_prime_groups
   * IndexError) on `rounds` for a grouped class with no heats, and switching to grouped
   * turns heat advance "none" into "next heat", so: add heats, then the round type, then
   * the advance.
   */
  async alterClass(
    classId: number,
    fields: { roundType?: number; heatAdvanceType?: number }
  ): Promise<void> {
    const find = async () => (await this.classData()).find((c) => c.id === classId);
    if (fields.roundType != null) {
      this.emit('alter_race_class', { class_id: classId, round_type: fields.roundType });
      await this.until(`class ${classId} round type ${fields.roundType}`, async () => {
        const c = await find();
        return c != null && Number(c.round_type) === fields.roundType;
      });
    }
    if (fields.heatAdvanceType != null) {
      this.emit('alter_race_class', {
        class_id: classId,
        heat_advance_type: fields.heatAdvanceType
      });
      await this.until(`class ${classId} heat advance ${fields.heatAdvanceType}`, async () => {
        const c = (await find()) as { heat_advance_type?: number } | undefined;
        return c != null && Number(c.heat_advance_type) === fields.heatAdvanceType;
      });
    }
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
    await this.seatHeat(heat.heat_id, fields.pilots);
    return heat.heat_id;
  }

  /** Put `pilots[i]` on seat i of an existing heat (`null` leaves the seat as it is). */
  async seatHeat(heatId: number, pilots: Array<number | null>): Promise<void> {
    const data = (await this.heatData()).find((h) => h.id === heatId);
    if (!data) throw new Error(`rig: heat ${heatId} missing from heat_data`);
    for (const [seat, pilotId] of pilots.entries()) {
      if (pilotId == null) continue;
      const slot = data.slots.find((s) => s.node_index === seat);
      if (!slot) throw new Error(`rig: heat ${heatId} has no slot for seat ${seat}`);
      this.emit('alter_heat', {
        heat: heatId,
        slot_id: slot.id,
        pilot: pilotId,
        method: SLOT_ASSIGN
      });
      await this.until(`seat ${seat + 1} = pilot ${pilotId}`, async () =>
        (await this.heats()).some(
          (h) => h.heat_id === heatId && h.nodes_pilots[String(seat)] === pilotId
        )
      );
    }
  }

  /** Seed seat `seat` of a heat from another heat's result (method 1, rank `rank`). */
  async seedSeatFromHeat(
    heatId: number,
    seat: number,
    fromHeat: number,
    rank: number
  ): Promise<void> {
    const data = (await this.heatData()).find((h) => h.id === heatId);
    const slot = data?.slots.find((s) => s.node_index === seat);
    if (!slot) throw new Error(`rig: heat ${heatId} has no slot for seat ${seat}`);
    this.emit('alter_heat', {
      heat: heatId,
      slot_id: slot.id,
      method: 1,
      seed_heat_id: fromHeat,
      seed_rank: rank
    });
    await this.until(`seat ${seat + 1} seeded`, async () => {
      const h = (await this.heatData()).find((x) => x.id === heatId);
      const sl = h?.slots.find((x) => x.id === slot.id);
      return sl?.method === 1 && Number(sl.seed_id) === fromHeat && Number(sl.seed_rank) === rank;
    });
  }

  /** RotorHazard's class_data message: classes with their plugin attributes. */
  async classData(): Promise<Array<Record<string, unknown> & { id: number }>> {
    return (
      await this.loadData<{ classes: Array<Record<string, unknown> & { id: number }> }>(
        'class_data'
      )
    ).classes;
  }

  /** RotorHazard's result_data message: each class's ranking as its rank method built it. */
  async classRanking(
    classId: number
  ): Promise<Array<{ callsign: string; position: number | null }>> {
    const data = await this.loadData<{
      classes?: Record<
        string,
        { ranking?: { ranking?: Array<{ callsign: string; position: number | null }> } }
      >;
    }>('result_data');
    return data.classes?.[String(classId)]?.ranking?.ranking ?? [];
  }

  /** Minimum lap time in seconds, and whether short laps are kept (highlight) or discarded. */
  async setMinLap(seconds: number, behavior: 'highlight' | 'discard' = 'highlight'): Promise<void> {
    await this.setLapOptions({ minLap: seconds, behavior: behavior === 'discard' ? 1 : 0 });
  }

  /**
   * RotorHazard's lap-detection options, read back from the `min_lap` message (MinLapBehavior
   * is server config, not an option, so /api/options cannot show it) and from /api/options
   * for the consecutive base.
   */
  async setLapOptions(o: {
    minLap?: number;
    behavior?: number;
    minFirstCrossing?: number;
    consecutives?: number;
  }): Promise<void> {
    if (o.minLap !== undefined) this.emit('set_min_lap', { min_lap: o.minLap });
    if (o.behavior !== undefined)
      this.emit('set_min_lap_behavior', { min_lap_behavior: o.behavior });
    if (o.minFirstCrossing !== undefined)
      this.emit('set_min_first_crossing', { min_first_crossing: o.minFirstCrossing });
    if (o.consecutives !== undefined)
      this.emit('set_consecutives_count', { count: o.consecutives });
    await this.until('lap options', async () => {
      const m = await this.minLap();
      if (o.minLap !== undefined && Number(m.min_lap) !== o.minLap) return false;
      if (o.behavior !== undefined && Number(m.min_lap_behavior) !== o.behavior) return false;
      if (o.minFirstCrossing !== undefined && Number(m.min_first_crossing) !== o.minFirstCrossing)
        return false;
      if (o.consecutives !== undefined) {
        const opts = await this.options();
        if (Number(opts.consecutivesCount ?? 3) !== o.consecutives) return false;
      }
      return true;
    });
  }

  /** The `min_lap` message: RotorHazard's answer to `load_data min_lap`. */
  async minLap(): Promise<{
    min_lap: number;
    min_lap_behavior: number;
    min_first_crossing: number;
  }> {
    return this.loadData('min_lap');
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

  /** Load a heat, run it with these passes (seat index → ms after start), stop and save. */
  async raceHeat(heatId: number, passes: Record<number, number[]>): Promise<ApiRace> {
    await this.setHeat(heatId);
    await this.start();
    await this.fly(passes);
    await this.stop();
    return this.save();
  }

  // ---- the plugin's round management (#36), driven from the socket ------------------------

  async deletedRaces(): Promise<Array<{ id: string; heat_id: number; round_id: number }>> {
    const done = this.next<{ races: Array<{ id: string; heat_id: number; round_id: number }> }>(
      'gridfpv_races_deleted'
    );
    this.emit('gridfpv_races_deleted_get');
    return (await done).races;
  }

  /** Delete a saved race through the plugin; resolves with the backup file it reported. */
  async deleteRace(heatId: number, round: number): Promise<string | null> {
    const done = this.next<{ backup?: string | null }>('gridfpv_races_deleted');
    this.emit('gridfpv_race_delete', { heat_id: heatId, round_id: round });
    const p = await done;
    await this.until('race deleted', async () =>
      (await this.deletedRaces()).some((d) => d.heat_id === heatId && d.round_id === round)
    );
    return p.backup ?? null;
  }

  /** Ask the plugin to restore and return RotorHazard's refusal message, or null if it went through. */
  async restoreRaceRefusal(id: string): Promise<string | null> {
    const alert = this.next<{ message?: string }>('priority_message', 5000).catch(() => null);
    const answer = this.next<{ changed?: unknown }>('gridfpv_races_deleted', 5000).catch(
      () => null
    );
    this.emit('gridfpv_race_restore', { id });
    const [a, b] = await Promise.all([alert, answer]);
    if (a?.message) return String(a.message);
    return b?.changed ? null : 'no answer';
  }

  async restoreRace(id: string): Promise<void> {
    const done = this.next('gridfpv_races_deleted');
    this.emit('gridfpv_race_restore', { id });
    await done;
    await this.until(
      'race restored',
      async () => !(await this.deletedRaces()).some((d) => d.id === id)
    );
  }

  /** RotorHazard's archives (db_bkp), as its backups_list message reports them. */
  async backups(): Promise<string[]> {
    const p = await this.loadData<{ backup_files: string[] | null }>('backups_list');
    return p.backup_files ?? [];
  }

  /** The plugin's teams, as it lists them. */
  async teams(): Promise<Array<{ id: string; name: string }>> {
    const done = this.next<{ teams: Array<{ id: string; name: string }> }>('gridfpv_teams');
    this.emit('gridfpv_teams_get');
    return (await done).teams;
  }

  /** The plugin's roster (#14), as it lists it. */
  async roster(): Promise<Array<{ id: string; callsign: string; in_event: boolean }>> {
    const done = this.next<{ pilots: Array<{ id: string; callsign: string; in_event: boolean }> }>(
      'gridfpv_roster'
    );
    this.emit('gridfpv_roster_get');
    return (await done).pilots;
  }

  /** Forget every roster entry whose callsign matches, so a spec leaves the roster as it found it. */
  async rosterForget(callsign: RegExp): Promise<void> {
    for (const p of await this.roster()) {
      if (!callsign.test(p.callsign)) continue;
      const done = this.next('gridfpv_roster');
      this.emit('gridfpv_roster_remove', { id: p.id });
      await done;
    }
  }

  /** Delete an archive (RotorHazard's delete_database), so a spec leaves db_bkp as it found it. */
  async deleteBackup(file: string): Promise<void> {
    this.emit('delete_database', { backup_file: file });
    await this.until(`archive ${file} deleted`, async () => !(await this.backups()).includes(file));
  }

  /** Dev rig only: make RotorHazard's backup folder unusable, or put it back (gridfpv_mock). */
  async blockBackups(block: boolean): Promise<void> {
    const done = this.next<{ action?: string; ok?: boolean; error?: string }>('gridfpv_mock_ack');
    this.emit('gridfpv_mock_block_backups', { block });
    const ack = await done;
    if (ack.ok === false) throw new Error(`rig: block backups failed: ${ack.error}`);
  }

  /** A seat's enter/exit thresholds (set_enter_at_level / set_exit_at_level), read back. */
  async setSeatLevels(seat: number, enter: number, exit: number): Promise<void> {
    this.emit('set_enter_at_level', { node: seat, enter_at_level: enter });
    this.emit('set_exit_at_level', { node: seat, exit_at_level: exit });
    await this.until(`seat ${seat + 1} levels ${enter}/${exit}`, async () => {
      const p = await this.loadData<{ enter_at_levels: number[]; exit_at_levels: number[] }>(
        'enter_and_exit_at_levels'
      );
      return p.enter_at_levels[seat] === enter && p.exit_at_levels[seat] === exit;
    });
  }

  /** RotorHazard's callouts (reload_callouts → callouts). */
  async callouts(): Promise<string[]> {
    const p = this.next<string[]>('callouts', 5_000).catch(() => [] as string[]);
    this.emit('reload_callouts');
    return p;
  }

  /** RotorHazard's scheduled start (get_race_scheduled → race_scheduled). */
  async raceScheduled(): Promise<{ scheduled: boolean; scheduled_at: number | null }> {
    const p = this.next<{ scheduled: boolean; scheduled_at: number | null }>('race_scheduled');
    this.emit('get_race_scheduled');
    return p;
  }

  /** Exceptions RotorHazard has logged since it started (the mock plugin counts logger.exception). */
  async exceptions(): Promise<number> {
    const done = this.next<{ action?: string; ok?: boolean; count?: number; error?: string }>(
      'gridfpv_mock_ack'
    );
    this.emit('gridfpv_mock_exceptions');
    const ack = await done;
    if (ack.ok === false) throw new Error(`rig: exceptions failed: ${ack.error}`);
    return Number(ack.count ?? 0);
  }

  async deleteHeat(heatId: number): Promise<void> {
    this.emit('delete_heat', { heat: heatId });
    await this.until(`heat ${heatId} gone`, async () =>
      (await this.heats()).every((h) => h.heat_id !== heatId)
    );
  }

  /** HTTP status of a JSON API path (RotorHazard answers 500 for a round that does not exist). */
  async apiStatus(path: string): Promise<number> {
    const res = await fetch(this.url + path, { headers: { Authorization: this.authHeader } });
    return res.status;
  }

  async discard(): Promise<void> {
    this.emit('discard_laps');
    await this.until('discarded', async () => (await this.status()).race_status === RACE.READY);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
