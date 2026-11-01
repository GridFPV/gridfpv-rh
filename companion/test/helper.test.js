import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Helper, FIELDS } from '../src/helper.js';
import { Profiles } from '../src/profiles.js';
import { DEFAULTS } from '../src/config.js';
import { startServer } from '../src/server.js';

/** A timer and an OBS that connect at once and do nothing else. */
class FakeTimer extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.raceList = [];
    this.samples = [];
  }
  connect() {
    setImmediate(() => {
      this.emit('connected');
      this.emit('synced', 12);
    });
    return this;
  }
  localMs() {
    return null;
  }
  close() {
    this.closed = true;
  }
  refreshRaceList() {
    return Promise.resolve([]);
  }
}
class FakeObs extends EventEmitter {
  constructor(url, pass) {
    super();
    this.url = url;
    this.ws = {
      call: async (type) => {
        if (type === 'CallVendorRequest' && pass === 'noplugin')
          throw new Error('No vendor was found by that name.');
        return {};
      }
    };
  }
  async connect() {
    this.connected = true;
    this.emit('connected', { obsVersion: '33.1.0' });
  }
  async recordStatus() {
    return { active: false, paused: false, durationMs: 0 };
  }
  async startRecord() {}
  async stopRecord() {
    return null;
  }
  async close() {
    this.closed = true;
  }
}

test('every settings field is a config key with its default, and the groups read in order', () => {
  for (const f of FIELDS) {
    assert.ok(f.key in DEFAULTS, f.key);
    assert.equal(f.default, DEFAULTS[f.key]);
  }
  assert.deepEqual(
    [...new Set(FIELDS.map((f) => f.group))],
    ['Timer', 'OBS', 'Recording', 'Renders', 'Tools']
  );
});

test('the helper starts a profile, reports both connections, logs, stops, and refuses a profile without a timer', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gridfpv-helper-'));
  const profiles = new Profiles({ dir });
  await profiles.save('Practice', { timer: 'http://t:5000', obsPass: 'x' });
  await profiles.save('Empty', {});
  const helper = new Helper({
    profiles,
    version: '9.9.9',
    deps: { Timer: FakeTimer, Obs: FakeObs, ffmpegPath: async () => '/bin/ffmpeg' }
  });
  const changes = [];
  helper.on('change', (s) => changes.push(s));
  let snap = helper.snapshot();
  assert.equal(snap.running, null);
  assert.equal(snap.version, '9.9.9');

  await assert.rejects(() => helper.start('Empty'), /no timer address/);
  snap = await helper.start('Practice');
  assert.equal(snap.running.profile, 'Practice');
  assert.equal(snap.running.recordFrom, 'obs');
  assert.equal(snap.status.obs.connected, true);
  assert.equal(snap.status.obs.version, '33.1.0');
  await new Promise((r) => setImmediate(r));
  snap = helper.snapshot();
  assert.equal(snap.status.timer.connected, true);
  assert.equal(snap.status.timer.synced, true);
  assert.equal(snap.status.timer.differential, 12);
  assert.equal((await profiles.state()).lastProfile, 'Practice');
  assert.ok(helper.lines.some((l) => /watching http:\/\/t:5000/.test(l.text)));
  assert.equal(helper.running.cfg.ffmpeg, '/bin/ffmpeg');

  const { timer, obs } = helper.running;
  await helper.stop();

  // A profile that records from a scene, against an OBS without the plugin: said, with the link.
  await profiles.save('Scene', {
    timer: 'http://t:5000',
    obsPass: 'noplugin',
    recordFrom: 'scene',
    scene: 'Clean'
  });
  await helper.start('Scene');
  await new Promise((r) => setImmediate(r));
  assert.equal(helper.snapshot().status.obs.sourceRecord, false);
  assert.ok(
    helper.lines.some((l) =>
      /Source Record plugin is not loaded.*github\.com\/exeldro/.test(l.text)
    )
  );
  await profiles.save('SceneOk', { timer: 'http://t:5000', recordFrom: 'scene', scene: 'Clean' });
  await helper.start('SceneOk');
  await new Promise((r) => setImmediate(r));
  assert.equal(helper.snapshot().status.obs.sourceRecord, true);
  await helper.stop();
  assert.equal(timer.closed, true);
  assert.equal(obs.closed, true);
  assert.equal(helper.snapshot().running, null);
  assert.equal(helper.snapshot().status.timer.connected, false);
  assert.ok(changes.length >= 3);
});

