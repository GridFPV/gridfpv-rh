/**
 * The recording's own timeline, read from the time bar the headless OBS's test scene draws:
 * a white bar on a black band whose length is the wall clock modulo one minute
 * (1280 px = 60 s, see dev/obs/config/basic/scenes/Test.json). The bar is a plain div moved
 * by requestAnimationFrame, so it is painted within a frame or two of the time it shows;
 * reading it off each frame of a file gives wall time as a function of file time, and so the
 * wall time at which the file begins — the ground truth the pinned race start is judged by.
 */
import { spawn } from 'node:child_process';

export async function measureTimeline({
  ffmpeg,
  file,
  y = 630,
  width = 1280,
  periodMs = 60_000,
  fps
}) {
  const rows = await rawRow(ffmpeg, file, y, width);
  const samples = [];
  for (let k = 0; k < rows.length; k++) {
    const row = rows[k];
    // The bar is the run of bright pixels from the left edge; its length is the time.
    let len = 0;
    while (len < width && row[len] > 160) len++;
    if (len === 0 || len >= width - 1) continue; // wrapped this frame, or not painted yet
    samples.push({ k, fileMs: (k / fps) * 1000, wallMod: (len / width) * periodMs });
  }
  if (samples.length < 10) throw new Error(`time bar: only ${samples.length} readable frames`);
  // Unwrap the modulo (a minute boundary inside the file) and fit wall = a + b·file.
  let offset = 0;
  const pts = [];
  for (let i = 0; i < samples.length; i++) {
    if (i > 0 && samples[i].wallMod + 1000 < samples[i - 1].wallMod) offset += periodMs;
    pts.push({ x: samples[i].fileMs, y: samples[i].wallMod + offset });
  }
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  const slope = sxy / sxx;
  const wallModAtFile0 = my - slope * mx; // wall time (mod period) at file time 0
  const residual = Math.sqrt(
    pts.reduce((s, p) => s + (p.y - (wallModAtFile0 + slope * p.x)) ** 2, 0) / n
  );
  return {
    wallModAtFile0,
    slope,
    residualMs: residual,
    frames: rows.length,
    readable: samples.length,
    periodMs
  };
}

/** Where a wall-clock instant sits in the file, in ms, given the fit (modulo-aware). */
export function fileTimeOf(fit, wallMs) {
  const target = ((wallMs % fit.periodMs) + fit.periodMs) % fit.periodMs;
  // Candidates one period apart; the one that lands inside the file (or nearest to it) wins.
  const base = (target - fit.wallModAtFile0) / fit.slope;
  const span = fit.periodMs / fit.slope;
  const fileLen = (fit.frames / 30) * 1000; // only used to pick the candidate; fps 30 is the harness's
  let best = base;
  for (const c of [base - span, base, base + span])
    if (Math.abs(c - fileLen / 2) < Math.abs(best - fileLen / 2)) best = c;
  return best;
}

function rawRow(ffmpeg, file, y, width) {
  return new Promise((resolve, reject) => {
    const p = spawn(
      ffmpeg,
      [
        '-v',
        'error',
        '-i',
        file,
        '-vf',
        `crop=${width}:2:0:${y},format=gray`,
        '-f',
        'rawvideo',
        'pipe:1'
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const chunks = [];
    let err = '';
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg row failed: ${err}`));
      const buf = Buffer.concat(chunks);
      // Two rows per frame (yuv420p wants an even crop); the first is the one read.
      const rows = [];
      for (let o = 0; o + width * 2 <= buf.length; o += width * 2)
        rows.push(buf.subarray(o, o + width));
      resolve(rows);
    });
  });
}
