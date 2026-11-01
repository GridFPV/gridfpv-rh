/**
 * The companion's settings: `gridfpv-video.json` in the working directory (or the path in
 * `GRIDFPV_VIDEO_CONFIG`), with environment overrides for the secrets. Everything has a
 * default except the timer's address.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const DEFAULTS = Object.freeze({
  /** RotorHazard, e.g. http://recon-nh.local:5000 — the socket and the overlay page both live there. */
  timer: '',
  /** RotorHazard's admin login, for the socket; the overlay page itself is public. */
  timerUser: '',
  timerPass: '',
  /** obs-websocket (Tools → WebSocket Server Settings in OBS 28+). */
  obs: 'ws://127.0.0.1:4455',
  obsPass: '',
  /**
   * What records each run (#98): 'obs' — OBS's own Record output, started and stopped per
   * run (a session where nothing else is being recorded); 'scene' — a named scene recorded
   * on its own by the Source Record filter, so OBS can stream and record the whole day
   * untouched while every run still lands in a clean file.
   */
  recordFrom: 'obs',
  /** The scene (or source) Source Record records, when recordFrom is 'scene'. */
  scene: '',
  /** Its Source Record filter's name; empty finds the first one, or lets Source Record make one. */
  sceneFilter: '',
  /** Where Source Record writes; empty = the filter's own path, else OBS's recording folder. */
  recordDir: '',
  /** Where renders go; empty = beside the recording. */
  outDir: '',
  /** Seconds of recording kept after the race stops, so the last lap and the FINISHED clock are in the file. */
  tailSeconds: 3,
  /**
   * After a stop, the timer goes Ready on Save or on Discard alike; a save shows up as a new
   * round in the race list within a second or two. This is how long to wait for that round
   * after Ready before the run counts as discarded (its recording then goes to trash/, never
   * deleted). Nothing is timed while the race sits stopped waiting for the director.
   */
  discardAfterSeconds: 20,
  /** A discarded run's recording goes to `trash/` beside it (never deleted); false leaves it in place. */
  trashDiscarded: true,
  /** Rendered video: the recording with the overlay composited (needs ffmpeg with libx264). */
  composite: true,
  /** The overlay alone with alpha, for a cut in Resolve: 'vp9' (.webm), 'prores' (.mov, ProRes 4444) or 'none'. */
  overlayOnly: 'vp9',
  fps: 30,
  width: 1920,
  height: 1080,
  /** 'dark' (light text on dark glass) or 'light'. */
  theme: 'dark',
  /** 'solo' or 'field'; empty lets the page choose (one pilot → solo). */
  layout: 'solo',
  ffmpeg: 'ffmpeg',
  /** Playwright channel for the browser that draws frames: 'chrome', 'msedge', or '' for the bundled Chromium. */
  browserChannel: 'chrome',
  /** x264 quality for the composite (lower is better/bigger). */
  crf: 18,
  /** How the overlay is blended onto the recording: 'linear' (light, as OBS composites its browser source) or 'srgb' (on the encoded values). */
  blend: 'linear',
  /** Milliseconds between the timer's clock samples; ten are taken, the median kept, as Grid's run page does. */
  syncEveryMs: 400
});

const ENV = {
  timer: 'GRIDFPV_TIMER',
  timerUser: 'GRIDFPV_TIMER_USER',
  timerPass: 'GRIDFPV_TIMER_PASS',
  obs: 'GRIDFPV_OBS',
  obsPass: 'GRIDFPV_OBS_PASS',
  ffmpeg: 'GRIDFPV_FFMPEG',
  browserChannel: 'GRIDFPV_BROWSER'
};

/** Merge defaults, the file (if any) and the environment; unknown keys in the file are an error. */
export function loadConfig({ file, env = process.env, cwd = process.cwd() } = {}) {
  const out = { ...DEFAULTS };
  const where = file ?? env.GRIDFPV_VIDEO_CONFIG ?? path.join(cwd, 'gridfpv-video.json');
  let text = null;
  try {
    text = readFileSync(where, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT' || file) throw new Error(`config: cannot read ${where}: ${e.message}`);
  }
  if (text != null) {
    const parsed = JSON.parse(text);
    for (const [k, v] of Object.entries(parsed)) {
      if (!(k in DEFAULTS)) throw new Error(`config: unknown setting "${k}" in ${where}`);
      out[k] = v;
    }
    out.configFile = where;
  }
  for (const [k, name] of Object.entries(ENV)) if (env[name]) out[k] = env[name];
  if (out.timer) out.timer = String(out.timer).replace(/\/+$/, '');
  return out;
}

export function requireTimer(cfg) {
  if (!cfg.timer)
    throw new Error(
      'config: say where the timer is — "timer": "http://recon-nh.local:5000" in gridfpv-video.json, or GRIDFPV_TIMER'
    );
  return cfg;
}
