import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compositeArgs, frameCount, overlayArgs, raceTimeOf, walkFrames } from '../src/frames.js';

test('frames cover the recording, the last partial frame included', () => {
  assert.equal(frameCount(1000, 30), 30);
  assert.equal(frameCount(1001, 30), 31);
  assert.equal(frameCount(0, 30), 0);
  assert.equal(frameCount(5000, 0), 0);
});

test('frame k shows recording time k/fps less where the start sits', () => {
  // The start signal is 4.2 s into the file: frame 0 is race time -4200, and 4.2 s in is 0.
  assert.equal(raceTimeOf(0, 30, 4200), -4200);
  assert.equal(raceTimeOf(126, 30, 4200), 0);
  assert.ok(Math.abs(raceTimeOf(127, 30, 4200) - 1000 / 30) < 1e-6);
  // A recording that began after the start: the file opens mid-race.
  assert.equal(raceTimeOf(0, 30, -1500), 1500);
});

test('walkFrames shoots only when the page key changes and repeats the frame otherwise', async () => {
  const keys = (t) => (t < 0 ? 'staging' : t < 1000 ? 'a' : 'b');
  const emitted = [];
  let shot = 0;
  const r = await walkFrames({
    durationMs: 2000,
    fps: 10,
    raceStartMs: 500,
    seek: async (t) => keys(t),
    shoot: async () => Buffer.from(`shot${++shot}`),
    emit: async (png) => emitted.push(png.toString())
  });
  assert.equal(r.frames, 20);
  assert.equal(r.shots, 3);
  // 5 staging frames (t = -500 … -100), 10 of 'a', 5 of 'b'.
  assert.deepEqual(emitted, [
    ...Array(5).fill('shot1'),
    ...Array(10).fill('shot2'),
    ...Array(5).fill('shot3')
  ]);
});

test('ffmpeg arguments: alpha overlay (vp9 / prores) and the composite with audio kept', () => {
  const vp9 = overlayArgs({ fps: 30, codec: 'vp9', out: 'o.webm' });
  assert.ok(vp9.includes('libvpx-vp9') && vp9.includes('yuva420p') && vp9.at(-1) === 'o.webm');
  const prores = overlayArgs({ fps: 30, codec: 'prores', out: 'o.mov' });
  assert.ok(prores.includes('prores_ks') && prores.includes('4444'));
  const c = compositeArgs({
    fps: 30,
    recording: 'r.mkv',
    out: 'n.mp4',
    crf: 18
  });
  assert.equal(c[c.indexOf('-i') + 1], 'r.mkv');
  assert.ok(c.includes('libx264') && c.includes('0:a?') && c.includes('-shortest'));
  assert.equal(c.at(-1), 'n.mp4');
});
