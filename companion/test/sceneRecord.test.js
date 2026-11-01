import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { SceneRecorder, TwoSceneRecorder } from '../src/sceneRecord.js';

/** An obs-websocket that answers like OBS 32 + Source Record 0.4.8 did in the spike (#98). */
function fakeObs({
  filters = [{ filterName: 'Source Record', filterKind: 'source_record_filter' }]
} = {}) {
  const calls = [];
  const state = { active: false, startedAt: 0, filename: null, files: [] };
  const ws = {
    async call(type, data = {}) {
      calls.push([type, data]);
      switch (type) {
        case 'GetSourceFilterList':
          return { filters };
        case 'GetSourceFilter':
          return { filterSettings: { path: '/rec', rec_format: 'mkv' } };
        case 'GetRecordDirectory':
          return { recordDirectory: '/obs-default' };
        case 'SetSourceFilterSettings':
          state.pathSet = data.filterSettings.path;
          return {};
        case 'CreateSourceFilter':
          state.created = data;
          state.pathSet = data.filterSettings.path;
          return {};
        case 'GetProfileParameter':
          return { parameterValue: data.parameterName === 'FFFilePath' ? '/ffmpeg-out' : '' };
        case 'GetOutputStatus':
          if (!state.active)
            throw new Error(`No output was found with the name \`${data.outputName}\`.`);
          return { outputActive: true, outputDuration: 1234 };
        case 'CallVendorRequest':
          if (data.vendorName !== 'source-record')
            throw new Error('No vendor was found by that name.');
          if (data.requestType === 'record_start') {
            state.active = true;
            state.filename = data.requestData.filename;
            return { responseData: { success: true } };
          }
          if (data.requestType === 'record_stop') {
            state.active = false;
            state.files.push(`${state.filename}.mkv`);
            return { responseData: { success: true } };
          }
          return { responseData: { success: false, error: 'unknown' } };
        default:
          throw new Error(`unexpected ${type}`);
      }
    }
  };
  const fs = {
    async readdir(dir) {
      return dir === '/rec' ? [...state.files, 'other.mkv'] : [];
    },
    async stat() {
      return { size: 4096 };
    }
  };
  return { ws, fs, calls, state };
}

test('records the scene to a file named for the heat, via Source Record, and finds the file after the stop', async () => {
  const { ws, fs, calls, state } = fakeObs();
  const rec = new SceneRecorder(
    { ws },
    { scene: 'Clean' },
    { fs, now: () => new Date(2026, 10, 1, 9, 5, 7) }
  );
  assert.deepEqual(await rec.recordStatus(), { active: false, paused: false, durationMs: 0 });
  await rec.startRecord({ heatId: 4 });
  assert.equal(state.filename, 'clean heat 4 2026-11-01 09-05-07');
  const start = calls.find(
    ([t, d]) => t === 'CallVendorRequest' && d.requestType === 'record_start'
  );
  assert.deepEqual(start[1].requestData, {
    source: 'Clean',
    filter: 'Source Record',
    filename: 'clean heat 4 2026-11-01 09-05-07'
  });
  // The folder is set on the filter before the start, so the file is where we look.
  assert.equal(state.pathSet, '/rec');
  assert.deepEqual(await rec.recordStatus(), { active: true, paused: false, durationMs: 1234 });
  const file = await rec.stopRecord();
  assert.equal(file, path.join('/rec', 'clean heat 4 2026-11-01 09-05-07.mkv'));
  assert.deepEqual(await rec.recordStatus(), { active: false, paused: false, durationMs: 0 });
});

test("with no filter on the scene yet, Source Record makes one named after the file; the folder falls back to OBS's", async () => {
  const { ws, fs, state } = fakeObs({ filters: [] });
  fs.readdir = async (dir) => (dir === '/obs-default' ? [...state.files] : []);
  const rec = new SceneRecorder(
    { ws },
    { scene: 'Clean' },
    { fs, now: () => new Date(2026, 0, 2, 3, 4, 5) }
  );
  await rec.startRecord();
  assert.equal(rec.filterName, 'Source Record');
  assert.equal(state.created.filterKind, 'source_record_filter');
  assert.equal(state.pathSet, '/obs-default');
  assert.equal(await rec.stopRecord(), path.join('/obs-default', 'clean 2026-01-02 03-04-05.mkv'));
});

test('a configured folder and filter name win, and a missing plugin is said plainly', async () => {
  const { ws, fs, calls } = fakeObs();
  fs.readdir = async (dir) => (dir === '/mine' ? ['clean 2026-01-02 03-04-05.mkv'] : []);
  const rec = new SceneRecorder(
    { ws },
    { scene: 'Clean', sceneFilter: 'Rec', recordDir: '/mine' },
    { fs, now: () => new Date(2026, 0, 2, 3, 4, 5) }
  );
  await rec.startRecord();
  assert.ok(!calls.some(([t]) => t === 'GetSourceFilterList' || t === 'GetRecordDirectory'));
  assert.equal(await rec.stopRecord(), path.join('/mine', 'clean 2026-01-02 03-04-05.mkv'));

  const noPlugin = new SceneRecorder(
    {
      ws: {
        call: async (type) => {
          if (type === 'CallVendorRequest') throw new Error('No vendor was found by that name.');
          return {};
        }
      }
    },
    { scene: 'Clean', sceneFilter: 'Rec', recordDir: '/mine' },
    { fs }
  );
  await assert.rejects(() => noPlugin.startRecord(), /Source Record plugin is not loaded/);
});

test("a file that is not where it was told to go is found in one of OBS's other folders, and said", async () => {
  const { ws, fs, state } = fakeObs();
  fs.readdir = async (dir) => (dir === '/ffmpeg-out' ? [...state.files] : []);
  const lines = [];
  const rec = new SceneRecorder(
    { ws },
    { scene: 'Clean' },
    { fs, now: () => new Date(2026, 0, 2, 3, 4, 5), log: (m) => lines.push(m) }
  );
  await rec.startRecord();
  // findFile waits for its folder; keep the test quick by looking straight away.
  rec.findFile = async (dir, name) => {
    const names = await fs.readdir(dir);
    const hit = names.find((n) => n.startsWith(name + '.'));
    return hit ? path.join(dir, hit) : null;
  };
  assert.equal(await rec.stopRecord(), path.join('/ffmpeg-out', 'clean 2026-01-02 03-04-05.mkv'));
  assert.ok(lines.some((l) => /not in \/rec but in \/ffmpeg-out/.test(l)));
});

test('two scenes: the clean one starts first and alone; the stop returns both files', async () => {
  const order = [];
  const fake = (name) => ({
    async startRecord() {
      order.push(`start ${name}`);
      await new Promise((r) => setTimeout(r, name === 'overlaid' ? 30 : 5));
      this.current = { name };
    },
    async stopRecord() {
      order.push(`stop ${name}`);
      return `/rec/${name}.mkv`;
    },
    async recordStatus() {
      return { active: Boolean(this.current), durationMs: 0 };
    }
  });
  const two = new TwoSceneRecorder(fake('clean'), fake('overlaid'));
  await two.startRecord({ heatId: 1 });
  // startRecord returned when the clean one was up; the overlaid one was still starting.
  assert.deepEqual(order, ['start clean', 'start overlaid']);
  assert.deepEqual(await two.stopRecord(), {
    file: '/rec/clean.mkv',
    overlaid: '/rec/overlaid.mkv'
  });
});
