/**
 * The window's state: the helper's snapshot and log, kept live by the event stream, and the
 * profiles with the settings vocabulary, loaded on demand.
 */
import {
  api,
  subscribe,
  type Field,
  type LogLine,
  type Profile,
  type Settings,
  type Snapshot
} from './api.js';

const LOG_KEEP = 400;

export const ui = $state({
  link: 'connecting' as 'connecting' | 'live' | 'lost',
  snapshot: null as Snapshot | null,
  log: [] as LogLine[],
  profiles: [] as Profile[],
  lastProfile: null as string | null,
  fields: [] as Field[],
  defaults: {} as Settings,
  busy: false,
  error: null as string | null
});

export function connect(): () => void {
  return subscribe({
    snapshot: (s) => {
      ui.snapshot = s;
      ui.log = s.log.slice(-LOG_KEEP);
      ui.link = 'live';
    },
    change: (s) => (ui.snapshot = s),
    log: (l) => {
      ui.log = [...ui.log, l].slice(-LOG_KEEP);
    },
    error: () => (ui.link = 'lost')
  });
}

export async function loadProfiles(): Promise<void> {
  const p = await api.profiles();
  ui.profiles = p.profiles;
  ui.lastProfile = p.lastProfile;
  ui.fields = p.fields;
  ui.defaults = p.defaults;
}

/** Run a call with the busy flag and the error line; returns whether it went through. */
export async function act(fn: () => Promise<unknown>): Promise<boolean> {
  ui.busy = true;
  ui.error = null;
  try {
    await fn();
    return true;
  } catch (e) {
    ui.error = e instanceof Error ? e.message : String(e);
    return false;
  } finally {
    ui.busy = false;
  }
}
