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
  times: number[];
  values: number[];
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
  capture: null as Capture | null
});

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

// ---- connection -----------------------------------------------------------------

/** Open the socket once; safe to call again (returns the existing one). */
export function connect(): Socket {
  if (socket) return socket;
  socket = io({ transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    state.connection = 'connected';
    socket?.emit('gridfpv_hello', { client: 'plugin-ui' });
    loadData('frequency_data', 'enter_and_exit_at_levels', 'node_tuning', 'node_data');
    socket?.emit('gridfpv_capture_get');
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

  // The plugin's capture channel.
  socket.on('gridfpv_capture', (p: Capture | { state: 'none' }) => {
    if (p.state === 'none') {
      state.capture = null;
      return;
    }
    const full = p as Capture;
    state.capture = {
      ...full,
      times: full.times ?? [],
      values: full.values ?? [],
      crossings: full.crossings ?? []
    };
    checkWaiters();
  });
  socket.on(
    'gridfpv_capture_chunk',
    (p: { seat: number; times: number[]; values: number[]; samples: number; seconds: number }) => {
      const cap = state.capture;
      if (!cap || cap.seat !== p.seat || cap.state !== 'recording') return;
      cap.times.push(...p.times);
      cap.values.push(...p.values);
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
      end: c.exit ?? cap.times[cap.times.length - 1] ?? (c.enter as number),
      at: c.exit != null ? ((c.enter as number) + c.exit) / 2 : (c.enter as number),
      peak: c.peak ?? 0,
      open: c.exit == null
    }));
}
