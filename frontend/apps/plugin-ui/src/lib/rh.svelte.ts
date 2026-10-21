/**
 * The socket.io connection to RotorHazard, as Svelte 5 runes state, plus every write the
 * UI makes. One rule for writes, learned the hard way on GridFPV: **RotorHazard does not
 * ack a socket emit and a handler that raises aborts silently**, so every write here is
 * followed by a readback — we re-request the data and resolve only when the state shows
 * what we sent, or report the mismatch.
 *
 * The SPA is served from inside RotorHazard, so the socket goes to the same origin (in
 * `make dev`, Vite proxies `/socket.io` to the rig).
 */
import { io, type Socket } from 'socket.io-client';
import {
  applyCrossingChange,
  applyFrequencyData,
  applyHeartbeat,
  applyLevels,
  applyNodeData,
  applyNodeTuning,
  type Profiles,
  type Seat
} from './seats.js';
import type { Crossing } from './crossings.js';
import { fromWire, type Preset, type PresetSeat, type WirePreset } from './presets.js';
import {
  applyClassData,
  applyFormatData,
  applyHeatData,
  applyPilotData,
  emptySetup,
  HEAT_STATUS,
  SLOT_METHOD,
  type Setup
} from './setup.js';
import { applyResultData, emptyResults, type Results } from './results.js';

export type HelloAck = {
  plugin_version: string;
  rhapi_version: string;
  rh_version: string | null;
  seat_count: number;
  redirect_home: boolean;
  capture: CaptureSummary | null;
};

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export type CaptureSummary = {
  seat: number;
  state: 'recording' | 'done';
  samples: number;
  seconds: number;
};

/** A firmware-detected crossing recorded during capture (exit null while open). */
export type FirmwareCrossing = { enter: number | null; exit: number | null; peak: number | null };

export type Capture = CaptureSummary & {
  /** RotorHazard's history extrema (peak/nadir per node read), backdated and unordered. */
  times: number[];
  values: number[];
  /** Current RSSI sampled at a steady rate: the drawn trace. */
  sampleTimes: number[];
  sampleValues: number[];
  crossings: FirmwareCrossing[];
  /** The seat's thresholds when the capture ended, if the plugin knew them. */
  enter?: number | null;
  exit?: number | null;
  frequency?: number | null;
};

export type WriteResult = { ok: boolean; message?: string };

const READBACK_MS = 2500;

let socket: Socket | null = null;

const state = $state({
  connection: 'connecting' as ConnectionState,
  hello: null as HelloAck | null,
  seats: [] as Seat[],
  profiles: { list: [], currentId: null, name: '', description: '' } as Profiles,
  capture: null as Capture | null,
  /** Custom channel presets the plugin keeps in RotorHazard's database. */
  presets: [] as Preset[],
  /** Pilots, classes, heats, formats — RotorHazard's setup entities. */
  setup: emptySetup() as Setup,
  /** Saved races and class standings (RotorHazard's result_data). */
  results: emptyResults() as Results,
  /** Class ranking methods RotorHazard offers (its own plus plugins'), by name. */
  rankMethods: [] as Array<{ name: string; label: string }>,
  /** Race points methods (for a format), by name. */
  pointsMethods: [] as Array<{ name: string; label: string }>,
  /** Teams the plugin keeps; the names are what RotorHazard stores on a pilot. */
  teams: [] as Team[],
  /** The event: RotorHazard's name/description options plus the plugin's details. */
  event: { name: '', description: '', date: '', venue: '', organizer: '', notes: '' } as EventInfo,
  /** RotorHazard's database backups (file names), newest last as RotorHazard lists them. */
  archives: [] as string[]
});

export type EventInfo = {
  name: string;
  description: string;
  date: string;
  venue: string;
  organizer: string;
  notes: string;
};
/** Set by RotorHazard's one-shot acks (reset_confirm, database_restore_done). */
let resetAcks = 0;
let restoreAcks = 0;

export type Team = { id: string; name: string; description: string };

/** Read-only view of the connection and timer state for screens. */
export function rh() {
  return state;
}

// ---- readback waiters -----------------------------------------------------------

type Waiter = {
  pred: () => boolean;
  resolve: (r: WriteResult) => void;
  timer: number;
  what: string;
};
const waiters: Waiter[] = [];

function checkWaiters() {
  for (let i = waiters.length - 1; i >= 0; i--) {
    const w = waiters[i];
    if (w.pred()) {
      clearTimeout(w.timer);
      waiters.splice(i, 1);
      w.resolve({ ok: true });
    }
  }
}

