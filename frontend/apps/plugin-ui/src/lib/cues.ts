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

export type CueOutputs = {
  tone: (t: Tone) => void;
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

/** rotorhazard.js MIN_LOG_VOL_LIM: below this a volume is silence. */
const MIN_LOG_VOL_LIM = 0.01;
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
  // the race timer, as RotorHazard's: tenths, staging-relative tenths, what has fired
  private raceStartMs: number | null = null;
  private stagingStartMs: number | null = null;
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

  // ---- tones (rotorhazard.js play_beep and friends) ----

  beep(durationMs: number, frequency: number, volume: number, type: ToneType, fadeS = 1) {
    if (volume && volume > MIN_LOG_VOL_LIM)
      this.out.tone({ durationMs, frequency, volume, type, fadeS });
  }
  private leaderTone() {
    const v = this.settings.indicator_beep_volume;
    this.beep(75, 1200, v, 'square');
    this.out.setTimeout(() => this.beep(100, 1800, v, 'square'), 75);
  }
  private winnerTone() {
    const v = this.settings.indicator_beep_volume;
    this.beep(50, 1200, v, 'square');
    this.out.setTimeout(() => this.beep(75, 1800, v, 'square'), 50);
    this.out.setTimeout(() => this.beep(50, 1200, v, 'square'), 125);
    this.out.setTimeout(() => this.beep(75, 1800, v, 'square'), 175);
    this.out.setTimeout(() => this.beep(50, 1200, v, 'square'), 250);
    this.out.setTimeout(() => this.beep(100, 1800, v, 'square'), 300);
  }
  private stageTone() {
    this.beep(100, 440, this.settings.tone_volume, 'triangle');
  }
  private startTone() {
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
    differential: number
  ) {
    // RotorHazard's clock to ours: pi seconds × 1000 minus the measured differential.
    this.raceStartMs = p.pi_starts_at_s == null ? null : p.pi_starts_at_s * 1000 - differential;
    this.stagingStartMs =
      p.pi_staging_at_s == null ? null : p.pi_staging_at_s * 1000 - differential;
    this.countUp = Boolean(p.unlimited_time);
    this.durationTenths = Math.round((p.race_time_sec ?? 0) * 10);
    this.stagingTones = p.staging_tones ?? 0;
    this.lastTenth = null;
    this.lastStagingTenth = null;
    this.winnerDeclared = false;
    this.running = true;
  }
  /** The race stopped (or was discarded): the timer stops, nothing more fires. */
  stop() {
    this.running = false;
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
  firstPassRegistered(msg: { node_index: number }) {
    const s = this.settings;
    if (s.beep_crossing_exited || !s.beep_on_first_pass_button) return;
    const f = NODE_TONE[msg.node_index] ?? 440;
    this.beep(35, f, s.indicator_beep_volume, 'sawtooth', 0.02);
    this.out.setTimeout(() => this.beep(35, f, s.indicator_beep_volume, 'sawtooth'), 70);
  }

  // ---- the race timer (rotorhazard.js timer callbacks.step), one call per tick ----

  tick() {
    if (!this.running || this.raceStartMs == null) return;
    const now = this.now();
    // RotorHazard rounds its tenths (Math.round(time / 100)), so a tenth flips at .x50.
    const elapsed = Math.round((now - this.raceStartMs) / 100);
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
      if (this.stagingStartMs == null) return;
      // staging-relative tenths at this race tenth: race start minus the time left
      const stagingTenths = Math.round(
        (this.raceStartMs! + tenths * 100 - this.stagingStartMs) / 100
      );
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