test('the server answers the window: status, profiles round trip, start/stop, and the event stream', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gridfpv-server-'));
  const uiDir = path.join(dir, 'ui');
  await fs.mkdir(uiDir);
  await fs.writeFile(path.join(uiDir, 'index.html'), '<!doctype html><title>GridFPV Video</title>');
  const profiles = new Profiles({ dir });
  const helper = new Helper({
    profiles,
    deps: { Timer: FakeTimer, Obs: FakeObs, ffmpegPath: async () => 'ffmpeg' }
  });
  const srv = await startServer({
    helper,
    port: 0,
    uiDir,
    probe: async (cfg) => ({
      timer: { ok: cfg.timer === 'http://t:5000' },
      obs: { ok: true, scenes: [{ name: 'Clean', sourceRecordFilters: [] }] }
    }),
    pick: async (kind, start) =>
      kind === 'folder' ? `/picked/${start || 'home'}` : { unsupported: true }
  });
  const api = async (method, p, data) => {
    const r = await fetch(srv.origin + p, {
      method,
      headers: data ? { 'content-type': 'application/json' } : {},
      body: data ? JSON.stringify(data) : undefined
    });
    return { status: r.status, body: await r.json() };
  };
  try {
    assert.equal((await api('GET', '/api/status')).body.running, null);
    const page = await fetch(srv.origin + '/anything/deep');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /GridFPV Video/);

    let r = await api('PUT', '/api/profiles/Race%20day', {
      timer: 'http://t:5000',
      recordFrom: 'scene',
      scene: 'Clean'
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.name, 'Race day');
    r = await api('PUT', '/api/profiles/Bad', { nope: 1 });
    assert.equal(r.status, 500);
    assert.match(r.body.error, /unknown setting/);
    r = await api('GET', '/api/profiles');
    assert.deepEqual(
      r.body.profiles.map((p) => p.name),
      ['Race day']
    );
    assert.equal(r.body.fields.length, FIELDS.length);
    assert.equal(r.body.defaults.fps, 30);
    r = await api('POST', '/api/profiles/Race%20day/rename', { to: 'Sunday' });
    assert.equal(r.body.name, 'Sunday');

    // The event stream: a snapshot on connect, then a change when a session starts.
    const ctrl = new AbortController();
    const es = await fetch(srv.origin + '/api/events', { signal: ctrl.signal });
    const reader = es.body.getReader();
    const read = async (want) => {
      let text = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) throw new Error('stream ended');
        text += Buffer.from(value).toString('utf8');
        if (text.includes(`event: ${want}\n`)) return text;
      }
    };
    assert.match(await read('snapshot'), /"running":null/);
    r = await api('POST', '/api/start', { profile: 'Sunday' });
    assert.equal(r.status, 200);
    assert.equal(r.body.running.profile, 'Sunday');
    assert.equal(r.body.running.recordFrom, 'scene');
    assert.match(await read('change'), /"profile":"Sunday"/);
    r = await api('POST', '/api/start', { profile: 'Nope' });
    assert.equal(r.status, 500);
    r = await api('POST', '/api/stop');
    assert.equal(r.body.running, null);
    ctrl.abort();

    r = await api('DELETE', '/api/profiles/Sunday');
    assert.deepEqual((await api('GET', '/api/profiles')).body.profiles, []);
    // The connections tried from a few settings (defaults filled in), and the OS's picker.
    r = await api('POST', '/api/probe', { settings: { timer: 'http://t:5000/' } });
    assert.deepEqual(r.body, {
      timer: { ok: true },
      obs: { ok: true, scenes: [{ name: 'Clean', sourceRecordFilters: [] }] }
    });
    r = await api('POST', '/api/pick', { kind: 'folder', start: 'D:' });
    assert.deepEqual(r.body, { path: '/picked/D:' });
    r = await api('POST', '/api/pick', { kind: 'file' });
    assert.deepEqual(r.body, { unsupported: true });
    r = await api('GET', '/api/browse?dir=' + encodeURIComponent(dir));
    assert.deepEqual(r.body.folders, ['profiles', 'ui']);
    assert.equal((await api('GET', '/api/nothing')).status, 404);
  } finally {
    await helper.stop();
    await srv.close();
  }
});