/** Resolve once `pred` holds (checked after every incoming update), or fail after a timeout. */
function awaitState(what: string, pred: () => boolean): Promise<WriteResult> {
  if (pred()) return Promise.resolve({ ok: true });
  return new Promise((resolve) => {
    const w: Waiter = {
      what,
      pred,
      resolve,
      timer: window.setTimeout(() => {
        const idx = waiters.indexOf(w);
        if (idx >= 0) waiters.splice(idx, 1);
        resolve({ ok: false, message: `${what}: RotorHazard did not confirm the change` });
      }, READBACK_MS)
    };
    waiters.push(w);
  });
}

function loadData(...types: string[]) {
  socket?.emit('load_data', { load_types: types });
}

/** After a reset or restore every list may have changed; ask for all of it again. */
function reloadEverything() {
  loadData(
    'frequency_data',
    'enter_and_exit_at_levels',
    'node_tuning',
    'node_data',
    'pilot_data',
    'class_data',
    'heat_data',
    'format_data',
    'result_data',
    'raceclass_rank_method_list',
    'race_points_method_list'
  );
  socket?.emit('gridfpv_presets_get');
  socket?.emit('gridfpv_teams_get');
  socket?.emit('gridfpv_event_get');
  socket?.emit('list_backups');
}

// ---- connection -----------------------------------------------------------------

/** Open the socket once; safe to call again (returns the existing one). */
export function connect(): Socket {
  if (socket) return socket;
  socket = io({ transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    state.connection = 'connected';
    socket?.emit('gridfpv_hello', { client: 'plugin-ui' });
    loadData(
      'frequency_data',
      'enter_and_exit_at_levels',
      'node_tuning',
      'node_data',
      'pilot_data',
      'class_data',
      'heat_data',
      'format_data',
      'result_data',
      'raceclass_rank_method_list',
      'race_points_method_list'
    );
    socket?.emit('gridfpv_capture_get');
    socket?.emit('gridfpv_presets_get');
    socket?.emit('gridfpv_teams_get');
    socket?.emit('gridfpv_event_get');
    socket?.emit('list_backups');
  });
  socket.on('disconnect', () => {
    state.connection = 'disconnected';
    state.hello = null;
  });
  socket.on('gridfpv_hello_ack', (ack: HelloAck) => {
    state.hello = ack;
  });

  // RotorHazard's own data events (RHUI.py). Each is applied by a pure reducer.
  socket.on('frequency_data', (p: { fdata: Parameters<typeof applyFrequencyData>[1] }) => {
    state.seats = applyFrequencyData(state.seats, p.fdata ?? []);
    checkWaiters();
  });
  socket.on('enter_and_exit_at_levels', (p: Parameters<typeof applyLevels>[1]) => {
    state.seats = applyLevels(state.seats, p);
    checkWaiters();
  });
  socket.on('heartbeat', (p: Parameters<typeof applyHeartbeat>[1]) => {
    state.seats = applyHeartbeat(state.seats, p);
    checkWaiters();
  });
  socket.on('node_data', (p: Parameters<typeof applyNodeData>[1]) => {
    state.seats = applyNodeData(state.seats, p);
  });
  socket.on('node_crossing_change', (p: Parameters<typeof applyCrossingChange>[1]) => {
    state.seats = applyCrossingChange(state.seats, p);
  });
  socket.on('node_tuning', (p: Parameters<typeof applyNodeTuning>[0]) => {
    state.profiles = applyNodeTuning(p);
    checkWaiters();
  });

  // RotorHazard's setup entities. Each is the whole list; RotorHazard broadcasts after any
  // change it makes, and we also re-request after our own writes.
  socket.on('pilot_data', (p: Parameters<typeof applyPilotData>[1]) => {
    state.setup = applyPilotData(state.setup, p);
    checkWaiters();
  });
  socket.on('heat_data', (p: Parameters<typeof applyHeatData>[1]) => {
    state.setup = applyHeatData(state.setup, p);
    checkWaiters();
  });
  socket.on('class_data', (p: Parameters<typeof applyClassData>[1]) => {
    state.setup = applyClassData(state.setup, p);
    checkWaiters();
  });
  socket.on('format_data', (p: Parameters<typeof applyFormatData>[1]) => {
    state.setup = applyFormatData(state.setup, p);
    checkWaiters();
  });
  socket.on('result_data', (p: Parameters<typeof applyResultData>[0]) => {
    state.results = applyResultData(p);
    checkWaiters();
  });
  socket.on(
    'raceclass_rank_method_list',
    (p: { methods: Array<{ name: string; label: string }> }) => {
      state.rankMethods = (p.methods ?? []).map((m) => ({ name: m.name, label: m.label }));
    }
  );

  socket.on('race_points_method_list', (p: { methods: Array<{ name: string; label: string }> }) => {
    state.pointsMethods = (p.methods ?? []).map((m) => ({ name: m.name, label: m.label }));
  });

  socket.on('gridfpv_event', (p: Partial<EventInfo>) => {
    state.event = {
      name: p.name ?? '',
      description: p.description ?? '',
      date: p.date ?? '',
      venue: p.venue ?? '',
      organizer: p.organizer ?? '',
      notes: p.notes ?? ''
    };
    checkWaiters();
  });
  socket.on('backups_list', (p: { backup_files: string[] | null }) => {
    state.archives = p.backup_files ?? [];
    checkWaiters();
  });
  // RotorHazard's own acks for the two whole-database operations.
  socket.on('reset_confirm', () => {
    resetAcks++;
    reloadEverything();
    checkWaiters();
  });
  socket.on('database_restore_done', () => {
    restoreAcks++;
    reloadEverything();
    checkWaiters();
  });

  socket.on('gridfpv_teams', (p: { teams: Team[] }) => {
    state.teams = (p.teams ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description ?? ''
    }));
    checkWaiters();
  });

  socket.on('gridfpv_presets', (p: { presets: WirePreset[] }) => {
    state.presets = (p.presets ?? []).map(fromWire);
    checkWaiters();
  });

  // The plugin's capture channel.
  socket.on('gridfpv_capture', (p: Capture | { state: 'none' }) => {
    if (p.state === 'none') {
      state.capture = null;
      return;
    }
    const full = p as Capture & { sample_times?: number[]; sample_values?: number[] };
    state.capture = {
      ...full,
      times: full.times ?? [],
      values: full.values ?? [],
      sampleTimes: full.sample_times ?? [],
      sampleValues: full.sample_values ?? [],
      crossings: full.crossings ?? []
    };
    checkWaiters();
  });
  socket.on(
    'gridfpv_capture_chunk',
    (p: {
      seat: number;
      times: number[];
      values: number[];
      sample_times?: number[];
      sample_values?: number[];
      samples: number;
      seconds: number;
    }) => {
      const cap = state.capture;
      if (!cap || cap.seat !== p.seat || cap.state !== 'recording') return;
      cap.times.push(...p.times);
      cap.values.push(...p.values);
      cap.sampleTimes.push(...(p.sample_times ?? []));
      cap.sampleValues.push(...(p.sample_values ?? []));
      cap.samples = p.samples;
      cap.seconds = p.seconds;
    }
  );

  return socket;
}

