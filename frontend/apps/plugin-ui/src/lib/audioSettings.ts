/**
 * RotorHazard's per-browser audio settings as data: the `rotorhazard.<key>` localStorage
 * entries its Audio Control panel writes (rotorhazard.js rhStorageItems, isAudio), its
 * "Export Audio Settings" text format and the import of it, its defaults, and the log
 * slider its volume controls use (LogSlider: 0–100 ↔ 0.01–1.0). The cue engine reads the
 * same keys, so what is set here is what both the engine and RotorHazard's own page play.
 */
import { AUDIO_DEFAULTS, readAudioSettings, type AudioSettings } from './cues.js';

export const AUDIO_KEYS = Object.keys(AUDIO_DEFAULTS) as Array<keyof AudioSettings>;

/** rotorhazard.js LogSlider({maxpos: 100, minval: MIN_LOG_VOLUME, maxval: MAX_LOG_VOLUME}). */
const MIN_LOG_VOLUME = 0.01;
const MAX_LOG_VOLUME = 1.0;
const SCALE = (Math.log(MAX_LOG_VOLUME) - Math.log(MIN_LOG_VOLUME)) / 100;
export function sliderToVolume(position: number): number {
  return Math.exp(position * SCALE + Math.log(MIN_LOG_VOLUME));
}
export function volumeToSlider(volume: number): number {
  if (!(volume > 0)) return 0;
  return Math.round((Math.log(volume) - Math.log(MIN_LOG_VOLUME)) / SCALE);
}

/** RotorHazard's saveData: every audio key as JSON under `rotorhazard.<key>`. */
export function saveAudioSettings(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  s: AudioSettings
): void {
  if (!storage) return;
  for (const k of AUDIO_KEYS) storage.setItem(`rotorhazard.${k}`, JSON.stringify(s[k]));
}

/** rotorhazard.getAudioSettingsStr: a dated comment, then `rotorhazard.<key>=<JSON>` lines. */
export function exportAudioSettings(s: AudioSettings, date: Date | null = new Date()): string {
  let out = '';
  if (date) out += `# RotorHazard Audio Settings ${date.toLocaleString('en-us')}\n`;
  for (const k of AUDIO_KEYS) out += `rotorhazard.${k}=${JSON.stringify(s[k])}\n`;
  return out;
}

/** RotorHazard's export file name shape (rhAudioSettings_<date>_<time>.cfg). */
export function exportFileName(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `rhAudioSettings_${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_` +
    `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}.cfg`
  );
}

/**
 * rotorhazard.importAudioSettingsDataStr: lines of `rotorhazard.<key>=<JSON>`, `#` comments
 * skipped, unknown keys reported; values take RotorHazard's own coercions (readAudioSettings).
 */
export function importAudioSettings(
  text: string,
  base: AudioSettings = AUDIO_DEFAULTS
): { settings: AudioSettings; unknown: string[]; found: number } {
  const store = new Map<string, string>();
  const unknown: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    const k = key.startsWith('rotorhazard.') ? key.slice('rotorhazard.'.length) : '';
    if ((AUDIO_KEYS as string[]).includes(k)) store.set(key, value);
    else unknown.push(key);
  }
  const settings = readAudioSettings({ getItem: (k) => store.get(k) ?? null }, base);
  return { settings, unknown, found: store.size };
}

/** The option lists RotorHazard's panel offers, with its values and labels. */
export const AUDIO_OPTIONS = {
  voice_callsign: [
    [0, 'Never'],
    [2, 'Only on non-team/non-co-op races'],
    [1, 'Always']
  ],
  voice_lap_count: [
    [0, 'Never'],
    [2, 'Only on non-team/non-co-op races'],
    [1, 'Always']
  ],
  voice_lap_time: [
    [0, 'Never'],
    [2, 'Only on non-team/non-co-op races'],
    [1, 'Always']
  ],
  voice_race_timer: [
    [0, 'Never'],
    [2, 'Only on fixed-time races'],
    [1, 'Always']
  ],
  voice_team_lap_count: [
    [0, 'Never'],
    [1, 'On team/co-op races'],
    [2, 'On team/co-op races (short call)']
  ],
  voice_race_winner: [
    [0, 'Never'],
    [1, 'Always']
  ],
  voice_if_node_finished: [
    [0, 'Never'],
    [1, 'Always']
  ],
  voice_split_timer: [
    [0, 'None'],
    [1, 'Pilot name'],
    [5, 'Pilot name, split value'],
    [3, 'Pilot name, split ID'],
    [7, 'Pilot name, split ID, split value'],
    [2, 'Split ID'],
    [6, 'Split ID, split value'],
    [4, 'Split value']
  ],
  voice_race_leader: [
    [0, 'None'],
    [1, 'After 1 second'],
    [2, 'After 2 seconds'],
    [3, 'After 3 seconds'],
    [4, 'After 4 seconds'],
    [5, 'After 5 seconds'],
    [6, 'After 6 seconds'],
    [7, 'After 7 seconds'],
    [8, 'After 8 seconds'],
    [9, 'After 9 seconds'],
    [10, 'After 10 seconds']
  ]
} as const satisfies Partial<Record<keyof AudioSettings, ReadonlyArray<readonly [number, string]>>>;
