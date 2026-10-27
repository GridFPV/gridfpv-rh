/**
 * Audio cues (#38): RotorHazard's staging/start tones, lap callouts, clock callouts, leader
 * and winner cues, as its own Run page makes them (rotorhazard.js play_beep/speak and
 * run.html's socket handlers), driven by the same socket events and the same per-browser
 * settings (`localStorage` keys `rotorhazard.<name>`). This module is pure: it is given a
 * clock, a tone player and a speaker, so tests can feed it a timeline and read the ledger.
 */

export type ToneType = 'sine' | 'square' | 'sawtooth' | 'triangle';
export type Tone = {
  durationMs: number;
  frequency: number;
  volume: number;
  type: ToneType;
  fadeS: number;
};
export type Utterance = {
  text: string;
  rate: number;
  pitch: number;
  volume: number;
  voice: string;
};
/** RotorHazard's "MP3 tones" (play_mp3_beep): one of its /static/audio files at a volume. */
export type Mp3File = 'stage' | 'buzzer' | 'beep' | 'leader' | 'winner';
export type Mp3Cue = { file: Mp3File; volume: number };

export type CueOutputs = {
  tone: (t: Tone) => void;
  /** Play an MP3 (#75); a page without the files may leave it out, the tone is then silent. */
  mp3?: (m: Mp3Cue) => void;
  speak: (u: Utterance) => void;
  /** Whether the speech engine is busy (RotorHazard waits for the previous callout). */
  speaking: () => boolean;
  setTimeout: (fn: () => void, ms: number) => void;
};

/** RotorHazard's per-browser audio settings, with its defaults (rotorhazard.js). */
export type AudioSettings = {
  voice_string_language: string;
  voice_language: string;
  voice_volume: number;
  voice_rate: number;
  voice_pitch: number;
  voice_callsign: number;
  voice_lap_count: number;
  voice_team_lap_count: number;
  voice_lap_time: number;
  voice_race_timer: number;
  voice_race_winner: number;
  voice_split_timer: number;
  voice_if_node_finished: number;
  voice_race_leader: number;
  tone_volume: number;
  beep_crossing_entered: boolean;
  beep_crossing_exited: boolean;
  beep_manual_lap_button: boolean;
  beep_race_leader_lap: boolean;
  beep_race_winner_declared: boolean;
  beep_cluster_connect: boolean;
  use_mp3_tones: boolean;
  beep_on_first_pass_button: boolean;
  indicator_beep_volume: number;
};

export const AUDIO_DEFAULTS: AudioSettings = {
  voice_string_language: 'match-timer',
  voice_language: '',
  voice_volume: 1.0,
  voice_rate: 1.25,
  voice_pitch: 1.0,
  voice_callsign: 1,
  voice_lap_count: 2,
  voice_team_lap_count: 1,
  voice_lap_time: 1,
  voice_race_timer: 2,
  voice_race_winner: 1,
  voice_split_timer: 0,
  voice_if_node_finished: 0,
  voice_race_leader: 0,
  tone_volume: 1.0,
  beep_crossing_entered: false,
  beep_crossing_exited: false,
  beep_manual_lap_button: false,
  beep_race_leader_lap: false,
  beep_race_winner_declared: false,
  beep_cluster_connect: false,
  use_mp3_tones: false,
  beep_on_first_pass_button: false,
  indicator_beep_volume: 0.5
};

/** RotorHazard reads every setting from localStorage as JSON under `rotorhazard.<name>`. */
export function readAudioSettings(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  defaults: AudioSettings = AUDIO_DEFAULTS
): AudioSettings {
  const out: AudioSettings = { ...defaults };
  if (!storage) return out;
  for (const key of Object.keys(defaults) as Array<keyof AudioSettings>) {
    const raw = storage.getItem(`rotorhazard.${key}`);
    if (raw == null) continue;
    let v: unknown = raw;
    try {
      v = JSON.parse(raw);
    } catch {
      /* a bare string */
    }
    const d = defaults[key];
    if (typeof d === 'boolean')
      (out as Record<string, unknown>)[key] = v === true || v === 'true' || v === 1;
    else if (typeof d === 'number') {
      const n = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
      if (Number.isFinite(n)) (out as Record<string, unknown>)[key] = n;
    } else (out as Record<string, unknown>)[key] = v == null ? '' : String(v);
  }
  return out;
}