// ---- writes (each with readback) ------------------------------------------------

/** Set a seat's channel in the active profile. `frequency` 0 turns the seat off. */
export function setChannel(
  seat: number,
  band: string | null,
  channel: number | null,
  frequency: number
): Promise<WriteResult> {
  socket?.emit('set_frequency', { node: seat, band, channel, frequency });
  window.setTimeout(() => loadData('frequency_data'), 150);
  return awaitState(`Seat ${seat + 1} channel`, () => state.seats[seat]?.frequency === frequency);
}

/** Set a seat's enter and exit levels in the active profile. */
export async function setLevels(seat: number, enter: number, exit: number): Promise<WriteResult> {
  // RotorHazard treats 0 as "take the node's current value", so a real 0 is not settable.
  socket?.emit('set_enter_at_level', { node: seat, enter_at_level: enter });
  socket?.emit('set_exit_at_level', { node: seat, exit_at_level: exit });
  window.setTimeout(() => loadData('enter_and_exit_at_levels'), 200);
  return awaitState(
    `Seat ${seat + 1} thresholds`,
    () => state.seats[seat]?.enter === enter && state.seats[seat]?.exit === exit
  );
}

/** Make a profile the active one; RotorHazard re-tunes every seat from it. */
export function setProfile(id: number): Promise<WriteResult> {
  socket?.emit('set_profile', { profile: id });
  window.setTimeout(
    () => loadData('node_tuning', 'frequency_data', 'enter_and_exit_at_levels'),
    200
  );
  return awaitState('Profile switch', () => state.profiles.currentId === id);
}

/** RotorHazard's "add" duplicates the active profile and switches to the copy. */
export function addProfile(): Promise<WriteResult> {
  const before = state.profiles.list.length;
  socket?.emit('add_profile');
  window.setTimeout(() => loadData('node_tuning'), 300);
  return awaitState('New profile', () => state.profiles.list.length > before);
}

