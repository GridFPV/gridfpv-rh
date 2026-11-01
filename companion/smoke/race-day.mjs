/**
 * The companion's race day for real (#96): a real RotorHazard (the dev rig), a real OBS
 * (the headless container, `make obs-up`), a real browser and ffmpeg. The script plays the
 * pilot on the timer's socket; the companion does the rest, and the script checks what
 * landed in /recordings:
 *
 *   1. stage → OBS records; start → the start is pinned; stop → sidecar; save → render
 *      (composite .mp4 + overlay .webm, named from the timer, the clock aligned)
 *   2. a marshal (one lap deleted through resave_laps) → the run re-renders, once
 *   3. stage, stop, discard → that recording lands in trash/
 *
 *   make rig-up obs-up && make video-test
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { io } from 'socket.io-client';
import { loadConfig } from '../src/config.js';
import { Obs } from '../src/obs.js';
import { recorderFor } from '../src/cli.js';
import { renderRun } from '../src/render.js';
import { Session } from '../src/session.js';
import { listSidecars } from '../src/sidecar.js';
import { Timer } from '../src/timer.js';

const RH_URL = process.env.RH_URL ?? 'http://localhost:5050';
const RH_USER = process.env.RH_USER ?? 'admin';
const RH_PASS = process.env.RH_PASS ?? 'rotorhazard';
const RECORDINGS = process.env.GRIDFPV_RECORDINGS ?? '/recordings';
// 'scene' (#98): the runs are recorded from the "Clean" scene by Source Record while OBS's own
// Record output runs the whole time, untouched — the race-day shape.
const RECORD_FROM = process.env.GRIDFPV_RECORD_FROM ?? 'obs';
// A race day's heat (#100): this many pilots on seats, every one flying, and the overlay in its
// field form — the table of the heat — rendered onto the one clean recording. 1 = RaceGOW (solo).
const PILOTS = Math.max(1, Math.min(4, Number(process.env.GRIDFPV_PILOTS ?? 1)));
const CALLSIGNS = ['Ace', 'Bee', 'Cal', 'Dee'];
// Seat 2 (node 1) stays Ace's, as the marshal step expects; the rest fill seats 1, 3, 4.
const SEATS = [1, 0, 2, 3];
const t0 = Date.now();
const log = (m) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${m}`);
const fail = (m) => {
  console.error(`\nRACE DAY FAILED: ${m}`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(label, fn, timeoutMs = 20_000, everyMs = 250) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) fail(`waited ${timeoutMs / 1000} s for: ${label}`);
    await sleep(everyMs);
  }
}

// ---- the pilot: RotorHazard's socket and JSON API, as the e2e rig drives them ----
const auth = 'Basic ' + Buffer.from(`${RH_USER}:${RH_PASS}`).toString('base64');
const api = async (p) => {
  for (let i = 0; ; i++) {
    const r = await fetch(RH_URL + p, { headers: { Authorization: auth } });
    if (r.status < 500 || i > 8) {
      if (!r.ok) fail(`${p} → ${r.status}`);
      return r.json();
    }
    await sleep(500);
  }
};
const rig = io(RH_URL, {
  path: '/socket.io',
  transports: ['websocket'],
  forceNew: true,
  extraHeaders: { Authorization: auth }
});
await new Promise((res, rej) => (rig.once('connect', res), rig.once('connect_error', rej)));
const status = async () => (await api('/api/status')).status.state;
const raceStatus = async () => Number((await status()).race_status);
const rounds = async (heatId) =>
  (await api('/api/race/all')).races.heats.find((h) => h.id === heatId)?.rounds ?? 0;
const loadData = (type) =>
  new Promise((resolve) => {
    rig.once(type, resolve);
    rig.emit('load_data', { load_types: [type] });
  });

// A clean slate: RotorHazard's own reset (races/heats/pilots), min lap 1 s.
const st0 = await status();
if (st0.race_status === 3 || st0.race_status === 1) rig.emit('stop_race');
if ((await raceStatus()) !== 0) rig.emit('discard_laps');
rig.emit('reset_database', { reset_type: 'all', with_archive: false });
await until(
  'database reset',
  async () =>
    (await api('/api/pilot/all')).pilots.length === 0 &&
    (await api('/api/heat/all')).heats &&
    Object.keys((await api('/api/heat/all')).heats).length === 0
);
rig.emit('set_min_lap', { min_lap: 1 });
rig.emit('set_min_lap_behavior', { min_lap_behavior: 0 });
const pilotIds = [];
for (let i = 0; i < PILOTS; i++) {
  rig.emit('add_pilot');
  const pilot = await until(
    `pilot ${i + 1}`,
    async () => (await api('/api/pilot/all')).pilots.filter((p) => !pilotIds.includes(p.id))[0]
  );
  pilotIds.push(pilot.id);
  rig.emit('alter_pilot', { pilot_id: pilot.id, callsign: CALLSIGNS[i], name: CALLSIGNS[i] });
}
const pilotId = pilotIds[0];
rig.emit('add_heat', {});
const heat = await until(
  'new heat',
  async () => Object.values((await api('/api/heat/all')).heats)[0]
);
rig.emit('alter_heat', { heat: heat.heat_id, name: 'Video A' });
const heatData = await until('heat_data', async () =>
  (await loadData('heat_data')).heats?.find((h) => h.id === heat.heat_id)
);
for (let i = 0; i < PILOTS; i++) {
  const slot = heatData.slots.find((s) => s.node_index === SEATS[i]);
  rig.emit('alter_heat', { heat: heat.heat_id, slot_id: slot.id, pilot: pilotIds[i], method: 0 });
  await until(
    `${CALLSIGNS[i]} on seat ${SEATS[i] + 1}`,
    async () =>
      Object.values((await api('/api/heat/all')).heats).find((h) => h.heat_id === heat.heat_id)
        ?.nodes_pilots?.[String(SEATS[i])] === pilotIds[i]
  );
}
// Every seat in use needs a frequency, or its crossings go nowhere (the rig's profile only
// tunes a few): Raceband 1–4.
const FREQS = [5658, 5695, 5732, 5769];
for (let i = 0; i < PILOTS; i++)
  rig.emit('set_frequency', {
    node: SEATS[i],
    frequency: FREQS[SEATS[i]],
    band: 'R',
    channel: SEATS[i] + 1
  });
rig.emit('set_current_heat', { heat: heat.heat_id });
await until('heat loaded', async () => (await status()).current_heat === heat.heat_id);
log(
  `rig ready: heat ${heat.heat_id} "Video A", ${CALLSIGNS.slice(0, PILOTS).join(', ')} on seat${PILOTS > 1 ? 's' : ''} ${SEATS.slice(
    0,
    PILOTS
  )
    .map((s) => s + 1)
    .join(', ')}`
);
await fs.mkdir(RECORDINGS, { recursive: true });
const before = new Set(await fs.readdir(RECORDINGS));

// ---- the companion, for real ----
const cfg = {
  ...loadConfig({ env: { ...process.env, GRIDFPV_TIMER: RH_URL } }),
  timerUser: RH_USER,
  timerPass: RH_PASS,
  browserChannel: '',
  tailSeconds: 2,
  discardAfterSeconds: 6,
  width: 1280,
  height: 720,
  fps: 30,
  recordFrom: RECORD_FROM,
  scene: process.env.GRIDFPV_SCENE ?? 'Clean',
  layout: PILOTS > 1 ? 'field' : 'solo'
};
const companionLines = [];
log(
  `recording from ${RECORD_FROM === 'scene' ? `the "${cfg.scene}" scene (Source Record)` : "OBS's own Record output"}`
);
const clog = (m) => (companionLines.push(String(m)), log(`  companion: ${m}`));
const timer = new Timer(cfg.timer, {
  user: cfg.timerUser,
  pass: cfg.timerPass,
  log: clog,
  syncEveryMs: 300
}).connect();
const obs = new Obs(cfg.obs, cfg.obsPass, clog);
await obs.connect();
if (!obs.connected) fail(`no OBS at ${cfg.obs} (make obs-up)`);
if (RECORD_FROM === 'scene') {
  // The whole-day recording OBS keeps regardless of the runs.
  if (!(await obs.recordStatus()).active) await obs.startRecord();
  log('OBS main recording ON for the whole day; the runs must not touch it');
}
const session = new Session(cfg, {
  timer,
  obs: recorderFor(cfg, obs, clog),
  now: () => performance.now(),
  setTimeout,
  clearTimeout,
  log: clog,
  render: ({ data }) => renderRun({ cfg, data, log: clog })
}).start();
await new Promise((resolve) => timer.once('synced', resolve));
log(`companion synced to the timer's clock (${timer.samples.length} samples)`);

// ---- 1. a run: stage, fly three crossings, stop, save ----
rig.emit('stage_race');
await until('racing', async () => (await raceStatus()) === 1, 30_000, 100);
const started = Date.now();
// Ace's three crossings; the other pilots cross a little later each, so the field has an order.
const crossings = [];
for (let i = 0; i < PILOTS; i++)
  for (const at of [500, 2000, 3600]) crossings.push({ at: at + i * 150, node: SEATS[i] });
crossings.sort((a, b) => a.at - b.at);
for (const c of crossings) {
  await sleep(Math.max(0, started + c.at - Date.now()));
  rig.emit('simulate_lap', { node: c.node });
}
await sleep(1200);
rig.emit('stop_race');
await until('stopped', async () => (await raceStatus()) === 2, 10_000, 100);
rig.emit('save_laps');
await until('round 1 saved', async () => (await rounds(heat.heat_id)) === 1);
log('run 1 saved on the timer');

const sidecarOf = async () =>
  (await listSidecars(RECORDINGS)).find((s) => !before.has(path.basename(s.file)));
const side = await until(
  'the sidecar, rendered',
  async () => {
    const s = await sidecarOf();
    return s?.data.rendered ? s : null;
  },
  180_000,
  1000
);
const d = side.data;
log(`sidecar: ${path.basename(side.file)}`);
log(
  `  recording ${path.basename(d.recording)}, start at ${d.race_start_ms} ms, staging at ${d.staging_ms} ms, end at ${d.end_ms} ms, length ${d.duration_ms} ms`
);
log(`  round ${d.round}, race ${d.race_id}, name "${d.name}", laps ${d.laps_hash}`);
if (!(await fs.stat(d.recording)).size) fail('the recording is empty');
if (!(d.race_start_ms > 0 && d.race_start_ms < 15_000))
  fail(`race_start_ms ${d.race_start_ms} is not inside the first seconds of the file`);
if (!(d.staging_ms < 0 && d.staging_ms > -15_000)) fail(`staging_ms ${d.staging_ms}`);
if (!(d.end_ms > 4000 && d.end_ms < 15_000)) fail(`end_ms ${d.end_ms}`);
if (!(d.duration_ms > d.race_start_ms + d.end_ms)) fail('the recording is shorter than the race');
if (d.round !== 1 || (d.name !== 'Video A · Round 1 · E2E event' && !/Video A/.test(d.name)))
  fail(`name/round: ${d.name} / ${d.round}`);
if (PILOTS > 1 && !companionLines.some((l) => /render: .*layout=field/.test(l)))
  fail('the field overlay was not what rendered (no layout=field in the render URL)');
const composite = d.rendered.files.find((f) => f.endsWith('.mp4'));
const overlay = d.rendered.files.find((f) => f.endsWith('.webm'));
if (!composite || !overlay) fail(`rendered files: ${d.rendered.files.join(', ')}`);
const probe = (file) =>
  new Promise((resolve) => {
    const p = spawn(cfg.ffmpeg.replace(/ffmpeg$/, 'ffprobe'), [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,codec_name,width,height,nb_read_frames,pix_fmt:stream_side_data:stream_tags:format=duration',
      '-count_frames',
      '-of',
      'json',
      file
    ]);
    let out = '';
    p.stdout.on('data', (x) => (out += x));
    p.on('close', () => resolve(JSON.parse(out || '{}')));
  });
const pc = await probe(composite);
const po = await probe(overlay);
const video = pc.streams?.find((s) => s.codec_type === 'video');
log(
  `composite: ${path.basename(composite)} — ${video?.codec_name} ${video?.width}x${video?.height}, ${Number(pc.format?.duration).toFixed(2)} s, ${video?.nb_read_frames} frames`
);
log(
  `overlay:   ${path.basename(overlay)} — ${po.streams?.[0]?.codec_name} ${po.streams?.[0]?.pix_fmt}, ${po.streams?.[0]?.nb_read_frames} frames`
);
if (video?.codec_name !== 'h264') fail('the composite is not h264');
const prec = await probe(d.recording);
log(
  `recording: ${Number(prec.format?.duration).toFixed(2)} s on disk (sidecar says ${d.duration_ms} ms)`
);
if (Math.abs(Number(pc.format.duration) - Number(prec.format.duration)) > 0.5)
  fail(`the composite is ${pc.format.duration} s, the recording ${prec.format.duration} s`);
if (Math.abs(Number(prec.format.duration) * 1000 - d.duration_ms) > 500)
  fail(`the sidecar's length ${d.duration_ms} ms is not the file's ${prec.format.duration} s`);
// VP9 alpha in WebM: the second plane is a block addition, which ffprobe reports as alpha_mode.
const alpha =
  /yuva/.test(po.streams?.[0]?.pix_fmt ?? '') || JSON.stringify(po).includes('alpha_mode');
if (po.streams?.[0]?.codec_name !== 'vp9' || !alpha)
  fail('the overlay track is not VP9 with alpha');

// ---- 2. a marshal: delete the second crossing; the run re-renders, once ----
const list = await loadData('race_list');
const saved = Object.values(list.heats).find((h) => Number(h.heat_id) === heat.heat_id).rounds['1'];
// RotorHazard agrees: every pilot on a seat has a saved race in the round (so the field has
// them all); it also keeps one per tuned seat with no pilot, which the overlay does not list.
const flown = saved.pilotraces.filter((x) => pilotIds.includes(Number(x.pilot_id)));
if (flown.length !== PILOTS)
  fail(`RotorHazard saved races for ${flown.length} of the ${PILOTS} pilots in round 1`);
const pr = saved.pilotraces.find((x) => Number(x.pilot_id) === pilotId);
const details = await new Promise((resolve) => {
  rig.once('race_details', resolve);
  rig.emit('get_pilotrace', { pilotrace_id: pr.pilotrace_id });
});
if (details.laps.length !== 3) fail(`expected 3 crossings, RotorHazard has ${details.laps.length}`);
const laps = details.laps.map((l, i) => ({ ...l, deleted: i === 1 }));
const renderedBefore = d.rendered.at;
rig.emit('resave_laps', {
  heat_id: heat.heat_id,
  round_id: 1,
  callsign: 'Ace',
  race_id: saved.race_id,
  pilotrace_id: pr.pilotrace_id,
  seat: 1,
  pilot_id: pilotId,
  laps,
  enter_at: details.enter_at,
  exit_at: details.exit_at
});
log('marshalled: crossing 2 deleted');
const again = await until(
  'the re-render',
  async () => {
    const s = await sidecarOf();
    return s && s.data.rendered.at !== renderedBefore && s.data.laps_hash !== d.laps_hash
      ? s
      : null;
  },
  180_000,
  1000
);
log(`re-rendered: laps ${again.data.laps_hash} (was ${d.laps_hash}) at ${again.data.rendered.at}`);
await sleep(4000);
if ((await sidecarOf()).data.rendered.at !== again.data.rendered.at)
  fail('rendered a third time with no change');

// ---- 2b. the overlay moves on the timer: the run renders again, with the new look ----
const renderedBeforeLook = again.data.rendered.at;
rig.emit('gridfpv_overlay_set', { corner: 'bottom-right', x: 40, y: 30, scale: 150 });
const moved = await until(
  'the re-render after the placement change',
  async () => {
    const s = await sidecarOf();
    return s && s.data.rendered.at !== renderedBeforeLook ? s : null;
  },
  180_000,
  1000
);
if (!/bottom-right/.test(moved.data.look ?? '')) fail(`the sidecar's look is ${moved.data.look}`);
log(`re-rendered for the new placement: look ${moved.data.look}`);
rig.emit('gridfpv_overlay_set', { corner: 'top-left', x: 24, y: 24, scale: 100 });
await sleep(1000);

// ---- 3. a discard: stage, stop, discard → trash ----
const filesBefore = new Set(await fs.readdir(RECORDINGS));
rig.emit('stage_race');
await until('racing again', async () => (await raceStatus()) === 1, 30_000, 100);
await sleep(1500);
rig.emit('stop_race');
await until('stopped again', async () => (await raceStatus()) === 2, 10_000, 100);
await sleep(2500); // past the tail: the recording has stopped before the discard
rig.emit('discard_laps');
await until('ready', async () => (await raceStatus()) === 0, 10_000, 100);
const trashed = await until(
  'the discarded recording in trash/',
  async () => {
    const now = await fs.readdir(RECORDINGS);
    const fresh = now.filter((n) => !filesBefore.has(n) && n !== 'trash');
    let trash = [];
    try {
      trash = await fs.readdir(path.join(RECORDINGS, 'trash'));
    } catch {}
    return fresh.length === 0 && trash.some((n) => n.endsWith('.mkv')) ? trash : null;
  },
  30_000,
  500
);
log(`discarded run in trash/: ${trashed.join(', ')}`);
if ((await rounds(heat.heat_id)) !== 1) fail('the discard saved a round');

if (RECORD_FROM === 'scene') {
  const st = await obs.recordStatus();
  if (!st.active) fail("OBS's own recording stopped: the runs touched it");
  log(`OBS main recording still ON after ${Math.round(st.durationMs / 1000)} s`);
  const whole = await obs.stopRecord();
  log(`OBS main recording stopped → ${whole}`);
  if (!path.basename(d.recording).startsWith('clean heat'))
    fail(`the run was not recorded by Source Record: ${d.recording}`);
}
log('RACE DAY OK');
timer.close();
rig.close();
await obs.close().catch(() => {});
process.exit(0);
