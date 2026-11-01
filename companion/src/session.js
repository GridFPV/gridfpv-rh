/**
 * The race-day loop, as a state machine over the timer's events and OBS: staging starts a
 * recording; the start signal is pinned inside it; the stop ends it (after a tail) and a
 * sidecar is written; a saved round names the run and renders; Ready with no round means a
 * discard, and the recording goes to trash; a changed result re-renders; a deleted round
 * trashes. Everything with a side effect is injected, so the whole loop runs in a test.
 */
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { raceStartInRecording } from './clock.js';
import { probeDuration } from './render.js';
import { lapsHash, listSidecars, sidecarPathFor, trashRecording, writeSidecar } from './sidecar.js';
import { RACE, roundsOf, scoredStamps } from './timer.js';

export class Session extends EventEmitter {
  /**
   * @param deps.timer   a Timer (events race_status/stage_ready/race_list/result_data/races_deleted; localMs(); pilotRace(); raceList)
   * @param deps.obs     recordStatus()/startRecord()/stopRecord()
   * @param deps.render  async ({sidecarFile, data}) => { files, lapStamps, title }
   * @param deps.now     performance.now()
   * @param deps.setTimeout/clearTimeout  for the tail and the discard wait (fakeable)
   */
  constructor(cfg, deps) {
    super();
    this.cfg = cfg;
    this.d = deps;
    this.log = deps.log ?? (() => {});
    this.recording = null; // the race being recorded: {heatId, nextRound, roundsBefore, raceStartMs, stagingMs, endMs, ...}
    this.pending = []; // recordings stopped and waiting for a save or a discard
    this.renderQueue = Promise.resolve();
    /** Trash moves, in order; tests await it. */
    this.tasks = Promise.resolve();
    this.known = new Map(); // sidecar file → data, for re-renders and trashing
    this.rendering = new Set(); // sidecar files with a render under way
  }

  changed() {
    this.emit('change');
  }

  /** Every run this session knows, newest first, with where it stands — for a window. */
  runs() {
    const out = [];
    if (this.recording)
      out.push({
        state: this.recording.endMs == null ? 'recording' : 'tail',
        heat_id: this.recording.heatId,
        round: null,
        name: null,
        recording: null,
        sidecar: null,
        started_at: this.recording.startedAt
      });
    for (const rec of this.pending)
      out.push({
        state: 'waiting',
        heat_id: rec.heatId,
        round: null,
        name: null,
        recording: rec.recording,
        sidecar: rec.sidecarFile,
        started_at: rec.startedAt
      });
    for (const [file, data] of this.known)
      out.push({
        state: this.rendering.has(file) ? 'rendering' : data.rendered ? 'rendered' : 'saved',
        heat_id: data.heat_id,
        round: data.round,
        name: data.name,
        recording: data.recording,
        sidecar: file,
        started_at: data.recorded_at ?? null,
        rendered_at: data.rendered?.at ?? null,
        files: data.rendered?.files ?? []
      });
    return out.sort((a, b) => String(b.started_at ?? '').localeCompare(String(a.started_at ?? '')));
  }

  start() {
    const t = this.d.timer;
    t.on('stage_ready', (r) => this.onStaging(r));
    t.on('race_status', (r) => this.onRaceStatus(r));
    t.on('race_list', (list) => this.onRaceList(list));
    t.on('result_data', () => this.onResults());
    t.on('races_deleted', () => void this.d.timer.refreshRaceList?.());
    t.on('overlay', (look) => this.onLook(look));
    // The placement the timer last broadcast is the baseline — it usually arrived at connect,
    // before this listener existed; without it the first real change would pass for the
    // baseline and no run would be re-rendered.
    if (t.overlayLook != null) this.look = t.overlayLook;
    return this;
  }

  /** Load the sidecars already in a folder (a restart mid-season keeps re-rendering them). */
  async adopt(dir) {
    for (const s of await listSidecars(dir, this.log)) this.known.set(s.file, s.data);
    this.log(`adopted ${this.known.size} sidecar(s) from ${dir}`);
    this.changed();
  }

