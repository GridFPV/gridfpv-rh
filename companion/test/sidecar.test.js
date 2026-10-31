import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  freeName,
  lapsHash,
  listSidecars,
  readSidecar,
  safeFileName,
  sidecarPathFor,
  trashRecording,
  writeSidecar
} from '../src/sidecar.js';

test('a run name becomes a file name without the characters file systems refuse', () => {
  assert.equal(safeFileName('RaceGOW 2 Track 4 Round 7'), 'RaceGOW 2 Track 4 Round 7');
  assert.equal(safeFileName('S2: Track 4 / Round 7?'), 'S2- Track 4 - Round 7-');
  assert.equal(safeFileName('  spaced   out. '), 'spaced out');
  assert.equal(safeFileName(''), 'run');
});

test('the laps hash is stable across the millisecond noise the page rounds away', () => {
  assert.equal(lapsHash([2000.4, 3600.2]), lapsHash([2000, 3600]));
  assert.notEqual(lapsHash([2000, 3600]), lapsHash([2000]));
});

test('sidecars are written atomically, listed, and trashed with the recording and renders', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gridfpv-sidecar-'));
  const rec = path.join(dir, '2026-10-31 14-02-11.mkv');
  await fs.writeFile(rec, 'video');
  const render = path.join(dir, 'RaceGOW 2 Track 4 Round 7.mp4');
  await fs.writeFile(render, 'render');
  const side = sidecarPathFor(rec);
  assert.equal(side, rec + '.gridfpv.json');
  await writeSidecar(side, {
    recording: rec,
    heat_id: 4,
    round: 7,
    rendered: { files: [render] }
  });
  assert.deepEqual((await readSidecar(side)).heat_id, 4);
  const listed = await listSidecars(dir);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].file, side);
  // A second trash of the same name does not overwrite the first.
  await fs.mkdir(path.join(dir, 'trash'));
  await fs.writeFile(path.join(dir, 'trash', path.basename(rec)), 'older');
  assert.equal(
    await freeName(path.join(dir, 'trash', path.basename(rec))),
    path.join(dir, 'trash', '2026-10-31 14-02-11 (2).mkv')
  );
  const moved = await trashRecording(side, listed[0].data);
  assert.equal(moved.length, 3);
  assert.equal((await fs.readdir(dir)).filter((n) => n !== 'trash').length, 0);
  assert.equal(await fs.readFile(path.join(dir, 'trash', path.basename(rec)), 'utf8'), 'older');
  assert.equal(
    await fs.readFile(path.join(dir, 'trash', '2026-10-31 14-02-11 (2).mkv'), 'utf8'),
    'video'
  );
  await fs.rm(dir, { recursive: true });
});
