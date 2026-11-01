/**
 * One render: open the timer's replay overlay for the run, step it frame by frame with
 * `window.gridfpvReplay.seek`, screenshot when the picture changes, and pipe the frames to
 * ffmpeg — once for the overlay alone (with alpha) and once composited onto the clean
 * recording. The browser only draws; the timer only answers; ffmpeg only encodes.
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { compositeArgs, frameCount, overlayArgs, walkFrames } from './frames.js';
import { safeFileName, supersede } from './sidecar.js';

const READY_TIMEOUT_MS = 30_000;

/** The replay page's URL for a sidecar's run. */
export function replayUrl(cfg, data) {
  const q = new URLSearchParams({
    heat: String(data.heat_id),
    round: String(data.round)
  });
  if (data.end_ms != null) q.set('end', String(Math.round(data.end_ms)));
  if (data.staging_ms != null) q.set('staging', String(Math.round(data.staging_ms)));
  if (cfg.layout) q.set('layout', cfg.layout);
  return `${cfg.timer}/grid/live/race${cfg.theme === 'light' ? '/light' : ''}?${q}`;
}

/** The files a run renders to, by name. */
/**
 * The run's name for files: the page's `runName` (event, class, heat, round — or RaceGOW's
 * template) when the plugin offers one, else its title, else heat and round.
 */
export function runNameOf(info, data) {
  return info.runName || info.title || data.name || `heat ${data.heat_id} round ${data.round}`;
}
/** Whether the first pass counts as a lap (RotorHazard start behaviour 1), when the page says. */
export function firstLapCountsOf(info) {
  return info.startBehavior == null ? null : Number(info.startBehavior) === 1;
}

/**
 * What a render is named after: the clean recording's own stem when it carries the run's
 * name (`<name> - Clean.ext`, perhaps `<name> - Clean (2).ext` for a round recorded twice),
 * so the render sits beside its recording and never lands on another run's; else the name.
 */
export function renderStem(data, name) {
  const base = data.recording ? path.basename(data.recording, path.extname(data.recording)) : '';
  const m = /^(.*) - Clean( \(\d+\))?$/.exec(base);
  return m ? m[1] + (m[2] ?? '') : name;
}

export function outputsFor(cfg, dir, name) {
  const stem = path.join(dir, safeFileName(name));
  const out = {};
  if (cfg.composite) out.composite = `${stem} - Overlay.mp4`;
  if (cfg.overlayOnly === 'vp9') out.overlay = `${stem} - Overlay alpha.webm`;
  else if (cfg.overlayOnly === 'prores') out.overlay = `${stem} - Overlay alpha.mov`;
  return out;
}

async function launch(cfg, log) {
  const opts = { headless: true };
  if (cfg.browserChannel) {
    try {
      return await chromium.launch({ ...opts, channel: cfg.browserChannel });
    } catch (e) {
      log(
        `browser: no "${cfg.browserChannel}" channel (${e.message.split('\n')[0]}); trying the bundled Chromium`
      );
    }
  }
  return chromium.launch(opts);
}