/** Rename / describe the active profile. */
export function alterProfile(name: string, description: string): Promise<WriteResult> {
  socket?.emit('alter_profile', { profile_name: name, profile_description: description });
  window.setTimeout(() => loadData('node_tuning'), 200);
  return awaitState(
    'Profile rename',
    () => state.profiles.name === name && state.profiles.description === description
  );
}

/** Delete the active profile (RotorHazard falls back to its first one). */
export function deleteProfile(): Promise<WriteResult> {
  const id = state.profiles.currentId;
  socket?.emit('delete_profile');
  window.setTimeout(
    () => loadData('node_tuning', 'frequency_data', 'enter_and_exit_at_levels'),
    300
  );
  return awaitState('Delete profile', () => state.profiles.currentId !== id);
}

// ---- capture --------------------------------------------------------------------

export function captureStart(seat: number): Promise<WriteResult> {
  socket?.emit('gridfpv_capture_start', { seat });
  return awaitState(
    'Capture start',
    () => state.capture?.seat === seat && state.capture?.state === 'recording'
  );
}

export function captureStop(): Promise<WriteResult> {
  socket?.emit('gridfpv_capture_stop');
  return awaitState('Capture stop', () => state.capture?.state === 'done');
}

/** Crossings the firmware saw during a capture, as the trace component draws them. */
export function firmwareCrossings(cap: Capture): Crossing[] {
  return cap.crossings
    .filter((c) => c.enter != null)
    .map((c) => ({
      start: c.enter as number,
      end:
        c.exit ??
        cap.sampleTimes[cap.sampleTimes.length - 1] ??
        cap.times[cap.times.length - 1] ??
        (c.enter as number),
      at: c.exit != null ? ((c.enter as number) + c.exit) / 2 : (c.enter as number),
      peak: c.peak ?? 0,
      open: c.exit == null
    }));
}

// ---- custom presets (stored by the plugin) --------------------------------------

/** Save the given layout as a custom preset; a same-named preset is replaced. */
export function savePreset(name: string, seats: PresetSeat[]): Promise<WriteResult> {
  socket?.emit('gridfpv_presets_save', { name, seats });
  const before = state.presets.find((p) => p.name.toLowerCase() === name.toLowerCase())?.id;
  return awaitState('Save preset', () => {
    const now = state.presets.find((p) => p.name.toLowerCase() === name.toLowerCase());
    return !!now && now.id !== before;
  });
}

export function deletePreset(id: string): Promise<WriteResult> {
  socket?.emit('gridfpv_presets_delete', { id });
  return awaitState('Delete preset', () => !state.presets.some((p) => p.id === id));
}

// ---- pilots -----------------------------------------------------------------------

/** RotorHazard adds a blank pilot; resolves with the new pilot's id. */
export async function addPilot(): Promise<WriteResult & { id?: number }> {
  const before = new Set(state.setup.pilots.map((p) => p.id));
  socket?.emit('add_pilot');
  window.setTimeout(() => loadData('pilot_data'), 200);
  const r = await awaitState('New pilot', () => state.setup.pilots.some((p) => !before.has(p.id)));
  const added = state.setup.pilots.find((p) => !before.has(p.id));
  // RotorHazard gives every new pilot team "A" by default; a new pilot starts with no team
  // here, so the only teams on pilots are ones the director chose.
  if (r.ok && added && added.team) {
    const cleared = await alterPilot(added.id, { team: '' });
    if (!cleared.ok) return { ...cleared, id: added.id };
  }
  return { ...r, id: added?.id };
}

export type PilotFields = {
  callsign?: string;
  name?: string;
  phonetic?: string;
  team?: string;
  color?: string;
};

/** Change a pilot's own fields (RHData.alter_pilot: callsign, name, phonetic, team_name, color). */
export function alterPilot(id: number, fields: PilotFields): Promise<WriteResult> {
  const payload: Record<string, unknown> = { pilot_id: id };
  if (fields.callsign !== undefined) payload.callsign = fields.callsign;
  if (fields.name !== undefined) payload.name = fields.name;
  if (fields.phonetic !== undefined) payload.phonetic = fields.phonetic;
  if (fields.team !== undefined) payload.team_name = fields.team;
  if (fields.color !== undefined) payload.color = fields.color;
  socket?.emit('alter_pilot', payload);
  window.setTimeout(() => loadData('pilot_data'), 200);
  return awaitState(`Pilot ${fields.callsign ?? ''}`.trim(), () => {
    const p = state.setup.pilots.find((x) => x.id === id);
    if (!p) return false;
    return (
      (fields.callsign === undefined || p.callsign === fields.callsign) &&
      (fields.name === undefined || p.name === fields.name) &&
      (fields.phonetic === undefined || p.phonetic === fields.phonetic) &&
      (fields.team === undefined || p.team === fields.team) &&
      (fields.color === undefined || p.color.toLowerCase() === fields.color.toLowerCase())
    );
  });
}

