/**
 * RotorHazard's Run page display preferences, per browser (rotorhazard.js rhStorageItems
 * with isAudio false, under localStorage `rotorhazard.<key>`): what each lap chip shows and
 * in which order, and whether RSSI is shown. Read and written like the audio settings, so
 * RotorHazard's own page and ours agree in the same browser.
 */
import type { LiveLap } from './race.js';

export type DisplayPrefs = {
  /** Show the lap number on each lap ("Lap number"). */
  display_lap_id: boolean;
  /** Show the lap's time since the race start ("Time since start"). */
  display_time_start: boolean;
  /** Show the lap's time since the first pass ("Time since first pass"). */
  display_time_first_pass: boolean;
  /** Newest lap first ("Lap order reversed"). */
  display_laps_reversed: boolean;
  /** RotorHazard hides its RSSI graphs with this; ours hides the RSSI readout. */
  hide_graphs: boolean;
};
export const DISPLAY_DEFAULTS: DisplayPrefs = {
  display_lap_id: false,
  display_time_start: false,
  display_time_first_pass: false,
  display_laps_reversed: false,
  hide_graphs: false
};
export const DISPLAY_KEYS = Object.keys(DISPLAY_DEFAULTS) as Array<keyof DisplayPrefs>;
export const DISPLAY_LABELS: Record<keyof DisplayPrefs, string> = {
  display_lap_id: 'Lap number',
  display_time_start: 'Time since start',
  display_time_first_pass: 'Time since first pass',
  display_laps_reversed: 'Lap order reversed',
  hide_graphs: 'Hide RSSI'
};

export function readDisplayPrefs(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  defaults: DisplayPrefs = DISPLAY_DEFAULTS
): DisplayPrefs {
  const out = { ...defaults };
  if (!storage) return out;
  for (const k of DISPLAY_KEYS) {
    const raw = storage.getItem(`rotorhazard.${k}`);
    if (raw == null) continue;
    out[k] = raw === 'true' || raw === '1' || raw === '"true"';
  }
  return out;
}
export function saveDisplayPrefs(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  p: DisplayPrefs
): void {
  if (!storage) return;
  for (const k of DISPLAY_KEYS) storage.setItem(`rotorhazard.${k}`, JSON.stringify(p[k]));
}

/** m:ss.sss as RotorHazard's formatTimeMillis shows a lap stamp. */
export function stampText(ms: number): string {
  const s = Math.floor(ms / 1000);
  const frac = String(Math.floor(ms % 1000)).padStart(3, '0');
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${frac}`;
}

/**
 * The laps of a seat as chips, in the order and with the extra text the preferences ask
 * for (run.html's lap list): the lap number when asked, the time since the race start,
 * and the time since the first pass (the earliest lap in the list, whichever end it is on).
 */
export function lapChips(
  laps: LiveLap[],
  prefs: DisplayPrefs
): Array<{ lap: LiveLap; label: string; extra: string[] }> {
  const ordered = prefs.display_laps_reversed ? [...laps].reverse() : laps;
  const first = laps.length ? Math.min(...laps.map((l) => l.stampMs)) : 0;
  return ordered.map((lap) => {
    const extra: string[] = [];
    if (prefs.display_time_start) extra.push(`@${stampText(lap.stampMs)}`);
    if (prefs.display_time_first_pass) extra.push(`+${stampText(lap.stampMs - first)}`);
    const label = prefs.display_lap_id
      ? lap.number === 0
        ? 'start'
        : lap.number < 0
          ? 'late'
          : `L${lap.number}`
      : '';
    return { lap, label, extra };
  });
}