/**
 * rotorhazard.js: MIN_LOG_VOLUME is the floor of its log volume sliders (what the slider
 * stores at its minimum is 0.01 with float noise, e.g. 0.010000000000000004), and anything
 * not above MIN_LOG_VOL_LIM = MIN_LOG_VOLUME + MIN_LOG_VOLUME/1000 is silence (#74).
 */
const MIN_LOG_VOLUME = 0.01;
export const MIN_LOG_VOL_LIM = MIN_LOG_VOLUME + MIN_LOG_VOLUME / 1000.0;
const NODE_TONE = [440, 466.2, 493.9, 523.3, 554.4, 587.3, 622.3, 659.3];
const LEADER_FLAG = '\u0001';
const WINNER_FLAG = '\u0002';

export type PhoneticData = {
  lap?: number;
  raw_time?: number;
  phonetic?: string;
  team_phonetic?: string | null;
  team_short_phonetic?: string | null;
  leader_flag?: boolean;
  node_finished?: boolean;
  pilot?: string;
  callsign?: string;
};

/**
 * The cue engine. `now()` is milliseconds on the page's clock; race times come in as
 * RotorHazard's clock through `differential` (RotorHazard ms minus page ms), the same
 * number the race clock uses.
 */
export class CueEngine {
  settings: AudioSettings;
  /** Minimum lap time (s), RotorHazard's: callouts for shorter laps are skipped. */
  minLapS = 0;
  private queue: string[] = [];
  private checkQueue = true;
  private checkCounter = 0;
  private winnerDeclared = false;
  // the race timer, as RotorHazard's: tenths, staging-relative tenths, what has fired.
  // Start times stay in RotorHazard's clock (pi seconds) and are placed on ours through the
  // differential, which can arrive or move after the race began (a reload mid-race, #73).
  private piStartS: number | null = null;
  private piStagingS: number | null = null;
  private differential: number | null = null;
  /** RotorHazard's resume_check: the first race_status after load kicks a running race off. */
  private resumeCheck = true;
  // RotorHazard's deferred timer: a scheduled start, in its clock (seconds), spoken down.
  private piScheduledS: number | null = null;
  private lastDeferredTenth: number | null = null;
  private countUp = false;
  private durationTenths = 0;
  private stagingTones = 0;
  private lastTenth: number | null = null;
  private lastStagingTenth: number | null = null;
  private running = false;

  constructor(
    private readonly out: CueOutputs,
    private readonly now: () => number,
    settings: AudioSettings = AUDIO_DEFAULTS
  ) {
    this.settings = settings;
  }

  private get raceStartMs(): number | null {
    return this.piStartS == null || this.differential == null
      ? null
      : this.piStartS * 1000 - this.differential;
  }
  private get stagingStartMs(): number | null {
    return this.piStagingS == null || this.differential == null
      ? null
      : this.piStagingS * 1000 - this.differential;
  }

  // ---- tones (rotorhazard.js play_beep and friends) ----

  beep(durationMs: number, frequency: number, volume: number, type: ToneType, fadeS = 1) {
    if (volume && volume > MIN_LOG_VOL_LIM)
      this.out.tone({ durationMs, frequency, volume, type, fadeS });
  }
  /** rotorhazard.js play_mp3_beep: the file at that volume, nothing below the floor. */
  mp3(file: Mp3File, volume: number) {
    if (volume && volume > MIN_LOG_VOL_LIM) this.out.mp3?.({ file, volume });
  }
  private leaderTone() {
    const v = this.settings.indicator_beep_volume;
    if (this.settings.use_mp3_tones) return this.mp3('leader', v);
    this.beep(75, 1200, v, 'square');
    this.out.setTimeout(() => this.beep(100, 1800, v, 'square'), 75);
  }
  private winnerTone() {
    const v = this.settings.indicator_beep_volume;
    if (this.settings.use_mp3_tones) return this.mp3('winner', v);
    this.beep(50, 1200, v, 'square');
    this.out.setTimeout(() => this.beep(75, 1800, v, 'square'), 50);
    this.out.setTimeout(() => this.beep(50, 1200, v, 'square'), 125);
    this.out.setTimeout(() => this.beep(75, 1800, v, 'square'), 175);
    this.out.setTimeout(() => this.beep(50, 1200, v, 'square'), 250);
    this.out.setTimeout(() => this.beep(100, 1800, v, 'square'), 300);
  }
  private stageTone() {
    if (this.settings.use_mp3_tones) return this.mp3('stage', this.settings.tone_volume);
    this.beep(100, 440, this.settings.tone_volume, 'triangle');
  }
  private startTone() {
    if (this.settings.use_mp3_tones) return this.mp3('buzzer', this.settings.tone_volume);
    this.beep(700, 880, this.settings.tone_volume, 'triangle', 0.25);
  }

