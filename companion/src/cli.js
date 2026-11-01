#!/usr/bin/env node
/**
 * gridfpv-video — the RaceGOW video companion (#96).
 *
 *   gridfpv-video watch            the race-day loop: record on the timer's events, render on save and marshal
 *   gridfpv-video render <sidecar> render (again) from a sidecar; also takes the recording's path
 *   gridfpv-video probe            check the timer, its clock sync, OBS and ffmpeg
 *   gridfpv-video init             write gridfpv-video.json from a few questions (the Windows launcher runs it first)
 *
 * Settings: gridfpv-video.json in the working directory (see README), or the environment.
 */
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { loadConfig, requireTimer } from './config.js';
import { Obs } from './obs.js';
import { SceneRecorder } from './sceneRecord.js';
import { renderRun } from './render.js';
import { Session } from './session.js';
import { readSidecar, sidecarPathFor, writeSidecar, lapsHash } from './sidecar.js';
import { Timer } from './timer.js';

const log = (msg) => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);

async function main(argv) {
  const [cmd = 'watch', arg] = argv;
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') return usage();
  if (cmd === 'init') return init();
  const cfg = loadConfig();
  if (cmd === 'watch') return watch(requireTimer(cfg));
  if (cmd === 'render') return render(requireTimer(cfg), arg);
  if (cmd === 'probe') return probe(cfg);
  usage();
  process.exitCode = 2;
}

function usage() {
  console.log('usage: gridfpv-video watch | render <sidecar.json|recording> | probe | init');
}

/** A few questions → gridfpv-video.json beside the program; everything else keeps its default. */
async function init() {
  const file = process.env.GRIDFPV_VIDEO_CONFIG ?? path.join(process.cwd(), 'gridfpv-video.json');
  // Lines from stdin one at a time: a terminal or a pipe, the same way.
  const lines = readline
    .createInterface({ input: process.stdin, crlfDelay: Infinity })
    [Symbol.asyncIterator]();
  const ask = async (q, d = '') => {
    process.stdout.write(d ? `${q} [${d}]: ` : `${q}: `);
    const { value, done } = await lines.next();
    if (done) throw new Error('init: no more input');
    return value.trim() || d;
  };
  const timer = (
    await ask('Timer address (as in the browser, e.g. http://recon-nh.local:5000)')
  ).replace(/\/+$/, '');
  const timerUser = await ask(
    'RotorHazard admin username (blank if RotorHazard has no login)',
    'admin'
  );
  const timerPass = timerUser ? await ask('RotorHazard admin password') : '';
  const obsPass = await ask('OBS WebSocket password (OBS → Tools → WebSocket Server Settings)');
  const cfg = {
    timer,
    timerUser,
    timerPass,
    obs: 'ws://127.0.0.1:4455',
    obsPass,
    browserChannel: process.platform === 'win32' ? 'msedge' : 'chrome'
  };
  await fs.writeFile(file, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`saved ${file}`);
  process.stdin.destroy();
}

async function watch(cfg) {
  const timer = new Timer(cfg.timer, {
    user: cfg.timerUser,
    pass: cfg.timerPass,
    log,
    syncEveryMs: cfg.syncEveryMs
  }).connect();
  const obs = new Obs(cfg.obs, cfg.obsPass, log);
  await obs.connect();
  const session = new Session(cfg, {
    timer,
    obs: recorderFor(cfg, obs),
    now: () => performance.now(),
    setTimeout,
    clearTimeout,
    log,
    render: ({ data }) => renderRun({ cfg, data, log })
  }).start();
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
    }
  };
  log(
    `watching ${cfg.timer}; recordings via ${cfg.obs} (${cfg.recordFrom === 'scene' ? `the "${cfg.scene}" scene, Source Record` : "OBS's own recording"}); renders ${cfg.outDir || 'beside each recording'}`
  );
  const stop = async () => {
    log('stopping');
    timer.close();
    await obs.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await new Promise(() => {});
}

/** What records a run (#98): OBS's Record output, or a scene of its own through Source Record. */
export function recorderFor(cfg, obs, log = () => {}) {
  if (cfg.recordFrom !== 'scene') return obs;
  if (!cfg.scene) throw new Error('recordFrom is "scene" but no "scene" is named');
  return new SceneRecorder(obs, cfg, { log });
}

