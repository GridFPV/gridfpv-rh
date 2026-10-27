/**
 * The audio cues on a page (#38): the CueEngine wired to Web Audio, speech synthesis,
 * RotorHazard's per-browser settings and the socket. Mirrors rotorhazard.js play_beep
 * (an oscillator into a gain node, faded out `duration` ms after it starts) and the
 * articulate plugin's speak (one SpeechSynthesisUtterance, voice picked by name).
 *
 * Browsers refuse sound until the page has been clicked: like RotorHazard's page, the
 * first click resumes the context and speaks a blank, and `unlocked` tells the UI.
 */
import {
  AUDIO_DEFAULTS,
  CueEngine,
  readAudioSettings,
  type Mp3Cue,
  type Tone,
  type Utterance
} from './cues.js';
import { untrack } from 'svelte';
import { onSocket, rh } from './rh.svelte.js';
import { RACE_STATUS } from './race.js';

type Ctx = AudioContext;

const audio = $state({ unlocked: false, enabled: true });
export function audioState() {
  return audio;
}

let ctx: Ctx | null = null;
function context(): Ctx | null {
  if (ctx) return ctx;
  const C =
    (
      window as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
      }
    ).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  ctx = new C();
  return ctx;
}

/** rotorhazard.js play_beep: start the oscillator, ramp the gain to silence after `duration`. */
function playTone(t: Tone) {
  const c = context();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain);
  gain.connect(c.destination);
  gain.gain.value = t.volume;
  osc.frequency.value = t.frequency;
  osc.type = t.type;
  const fade = /firefox/i.test(navigator.userAgent) ? 0 : t.fadeS;
  osc.start();
  window.setTimeout(() => {
    try {
      gain.gain.exponentialRampToValueAtTime(0.00001, c.currentTime + fade);
    } catch {
      /* a closed context */
    }
    window.setTimeout(
      () => {
        try {
          osc.stop();
        } catch {
          /* already stopped */
        }
      },
      fade * 1000 + 50
    );
  }, t.durationMs);
}

/**
 * rotorhazard.js play_mp3_beep (#75): RotorHazard's own files, served by it next to this page
 * (layout.html's <audio> elements point at /static/audio/*.mp3), so they work offline.
 */
const mp3s = new Map<string, HTMLAudioElement>();
function playMp3(m: Mp3Cue) {
  let el = mp3s.get(m.file);
  if (!el) {
    el = new Audio(`/static/audio/${m.file}.mp3`);
    el.preload = 'auto';
    mp3s.set(m.file, el);
  }
  el.volume = m.volume;
  el.currentTime = 0;
  void el.play()?.catch(() => {
    /* not unlocked yet */
  });
}

function speakNow(u: Utterance) {
  const synth = window.speechSynthesis;
  if (!synth) return;
  const utter = new SpeechSynthesisUtterance(u.text);
  utter.rate = u.rate;
  utter.pitch = u.pitch;
  utter.volume = u.volume;
  if (u.voice) {
    const voice = synth.getVoices().find((v) => v.name === u.voice);
    if (voice) utter.voice = voice;
  }
  synth.speak(utter);
}

let engine: CueEngine | null = null;
let stops: Array<() => void> = [];

