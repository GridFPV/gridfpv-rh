/**
 * A profile's connections, tried (#99): the timer and OBS from a few settings, so the window
 * can say "connected" before the rest of the form, and fill its choices — OBS's scenes, the
 * Source Record filters on each, its recording folder — instead of asking for them typed.
 * `only: 'obs'` (or `'timer'`) tries that one alone — the window reconnects to OBS by itself
 * when a profile with an OBS address is opened, and should not wait on a timer that is off.
 * Everything is injectable; both connections are closed before returning.
 */
import { Obs } from './obs.js';
import { FILTER_KIND, sourceRecordLoaded } from './sceneRecord.js';
import { Timer } from './timer.js';

export async function probeSettings(
  cfg,
  { Timer: T = Timer, Obs: O = Obs, timeoutMs = 8000, only = null, log = () => {} } = {}
) {
  const skipped = { ok: false, skipped: true, error: null };
  const [timer, obs] = await Promise.all([
    only === 'obs' ? skipped : probeTimer(cfg, T, timeoutMs, log),
    only === 'timer' ? skipped : probeObs(cfg, O, timeoutMs, log)
  ]);
  return { timer, obs };
}

async function probeTimer(cfg, T, timeoutMs, log) {
  if (!cfg.timer) return { ok: false, error: 'no timer address' };
  const t = new T(cfg.timer, { user: cfg.timerUser, pass: cfg.timerPass, log, syncEveryMs: 150 });
  const out = { ok: false, synced: false, differential: null, heats: 0, error: null };
  await new Promise((resolve) => {
    const done = setTimeout(() => {
      if (!out.ok) out.error = 'no answer from the timer';
      resolve();
    }, timeoutMs);
    t.on('connected', () => {
      out.ok = true;
    });
    t.on('synced', (d) => {
      out.synced = true;
      out.differential = d;
      out.heats = t.raceList?.length ?? 0;
      clearTimeout(done);
      resolve();
    });
    t.connect();
  });
  t.close();
  return out;
}

async function probeObs(cfg, O, timeoutMs, log) {
  const o = new O(cfg.obs, cfg.obsPass, log);
  const out = {
    ok: false,
    version: '',
    recordDirectory: '',
    scenes: [],
    sourceRecord: false,
    error: null
  };
  const timer = new Promise((_, rej) =>
    setTimeout(() => rej(new Error('no answer from OBS')), timeoutMs)
  );
  try {
    await Promise.race([o.connect(), timer]);
    if (!o.connected)
      throw new Error(
        `cannot connect to ${cfg.obs} (is the WebSocket server on, and the password right?)`
      );
    out.ok = true;
    const ws = o.ws;
    const v = await ws.call('GetVersion').catch(() => ({}));
    out.version = v.obsVersion ?? '';
    out.recordDirectory =
      (await ws.call('GetRecordDirectory').catch(() => ({}))).recordDirectory ?? '';
    const { scenes = [] } = await ws.call('GetSceneList').catch(() => ({}));
    for (const s of scenes) {
      const { filters = [] } = await ws
        .call('GetSourceFilterList', { sourceName: s.sceneName })
        .catch(() => ({}));
      out.scenes.push({
        name: s.sceneName,
        sourceRecordFilters: filters
          .filter((f) => f.filterKind === FILTER_KIND)
          .map((f) => f.filterName)
      });
    }
    // Scenes are listed newest last by OBS; show them as OBS does (top of the list first).
    out.scenes.reverse();
    out.sourceRecord = await sourceRecordLoaded(ws);
  } catch (e) {
    out.error = e.message ?? String(e);
  } finally {
    await o.close?.().catch(() => {});
  }
  return out;
}
