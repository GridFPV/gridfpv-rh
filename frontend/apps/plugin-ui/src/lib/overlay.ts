/**
 * Overlays (#12): the pages you put on top of video in OBS, served bare under
 * `/grid/live/...` with no login and a see-through background. An overlay only reads
 * what the socket already carries; closing OBS, or the browser source crashing, cannot
 * touch a race. The pure helpers here are shared by the overlay page and the Overlays
 * admin page that hands out its URL; tests cover them without a timer.
 */
import { BASE } from './router.svelte.js';
import { RACE_STATUS, type ClockPhase, type LiveLap, type LiveSeat } from './race.js';

export type OverlayTheme = 'dark' | 'light';
export type OverlayName = 'race';

export interface OverlayInfo {
  name: OverlayName;
  title: string;
  description: string;
}

/** The overlays the plugin serves, in the order the Overlays page lists them. */
export const OVERLAY_CATALOG: readonly OverlayInfo[] = [
  {
    name: 'race',
    title: 'Race timer',
    description:
      'The race clock and phase, the heat name, and every pilot on the timer with their ' +
      'laps — last lap, best lap, and the best run of laps in a row when the format scores ' +
      'one. A single pilot gets the full lap list and their best of the day.'
  }
];

/** The route (relative to /grid) for an overlay: `live/race`, `live/race/light`. */
export function overlayRoute(name: OverlayName, theme: OverlayTheme = 'dark'): string {
  return theme === 'light' ? `live/${name}/light` : `live/${name}`;
}

/** The overlay a route names, or null for any other route. */
export function parseOverlayRoute(route: string): { name: string; theme: OverlayTheme } | null {
  const m = /^live\/([a-z]+)(?:\/(light|dark))?$/.exec(route);
  if (!m) return null;
  return { name: m[1], theme: m[2] === 'light' ? 'light' : 'dark' };
}

/**
 * The URL to paste into OBS, from the address the browser used to reach the timer — so
 * it is right whether that was a home DNS name, the field hotspot's IP or localhost.
 */
export function overlayUrl(
  origin: string,
  name: OverlayName,
  theme: OverlayTheme = 'dark'
): string {
  return `${origin}${BASE}/${overlayRoute(name, theme)}`;
}

/** Laps that score: not deleted, not the holeshot (lap 0), not a late lap (-1). */
export function racingLaps(seat: LiveSeat): LiveLap[] {
  return seat.laps.filter((l) => !l.deleted && l.number > 0);
}

/** A consecutive-lap window: where it starts (0-based index into the lap list) and its total. */
export interface ConsecutiveWindow {
  start: number;
  laps: number[];
  totalMs: number;
}

/**
 * The fastest `n` laps in a row of a lap sequence (ms), or undefined with fewer than `n`
 * laps. Ties go to the earliest window, as RotorHazard's do.
 */
export function bestConsecutive(
  lapMs: readonly number[],
  n: number
): ConsecutiveWindow | undefined {
  if (n <= 0 || lapMs.length < n) return undefined;
  let best: ConsecutiveWindow | undefined;
  for (let start = 0; start + n <= lapMs.length; start += 1) {
    const laps = lapMs.slice(start, start + n);
    const totalMs = laps.reduce((sum, lap) => sum + lap, 0);
    if (!best || totalMs < best.totalMs) best = { start, laps, totalMs };
  }
  return best;
}

export function inWindow(index: number, w: ConsecutiveWindow | undefined): boolean {
  return w !== undefined && index >= w.start && index < w.start + w.laps.length;
}

/** A lap or run time the way RotorHazard prints one: `0:04.535`. */
export function formatLapMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  const t = Math.max(0, Math.round(ms));
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const f = t % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(f).padStart(3, '0')}`;
}

/** The word in the corner: what the race is doing right now. */
export function phaseLabel(status: number, clock: ClockPhase): string {
  if (status === RACE_STATUS.STAGING) return 'STAGING';
  if (status === RACE_STATUS.RACING) return clock === 'overtime' ? 'TIME UP' : 'LIVE';
  if (status === RACE_STATUS.DONE) return 'FINISHED';
  return 'READY';
}