/** Set one plugin attribute on a pilot (RotorHazard takes one per call). */
export function setPilotAttribute(id: number, name: string, value: string): Promise<WriteResult> {
  socket?.emit('alter_pilot', { pilot_id: id, pilot_attr: name, value });
  window.setTimeout(() => loadData('pilot_data'), 200);
  return awaitState(`Pilot attribute ${name}`, () => {
    const p = state.setup.pilots.find((x) => x.id === id);
    return !!p && String(p.attributes[name] ?? '') === value;
  });
}

/** RotorHazard refuses to delete a pilot who is in a saved race; the readback reports it. */
export function deletePilot(id: number): Promise<WriteResult> {
  socket?.emit('delete_pilot', { pilot: id });
  window.setTimeout(() => loadData('pilot_data'), 200);
  return awaitState('Delete pilot', () => !state.setup.pilots.some((p) => p.id === id)).then((r) =>
    r.ok
      ? r
      : {
          ok: false,
          message: 'RotorHazard kept the pilot — pilots in a saved race cannot be deleted.'
        }
  );
}

// ---- classes ----------------------------------------------------------------------

export async function addClass(): Promise<WriteResult & { id?: number }> {
  const before = new Set(state.setup.classes.map((c) => c.id));
  socket?.emit('add_race_class');
  window.setTimeout(() => loadData('class_data'), 200);
  const r = await awaitState('New class', () => state.setup.classes.some((c) => !before.has(c.id)));
  return { ...r, id: state.setup.classes.find((c) => !before.has(c.id))?.id };
}

export type ClassFields = {
  name?: string;
  description?: string;
  formatId?: number;
  winCondition?: string;
  rounds?: number;
  heatAdvanceType?: number;
  roundType?: number;
};

export function alterClass(id: number, fields: ClassFields): Promise<WriteResult> {
  const payload: Record<string, unknown> = { class_id: id };
  if (fields.name !== undefined) payload.class_name = fields.name;
  if (fields.description !== undefined) payload.class_description = fields.description;
  if (fields.formatId !== undefined) payload.class_format = fields.formatId;
  if (fields.winCondition !== undefined) payload.win_condition = fields.winCondition;
  if (fields.rounds !== undefined) payload.rounds = fields.rounds;
  if (fields.heatAdvanceType !== undefined) payload.heat_advance_type = fields.heatAdvanceType;
  if (fields.roundType !== undefined) payload.round_type = fields.roundType;
  socket?.emit('alter_race_class', payload);
  window.setTimeout(() => loadData('class_data'), 200);
  return awaitState('Class', () => {
    const c = state.setup.classes.find((x) => x.id === id);
    if (!c) return false;
    return (
      (fields.name === undefined || c.name === fields.name) &&
      (fields.description === undefined || c.description === fields.description) &&
      (fields.formatId === undefined || c.formatId === fields.formatId) &&
      (fields.winCondition === undefined || c.winCondition === fields.winCondition) &&
      (fields.rounds === undefined || c.rounds === fields.rounds) &&
      (fields.heatAdvanceType === undefined || c.heatAdvanceType === fields.heatAdvanceType) &&
      (fields.roundType === undefined || c.roundType === fields.roundType)
    );
  });
}

/** A stage in one step: a class with its settings and, optionally, empty heats. */
export async function createStage(spec: {
  name: string;
  formatId: number;
  rounds: number;
  winCondition: string;
  heats: number;
}): Promise<WriteResult & { id?: number }> {
  const made = await addClass();
  if (!made.ok || made.id == null) return made;
  const set = await alterClass(made.id, {
    name: spec.name,
    formatId: spec.formatId,
    rounds: spec.rounds,
    winCondition: spec.winCondition
  });
  if (!set.ok) return { ...set, id: made.id };
  for (let i = 0; i < spec.heats; i++) {
    const h = await addHeat(made.id);
    if (!h.ok) return { ...h, id: made.id };
  }
  return { ok: true, id: made.id };
}