  // ---- speech (rotorhazard.js speak / doSpeak, drained on heartbeat) ----

  speak(text: string, priority = false) {
    if (priority) this.queue.unshift(text);
    else this.queue.push(text);
  }
  private doSpeak(obj: string): boolean {
    let text = obj;
    if (text.startsWith(LEADER_FLAG)) {
      text = text.slice(1);
      this.leaderTone();
    } else if (text.startsWith(WINNER_FLAG)) {
      text = text.slice(1);
      this.winnerTone();
    }
    if (
      this.settings.voice_volume &&
      this.settings.voice_volume > MIN_LOG_VOL_LIM &&
      text.length > 0
    ) {
      this.out.speak({
        text,
        rate: this.settings.voice_rate,
        pitch: this.settings.voice_pitch,
        volume: this.settings.voice_volume,
        voice: this.settings.voice_language
      });
      return true;
    }
    return false;
  }
  /** RotorHazard's heartbeat handler: one callout per heartbeat, once the last has started. */
  heartbeat() {
    if (this.queue.length === 0) return;
    const speaking = this.out.speaking();
    if (this.checkQueue) {
      if (!speaking) {
        const obj = this.queue.shift()!;
        if (this.queue.length > 0) {
          this.checkQueue = false;
          this.checkCounter = 10;
        }
        if (!this.doSpeak(obj)) this.checkQueue = true;
      }
    } else if (speaking || --this.checkCounter <= 0) {
      this.checkQueue = true;
      this.checkCounter = 0;
    }
  }
  /** The first click on the page: RotorHazard speaks a blank to wake the engine. */
  unlock() {
    this.doSpeak(' ');
  }

  // ---- socket events (run.html) ----

  stageReady(
    p: {
      pi_staging_at_s?: number;
      pi_starts_at_s?: number;
      staging_tones?: number;
      unlimited_time?: boolean | number;
      race_time_sec?: number;
    },
    differential: number | null
  ) {
    // RotorHazard's clock to ours: pi seconds × 1000 minus the measured differential, which
    // is applied at each tick so it can arrive (or move) later.
    this.piStartS = p.pi_starts_at_s ?? null;
    this.piStagingS = p.pi_staging_at_s ?? null;
    this.differential = differential;
    this.countUp = Boolean(p.unlimited_time);
    this.durationTenths = Math.round((p.race_time_sec ?? 0) * 10);
    this.stagingTones = p.staging_tones ?? 0;
    this.lastTenth = null;
    this.lastStagingTenth = null;
    this.winnerDeclared = false;
    this.running = true;
    this.piScheduledS = null; // the race timer takes over from the deferred one
  }
  /**
   * run.html's race_scheduled: RotorHazard's deferred timer counts down to a scheduled start
   * and speaks "Next race begins in …" at its marks (hours, 30/10 minutes, 5–2 minutes,
   * 1 minute, 30/10/5 seconds) while no race runs; null cancels it.
   */
  scheduleAt(piSeconds: number | null, differential: number | null) {
    this.piScheduledS = piSeconds;
    if (differential != null) this.differential = differential;
    this.lastDeferredTenth = null;
  }
  private deferredStep(tenths: number) {
    if (this.settings.voice_race_timer === 0) return;
    const say = (what: string) => this.speak(`Next race begins in ${what}`, true);
    if (tenths < -36000 && !(tenths % -36000)) say(`${tenths / -36000} Hours`);
    else if (tenths === -36000) say('1 Hour');
    else if (tenths === -18000) say('30 Minutes');
    else if (tenths === -6000) say('10 Minutes');
    else if (tenths < -600 && tenths >= -3000 && !(tenths % 600)) say(`${tenths / -600} Minutes`);
    else if (tenths === -600) say('1 Minute');
    else if (tenths === -300) say('30 Seconds');
    else if (tenths === -100) say('10 Seconds');
    else if (tenths === -50) say('5 Seconds');
  }
  /**
   * The race stopped (or was discarded): the timer stops, nothing more fires. A tenth whose
   * boundary has passed fires first: RotorHazard's own step is scheduled on the boundary and
   * has run by the time its stop_timer reaches a page, so the expiry tone at the very moment
   * the server ends the race is not lost to the order of two messages.
   */
  stop() {
    if (this.running) this.tick();
    this.running = false;
  }
  /** Milliseconds until the next whole tenth of the running race, for a boundary-aligned tick. */
  msToNextTenth(): number | null {
    const start = this.raceStartMs;
    if (!this.running || start == null) return null;
    const into = (((this.now() - start) % 100) + 100) % 100;
    return 100 - into;
  }
  /**
   * run.html's race_status handler: the first one after load finds a race staging or running
   * (a page reloaded mid-race, #73) and kicks it off from the same fields stage_ready carries,
   * as RotorHazard's resume_check / race_kickoff does; Ready stops the timer.
   */
  raceStatus(
    p: Parameters<CueEngine['stageReady']>[0] & { race_status?: number | string },
    differential: number | null
  ) {
    const status = Number(p.race_status);
    if (status === 0) this.stop();
    else if (this.resumeCheck && (status === 1 || status === 3)) this.stageReady(p, differential);
    this.resumeCheck = false;
  }
  /**
   * The clock sync moved (a new pi_time sample): the start times move with it. Tenths already
   * fired are not fired again, and tenths a forward jump skipped are not caught up.
   */
  resync(differential: number | null) {
    if (differential === this.differential) return;
    this.differential = differential;
    const start = this.raceStartMs;
    if (this.lastTenth == null || start == null) return;
    const elapsed = Math.floor((this.now() - start) / 100);
    this.lastTenth = Math.max(this.lastTenth, elapsed - 1);
  }

