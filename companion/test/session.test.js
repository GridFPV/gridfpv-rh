import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Session } from '../src/session.js';
import { readSidecar, sidecarPathFor, writeSidecar } from '../src/sidecar.js';

/** A race day in a box: fake timer, fake OBS, a render that records what it was asked. */
function rig({ trashDiscarded = true } = {}) {
  let clock = 100_000; // local ms
  const timers = [];
  const timer = Object.assign(new EventEmitter(), {
    raceList: [],
    diff: 0,
    localMs(s) {
      return s == null ? null : s * 1000 - 500_000; // timer clock runs 500 s ahead of local
    },
    pilotRace: async (id) => timer.races[id],
    races: {},
    asked: 0,
    refreshRaceList: async () => {
      timer.asked++;
    }
  });
  const obs = {
    active: false,
    startedAt: null,
    file: null,
    async recordStatus() {
      return {
        active: this.active,
        paused: false,
        durationMs: this.active ? clock - this.startedAt : 0
      };
    },
    async startRecord() {
      this.active = true;
      this.startedAt = clock;
    },
    async stopRecord() {
      this.active = false;
      return this.file;
    }
  };
  const renders = [];
  const deps = {
    timer,
    obs,
    now: () => clock,
    setTimeout: (fn, ms) => {
      const t = { at: clock + ms, fn };
      timers.push(t);
      return t;
    },
    clearTimeout: (t) => {
      const i = timers.indexOf(t);
      if (i >= 0) timers.splice(i, 1);
    },
    render: async ({ data }) => {
      renders.push({ ...data });
      return {
        title: `RaceGOW 2 Track 4 Round ${data.round}`,
        look: deps.look,
        lapStamps: [2000, 3600],
        files: [path.join(path.dirname(data.recording), 'render.mp4')]
      };
    },
    log: () => {}
  };
  const advance = async (ms) => {
    clock += ms;
    for (const t of [...timers].filter((t) => t.at <= clock)) {
      timers.splice(timers.indexOf(t), 1);
      await t.fn();
    }
    await new Promise((r) => setImmediate(r));
  };
  return {
    timer,
    obs,
    deps,
    renders,
    advance,
    tick: () => new Promise((r) => setImmediate(r))
  };
}

