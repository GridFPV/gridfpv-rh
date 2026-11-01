/**
 * The helper (#99): the pipeline behind a window. One `Helper` owns the profiles, the running
 * session (timer + OBS + recorder + renders) if any, a snapshot of what is going on for the
 * UI, and a ring of log lines. It emits `change` whenever the snapshot moves; the server
 * streams that to the page.
 *
 * Everything that talks to the outside is injectable (`deps`) so the whole thing runs in a
 * test with a fake timer and a fake OBS.
 */
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { DEFAULTS } from './config.js';
import { Obs } from './obs.js';
import { Profiles } from './profiles.js';
import { renderRun } from './render.js';
import { SceneRecorder } from './sceneRecord.js';
import { Session } from './session.js';
import { Timer } from './timer.js';

export const LOG_LINES = 400;

export class Helper extends EventEmitter {
  constructor({ profiles = new Profiles(), deps = {}, version = '' } = {}) {
    super();
    this.profiles = profiles;
    this.version = version;
    this.d = {
      Timer: deps.Timer ?? Timer,
      Obs: deps.Obs ?? Obs,
      SceneRecorder: deps.SceneRecorder ?? SceneRecorder,
      render: deps.render ?? (({ cfg, data, log }) => renderRun({ cfg, data, log })),
      now: deps.now ?? (() => performance.now()),
      setTimeout: deps.setTimeout ?? setTimeout,
      clearTimeout: deps.clearTimeout ?? clearTimeout,
      ffmpegPath: deps.ffmpegPath ?? (async (cfg) => cfg.ffmpeg)
    };
    this.lines = [];
    this.running = null; // { profile, cfg, timer, obs, recorder, session, startedAt }
    this.status = {
      timer: { connected: false, synced: false, differential: null },
      obs: { connected: false, recording: false, version: '' }
    };
    this.notice = null; // the last thing worth a banner: a start that failed, say
  }

  // ---- log ----
  log(msg) {
    const line = { at: new Date().toISOString(), text: String(msg) };
    this.lines.push(line);
    if (this.lines.length > LOG_LINES) this.lines.splice(0, this.lines.length - LOG_LINES);
    this.emit('log', line);
  }

  // ---- what the window shows ----
  snapshot() {
    const r = this.running;
    return {
      version: this.version,
      running: r
        ? { profile: r.profile, startedAt: r.startedAt, recordFrom: r.cfg.recordFrom }
        : null,
      status: this.status,
      notice: this.notice,
      runs: r?.session ? r.session.runs() : []
    };
  }
  changed() {
    this.emit('change', this.snapshot());
  }

  // ---- lifecycle ----
  /** Start watching with a profile's settings. Stops whatever was running first. */
  async start(profileName) {
    if (this.running) await this.stop();
    const { settings } = await this.profiles.load(profileName);
    const cfg = Profiles.effective(settings);
    if (!cfg.timer) throw new Error(`profile "${profileName}" has no timer address`);
    if (cfg.recordFrom === 'scene' && !cfg.scene)
      throw new Error(`profile "${profileName}" records from a scene but names none`);
    cfg.ffmpeg = await this.d.ffmpegPath(cfg, (m) => this.log(m));
    const log = (m) => this.log(m);
    this.notice = null;
    const timer = new this.d.Timer(cfg.timer, {
      user: cfg.timerUser,
      pass: cfg.timerPass,
      log,
      syncEveryMs: cfg.syncEveryMs
    });
    timer.on('connected', () => this.setStatus('timer', { connected: true, synced: false }));
    timer.on('disconnected', () =>
      this.setStatus('timer', { connected: false, synced: false, differential: null })
    );
    timer.on('synced', (d) => this.setStatus('timer', { synced: true, differential: d }));
    timer.connect();
    const obs = new this.d.Obs(cfg.obs, cfg.obsPass, log);
    obs.on?.('connected', (info) =>
      this.setStatus('obs', { connected: true, version: info?.obsVersion ?? '' })
    );
    obs.on?.('closed', () => this.setStatus('obs', { connected: false, recording: false }));
    await obs.connect();
    const recorder = cfg.recordFrom === 'scene' ? new this.d.SceneRecorder(obs, cfg, { log }) : obs;
    const session = new Session(cfg, {
      timer,
      obs: recorder,
      now: this.d.now,
      setTimeout: this.d.setTimeout,
      clearTimeout: this.d.clearTimeout,
      log,
      render: ({ data }) => this.d.render({ cfg, data, log })
    }).start();
    session.on('change', () => this.changed());
    this.running = {
      profile: profileName,
      cfg,
      timer,
      obs,
      recorder,
      session,
      startedAt: Date.now()
    };
    await this.profiles.setState({ ...(await this.profiles.state()), lastProfile: profileName });
    if (cfg.outDir) await session.adopt(cfg.outDir);
    // Sidecars live beside the recordings; the first stop tells us where that is.
    const seen = new Set(cfg.outDir ? [cfg.outDir] : []);
    const origFinish = session.finishRecording.bind(session);
    session.finishRecording = async (rec) => {
      await origFinish(rec);
      const dir = rec.recording ? path.dirname(rec.recording) : null;
      if (dir && !seen.has(dir)) {
        seen.add(dir);
        await session.adopt(dir);
        this.changed();
      }
    };
    this.log(
      `watching ${cfg.timer}; recording via ${cfg.obs} (${cfg.recordFrom === 'scene' ? `the "${cfg.scene}" scene, Source Record` : "OBS's own recording"}); renders ${cfg.outDir || 'beside each recording'}`
    );
    this.changed();
    return this.snapshot();
  }

