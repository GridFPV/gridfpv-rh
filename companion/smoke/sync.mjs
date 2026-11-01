/**
 * How far the rendered overlay's look is from the live one, measured on pixels. The headless
 * OBS's Clean scene (the program) carries the timer's own live overlay page on its right
 * half, so a composite holds two panels: OBS's live one (right, composited by OBS) and the
 * helper's rendered one (left, composited by ffmpeg). Text differs (fonts, a tenth here and
 * there), so the comparison is of the glass: the darker third of each crop's pixels is the
 * panel's background over the same stripes, and its mean colour says whether the two
 * composites let the same amount of picture through. (Sync is measured separately, against
 * the recording's time bar — see timebar.mjs.)
 */
import { spawn } from 'node:child_process';

async function cropRgb(ffmpeg, file, { x, y, w, h }, scale) {
  const sw = Math.round(w / scale);
  const sh = Math.round(h / scale);
  const frames = await raw(
    ffmpeg,
    file,
    `crop=${w}:${h}:${x}:${y},scale=${sw}:${sh}:flags=area,format=rgb24`,
    sw * sh * 3
  );
  return frames;
}

function raw(ffmpeg, file, vf, frameBytes) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-v', 'error', '-i', file, '-vf', vf, '-f', 'rawvideo', 'pipe:1'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const chunks = [];
    let err = '';
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg crop failed: ${err}`));
      const buf = Buffer.concat(chunks);
      const frames = [];
      for (let o = 0; o + frameBytes <= buf.length; o += frameBytes)
        frames.push(buf.subarray(o, o + frameBytes));
      resolve(frames);
    });
  });
}

/** Mean RGB of the darkest `share` of a frame's pixels (by luma): the glass, not the text. */
function glassTone(frame, share = 0.35) {
  const px = [];
  for (let i = 0; i + 2 < frame.length; i += 3)
    px.push({ l: 0.299 * frame[i] + 0.587 * frame[i + 1] + 0.114 * frame[i + 2], i });
  px.sort((a, b) => a.l - b.l);
  const take = px.slice(0, Math.max(1, Math.floor(px.length * share)));
  const acc = [0, 0, 0];
  for (const p of take) {
    acc[0] += frame[p.i];
    acc[1] += frame[p.i + 1];
    acc[2] += frame[p.i + 2];
  }
  return acc.map((v) => v / take.length);
}

/**
 * @returns {{ left: number[], right: number[], delta: number[], frames: number }} mean glass
 *   tone of each panel over the race, and left − right per channel.
 */
export async function measureLook({ ffmpeg, file, left, right, fps, scale = 2, skipS = 1 }) {
  const L = await cropRgb(ffmpeg, file, left, scale);
  const R = await cropRgb(ffmpeg, file, right, scale);
  const n = Math.min(L.length, R.length);
  const from = Math.round(skipS * fps);
  const lm = [0, 0, 0];
  const rm = [0, 0, 0];
  let c = 0;
  for (let k = from; k < n; k += 3) {
    const a = glassTone(L[k]);
    const b = glassTone(R[k]);
    for (let i = 0; i < 3; i++) {
      lm[i] += a[i];
      rm[i] += b[i];
    }
    c++;
  }
  const r1 = (v) => Math.round(v * 10) / 10;
  return {
    left: lm.map((v) => r1(v / c)),
    right: rm.map((v) => r1(v / c)),
    delta: lm.map((v, i) => r1((v - rm[i]) / c)),
    frames: n
  };
}