test('staging starts the recording, the start is pinned by elapsed time, the stop writes a sidecar, a saved round renders', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gridfpv-session-'));
  const { timer, obs, deps, renders, advance, tick } = rig();
  obs.file = path.join(dir, 'rec.mkv');
  await fs.writeFile(obs.file, '');
  const s = new Session(
    { tailSeconds: 3, discardAfterSeconds: 8, trashDiscarded: true },
    deps
  ).start();

  // Staging at local 100000 (timer 600.000 s); start 2.5 s later.
  timer.emit('stage_ready', {
    status: 3,
    heatId: 4,
    nextRound: 7,
    startsAt: 602.5,
    stagingAt: 600.0
  });
  await tick();
  assert.equal(obs.active, true);
  await advance(2500);
  timer.emit('race_status', {
    status: 1,
    heatId: 4,
    nextRound: 7,
    startsAt: 602.5,
    stagingAt: 600.0
  });
  await tick();
  assert.equal(s.recording.raceStartMs, 2500);
  assert.equal(s.recording.stagingMs, -2500);
  // Stopped 30 s after the start; the tail keeps recording 3 s.
  await advance(30_000);
  timer.emit('race_status', {
    status: 2,
    heatId: 4,
    nextRound: 7,
    startsAt: 602.5,
    stagingAt: 600.0
  });
  await tick();
  assert.equal(s.recording.endMs, 30_000);
  assert.equal(obs.active, true);
  await advance(3000);
  assert.equal(obs.active, false);
  const side = sidecarPathFor(obs.file);
  const data = await readSidecar(side);
  assert.equal(data.race_start_ms, 2500);
  assert.equal(data.end_ms, 30_000);
  assert.equal(data.duration_ms, 35_500);
  assert.equal(data.round, null);
  // Saved: the heat gains round 7; the run is named and rendered, the sidecar completed.
  timer.raceList = [
    {
      heatId: 4,
      rounds: [{ round: 7, raceId: 42, pilotraces: [{ pilotraceId: 9 }] }]
    }
  ];
  timer.emit('race_status', { status: 0, heatId: 4, nextRound: 8 });
  await advance(300);
  assert.ok(timer.asked >= 1, 'asked RotorHazard for the saved races after Ready');
  timer.emit('race_list', timer.raceList);
  await s.tasks; // the save names the run first, then renders
  await s.renderQueue;
  await tick();
  assert.equal(renders.length, 1);
  assert.equal(renders[0].round, 7);
  const done = await readSidecar(side);
  assert.equal(done.name, 'RaceGOW 2 Track 4 Round 7');
  assert.equal(done.race_id, 42);
  assert.ok(done.laps_hash);
  assert.deepEqual(done.rendered.files, [path.join(dir, 'render.mp4')]);
  // Ready came before the list, so a discard timer was set; it must not fire now.
  await advance(10_000);
  assert.equal(renders.length, 1);
  assert.ok(await fs.stat(obs.file));

  // A marshal: results change, the laps differ → one re-render; unchanged laps → none.
  timer.races[9] = {
    pilotraceId: 9,
    laps: [{ stampMs: 500 }, { stampMs: 2000 }, { stampMs: 3600, deleted: true }, { stampMs: 5900 }]
  };
  await s.checkResults();
  await s.renderQueue;
  assert.equal(renders.length, 2);
  // Now the page reports what the sidecar has (the fake render always says [2000, 3600]).
  timer.races[9] = {
    pilotraceId: 9,
    laps: [{ stampMs: 500 }, { stampMs: 2000 }, { stampMs: 3600 }]
  };
  await s.checkResults();
  await s.renderQueue;
  assert.equal(renders.length, 2);

  // The overlay's placement changes on the timer: the run renders again with the new look,
  // and the same placement arriving again (a reconnect) does not.
  deps.look = '{"corner":"bottom-right"}';
  timer.emit('overlay', '{"corner":"top-left"}'); // the baseline, learnt on connect
  timer.emit('overlay', '{"corner":"bottom-right"}');
  await s.renderQueue;
  assert.equal(renders.length, 3);
  assert.equal((await readSidecar(side)).look, '{"corner":"bottom-right"}');
  timer.emit('overlay', '{"corner":"bottom-right"}');
  await s.renderQueue;
  assert.equal(renders.length, 3);

  // The round is deleted (#36): the recording, sidecar and render go to trash.
  await fs.writeFile(path.join(dir, 'render.mp4'), '');
  timer.raceList = [{ heatId: 4, rounds: [] }];
  timer.emit('race_list', timer.raceList);
  await s.tasks;
  assert.deepEqual((await fs.readdir(path.join(dir, 'trash'))).sort(), [
    'rec.mkv',
    'rec.mkv.gridfpv.json',
    'render.mp4'
  ]);
  await fs.rm(dir, { recursive: true });
});

test('Ready with no new round is a discard: the recording goes to trash (or stays, by setting)', async () => {
  for (const trashDiscarded of [true, false]) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gridfpv-session-'));
    const { timer, obs, deps, renders, advance, tick } = rig();
    obs.file = path.join(dir, 'rec.mkv');
    await fs.writeFile(obs.file, '');
    new Session({ tailSeconds: 1, discardAfterSeconds: 8, trashDiscarded }, deps).start();
    timer.emit('race_status', {
      status: 3,
      heatId: 4,
      nextRound: 7,
      startsAt: 601,
      stagingAt: 600
    });
    await tick();
    await advance(1000);
    timer.emit('race_status', {
      status: 1,
      heatId: 4,
      nextRound: 7,
      startsAt: 601,
      stagingAt: 600
    });
    await tick();
    await advance(5000);
    timer.emit('race_status', {
      status: 2,
      heatId: 4,
      nextRound: 7,
      startsAt: 601,
      stagingAt: 600
    });
    await tick();
    await advance(1000);
    timer.emit('race_status', { status: 0, heatId: 4, nextRound: 7 });
    await tick();
    await advance(8000);
    await tick();
    assert.equal(renders.length, 0);
    const left = (await fs.readdir(dir)).filter((n) => n !== 'trash').sort();
    if (trashDiscarded) {
      assert.deepEqual(left, []);
      assert.deepEqual((await fs.readdir(path.join(dir, 'trash'))).sort(), [
        'rec.mkv',
        'rec.mkv.gridfpv.json'
      ]);
    } else assert.deepEqual(left, ['rec.mkv', 'rec.mkv.gridfpv.json']);
    await fs.rm(dir, { recursive: true });
  }
});