  // ---- recording ----
  async onStaging(race) {
    if (race.status !== RACE.STAGING) return;
    if (this.recording) return; // already on it (stage_ready and race_status both say so)
    const roundsBefore = roundsOf(this.d.timer.raceList, race.heatId).map((r) => r.round);
    this.recording = {
      heatId: race.heatId,
      nextRound: race.nextRound ?? null,
      roundsBefore,
      startsAt: race.startsAt,
      stagingAt: race.stagingAt,
      raceStartMs: null,
      stagingMs: null,
      endMs: null,
      startedAt: new Date().toISOString()
    };
    try {
      const st = await this.d.obs.recordStatus();
      if (!st.active) {
        await this.d.obs.startRecord({ heatId: race.heatId });
        // The file's time zero on our clock: startRecord returns as the output begins.
        this.recording.outputStartLocal = this.d.now();
        this.log(`recording: started for heat ${race.heatId}`);
      } else {
        // Already running: its time zero can only be guessed from the duration counter, which
        // lags the file by the encoder's queue; the stop measures that lag and corrects it.
        this.recording.outputStartLocal = null;
        this.recording.counterStartLocal = this.d.now() - st.durationMs;
        this.log(`recording: already on (${Math.round(st.durationMs / 1000)} s in); using it`);
      }
    } catch (e) {
      this.log(`recording: OBS refused to start: ${e.message}`);
      this.recording = null;
    }
    this.changed();
  }

  async onRaceStatus(race) {
    if (race.status === RACE.STAGING) return this.onStaging(race);
    if (race.status === RACE.READY) return this.onReady();
    const rec = this.recording;
    if (!rec) return;
    if (race.status === RACE.RACING && rec.raceStartMs == null) {
      rec.startsAt = race.startsAt ?? rec.startsAt;
      rec.stagingAt = race.stagingAt ?? rec.stagingAt;
      await this.pinStart(rec);
    }
    if (race.status === RACE.DONE && rec.endMs == null) {
      if (rec.raceStartMs == null) await this.pinStart(rec);
      const startLocal = this.d.timer.localMs(rec.startsAt);
      rec.endMs = startLocal == null ? null : this.d.now() - startLocal;
      this.log(
        `race: stopped at ${rec.endMs == null ? '?' : (rec.endMs / 1000).toFixed(1)} s; recording ${this.cfg.tailSeconds} s more`
      );
      this.d.setTimeout(() => this.finishRecording(rec), this.cfg.tailSeconds * 1000);
      this.changed();
    }
  }

  /** Ready after a stop: saved or discarded. race_list tells which; if it says nothing in time, it was a discard. */
  onReady() {
    let any = false;
    for (const rec of [this.recording, ...this.pending]) {
      if (!rec || rec.endMs == null || rec.readyAt) continue;
      rec.readyAt = this.d.now();
      rec.discardTimer = this.d.setTimeout(
        () => this.discard(rec),
        this.cfg.discardAfterSeconds * 1000
      );
      any = true;
    }
    if (any) this.askRaceList();
  }

  /**
   * RotorHazard does not broadcast its saved-race list on a save (Grid's own page asks for it
   * after saving), so ask — now, and again while the save settles — well inside the discard wait.
   */
  askRaceList() {
    for (const ms of [300, 2000, 4500])
      this.d.setTimeout(() => this.d.timer.refreshRaceList?.(), ms);
  }