/** Start the cues for this page; returns the function that stops them. Idempotent. */
export function startCues(): () => void {
  if (engine) return stopCues;
  const timer = rh();
  const settings = readAudioSettings(safeStorage());
  engine = new CueEngine(
    {
      tone: playTone,
      mp3: playMp3,
      speak: speakNow,
      speaking: () => Boolean(window.speechSynthesis?.speaking),
      setTimeout: (fn, ms) => void window.setTimeout(fn, ms)
    },
    () => performance.now(),
    settings
  );
  // startCues runs inside a component effect: the state it reads to seed itself must not
  // re-run that effect (which would replace the engine mid-race and lose its speech queue).
  engine.minLapS = untrack(() => timer.timing.minLapMs) / 1000;
  const e = engine;

  // RotorHazard's settings are per browser: another tab (or its own page) may change them.
  const onStorage = (ev: StorageEvent) => {
    if (ev.key?.startsWith('rotorhazard.')) e.settings = readAudioSettings(safeStorage());
  };
  window.addEventListener('storage', onStorage);
  stops.push(() => window.removeEventListener('storage', onStorage));

  // Unlock on the first click, as RotorHazard's page does.
  const unlock = () => {
    const c = context();
    if (c && c.state === 'suspended') void c.resume();
    e.unlock();
    audio.unlocked = true;
    document.removeEventListener('click', unlock);
  };
  document.addEventListener('click', unlock);
  stops.push(() => document.removeEventListener('click', unlock));

  stops.push(
    onSocket<Parameters<CueEngine['stageReady']>[0]>('stage_ready', (p) => {
      e.minLapS = timer.timing.minLapMs / 1000;
      e.stageReady(p, timer.sync.differential ?? 0);
    }),
    onSocket<Parameters<CueEngine['raceStatus']>[0]>('race_status', (p) =>
      e.raceStatus(p, timer.sync.differential)
    ),
    // Each pi_time sample moves the measured differential; the timer follows it (#73).
    onSocket('pi_time', () => e.resync(timer.sync.differential)),
    onSocket('stop_timer', () => e.stop()),
    onSocket('heartbeat', () => e.heartbeat()),
    onSocket<Parameters<CueEngine['phoneticData']>[0]>('phonetic_data', (p) => {
      // Read at the callout, not only at staging: a page opened mid-race (#73) has had no
      // stage_ready, and the state's minimum lap starts at RotorHazard's default until min_lap
      // arrives.
      e.minLapS = timer.timing.minLapMs / 1000;
      e.phoneticData(p);
    }),
    onSocket<Parameters<CueEngine['phoneticLeader']>[0]>('phonetic_leader', (p) =>
      e.phoneticLeader(p)
    ),
    onSocket<Parameters<CueEngine['phoneticText']>[0]>('phonetic_text', (p) => e.phoneticText(p)),
    onSocket<{ node_index: number }>('first_pass_registered', (p) => e.firstPassRegistered(p))
  );
  // A page opened mid-race (#73): the socket's first race_status may already have come and
  // gone before this ran; RotorHazard's page would have kicked its timer off from it. Do the
  // same from the state it left behind.
  untrack(() => {
    const r = timer.race;
    if (r.status === RACE_STATUS.RACING || r.status === RACE_STATUS.STAGING) {
      e.raceStatus(
        {
          race_status: r.status,
          pi_starts_at_s: r.startsAt ?? undefined,
          pi_staging_at_s: r.stagingAt ?? undefined,
          staging_tones: r.stagingTones,
          unlimited_time: r.unlimitedTime,
          race_time_sec: r.raceTimeSec
        },
        timer.sync.differential
      );
    }
  });
  // RotorHazard's page steps its timer on each whole tenth (a setTimeout aligned to the race
  // start); do the same: after every tick, one timeout aimed just past the next boundary, with
  // a 20 ms interval as the backstop (the ledgers are compared at ±50 ms).
  let aligned = 0;
  const tick = () => {
    e.tick();
    const ms = e.msToNextTenth();
    window.clearTimeout(aligned);
    if (ms != null) aligned = window.setTimeout(tick, ms + 1);
  };
  const backstop = window.setInterval(tick, 20);
  stops.push(() => {
    window.clearInterval(backstop);
    window.clearTimeout(aligned);
  });
  return stopCues;
}

/** The director pressed "+ Lap" on a seat: RotorHazard's page beeps the node tone if asked. */
export function cueManualLap(seat: number) {
  engine?.manualLap(seat);
}

export function stopCues() {
  for (const s of stops) s();
  stops = [];
  engine = null;
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export { AUDIO_DEFAULTS };