export function duplicateClass(id: number): Promise<WriteResult> {
  const before = state.setup.classes.length;
  socket?.emit('duplicate_race_class', { class: id });
  window.setTimeout(() => loadData('class_data', 'heat_data'), 300);
  return awaitState('Duplicate class', () => state.setup.classes.length > before);
}

export function deleteClass(id: number): Promise<WriteResult> {
  socket?.emit('delete_class', { class: id });
  window.setTimeout(() => loadData('class_data', 'heat_data'), 200);
  return awaitState('Delete class', () => !state.setup.classes.some((c) => c.id === id)).then(
    (r) =>
      r.ok
        ? r
        : {
            ok: false,
            message: 'RotorHazard kept the class — classes with saved races cannot be deleted.'
          }
  );
}

// ---- heats ------------------------------------------------------------------------

export async function addHeat(classId: number): Promise<WriteResult & { id?: number }> {
  const before = new Set(state.setup.heats.map((h) => h.id));
  socket?.emit('add_heat', classId ? { class: classId } : {});
  window.setTimeout(() => loadData('heat_data'), 200);
  const r = await awaitState('New heat', () => state.setup.heats.some((h) => !before.has(h.id)));
  return { ...r, id: state.setup.heats.find((h) => !before.has(h.id))?.id };
}

export function duplicateHeat(id: number): Promise<WriteResult> {
  const before = state.setup.heats.length;
  socket?.emit('duplicate_heat', { heat: id });
  window.setTimeout(() => loadData('heat_data'), 300);
  return awaitState('Duplicate heat', () => state.setup.heats.length > before);
}

export type HeatFields = { name?: string; classId?: number; autoFrequency?: boolean };

export function alterHeat(id: number, fields: HeatFields): Promise<WriteResult> {
  const payload: Record<string, unknown> = { heat: id };
  if (fields.name !== undefined) payload.name = fields.name;
  if (fields.classId !== undefined) payload.class = fields.classId;
  if (fields.autoFrequency !== undefined) payload.auto_frequency = fields.autoFrequency;
  socket?.emit('alter_heat', payload);
  window.setTimeout(() => loadData('heat_data'), 200);
  return awaitState('Heat', () => {
    const h = state.setup.heats.find((x) => x.id === id);
    if (!h) return false;
    return (
      (fields.name === undefined || h.name === fields.name) &&
      (fields.classId === undefined || h.classId === fields.classId) &&
      (fields.autoFrequency === undefined || h.autoFrequency === fields.autoFrequency)
    );
  });
}

export function deleteHeat(id: number): Promise<WriteResult> {
  socket?.emit('delete_heat', { heat: id });
  window.setTimeout(() => loadData('heat_data'), 200);
  return awaitState('Delete heat', () => !state.setup.heats.some((h) => h.id === id)).then((r) =>
    r.ok
      ? r
      : {
          ok: false,
          message: 'RotorHazard kept the heat — heats with saved races cannot be deleted.'
        }
  );
}

/**
 * Seed now: ask RotorHazard to fill the heat's seeded seats from results (calc_pilots), then
 * confirm the plan (confirm_heat_plan → status CONFIRMED) so it will race. Seats whose result
 * is not in yet stay empty; the readback is the confirmed status.
 */
export function seedHeat(id: number): Promise<WriteResult> {
  socket?.emit('calc_pilots', { heat: id });
  window.setTimeout(() => socket?.emit('confirm_heat_plan', { heat_id: id }), 300);
  window.setTimeout(() => loadData('heat_data'), 600);
  return awaitState(
    'Seed',
    () => state.setup.heats.find((h) => h.id === id)?.status === HEAT_STATUS.CONFIRMED
  );
}

/** Back to a plan: RotorHazard drops the confirmation and will recompute seats on the next seed. */
export function unseedHeat(id: number): Promise<WriteResult> {
  socket?.emit('calc_reset', { heat: id });
  window.setTimeout(() => loadData('heat_data'), 300);
  return awaitState(
    'Reset seeding',
    () => state.setup.heats.find((h) => h.id === id)?.status === HEAT_STATUS.PLANNED
  );
}

/** What a slot should hold. One of: a pilot, a heat result, a class rank, or nothing. */
export type SlotSeating =
  | { method: typeof SLOT_METHOD.NONE }
  | { method: typeof SLOT_METHOD.ASSIGN; pilotId: number }
  | { method: typeof SLOT_METHOD.HEAT_RESULT; heatId: number; rank: number }
  | { method: typeof SLOT_METHOD.CLASS_RESULT; classId: number; rank: number };

