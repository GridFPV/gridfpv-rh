/**
 * The sidecar: one JSON file beside each recording, written when the recording is true and
 * read back by every render. It carries the alignment (where the start signal and staging
 * sit in the file, and where the race stopped), which run it is, the run's name baked at
 * save time, and what was last rendered from which laps. Nothing here recomputes a name.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const SIDECAR_SUFFIX = '.gridfpv.json';
export const VERSION = 1;

export function sidecarPathFor(recording) {
  return recording + SIDECAR_SUFFIX;
}
export function isSidecar(file) {
  return file.endsWith(SIDECAR_SUFFIX);
}

/** A run's name as a file name: what RotorHazard allowed in a heat name, minus what a file system refuses. */
export function safeFileName(name) {
  const cleaned = String(name)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned || 'run';
}

/** The lap stamps the page reported, hashed; the same laps render the same, so equal hashes skip a render. */
export function lapsHash(lapStamps) {
  return createHash('sha1')
    .update(lapStamps.map((x) => Math.round(x)).join(','))
    .digest('hex')
    .slice(0, 12);
}

export async function readSidecar(file) {
  const data = JSON.parse(await fs.readFile(file, 'utf8'));
  if (data.version !== VERSION)
    throw new Error(`${file}: sidecar version ${data.version}, wanted ${VERSION}`);
  return data;
}

export async function writeSidecar(file, data) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ version: VERSION, ...data }, null, 2) + '\n');
  await fs.rename(tmp, file);
}

/** Every sidecar under `dir` (one level), parsed; unreadable ones are reported, not fatal. */
export async function listSidecars(dir, log = () => {}) {
  let names = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const n of names.filter(isSidecar).sort()) {
    const file = path.join(dir, n);
    try {
      out.push({ file, data: await readSidecar(file) });
    } catch (e) {
      log(`skipping ${file}: ${e.message}`);
    }
  }
  return out;
}

/**
 * Move a recording and everything of its (sidecar, renders) into `trash/` beside it. Never
 * unlinks: a discarded run's video can still be fished out by hand. Returns what moved.
 */
export async function trashRecording(sidecarFile, data) {
  const dir = path.dirname(sidecarFile);
  const trash = path.join(dir, 'trash');
  await fs.mkdir(trash, { recursive: true });
  const files = [data.recording, sidecarFile, ...(data.rendered?.files ?? [])].filter(Boolean);
  const moved = [];
  for (const f of files) {
    const abs = path.isAbsolute(f) ? f : path.join(dir, f);
    const dest = await freeName(path.join(trash, path.basename(abs)));
    try {
      await fs.rename(abs, dest);
      moved.push(dest);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  return moved;
}

/** `name.ext`, else `name (2).ext`, … — a trash can holds two runs with the same name. */
export async function freeName(file) {
  const ext = path.extname(file);
  const stem = file.slice(0, file.length - ext.length);
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? file : `${stem} (${i})${ext}`;
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }
}