function ffmpeg(cfg, args, label) {
  const proc = spawn(cfg.ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  proc.stderr.on('data', (d) => (err += d));
  const enc = { proc, label, failed: null };
  enc.done = new Promise((resolve, reject) => {
    const fail = (e) => {
      enc.failed = e;
      reject(e);
    };
    proc.on('error', (e) => fail(new Error(`${label}: cannot run ${cfg.ffmpeg}: ${e.message}`)));
    proc.on('close', (code) =>
      code === 0
        ? resolve()
        : fail(
            new Error(
              `${label}: ffmpeg exited ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`
            )
          )
    );
  });
  // Awaited at the end; an encoder dying mid-walk is noticed by `failed`, not as an unhandled rejection.
  enc.done.catch(() => {});
  // A failed encoder must not hang the frame loop on a closed pipe.
  proc.stdin.on('error', () => {});
  return enc;
}

function write(stream, buf) {
  return new Promise((resolve) => {
    if (stream.destroyed || stream.writableEnded) return resolve();
    if (stream.write(buf)) resolve();
    else stream.once('drain', resolve);
  });
}

/**
 * Render a run. Returns `{ files, lapStamps, title }`, or throws with the reason. `data` is
 * the sidecar (needs heat_id, round, race_start_ms, duration_ms; recording for a composite).
 */
export async function renderRun({ cfg, data, log = () => {} }) {
  if (data.round == null) throw new Error('the run has no round yet (not saved)');
  if (data.race_start_ms == null) throw new Error('the sidecar has no alignment (race_start_ms)');
  const durationMs = data.duration_ms ?? (await probeDuration(cfg, data.recording));
  if (!(durationMs > 0)) throw new Error('the recording length is unknown (duration_ms)');
  const dir = cfg.outDir || path.dirname(data.recording);
  await fs.mkdir(dir, { recursive: true });

  const browser = await launch(cfg, log);
  const encoders = [];
  try {
    const ctx = await browser.newContext({
      viewport: { width: cfg.width, height: cfg.height },
      deviceScaleFactor: 1,
      httpCredentials: cfg.timerUser
        ? { username: cfg.timerUser, password: cfg.timerPass }
        : undefined
    });
    const page = await ctx.newPage();
    const url = replayUrl(cfg, data);
    await page.goto(url, { waitUntil: 'load' });
    const info = await page.evaluate(
      (ms) =>
        Promise.race([
          window.gridfpvReplay.ready(),
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error('the replay page did not become ready')), ms)
          )
        ]),
      READY_TIMEOUT_MS
    );
    const title = runNameOf(info, data);
    const outputs = outputsFor(cfg, dir, renderStem(data, title));
    log(
      `render: "${title}" — ${frameCount(durationMs, cfg.fps)} frames at ${cfg.fps} fps from ${url}`
    );

    const parts = {};
    if (outputs.overlay) {
      parts.overlay = outputs.overlay.replace(/(\.[^.]+)$/, '.part$1');
      encoders.push(
        ffmpeg(
          cfg,
          overlayArgs({
            fps: cfg.fps,
            codec: cfg.overlayOnly,
            out: parts.overlay
          }),
          'overlay'
        )
      );
    }
    if (outputs.composite) {
      if (!data.recording || !(await exists(data.recording)))
        log(`render: no recording at ${data.recording}; overlay only`);
      else if (!(await readable(cfg, data.recording, log)))
        throw new Error(`the recording at ${data.recording} cannot be read (still being written?)`);
      else {
        parts.composite = outputs.composite.replace(/(\.[^.]+)$/, '.part$1');
        encoders.push(
          ffmpeg(
            cfg,
            compositeArgs({
              fps: cfg.fps,
              recording: data.recording,
              out: parts.composite,
              crf: cfg.crf,
              blend: cfg.blend,
              videoEncoder: cfg.videoEncoder
            }),
            'composite'
          )
        );
      }
    }
    if (!encoders.length)
      throw new Error('nothing to render: composite and overlayOnly are both off');

    const started = Date.now();
    const counts = await walkFrames({
      durationMs,
      fps: cfg.fps,
      raceStartMs: data.race_start_ms,
      seek: async (t) => (await page.evaluate((ms) => window.gridfpvReplay.seek(ms), t)).key,
      shoot: () =>
        page.screenshot({
          type: 'png',
          omitBackground: true,
          animations: 'disabled',
          caret: 'hide'
        }),
      emit: (png) => {
        const dead = encoders.find((e) => e.failed);
        if (dead) throw dead.failed;
        return Promise.all(encoders.map((e) => write(e.proc.stdin, png)));
      },
      onProgress: (k, n) => log(`render: ${Math.round((100 * k) / n)}%`)
    });
    for (const e of encoders) e.proc.stdin.end();
    await Promise.all(encoders.map((e) => e.done));
    const files = [];
    const superseded = {};
    for (const [kind, part] of Object.entries(parts)) {
      const final = outputs[kind];
      // A file already of that name that is not an earlier render of this run (OBS's own
      // overlaid recording, named alike) is kept, in superseded/ — never written over.
      if ((await exists(final)) && !(data.rendered?.files ?? []).includes(final))
        superseded[final] = await supersede(final);
      await fs.rename(part, final);
      files.push(final);
    }
    log(
      `render: done in ${((Date.now() - started) / 1000).toFixed(1)} s — ${counts.frames} frames, ${counts.shots} screenshots`
    );
    return {
      files,
      superseded,
      lapStamps: info.lapStamps,
      firstLapCounts: firstLapCountsOf(info),
      title,
      look: info.look
    };
  } catch (e) {
    for (const enc of encoders) enc.proc.kill('SIGKILL');
    throw e;
  } finally {
    await browser.close();
  }
}

/**
 * The run's name as the overlay page composes it (event, heat, round; or the RaceGOW template),
 * without drawing a frame: the page is opened, asked, closed. For naming the overlaid file at
 * the save when nothing is rendered yet (#105).
 */
export async function runTitle({ cfg, data, log = () => {} }) {
  const browser = await launch(cfg, log);
  try {
    const ctx = await browser.newContext({
      viewport: { width: 640, height: 360 },
      httpCredentials: cfg.timerUser
        ? { username: cfg.timerUser, password: cfg.timerPass }
        : undefined
    });
    const page = await ctx.newPage();
    await page.goto(replayUrl(cfg, data), { waitUntil: 'load' });
    const info = await page.evaluate(
      (ms) =>
        Promise.race([
          window.gridfpvReplay.ready(),
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error('the replay page did not become ready')), ms)
          )
        ]),
      READY_TIMEOUT_MS
    );
    return {
      title: runNameOf(info, data),
      lapStamps: info.lapStamps,
      firstLapCounts: firstLapCountsOf(info),
      look: info.look
    };
  } finally {
    await browser.close();
  }
}

/** OBS finishes a file a moment after it says it stopped: probe until ffprobe can read it, up to 20 s. */
async function readable(cfg, file, log) {
  for (let i = 0; i < 20; i++) {
    if ((await probeDuration(cfg, file)) != null) return true;
    if (i === 0) log('render: waiting for the recording to be readable');
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function exists(f) {
  try {
    await fs.access(f);
    return true;
  } catch {
    return false;
  }
}

/** The recording's length by ffprobe (beside ffmpeg), when the sidecar lacks it. */
export function probeDuration(cfg, file) {
  if (!file) return Promise.resolve(null);
  const ffprobe = cfg.ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m, ext) => `ffprobe${ext ?? ''}`);
  return new Promise((resolve) => {
    const p = spawn(ffprobe, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      file
    ]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => resolve(null));
    p.on('close', () => resolve(Number(out) > 0 ? Math.round(Number(out) * 1000) : null));
  });
}