/** Seat one slot (RHData.alter_heat: slot_id + method / pilot / seed_heat_id / seed_class_id / seed_rank). */
export function seatSlot(
  heatId: number,
  slotId: number,
  seating: SlotSeating
): Promise<WriteResult> {
  const payload: Record<string, unknown> = {
    heat: heatId,
    slot_id: slotId,
    method: seating.method
  };
  if (seating.method === SLOT_METHOD.ASSIGN) payload.pilot = seating.pilotId;
  if (seating.method === SLOT_METHOD.HEAT_RESULT) {
    payload.seed_heat_id = seating.heatId;
    payload.seed_rank = seating.rank;
  }
  if (seating.method === SLOT_METHOD.CLASS_RESULT) {
    payload.seed_class_id = seating.classId;
    payload.seed_rank = seating.rank;
  }
  if (seating.method === SLOT_METHOD.NONE) payload.pilot = 0;
  socket?.emit('alter_heat', payload);
  window.setTimeout(() => loadData('heat_data'), 200);
  return awaitState('Seat', () => {
    const slot = state.setup.heats.find((h) => h.id === heatId)?.slots.find((s) => s.id === slotId);
    if (!slot) return false;
    if (slot.method !== seating.method) return false;
    if (seating.method === SLOT_METHOD.ASSIGN) return slot.pilotId === seating.pilotId;
    if (seating.method === SLOT_METHOD.HEAT_RESULT)
      return slot.seedId === seating.heatId && slot.seedRank === seating.rank;
    if (seating.method === SLOT_METHOD.CLASS_RESULT)
      return slot.seedId === seating.classId && slot.seedRank === seating.rank;
    return true;
  });
}

// ---- teams (stored by the plugin; names are what RotorHazard stores on pilots) --------

/** Create (`id` null) or update a team. A rename moves the team's pilots along. */
export function saveTeam(
  id: string | null,
  name: string,
  description: string
): Promise<WriteResult> {
  socket?.emit('gridfpv_teams_save', { id, name, description });
  return awaitState('Save team', () =>
    state.teams.some(
      (t) => (id ? t.id === id : true) && t.name === name && t.description === description
    )
  );
}

/** Delete a team; its pilots are left with no team. */
export function deleteTeam(id: string): Promise<WriteResult> {
  socket?.emit('gridfpv_teams_delete', { id });
  return awaitState('Delete team', () => !state.teams.some((t) => t.id === id));
}

// ---- the event (RotorHazard's name/description + the plugin's details) ------------

export function saveEvent(fields: Partial<EventInfo>): Promise<WriteResult> {
  socket?.emit('gridfpv_event_save', fields);
  return awaitState('Event', () =>
    (Object.keys(fields) as Array<keyof EventInfo>).every((k) => state.event[k] === fields[k])
  );
}

/**
 * Start a new event the way RotorHazard can't on its own: archive the current database,
 * clear races + heats + classes (and pilots only if asked), keep formats, profiles and
 * plugin options, then name the new event and blank its details.
 */
export async function newEvent(name: string, keepPilots: boolean): Promise<WriteResult> {
  const acks = resetAcks;
  socket?.emit('reset_database', {
    reset_type: keepPilots ? 'classes' : 'all',
    with_archive: true
  });
  const reset = await awaitState('New event', () => resetAcks > acks);
  if (!reset.ok) return reset;
  socket?.emit('gridfpv_event_clear');
  const cleared = await awaitState(
    'New event',
    () => state.event.venue === '' && state.event.notes === ''
  );
  if (!cleared.ok) return cleared;
  const named = await saveEvent({ name, description: '' });
  window.setTimeout(() => socket?.emit('list_backups'), 500);
  return named;
}

/** Archive the current database now (RotorHazard's backup_database). */
export function archiveNow(): Promise<WriteResult> {
  const before = state.archives.length;
  socket?.emit('backup_database');
  window.setTimeout(() => socket?.emit('list_backups'), 1000);
  return awaitState('Archive', () => state.archives.length > before);
}

/** Replace the whole database with an archive; RotorHazard acks with database_restore_done. */
export async function restoreArchive(file: string): Promise<WriteResult> {
  const acks = restoreAcks;
  socket?.emit('restore_database', { backup_file: file });
  // A restore stops and restarts RotorHazard's background threads; allow longer than usual.
  const start = Date.now();
  while (Date.now() - start < 15000) {
    if (restoreAcks > acks) return { ok: true };
    await new Promise((r) => setTimeout(r, 250));
  }
  return { ok: false, message: 'Restore: RotorHazard did not confirm within 15 s' };
}