async function render(cfg, target) {
  if (!target)
    throw new Error('render: which run? give its sidecar (.gridfpv.json) or the recording');
  const file = target.endsWith('.gridfpv.json') ? target : sidecarPathFor(target);
  const data = await readSidecar(file);
  if (data.round == null) {
    // Not matched to a saved round yet (the companion was not watching at the save): ask the timer.
    const timer = new Timer(cfg.timer, {
      user: cfg.timerUser,
      pass: cfg.timerPass,
      log
    }).connect();
    const list = await new Promise((resolve, reject) => {
      timer.once('race_list', resolve);
      setTimeout(
        () => reject(new Error('render: the timer did not answer with its saved races')),
        15_000
      );
    });
    timer.close();
    const rounds = list.find((h) => h.heatId === data.heat_id)?.rounds ?? [];
    if (!rounds.length)
      throw new Error(`render: heat ${data.heat_id} has no saved round on the timer`);
    const r = rounds.at(-1);
    log(
      `render: taking heat ${data.heat_id}'s newest round, ${r.round}; edit "round" in the sidecar if that is wrong`
    );
    data.round = r.round;
    data.race_id = r.raceId;
  }
  const out = await renderRun({ cfg, data, log });
  data.name = out.title;
  data.laps_hash = lapsHash(out.lapStamps);
  data.rendered = { at: new Date().toISOString(), files: out.files };
  await writeSidecar(file, data);
  for (const f of out.files) log(`→ ${f}`);
}

async function probe(cfg) {
  log(`config: ${cfg.configFile ?? 'defaults + environment'}`);
  await new Promise((resolve) => {
    const p = spawn(cfg.ffmpeg, ['-hide_banner', '-encoders']);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', (e) => (log(`ffmpeg: not found (${cfg.ffmpeg}): ${e.message}`), resolve()));
    p.on('close', () => {
      const has = (c) => out.includes(` ${c} `);
      log(
        `ffmpeg: ${cfg.ffmpeg} — libx264 ${has('libx264') ? 'yes' : 'NO'}, libvpx-vp9 ${has('libvpx-vp9') ? 'yes' : 'NO'}, prores_ks ${has('prores_ks') ? 'yes' : 'NO'}`
      );
      resolve();
    });
  });
  if (cfg.timer) {
    const timer = new Timer(cfg.timer, {
      user: cfg.timerUser,
      pass: cfg.timerPass,
      log,
      syncEveryMs: cfg.syncEveryMs
    }).connect();
    await new Promise((resolve) => {
      const t = setTimeout(() => (log('timer: no clock sync within 15 s'), resolve()), 15_000);
      timer.once('synced', (d) => {
        clearTimeout(t);
        log(
          `timer: clock synced; differential ${Math.round(d)} ms over ${timer.samples.length} samples (spread ${Math.round(Math.max(...timer.samples.map((s) => s.differential)) - Math.min(...timer.samples.map((s) => s.differential)))} ms)`
        );
        log(`timer: ${timer.raceList.length} heat(s) with saved races`);
        resolve();
      });
    });
    timer.close();
  } else log('timer: not configured');
  const obs = new Obs(cfg.obs, cfg.obsPass, log);
  await obs.connect();
  if (obs.connected) {
    const st = await obs.recordStatus();
    log(`obs: recording ${st.active ? `ON (${Math.round(st.durationMs / 1000)} s)` : 'off'}`);
    if (cfg.recordFrom === 'scene') {
      try {
        const rec = new SceneRecorder(obs, cfg, { log });
        const filter = await rec.findFilter();
        const dir = await rec.resolveDir();
        log(
          `obs: scene "${cfg.scene}" — Source Record filter ${filter ? `"${filter}"` : 'none yet (one will be made at the first run)'}; files to ${dir}`
        );
        const vendors = await obs.ws
          .call('CallVendorRequest', {
            vendorName: 'source-record',
            requestType: 'record_stop',
            requestData: { source: '\u0000no such source' }
          })
          .then(() => 'loaded')
          .catch((e) =>
            /vendor/i.test(e.message) ? 'NOT LOADED — install Source Record' : 'loaded'
          );
        log(`obs: Source Record plugin ${vendors}`);
      } catch (e) {
        log(`obs: scene check failed: ${e.message}`);
      }
    }
  }
  await obs.close().catch(() => {});
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