  async stop() {
    const r = this.running;
    if (!r) return;
    this.running = null;
    this.log('stopped watching');
    r.timer.close();
    await r.obs.close?.().catch(() => {});
    this.status = {
      timer: { connected: false, synced: false, differential: null },
      obs: { connected: false, recording: false, version: '' }
    };
    this.changed();
  }

  setStatus(which, fields) {
    this.status = { ...this.status, [which]: { ...this.status[which], ...fields } };
    this.changed();
  }

  /** Render (again) from a sidecar, with the running profile's settings or a named one's. */
  async render(sidecarFile, profileName = this.running?.profile) {
    if (!profileName) throw new Error('no profile to render with');
    const cfg =
      this.running?.cfg ?? Profiles.effective((await this.profiles.load(profileName)).settings);
    const session = this.running?.session;
    if (session) {
      const data = session.known.get(sidecarFile);
      if (!data) throw new Error(`the running session does not know ${sidecarFile}`);
      return session.queueRender(sidecarFile, data);
    }
    const { readSidecar, writeSidecar, lapsHash } = await import('./sidecar.js');
    const data = await readSidecar(sidecarFile);
    const out = await this.d.render({ cfg, data, log: (m) => this.log(m) });
    data.name = out.title;
    data.laps_hash = lapsHash(out.lapStamps);
    data.rendered = { at: new Date().toISOString(), files: out.files };
    await writeSidecar(sidecarFile, data);
    return out;
  }

  /** The settings form's vocabulary: every key, its default, and a short description. */
  static fields() {
    return FIELDS;
  }
}

/**
 * What the window asks for, in order; keys are config keys (`DEFAULTS`). `step: 1` is the
 * first page of a new profile — the connections — tried before the rest is shown, so the
 * rest can offer choices (`choices`: OBS's scenes, the Source Record filters on the chosen
 * scene) instead of asking for them typed. `kind` marks a path a picker can fill.
 */