export function deleteArchive(file: string): Promise<WriteResult> {
  socket?.emit('delete_database', { backup_file: file });
  window.setTimeout(() => socket?.emit('list_backups'), 500);
  return awaitState('Delete archive', () => !state.archives.includes(file));
}

// ---- race formats -------------------------------------------------------------------

/** RotorHazard adds a format by duplicating one (add_race_format {source_format_id}). */
export async function addFormat(sourceId: number): Promise<WriteResult & { id?: number }> {
  const before = new Set(state.setup.formats.map((f) => f.id));
  socket?.emit('add_race_format', { source_format_id: sourceId });
  window.setTimeout(() => loadData('format_data'), 200);
  const r = await awaitState('New format', () =>
    state.setup.formats.some((f) => !before.has(f.id))
  );
  return { ...r, id: state.setup.formats.find((f) => !before.has(f.id))?.id };
}

export type FormatFields = {
  name?: string;
  unlimitedTime?: boolean;
  raceTimeSec?: number;
  lapGraceSec?: number;
  stagingFixedTones?: number;
  startDelayMin?: number;
  startDelayMax?: number;
  stagingDelayTones?: number;
  startBehavior?: number;
  winCondition?: number;
  numberLapsWin?: number;
  teamRacingMode?: number;
  pointsMethod?: string | null;
};

/** Change a format (RHData.alter_raceFormat keys). RotorHazard refuses this during a race. */
export function alterFormat(id: number, fields: FormatFields): Promise<WriteResult> {
  const p: Record<string, unknown> = { format_id: id };
  if (fields.name !== undefined) p.format_name = fields.name;
  if (fields.unlimitedTime !== undefined) p.unlimited_time = fields.unlimitedTime ? 1 : 0;
  if (fields.raceTimeSec !== undefined) p.race_time_sec = fields.raceTimeSec;
  if (fields.lapGraceSec !== undefined) p.lap_grace_sec = fields.lapGraceSec;
  if (fields.stagingFixedTones !== undefined) p.staging_fixed_tones = fields.stagingFixedTones;
  if (fields.startDelayMin !== undefined) p.start_delay_min_ms = fields.startDelayMin;
  if (fields.startDelayMax !== undefined) p.start_delay_max_ms = fields.startDelayMax;
  if (fields.stagingDelayTones !== undefined) p.staging_delay_tones = fields.stagingDelayTones;
  if (fields.startBehavior !== undefined) p.start_behavior = fields.startBehavior;
  if (fields.winCondition !== undefined) p.win_condition = fields.winCondition;
  if (fields.numberLapsWin !== undefined) p.number_laps_win = fields.numberLapsWin;
  if (fields.teamRacingMode !== undefined) p.team_racing_mode = fields.teamRacingMode;
  if (fields.pointsMethod !== undefined) p.points_method = fields.pointsMethod ?? '';
  socket?.emit('alter_race_format', p);
  window.setTimeout(() => loadData('format_data'), 200);
  return awaitState('Format', () => {
    const f = state.setup.formats.find((x) => x.id === id);
    if (!f) return false;
    const same = <K extends keyof FormatFields>(k: K, v: unknown) =>
      fields[k] === undefined || v === fields[k];
    return (
      same('name', f.name) &&
      same('unlimitedTime', f.unlimitedTime) &&
      same('raceTimeSec', f.raceTimeSec) &&
      same('lapGraceSec', f.lapGraceSec) &&
      same('stagingFixedTones', f.stagingFixedTones) &&
      same('startDelayMin', f.startDelayMin) &&
      same('startDelayMax', f.startDelayMax) &&
      same('stagingDelayTones', f.stagingDelayTones) &&
      same('startBehavior', f.startBehavior) &&
      same('winCondition', f.winCondition) &&
      same('numberLapsWin', f.numberLapsWin) &&
      same('teamRacingMode', f.teamRacingMode) &&
      (fields.pointsMethod === undefined ||
        (f.pointsMethod ?? null) === (fields.pointsMethod || null))
    );
  }).then((r) =>
    r.ok
      ? r
      : {
          ok: false,
          message: 'RotorHazard did not confirm — a format cannot change while a race is running.'
        }
  );
}

export function deleteFormat(id: number): Promise<WriteResult> {
  socket?.emit('delete_race_format', { format_id: id });
  window.setTimeout(() => loadData('format_data', 'class_data'), 200);
  return awaitState('Delete format', () => !state.setup.formats.some((f) => f.id === id)).then(
    (r) =>
      r.ok
        ? r
        : {
            ok: false,
            message: 'RotorHazard kept the format — formats with saved races cannot be deleted.'
          }
  );
}
