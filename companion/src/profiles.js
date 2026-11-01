/**
 * Profiles (#99): a named set of settings — the timer, OBS, what records a run, where files
 * go, the look of the render — saved as JSON files in the per-user app data folder, so the
 * helper's window can keep one per event or machine and switch between them. The console
 * companion's `gridfpv-video.json` is one profile without a name; `importLegacy` adopts it.
 *
 *   %APPDATA%\GridFPV Video\profiles\<name>.json      Windows
 *   ~/Library/Application Support/GridFPV Video/…      macOS
 *   $XDG_CONFIG_HOME/gridfpv-video/…                   elsewhere
 *
 * `state.json` beside them remembers the last profile used. `GRIDFPV_VIDEO_HOME` overrides
 * the folder (tests, a portable install).
 */
import { promises as nodeFs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULTS } from './config.js';

export const APP_DIR_NAME = 'GridFPV Video';

/** The per-user folder the helper keeps its profiles and state in. */
export function homeDir(env = process.env, platform = process.platform) {
  if (env.GRIDFPV_VIDEO_HOME) return env.GRIDFPV_VIDEO_HOME;
  if (platform === 'win32')
    return path.join(env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), APP_DIR_NAME);
  if (platform === 'darwin')
    return path.join(os.homedir(), 'Library', 'Application Support', APP_DIR_NAME);
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'gridfpv-video');
}

/** A profile's name as its file name. */
export function profileFileName(name) {
  const cleaned = String(name)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if (!cleaned) throw new Error('a profile needs a name');
  return cleaned + '.json';
}

/** The settings a profile may carry: every config key but the file it came from. */
export const PROFILE_KEYS = Object.freeze(Object.keys(DEFAULTS));

/** Keep only known keys; unknown ones are an error, as the config loader treats them. */
export function sanitize(settings = {}) {
  const out = {};
  for (const [k, v] of Object.entries(settings)) {
    if (!PROFILE_KEYS.includes(k)) throw new Error(`unknown setting "${k}"`);
    out[k] = v;
  }
  return out;
}

export class Profiles {
  constructor({ dir = homeDir(), fs = nodeFs } = {}) {
    this.dir = dir;
    this.profilesDir = path.join(dir, 'profiles');
    this.stateFile = path.join(dir, 'state.json');
    this.fs = fs;
  }

  async ensure() {
    await this.fs.mkdir(this.profilesDir, { recursive: true });
  }

  /** Every profile, by name, with its settings. */
  async list() {
    await this.ensure();
    const names = (await this.fs.readdir(this.profilesDir)).filter((n) => n.endsWith('.json'));
    const out = [];
    for (const n of names.sort((a, b) => a.localeCompare(b))) {
      try {
        out.push(await this.load(n.slice(0, -'.json'.length)));
      } catch {
        // an unreadable file is not a profile
      }
    }
    return out;
  }

  async load(name) {
    const file = path.join(this.profilesDir, profileFileName(name));
    const raw = JSON.parse(await this.fs.readFile(file, 'utf8'));
    const { name: stored, ...rest } = raw;
    return { name: stored || name, settings: sanitize(rest) };
  }

  /** Write (or overwrite) a profile; returns it as stored. */
  async save(name, settings) {
    await this.ensure();
    const clean = sanitize(settings);
    const file = path.join(this.profilesDir, profileFileName(name));
    const tmp = file + '.tmp';
    await this.fs.writeFile(tmp, JSON.stringify({ name, ...clean }, null, 2) + '\n');
    await this.fs.rename(tmp, file);
    return { name, settings: clean };
  }

  async remove(name) {
    await this.fs.rm(path.join(this.profilesDir, profileFileName(name)), { force: true });
    const st = await this.state();
    if (st.lastProfile === name) await this.setState({ ...st, lastProfile: null });
  }

  async rename(from, to) {
    const p = await this.load(from);
    await this.save(to, p.settings);
    await this.remove(from);
    return this.load(to);
  }

  async state() {
    try {
      return JSON.parse(await this.fs.readFile(this.stateFile, 'utf8'));
    } catch {
      return { lastProfile: null };
    }
  }

  async setState(state) {
    await this.ensure();
    const tmp = this.stateFile + '.tmp';
    await this.fs.writeFile(tmp, JSON.stringify(state, null, 2) + '\n');
    await this.fs.rename(tmp, this.stateFile);
  }

  /** The console companion's `gridfpv-video.json`, adopted as a profile once, if none exists yet. */
  async importLegacy(file, name = 'Imported') {
    let text;
    try {
      text = await this.fs.readFile(file, 'utf8');
    } catch {
      return null;
    }
    if ((await this.list()).length) return null;
    const settings = sanitize(JSON.parse(text));
    const p = await this.save(name, settings);
    await this.setState({ ...(await this.state()), lastProfile: name });
    return p;
  }

  /** A profile's settings over the defaults: what the pipeline runs with. */
  static effective(settings) {
    return { ...DEFAULTS, ...settings, timer: String(settings.timer ?? '').replace(/\/+$/, '') };
  }
}
