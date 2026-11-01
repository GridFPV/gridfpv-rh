/**
 * The independent per-race recording (#98): a named scene — the clean capture, no overlay —
 * recorded by exeldro's Source Record filter to its own file, whatever OBS's Stream and
 * Record outputs are doing. So OBS can stream the program and record the whole day while
 * every race still lands in a clean file of its own.
 *
 * Source Record registers obs-websocket vendor requests (vendor `source-record`):
 * `record_start {source, filter?, filename}` sets the filter's file name and starts it, and
 * `record_stop {source, filter?}` stops it. While recording, the output is listed by OBS
 * under the filter's name, so `GetOutputStatus` gives its length — the same alignment the
 * main recording gets — and it vanishes from the list when the file is closed. Verified
 * against OBS 32.2 + Source Record 0.4.8 (`make obs-up`).
 *
 * Same three calls as `Obs` (recordStatus / startRecord / stopRecord), so `Session` cannot
 * tell the two apart.
 */
import { promises as nodeFs } from 'node:fs';
import path from 'node:path';

export const VENDOR = 'source-record';
export const FILTER_KIND = 'source_record_filter';

export class SceneRecorder {
  /**
   * @param obs       the connected `Obs` (its `ws` is used)
   * @param cfg       scene (the source Source Record records), sceneFilter (its filter's name,
   *                  optional), recordDir (where its files go, optional)
   */
  constructor(obs, cfg, { log = () => {}, fs = nodeFs, now = () => new Date() } = {}) {
    this.obs = obs;
    this.scene = cfg.scene;
    this.filterName = cfg.sceneFilter || null;
    this.recordDir = cfg.recordDir || null;
    this.log = log;
    this.fs = fs;
    this.now = now;
    this.current = null; // { name, dir } while a recording is on
  }

  get ws() {
    return this.obs.ws;
  }

  /** The Source Record filter on the scene, by name: configured, found, or none (yet). */
  async findFilter() {
    if (this.filterName) return this.filterName;
    const { filters } = await this.ws.call('GetSourceFilterList', { sourceName: this.scene });
    const f = filters.find((x) => x.filterKind === FILTER_KIND);
    if (f) this.filterName = f.filterName;
    return this.filterName;
  }

  /** Where the files go: configured, else the filter's own `path`, else OBS's recording folder. */
  async resolveDir() {
    if (this.recordDir) return this.recordDir;
    const filter = await this.findFilter();
    if (filter) {
      const { filterSettings } = await this.ws.call('GetSourceFilter', {
        sourceName: this.scene,
        filterName: filter
      });
      if (filterSettings?.path) return filterSettings.path;
    }
    return (await this.ws.call('GetRecordDirectory')).recordDirectory;
  }

  /** OBS lists the filter's output while it records; gone from the list means stopped. */
  async recordStatus() {
    const filter = await this.findFilter();
    if (!filter) return { active: false, paused: false, durationMs: 0 };
    try {
      const r = await this.ws.call('GetOutputStatus', { outputName: filter });
      return {
        active: Boolean(r.outputActive),
        paused: false,
        durationMs: Number(r.outputDuration)
      };
    } catch (e) {
      if (/No output was found/i.test(e.message))
        return { active: false, paused: false, durationMs: 0 };
      throw e;
    }
  }

  /** A file name for the run before it has a name: the heat and the clock. */
  fileNameFor({ heatId } = {}) {
    const d = this.now();
    const p = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
    return heatId != null ? `clean heat ${heatId} ${stamp}` : `clean ${stamp}`;
  }

  async startRecord(run = {}) {
    if (!this.scene) throw new Error('scene recording: no scene configured ("scene")');
    const dir = await this.resolveDir();
    const name = this.fileNameFor(run);
    const filter = await this.findFilter();
    const requestData = { source: this.scene, filename: name };
    if (filter) requestData.filter = filter;
    const r = await this.vendor('record_start', requestData);
    if (!r.success) throw new Error(`Source Record refused to start: ${r.error ?? 'no reason'}`);
    // A filter Source Record made for us is named after the file; that is the output's name too.
    if (!filter) this.filterName = name;
    this.current = { name, dir, startedAt: Date.now() };
    this.log(`scene recording: "${this.scene}" → ${path.join(dir, name)}.*`);
  }

  /**
   * Stops, waits for OBS to close the file (the output leaves the list), and returns the
   * file — the one in the folder named as asked; the extension is Source Record's choice.
   */
  async stopRecord() {
    const cur = this.current;
    if (!cur) throw new Error('scene recording: nothing is recording');
    const requestData = { source: this.scene };
    if (this.filterName) requestData.filter = this.filterName;
    const r = await this.vendor('record_stop', requestData);
    if (!r.success) throw new Error(`Source Record refused to stop: ${r.error ?? 'no reason'}`);
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (!(await this.recordStatus()).active) break;
      await new Promise((res) => setTimeout(res, 100));
    }
    this.current = null;
    const file = await this.findFile(cur.dir, cur.name);
    if (!file) throw new Error(`scene recording: no file named "${cur.name}.*" in ${cur.dir}`);
    await this.settled(file);
    return file;
  }

  async findFile(dir, name) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const names = await this.fs.readdir(dir).catch(() => []);
      const hit = names.find(
        (n) => n.startsWith(name + '.') && !n.endsWith('.tmp') && !n.endsWith('.gridfpv.json')
      );
      if (hit) return path.join(dir, hit);
      await new Promise((res) => setTimeout(res, 200));
    }
    return null;
  }

  /** The file is whole when its size stops changing. */
  async settled(file) {
    let last = -1;
    for (let i = 0; i < 50; i++) {
      const { size } = await this.fs.stat(file);
      if (size > 0 && size === last) return;
      last = size;
      await new Promise((res) => setTimeout(res, 200));
    }
  }

  async vendor(requestType, requestData) {
    try {
      const r = await this.ws.call('CallVendorRequest', {
        vendorName: VENDOR,
        requestType,
        requestData
      });
      return r.responseData ?? {};
    } catch (e) {
      if (/vendor/i.test(e.message) && /not found|No vendor/i.test(e.message))
        throw new Error(
          'the Source Record plugin is not loaded in OBS (install it: https://obsproject.com/forum/resources/source-record.1285/)'
        );
      throw e;
    }
  }
}
