import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { probeSettings } from '../src/probe.js';
import { pickCommand, pickPath } from '../src/pick.js';

class FakeTimer extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.raceList = [{}, {}];
  }
  connect() {
    if (this.url.includes('down')) return this;
    setImmediate(() => {
      this.emit('connected');
      this.emit('synced', 7);
    });
    return this;
  }
  close() {
    this.closed = true;
  }
}
class FakeObs {
  constructor(url, pass) {
    this.url = url;
    this.pass = pass;
    this.connected = false;
    this.ws = {
      call: async (type, data) => {
        switch (type) {
          case 'GetVersion':
            return { obsVersion: '33.1.0' };
          case 'GetRecordDirectory':
            return { recordDirectory: 'D:\\Recordings' };
          case 'GetSceneList':
            return { scenes: [{ sceneName: 'Clean' }, { sceneName: 'Program' }] };
          case 'GetSourceFilterList':
            return data.sourceName === 'Clean'
              ? {
                  filters: [
                    { filterName: 'Rec', filterKind: 'source_record_filter' },
                    { filterName: 'Blur', filterKind: 'gpu_blur' }
                  ]
                }
              : { filters: [] };
          case 'CallVendorRequest':
            if (this.pass === 'noplugin') throw new Error('No vendor was found by that name.');
            return { responseData: { success: false, error: 'source not found' } };
          default:
            throw new Error(type);
        }
      }
    };
  }
  async connect() {
    this.connected = this.pass !== 'wrong';
  }
  async close() {
    this.closed = true;
  }
}

test('a probe tries both connections, lists scenes and their Source Record filters, and closes', async () => {
  const r = await probeSettings(
    { timer: 'http://t', timerUser: 'a', timerPass: 'b', obs: 'ws://o', obsPass: 'ok' },
    { Timer: FakeTimer, Obs: FakeObs, timeoutMs: 500 }
  );
  assert.equal(r.timer.ok, true);
  assert.equal(r.timer.synced, true);
  assert.equal(r.timer.differential, 7);
  assert.equal(r.timer.heats, 2);
  assert.equal(r.obs.ok, true);
  assert.equal(r.obs.version, '33.1.0');
  assert.equal(r.obs.recordDirectory, 'D:\\Recordings');
  assert.deepEqual(r.obs.scenes, [
    { name: 'Program', sourceRecordFilters: [] },
    { name: 'Clean', sourceRecordFilters: ['Rec'] }
  ]);
  assert.equal(r.obs.sourceRecord, true);
});

test('a probe says what failed: a silent timer, a refused OBS, a missing plugin', async () => {
  const r = await probeSettings(
    { timer: 'http://down', obs: 'ws://o', obsPass: 'wrong' },
    { Timer: FakeTimer, Obs: FakeObs, timeoutMs: 200 }
  );
  assert.equal(r.timer.ok, false);
  assert.match(r.timer.error, /no answer/);
  assert.equal(r.obs.ok, false);
  assert.match(r.obs.error, /cannot connect/);
  const r2 = await probeSettings(
    { timer: '', obs: 'ws://o', obsPass: 'noplugin' },
    { Timer: FakeTimer, Obs: FakeObs, timeoutMs: 200 }
  );
  assert.equal(r2.timer.ok, false);
  assert.equal(r2.obs.ok, true);
  assert.equal(r2.obs.sourceRecord, false);
});

test('a probe of OBS alone never touches the timer (the window reconnects to OBS by itself)', async () => {
  class NoTimer {
    constructor() {
      throw new Error('the timer was tried');
    }
  }
  const r = await probeSettings(
    { timer: 'http://down', obs: 'ws://o', obsPass: 'ok' },
    { Timer: NoTimer, Obs: FakeObs, timeoutMs: 200, only: 'obs' }
  );
  assert.deepEqual(r.timer, { ok: false, skipped: true, error: null });
  assert.equal(r.obs.ok, true);
  assert.equal(r.obs.scenes.length, 2);
  const r2 = await probeSettings(
    { timer: 'http://t', obs: 'ws://o', obsPass: 'wrong' },
    { Timer: FakeTimer, Obs: FakeObs, timeoutMs: 200, only: 'timer' }
  );
  assert.equal(r2.timer.ok, true);
  assert.equal(r2.obs.skipped, true);
});

test('the native picker command follows the platform; a missing dialog or a cancel is reported, not thrown', async () => {
  assert.equal(pickCommand('folder', '', 'win32').cmd, 'powershell');
  assert.match(
    pickCommand('folder', "C:\\Ryan's", 'win32').args.at(-1),
    /FolderBrowserDialog.*C:\\Ryan''s/
  );
  assert.match(pickCommand('file', '', 'win32').args.at(-1), /OpenFileDialog/);
  assert.deepEqual(pickCommand('folder', '/Users/r', 'darwin').args, [
    '-e',
    'POSIX path of (choose folder default location POSIX file "/Users/r")'
  ]);
  assert.deepEqual(pickCommand('file', '', 'linux'), { cmd: 'zenity', args: ['--file-selection'] });
  assert.deepEqual(pickCommand('folder', '/x', 'linux').args, [
    '--file-selection',
    '--directory',
    '--filename=/x/'
  ]);

  assert.equal(
    await pickPath('folder', '', { platform: 'linux', run: async () => '/tmp/out/\n' }),
    '/tmp/out'
  );
  assert.equal(await pickPath('folder', '', { platform: 'linux', run: async () => '' }), null);
  assert.deepEqual(
    await pickPath('folder', '', {
      platform: 'linux',
      run: async () => {
        throw Object.assign(new Error('x'), { code: 'ENOENT' });
      }
    }),
    { unsupported: true }
  );
  assert.equal(
    await pickPath('file', '', {
      platform: 'linux',
      run: async () => {
        throw Object.assign(new Error('c'), { cancelled: true });
      }
    }),
    null
  );
});
