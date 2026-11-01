import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Session } from '../src/session.js';
import { readSidecar, sidecarPathFor } from '../src/sidecar.js';

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