  /**
   * Where the start signal sits in the file: the start's moment on our clock against the
   * moment the output began (file time zero), both on the same clock. When the recording
   * was already running at staging, the output's duration counter stands in for its start,
   * and the stop corrects it by the encoder's lag (the file ends up longer than the counter
   * said by exactly the frames that were still in the encoder).
   */
  async pinStart(rec) {
    const startLocal = this.d.timer.localMs(rec.startsAt);
    if (startLocal == null)
      return this.log(
        'race: started, but the timer clock is not synced yet; the start will be pinned at the stop'
      );
    try {
      if (rec.outputStartLocal != null) {
        rec.raceStartMs = startLocal - rec.outputStartLocal;
        rec.pinnedBy = 'output start';
      } else {
        const st = await this.d.obs.recordStatus();
        const now = this.d.now();
        if (!st.active) return this.log('race: started, but OBS is not recording');
        rec.raceStartMs = raceStartInRecording(st.durationMs, now, startLocal);
        rec.pinnedBy = 'duration counter';
      }
      rec.stagingMs = rec.stagingAt == null ? null : (rec.stagingAt - rec.startsAt) * 1000;
      this.log(
        `race: start pinned ${(rec.raceStartMs / 1000).toFixed(3)} s into the recording (by the ${rec.pinnedBy})`
      );
    } catch (e) {
      this.log(`race: could not pin the start: ${e.message}`);
    }
  }

  async finishRecording(rec) {
    try {
      const st = await this.d.obs.recordStatus();
      const counterMs = st.durationMs;
      rec.durationMs = counterMs;
      const file = await this.d.obs.stopRecord();
      rec.recording = file;
      // The file's own length wins; the difference from the counter is the encoder's lag
      // (frames still queued when the counter was read, flushed into the file at the stop).
      const probed = this.cfg.ffmpeg ? await probeDuration(this.cfg, file) : null;
      if (probed != null) {
        rec.durationMs = probed;
        rec.encoderLagMs = Math.max(0, probed - counterMs);
        if (rec.pinnedBy === 'duration counter' && rec.raceStartMs != null) {
          rec.raceStartMs += rec.encoderLagMs;
          this.log(
            `race: start moved to ${(rec.raceStartMs / 1000).toFixed(3)} s — the counter ran ${Math.round(rec.encoderLagMs)} ms behind the file`
          );
        }
      }
      this.log(
        `recording: stopped → ${file} (${((rec.durationMs ?? 0) / 1000).toFixed(1)} s${rec.encoderLagMs != null ? `; encoder lag ${Math.round(rec.encoderLagMs)} ms` : ''})`
      );
    } catch (e) {
      this.log(`recording: could not stop: ${e.message}`);
      this.recording = null;
      this.changed();
      return;
    }
    const sidecarFile = sidecarPathFor(rec.recording);
    const data = {
      recording: rec.recording,
      heat_id: rec.heatId,
      round: null,
      race_id: null,
      name: null,
      race_start_ms: rec.raceStartMs,
      staging_ms: rec.stagingMs,
      end_ms: rec.endMs,
      duration_ms: rec.durationMs,
      pinned_by: rec.pinnedBy ?? null,
      encoder_lag_ms: rec.encoderLagMs ?? null,
      recorded_at: rec.startedAt
    };
    await writeSidecar(sidecarFile, data);
    rec.sidecarFile = sidecarFile;
    rec.data = data;
    this.pending.push(rec);
    this.recording = null;
    this.changed();
    // The save may already have been listed while the tail ran — or not asked for yet.
    this.onRaceList(this.d.timer.raceList);
    this.askRaceList();
  }

  // ---- save / discard ----
  onRaceList(list) {
    for (const rec of [...this.pending]) {
      const rounds = roundsOf(list, rec.heatId);
      const fresh = rounds.filter((r) => !rec.roundsBefore.includes(r.round));
      if (!fresh.length) continue;
      const round = fresh.sort((a, b) => b.round - a.round)[0];
      this.d.clearTimeout(rec.discardTimer);
      this.pending = this.pending.filter((x) => x !== rec);
      rec.data.round = round.round;
      rec.data.race_id = round.raceId;
      this.known.set(rec.sidecarFile, rec.data);
      this.log(
        `run saved: heat ${rec.heatId} round ${round.round} (race ${round.raceId}) → render`
      );
      this.queueRender(rec.sidecarFile, rec.data);
      this.changed();
    }
    // A round that is gone (the plugin's delete, #36): its recording and renders go to trash.
    for (const [file, data] of [...this.known]) {
      if (data.round == null) continue;
      const still = roundsOf(list, data.heat_id).some(
        (r) => r.round === data.round && r.raceId === data.race_id
      );
      if (!still) {
        this.known.delete(file);
        this.changed();
        if (this.cfg.trashDiscarded)
          this.tasks = this.tasks.then(() => this.trash(file, data, 'round deleted'));
        else
          this.log(
            `round deleted: heat ${data.heat_id} round ${data.round}; recording kept (trashDiscarded is off)`
          );
      }
    }
  }