  phoneticData(msg: PhoneticData) {
    const s = this.settings;
    if (msg.node_finished && !s.voice_if_node_finished) return;
    if (!(this.minLapS * 1000 < (msg.raw_time ?? 0))) return;
    let tts = '';
    if (s.voice_callsign === 1 || (s.voice_callsign === 2 && !msg.team_phonetic)) {
      if (msg.callsign) tts = msg.callsign;
      if (msg.pilot) tts = msg.pilot;
    }
    if (msg.lap && (s.voice_lap_count === 1 || (s.voice_lap_count === 2 && !msg.team_phonetic))) {
      if (tts.length) tts += ', ';
      tts += `Lap ${msg.lap}`;
    }
    if (s.voice_lap_time === 1 || (s.voice_lap_time === 2 && !msg.team_phonetic)) {
      if (tts.length) tts += ', ';
      tts += msg.phonetic ?? '';
    }
    if (msg.team_phonetic && s.voice_team_lap_count !== 0) {
      if (tts.length) tts += ', ';
      tts +=
        s.voice_team_lap_count === 2 && msg.team_short_phonetic
          ? msg.team_short_phonetic
          : msg.team_phonetic;
    }
    if (tts.length === 0) return;
    if (msg.leader_flag) {
      if (s.beep_race_leader_lap) this.speak(LEADER_FLAG);
      if (s.voice_race_leader && !msg.team_phonetic) {
        const who = msg.pilot ? msg.pilot : (msg.callsign ?? '');
        this.out.setTimeout(() => this.calloutLeader(who, false), s.voice_race_leader * 1000);
      }
    }
    this.speak(tts);
  }
  phoneticLeader(msg: { pilot?: string; callsign?: string }) {
    if (!this.settings.voice_race_leader) return;
    const who = msg.pilot ? msg.pilot : (msg.callsign ?? '');
    this.out.setTimeout(
      () => this.calloutLeader(who, true),
      this.settings.voice_race_leader * 1000
    );
  }
  private calloutLeader(who: string, separate: boolean) {
    if (this.winnerDeclared) return;
    this.speak(`${who} is leading`, separate);
    if (separate && this.settings.beep_race_leader_lap) this.speak(LEADER_FLAG, separate);
  }
  phoneticText(msg: { text?: string; domain?: string | false; winner_flag?: boolean }) {
    if (msg.winner_flag) {
      if (this.settings.beep_race_winner_declared) this.speak(WINNER_FLAG);
      this.winnerDeclared = true;
    }
    if (msg.text) {
      const domain = msg.domain
        ? (this.settings as Record<string, unknown>)[`voice_${msg.domain}`]
        : undefined;
      if (!msg.domain || domain) this.speak(msg.text);
    }
  }
  /** run.html's "+ Lap" click: the seat's node tone when "beep on manual lap" is set. */
  manualLap(nodeIndex: number) {
    const s = this.settings;
    if (!s.beep_manual_lap_button) return;
    if (s.use_mp3_tones) return this.mp3('beep', s.indicator_beep_volume);
    this.beep(35, NODE_TONE[nodeIndex] ?? 440, s.indicator_beep_volume, 'sawtooth');
  }
  firstPassRegistered(msg: { node_index: number }) {
    const s = this.settings;
    if (s.beep_crossing_exited || !s.beep_on_first_pass_button) return;
    if (s.use_mp3_tones) return this.mp3('beep', s.indicator_beep_volume);
    const f = NODE_TONE[msg.node_index] ?? 440;
    this.beep(35, f, s.indicator_beep_volume, 'sawtooth', 0.02);
    this.out.setTimeout(() => this.beep(35, f, s.indicator_beep_volume, 'sawtooth'), 70);
  }