test('a placement change re-renders the known runs even when the baseline arrived before the session listened', async () => {
  const { timer, deps, renders, tick } = rig();
  timer.overlayLook = '{"corner":"top-left"}'; // broadcast at connect, before start()
  const s = new Session(
    { tailSeconds: 1, discardAfterSeconds: 5, trashDiscarded: false },
    deps
  ).start();
  s.known.set('/tmp/a.gridfpv.json', {
    round: 1,
    race_id: 1,
    heat_id: 4,
    look: '{"corner":"top-left"}',
    recording: '/tmp/a.mkv'
  });
  timer.emit('overlay', '{"corner":"bottom-right"}');
  await tick();
  await s.renderQueue;
  assert.equal(renders.length, 1);
  // The same placement again: nothing to do.
  timer.emit('overlay', '{"corner":"bottom-right"}');
  await tick();
  await s.renderQueue;
  assert.equal(renders.length, 1);
});

test("render later (#105): the overlaid file takes the run's name at the save, a marshal only marks the run, Render all renders and supersedes", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gridfpv-later-'));
  const { timer, obs, deps, renders, advance, tick } = rig();
  obs.file = path.join(dir, 'clean heat 4.mkv');
  const overlaid = path.join(dir, 'live heat 4.mkv');
  await fs.writeFile(obs.file, '');
  await fs.writeFile(overlaid, 'overlaid');
  obs.stopRecord = async () => {
    obs.active = false;
    return { file: obs.file, overlaid };
  };
  const titles = [];
  deps.title = async ({ data }) => {
    titles.push(data.round);
    return { title: `RaceGOW 6 Track 2 Round ${data.round}`, lapStamps: [2000, 3600], look: 'L1' };
  };
  deps.render = async ({ data }) => {
    renders.push({ ...data });
    const out = path.join(dir, 'RaceGOW 6 Track 2 Round 7 - Overlay.mp4');
    await fs.writeFile(out, 'rendered');
    return { title: 'RaceGOW 6 Track 2 Round 7', look: 'L1', lapStamps: [2000], files: [out] };
  };
  const s = new Session(
    { tailSeconds: 1, discardAfterSeconds: 5, trashDiscarded: true, renderWhen: 'later' },
    deps
  ).start();
  timer.emit('stage_ready', {
    status: 3,
    heatId: 4,
    nextRound: 7,
    startsAt: 602.5,
    stagingAt: 600
  });
  await tick();
  await advance(2500);
  timer.emit('race_status', {
    status: 1,
    heatId: 4,
    nextRound: 7,
    startsAt: 602.5,
    stagingAt: 600
  });
  await tick();
  await advance(10_000);
  timer.emit('race_status', {
    status: 2,
    heatId: 4,
    nextRound: 7,
    startsAt: 602.5,
    stagingAt: 600
  });
  await tick();
  await advance(1100);
  await tick();
  timer.raceList = [
    { heatId: 4, rounds: [{ round: 7, raceId: 70, pilotraces: [{ pilotraceId: 1 }] }] }
  ];
  timer.races = {
    1: {
      pilotraceId: 1,
      pilotId: 1,
      laps: [
        { stampMs: 0, deleted: false },
        { stampMs: 2000, deleted: false },
        { stampMs: 3600, deleted: false }
      ]
    }
  };
  timer.emit('race_status', { status: 0, heatId: 4, nextRound: 8 });
  await advance(300);
  timer.emit('race_list', timer.raceList);
  await s.tasks;
  await tick();
  // Named from the page: both files and the sidecar take the name; nothing rendered.
  assert.deepEqual(titles, [7]);
  assert.equal(renders.length, 0);
  const clean = path.join(dir, 'RaceGOW 6 Track 2 Round 7 - Clean.mkv');
  const side = sidecarPathFor(clean);
  let data = await readSidecar(side);
  assert.equal(data.name, 'RaceGOW 6 Track 2 Round 7');
  assert.equal(data.recording, clean);
  assert.equal(data.deliverable, path.join(dir, 'RaceGOW 6 Track 2 Round 7 - Overlay.mkv'));
  assert.equal(data.overlaid_recording, data.deliverable);
  assert.equal(data.needs_render, null);
  assert.deepEqual((await fs.readdir(dir)).sort(), [
    'RaceGOW 6 Track 2 Round 7 - Clean.mkv',
    'RaceGOW 6 Track 2 Round 7 - Clean.mkv.gridfpv.json',
    'RaceGOW 6 Track 2 Round 7 - Overlay.mkv'
  ]);
  assert.equal(s.runs().find((r) => r.round === 7).state, 'ready');
  // The laps as the timer has them are the baseline: the first check after the save is quiet.
  await s.checkResults();
  assert.equal((await readSidecar(side)).needs_render, null);

  // A marshal: the laps differ from the hash taken at the save → marked, still not rendered.
  timer.races[1].laps[1].deleted = true;
  timer.emit('result_data');
  await new Promise((r) => setTimeout(r, 1700));
  await tick();
  assert.equal(renders.length, 0);
  data = await readSidecar(side);
  assert.equal(data.needs_render, 'the laps changed');
  assert.equal(s.runs().find((r) => r.round === 7).state, 'needs render');

  // Render all: rendered, the OBS file superseded, the composite now the finished video.
  await s.renderAll();
  await tick();
  assert.equal(renders.length, 1);
  data = await readSidecar(side);
  assert.equal(data.needs_render, null);
  assert.equal(data.deliverable, path.join(dir, 'RaceGOW 6 Track 2 Round 7 - Overlay.mp4'));
  assert.deepEqual(await fs.readdir(path.join(dir, 'superseded')), [
    'RaceGOW 6 Track 2 Round 7 - Overlay.mkv'
  ]);
  assert.equal(s.runs().find((r) => r.round === 7).state, 'rendered');
  await fs.rm(dir, { recursive: true });
});

