/**
 * ffmpeg for the Windows helper (#99): too big to ship (the gyan.dev essentials build is
 * 115 MB), so it is fetched once into the helper's own folder and kept there. Elsewhere
 * ffmpeg comes from the PATH (Homebrew, apt). The console launcher did the same with curl
 * and tar; this is that, in Node, so the window can show the progress.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const FFMPEG_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';

/** The ffmpeg to run: a configured one, the fetched one under `home`, or the PATH's. */
export async function ffmpegPath(cfg, home, log = () => {}, { fetch: doFetch = fetchFfmpeg } = {}) {
  if (cfg.ffmpeg && cfg.ffmpeg !== 'ffmpeg') return cfg.ffmpeg;
  if (process.platform !== 'win32') return 'ffmpeg';
  const local = path.join(home, 'ffmpeg', 'bin', 'ffmpeg.exe');
  if (await exists(local)) return local;
  if (await onPath('ffmpeg')) return 'ffmpeg';
  await doFetch(home, log);
  return local;
}

/** Download and unpack the Windows build into `<home>/ffmpeg` (bin/ffmpeg.exe inside). */
export async function fetchFfmpeg(home, log = () => {}) {
  await fs.mkdir(home, { recursive: true });
  const zip = path.join(home, 'ffmpeg.zip');
  log(`ffmpeg: fetching ${FFMPEG_URL} (about 115 MB, once)`);
  const r = await fetch(FFMPEG_URL);
  if (!r.ok) throw new Error(`ffmpeg: download failed: ${r.status}`);
  const total = Number(r.headers.get('content-length')) || 0;
  let got = 0;
  let lastPct = -1;
  const counting = new TransformStreamCounter((n) => {
    got += n;
    const pct = total ? Math.floor((100 * got) / total) : -1;
    if (pct >= 0 && pct !== lastPct && pct % 10 === 0) {
      lastPct = pct;
      log(`ffmpeg: ${pct}%`);
    }
  });
  await pipeline(Readable.fromWeb(r.body), counting, createWriteStream(zip));
  log('ffmpeg: unpacking');
  const stage = path.join(home, 'ffmpeg.unpack');
  await fs.rm(stage, { recursive: true, force: true });
  await fs.mkdir(stage, { recursive: true });
  await run('tar', ['-xf', zip, '-C', stage]);
  const inner = (await fs.readdir(stage)).find((n) => /^ffmpeg-.*essentials_build$/.test(n));
  if (!inner) throw new Error('ffmpeg: the zip did not contain the expected folder');
  const dest = path.join(home, 'ffmpeg');
  await fs.rm(dest, { recursive: true, force: true });
  await fs.rename(path.join(stage, inner), dest);
  await fs.rm(stage, { recursive: true, force: true });
  await fs.rm(zip, { force: true });
  if (!(await exists(path.join(dest, 'bin', 'ffmpeg.exe'))))
    throw new Error('ffmpeg: bin\\ffmpeg.exe is missing after unpacking');
  log(`ffmpeg: ready at ${dest}`);
}

class TransformStreamCounter extends Transform {
  constructor(onChunk) {
    super();
    this.onChunk = onChunk;
  }
  _transform(chunk, _enc, cb) {
    this.onChunk(chunk.length);
    cb(null, chunk);
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} failed: ${err.trim()}`))
    );
  });
}

async function exists(f) {
  try {
    await fs.access(f);
    return true;
  } catch {
    return false;
  }
}

function onPath(cmd) {
  return new Promise((resolve) => {
    const p = spawn(cmd, ['-version'], { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
}
