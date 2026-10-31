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
import { safeFileName } from './sidecar.js';

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
export function outputsFor(cfg, dir, name) {
  const stem = path.join(dir, safeFileName(name));
  const out = {};
  if (cfg.composite) out.composite = `${stem}.mp4`;
  if (cfg.overlayOnly === 'vp9') out.overlay = `${stem} overlay.webm`;
  else if (cfg.overlayOnly === 'prores') out.overlay = `${stem} overlay.mov`;
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
    const title = info.title || data.name || `heat ${data.heat_id} round ${data.round}`;
    const outputs = outputsFor(cfg, dir, title);
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
              crf: cfg.crf
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
    for (const [kind, part] of Object.entries(parts)) {
      await fs.rename(part, outputs[kind]);
      files.push(outputs[kind]);
    }
    log(
      `render: done in ${((Date.now() - started) / 1000).toFixed(1)} s — ${counts.frames} frames, ${counts.shots} screenshots`
    );
    return { files, lapStamps: info.lapStamps, title };
  } catch (e) {
    for (const enc of encoders) enc.proc.kill('SIGKILL');
    throw e;
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