test('a save takes its lap baseline from the timer, not the page: a format whose first pass counts does not read as a marshal', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gridfpv-baseline-'));
  const { timer, deps, tick } = rig();
  const logs = [];
  deps.log = (l) => logs.push(l);
  // The page (a "first lap counts" format) lists every crossing; before, the helper's own
  // check dropped the first one and saw a change on every save.
  deps.title = async () => ({
    title: 'Open Class Heat 2 Round 3',
    lapStamps: [500, 2000, 3600],
    firstLapCounts: true,
    look: 'L1'
  });
  timer.raceList = [
    { heatId: 2, rounds: [{ round: 3, raceId: 20, pilotraces: [{ pilotraceId: 5 }] }] }
  ];
  timer.races[5] = {
    pilotraceId: 5,
    laps: [{ stampMs: 500 }, { stampMs: 2000 }, { stampMs: 3600 }]
  };
  const s = new Session({ tailSeconds: 1, discardAfterSeconds: 5, renderWhen: 'later' }, deps);
  s.look = 'L1';
  const rec = path.join(dir, 'clean heat 2 2026-11-01 15-01-16.mp4');
  await fs.writeFile(rec, '');
  const side = sidecarPathFor(rec);
  const data = {
    recording: rec,
    overlaid_recording: null,
    heat_id: 2,
    round: 3,
    race_id: 20,
    name: null,
    duration_ms: 64_500
  };
  await writeSidecar(side, data);
  s.known.set(side, data);
  await s.onSaved(side, data);
  await tick();
  const named = path.join(dir, 'Open Class Heat 2 Round 3 - Clean.mp4');
  assert.ok((await fs.readdir(dir)).includes('Open Class Heat 2 Round 3 - Clean.mp4'));
  assert.equal(data.first_lap_counts, true);
  assert.equal(data.needs_render, 'no overlaid recording'); // the one true reason, kept
  assert.ok([...s.known.keys()].includes(sidecarPathFor(named)));
  await s.checkResults();
  assert.ok(!logs.some((l) => l.startsWith('laps changed')), logs.join('\n'));
  assert.equal(data.needs_render, 'no overlaid recording');
  // A real marshal still counts.
  timer.races[5].laps[1].deleted = true;
  await s.checkResults();
  assert.ok(logs.some((l) => l === 'laps changed for Open Class Heat 2 Round 3'));
  await fs.rm(dir, { recursive: true });
});