export const FIELDS = [
  {
    key: 'timer',
    label: 'Timer address',
    help: 'RotorHazard as in the browser, e.g. http://recon-nh.local:5000',
    group: 'Timer',
    type: 'text',
    step: 1
  },
  {
    key: 'timerUser',
    label: 'RotorHazard admin user',
    help: 'Blank if RotorHazard has no login',
    group: 'Timer',
    type: 'text',
    step: 1
  },
  {
    key: 'timerPass',
    label: 'RotorHazard admin password',
    group: 'Timer',
    type: 'password',
    step: 1
  },
  {
    key: 'obs',
    label: 'OBS WebSocket address',
    help: 'Tools → WebSocket Server Settings in OBS; this machine is ws://127.0.0.1:4455',
    group: 'OBS',
    type: 'text',
    step: 1
  },
  { key: 'obsPass', label: 'OBS WebSocket password', group: 'OBS', type: 'password', step: 1 },
  {
    key: 'recordFrom',
    label: 'Record each run from',
    help: "OBS's own recording (a session where nothing else records), or a scene of its own through the Source Record filter while OBS streams and records the whole day",
    group: 'Recording',
    type: 'select',
    options: [
      { value: 'obs', label: "OBS's own recording" },
      { value: 'scene', label: 'A scene, via Source Record' }
    ]
  },
  {
    key: 'scene',
    label: 'Scene to record',
    help: 'The clean capture scene (no overlay); needs the Source Record plugin in OBS',
    group: 'Recording',
    type: 'text',
    choices: 'scenes',
    when: { recordFrom: 'scene' }
  },
  {
    key: 'sceneFilter',
    label: 'Source Record filter on that scene',
    help: 'Only when the scene carries more than one; otherwise the one it has is used, or Source Record makes one',
    group: 'Recording',
    type: 'text',
    choices: 'filters',
    when: { recordFrom: 'scene' },
    advanced: true
  },
  {
    key: 'recordDir',
    label: 'Recording folder',
    help: "Blank: where the filter is set to write, else OBS's recording folder",
    group: 'Recording',
    type: 'text',
    kind: 'folder',
    when: { recordFrom: 'scene' }
  },
  {
    key: 'tailSeconds',
    label: 'Seconds kept after the stop',
    group: 'Recording',
    type: 'number',
    min: 0,
    max: 60
  },
  {
    key: 'discardAfterSeconds',
    label: 'Seconds to wait for the save after Ready',
    help: 'After a stop the timer goes Ready on Save or Discard alike; a save appears as a new round within a second or two. Past this wait the run counts as discarded and its recording moves to trash/ (never deleted). The clock does not run while the race sits stopped.',
    group: 'Recording',
    type: 'number',
    min: 5,
    max: 300
  },
  {
    key: 'trashDiscarded',
    label: 'Move a discarded run to trash/',
    group: 'Recording',
    type: 'boolean'
  },
  {
    key: 'outDir',
    label: 'Renders folder',
    help: 'Blank: beside each recording',
    group: 'Renders',
    type: 'text',
    kind: 'folder'
  },
  {
    key: 'layout',
    label: 'Overlay layout',
    group: 'Renders',
    type: 'select',
    options: [
      { value: 'solo', label: 'One pilot (RaceGOW)' },
      { value: 'field', label: 'The field (a heat of pilots)' },
      { value: '', label: 'Let the page choose' }
    ]
  },
  {
    key: 'theme',
    label: 'Overlay theme',
    group: 'Renders',
    type: 'select',
    options: [
      { value: 'dark', label: 'Light text on dark glass' },
      { value: 'light', label: 'Dark text on a light panel' }
    ]
  },
  {
    key: 'composite',
    label: 'Render the recording with the overlay (.mp4)',
    group: 'Renders',
    type: 'boolean'
  },
  {
    key: 'overlayOnly',
    label: 'Overlay alone, with alpha',
    group: 'Renders',
    type: 'select',
    options: [
      { value: 'vp9', label: 'VP9 (.webm)' },
      { value: 'prores', label: 'ProRes 4444 (.mov)' },
      { value: 'none', label: 'None' }
    ]
  },
  { key: 'width', label: 'Width', group: 'Renders', type: 'number', min: 320, max: 7680 },
  { key: 'height', label: 'Height', group: 'Renders', type: 'number', min: 180, max: 4320 },
  { key: 'fps', label: 'Frames per second', group: 'Renders', type: 'number', min: 1, max: 120 },
  {
    key: 'crf',
    label: 'x264 quality (CRF, lower is better and bigger)',
    group: 'Renders',
    type: 'number',
    min: 0,
    max: 51
  },
  {
    key: 'ffmpeg',
    label: 'ffmpeg',
    help: 'Blank or "ffmpeg": the one the helper fetched, or on the PATH',
    group: 'Tools',
    type: 'text',
    kind: 'file'
  },
  {
    key: 'browserChannel',
    label: 'Browser that draws the frames',
    group: 'Tools',
    type: 'select',
    options: [
      { value: 'msedge', label: 'Microsoft Edge' },
      { value: 'chrome', label: 'Google Chrome' },
      { value: '', label: "Playwright's bundled Chromium" }
    ]
  },
  {
    key: 'syncEveryMs',
    label: 'Milliseconds between clock samples',
    group: 'Tools',
    type: 'number',
    min: 100,
    max: 5000
  }
].map((f) => ({ ...f, default: DEFAULTS[f.key] }));