  async discard(rec) {
    // The tail may still be running: come back once the recording has stopped.
    if (this.recording === rec) {
      rec.discardTimer = this.d.setTimeout(() => this.discard(rec), 2000);
      return;
    }
    if (!this.pending.includes(rec)) return;
    this.pending = this.pending.filter((x) => x !== rec);
    if (this.cfg.trashDiscarded) await this.trash(rec.sidecarFile, rec.data, 'run discarded');
    else this.log(`run discarded: ${rec.recording} kept (trashDiscarded is off)`);
    this.changed();
  }

  async trash(sidecarFile, data, why) {
    try {
      const moved = await trashRecording(sidecarFile, data);
      this.log(
        `${why}: ${moved.length} file(s) moved to ${path.join(path.dirname(sidecarFile), 'trash')}`
      );
    } catch (e) {
      this.log(`${why}: could not move to trash: ${e.message}`);
    }
  }

  // ---- renders ----
  queueRender(sidecarFile, data) {
    this.rendering.add(sidecarFile);
    this.changed();
    this.renderQueue = this.renderQueue
      .then(() => this.d.render({ sidecarFile, data }))
      .then(async (r) => {
        if (!r) return;
        data.name = r.title ?? data.name;
        data.laps_hash = lapsHash(r.lapStamps);
        if (r.look) data.look = r.look;
        data.rendered = { at: new Date().toISOString(), files: r.files };
        await writeSidecar(sidecarFile, data);
        this.log(`rendered: ${r.files.map((f) => path.basename(f)).join(', ')}`);
      })
      .catch((e) => this.log(`render failed for ${path.basename(sidecarFile)}: ${e.message}`))
      .finally(() => {
        this.rendering.delete(sidecarFile);
        this.changed();
      });
    return this.renderQueue;
  }

  /** The overlay's placement changed on the timer: every render is stale, so render them all again. */
  onLook(look) {
    if (this.look === undefined) {
      this.look = look;
      return;
    }
    if (look === this.look) return;
    this.look = look;
    const stale = [...this.known].filter(([, data]) => data.round != null && data.look !== look);
    this.log(`overlay placement changed → re-render ${stale.length} run(s)`);
    for (const [file, data] of stale) void this.queueRender(file, data);
  }

  /** Results changed (a marshal, somewhere): re-render every known run whose laps differ from what was rendered. */
  onResults() {
    clearTimeout(this.resultsTimer);
    this.resultsTimer = setTimeout(() => void this.checkResults(), 1500);
    this.resultsTimer.unref?.();
  }
  async checkResults() {
    for (const [file, data] of [...this.known]) {
      if (data.race_id == null) continue;
      const round = roundsOf(this.d.timer.raceList, data.heat_id).find(
        (r) => r.raceId === data.race_id
      );
      if (!round) continue;
      try {
        const prs = [];
        for (const pr of round.pilotraces) prs.push(await this.d.timer.pilotRace(pr.pilotraceId));
        const hash = lapsHash(scoredStamps(prs, data.first_lap_counts));
        if (hash !== data.laps_hash) {
          this.log(`laps changed for heat ${data.heat_id} round ${data.round} → re-render`);
          await this.queueRender(file, data);
        }
      } catch (e) {
        this.log(`could not check heat ${data.heat_id} round ${data.round}: ${e.message}`);
      }
    }
  }
}
