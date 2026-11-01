/**
 * The helper's local API (companion/src/server.js): JSON calls and the event stream. Same
 * origin as the page, whether the desktop shell or a browser shows it.
 */
export type RunState = 'recording' | 'tail' | 'waiting' | 'saved' | 'rendering' | 'rendered';
export type Run = {
  state: RunState;
  heat_id: number;
  round: number | null;
  name: string | null;
  recording: string | null;
  sidecar: string | null;
  started_at: string | null;
  rendered_at?: string | null;
  files?: string[];
};
export type Snapshot = {
  version: string;
  running: { profile: string; startedAt: number; recordFrom: 'obs' | 'scene' } | null;
  status: {
    timer: { connected: boolean; synced: boolean; differential: number | null };
    obs: { connected: boolean; recording: boolean; version: string };
  };
  notice: string | null;
  runs: Run[];
};
export type LogLine = { at: string; text: string };
export type Settings = Record<string, string | number | boolean>;
export type Profile = { name: string; settings: Settings };
export type Field = {
  key: string;
  label: string;
  help?: string;
  group: string;
  type: 'text' | 'password' | 'number' | 'boolean' | 'select';
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  when?: Record<string, string>;
  /** The first page of a new profile: the connections. */
  step?: number;
  /** A path a picker can fill. */
  kind?: 'folder' | 'file';
  /** Offered from a probe of OBS instead of typed. */
  choices?: 'scenes' | 'filters';
  /** Shown only when it matters (a scene with several Source Record filters). */
  advanced?: boolean;
  default: string | number | boolean;
};
export type ProfilesPayload = {
  profiles: Profile[];
  lastProfile: string | null;
  fields: Field[];
  defaults: Settings;
};
export type Probe = {
  timer: {
    ok: boolean;
    synced?: boolean;
    differential?: number | null;
    heats?: number;
    error?: string | null;
  };
  obs: {
    ok: boolean;
    version?: string;
    recordDirectory?: string;
    scenes?: { name: string; sourceRecordFilters: string[] }[];
    sourceRecord?: boolean;
    error?: string | null;
  };
};

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(data.error ?? `${method} ${path}: ${r.status}`);
  return data;
}

export const api = {
  status: () => call<Snapshot>('GET', '/api/status'),
  profiles: () => call<ProfilesPayload>('GET', '/api/profiles'),
  saveProfile: (name: string, settings: Settings) =>
    call<Profile>('PUT', `/api/profiles/${encodeURIComponent(name)}`, settings),
  deleteProfile: (name: string) =>
    call<{ ok: true }>('DELETE', `/api/profiles/${encodeURIComponent(name)}`),
  renameProfile: (name: string, to: string) =>
    call<Profile>('POST', `/api/profiles/${encodeURIComponent(name)}/rename`, { to }),
  start: (profile: string) => call<Snapshot>('POST', '/api/start', { profile }),
  stop: () => call<Snapshot>('POST', '/api/stop'),
  render: (sidecar: string) => call<{ ok: true }>('POST', '/api/render', { sidecar }),
  open: (path: string) => call<{ ok: true }>('POST', '/api/open', { path }),
  probe: (settings: Settings) => call<Probe>('POST', '/api/probe', { settings }),
  pick: (kind: 'folder' | 'file', start?: string) =>
    call<{ path?: string | null; unsupported?: boolean }>('POST', '/api/pick', { kind, start }),
  browse: (dir?: string) =>
    call<{ dir: string; parent: string | null; folders: string[] }>(
      'GET',
      `/api/browse${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`
    )
};

/** Subscribe to the stream; returns the unsubscribe. */
export function subscribe(handlers: {
  snapshot: (s: Snapshot & { log: LogLine[] }) => void;
  change: (s: Snapshot) => void;
  log: (l: LogLine) => void;
  open?: () => void;
  error?: () => void;
}): () => void {
  const es = new EventSource('/api/events');
  es.addEventListener('snapshot', (e) => handlers.snapshot(JSON.parse((e as MessageEvent).data)));
  es.addEventListener('change', (e) => handlers.change(JSON.parse((e as MessageEvent).data)));
  es.addEventListener('log', (e) => handlers.log(JSON.parse((e as MessageEvent).data)));
  es.onopen = () => handlers.open?.();
  es.onerror = () => handlers.error?.();
  return () => es.close();
}
