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
  engine.minLapS = timer.timing.minLapMs / 1000;
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
    onSocket<{ race_status: number }>('race_status', (p) => {
      if (Number(p.race_status) === RACE_STATUS.READY) e.stop();
    }),
    onSocket('stop_timer', () => e.stop()),
    onSocket('heartbeat', () => e.heartbeat()),
    onSocket<Parameters<CueEngine['phoneticData']>[0]>('phonetic_data', (p) => e.phoneticData(p)),
    onSocket<Parameters<CueEngine['phoneticLeader']>[0]>('phonetic_leader', (p) =>
      e.phoneticLeader(p)
    ),
    onSocket<Parameters<CueEngine['phoneticText']>[0]>('phonetic_text', (p) => e.phoneticText(p)),
    onSocket<{ node_index: number }>('first_pass_registered', (p) => e.firstPassRegistered(p))
  );
  // Ticking well inside a tenth keeps each tone within a few ms of its tenth (RotorHazard's
  // page runs its timer at 100 ms; the ledgers are compared at ±50 ms).
  const tick = window.setInterval(() => e.tick(), 20);
  stops.push(() => window.clearInterval(tick));
  return stopCues;
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