  // ---- the race timer (rotorhazard.js timer callbacks.step), one call per tick ----

  tick() {
    if (!this.running && this.piScheduledS != null && this.differential != null) {
      const at = this.piScheduledS * 1000 - this.differential;
      const elapsed = Math.floor((this.now() - at) / 100);
      if (this.lastDeferredTenth == null) this.lastDeferredTenth = elapsed - 1;
      for (let e = this.lastDeferredTenth + 1; e <= elapsed; e++) {
        if (e >= 0) {
          this.piScheduledS = null; // expired: RotorHazard's page shows "Wait" for the start
          break;
        }
        this.deferredStep(e);
      }
      this.lastDeferredTenth = elapsed;
      return;
    }
    const start = this.raceStartMs;
    if (!this.running || start == null) return;
    const now = this.now();
    // RotorHazard's timer (rotorhazard.js timerModel) schedules each step on the whole tenth
    // (get_next_step aligns setTimeout to local_zero_time modulo 100 ms) and labels it with
    // Math.round(time / 100); so a tenth fires AT k × 100 ms, a few ms late. Ticking every
    // 20 ms and taking the floor fires ours in the same 0–20 ms window after the boundary.
    // (Rounding here fired up to 50 ms before the boundary: QA measured a steady 30–40 ms
    // lead on every staging tone, #38.)
    const elapsed = Math.floor((now - start) / 100);
    if (this.lastTenth == null) this.lastTenth = elapsed - 1;
    // Fire every tenth that passed since the last tick, in order, so none is skipped.
    // RotorHazard's time_tenths: negative before the start, elapsed while counting up,
    // remaining while counting down.
    for (let e = this.lastTenth + 1; e <= elapsed; e++) {
      this.step(e < 0 ? e : this.countUp ? e : this.durationTenths - e);
      // A countdown that reached zero expires RotorHazard's timer: nothing fires after it.
      if (!this.countUp && e >= this.durationTenths) {
        this.running = false;
        break;
      }
    }
    this.lastTenth = elapsed;
  }
  private step(tenths: number) {
    const s = this.settings;
    if (tenths < 0) {
      const start = this.raceStartMs;
      const staging = this.stagingStartMs;
      if (start == null || staging == null) return;
      // staging-relative tenths at this race tenth: race start minus the time left
      const stagingTenths = Math.round((start + tenths * 100 - staging) / 100);
      if (
        stagingTenths < this.stagingTones * 10 &&
        stagingTenths >= 0 &&
        stagingTenths % 10 === 0 &&
        stagingTenths !== this.lastStagingTenth
      ) {
        this.lastStagingTenth = stagingTenths;
        this.stageTone();
      }
      return;
    }
    if (tenths === 0 || (!this.countUp && tenths === this.durationTenths)) {
      this.startTone();
      return;
    }
    if (!this.countUp) {
      if (tenths <= 50 && tenths > 0) {
        if (tenths % 10 === 0) this.stageTone();
      } else if (tenths === 100) {
        if (s.voice_race_timer !== 0) this.speak('10 Seconds', true);
      }
    }
    if (s.voice_race_timer === 1 || (s.voice_race_timer === 2 && !this.countUp)) {
      if (tenths > 36000 && !(tenths % 36000)) this.speak(`${tenths / 36000} Hours`, true);
      else if (tenths === 36000) this.speak('1 Hour', true);
      else if (tenths === 18000) this.speak('30 Minutes', true);
      else if (tenths > 600 && tenths <= 3000 && !(tenths % 600))
        this.speak(`${tenths / 600} Minutes`, true);
      else if (tenths === 600) this.speak('1 Minute', true);
      else if (tenths === 300) this.speak('30 Seconds', true);
    }
  }
}
