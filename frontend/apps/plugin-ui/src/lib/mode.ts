/**
 * The plugin's mode (#95): how much of Grid this timer shows, and in whose words. One
 * setting for the whole timer (the plugin keeps it beside the event name), so the phone,
 * the laptop and the overlay machine agree.
 *
 * - full: everything.
 * - simple: the club-night pages; Teams, Formats and the stage machinery stay out of the way.
 * - racegow: simple, plus racegow's workflow and vocabulary (seasons, tracks, runs): Home
 *   becomes the season — its tracks, the pilot, new season / new track — and Event, Pilots
 *   and Stages leave the nav.
 *
 * Hidden pages stay reachable by URL and from the help: the mode is about what is in the
 * way, not about locking anything.
 */
import { SCREENS } from './screens.js';

export type Mode = 'full' | 'simple' | 'racegow';
export const MODES: readonly Mode[] = ['full', 'simple', 'racegow'];
export const DEFAULT_MODE: Mode = 'full';

export const MODE_LABELS: Record<Mode, string> = {
  full: 'Full',
  simple: 'Simple',
  racegow: 'RaceGOW'
};

export const MODE_DESCRIPTIONS: Record<Mode, string> = {
  full: 'Every page: the event, pilots and teams, formats, stages with brackets and Chase the Ace, run, marshal, results.',
  simple:
    'A club night without the machinery: no Teams or Formats pages, no brackets or seeding on Stages.',
  racegow: 'Simple, in racegow’s words: seasons, tracks and runs, one pilot on one seat.'
};

/** Screens a mode keeps out of the nav. */
const HIDDEN: Record<Mode, ReadonlySet<string>> = {
  full: new Set(),
  simple: new Set(['teams', 'formats']),
  // Seasons, tracks and the pilot live on racegow's own Home; Event, Pilots and Stages
  // stay reachable by URL for the odd repair, out of the way otherwise.
  racegow: new Set(['teams', 'formats', 'event', 'pilots', 'stages'])
};

export function isMode(v: unknown): v is Mode {
  return typeof v === 'string' && (MODES as readonly string[]).includes(v);
}

/** The admin screens this mode shows, in nav order. */
export function visibleScreens(mode: Mode): typeof SCREENS {
  const hidden = HIDDEN[mode];
  return SCREENS.filter((s) => !hidden.has(s.path));
}

/** Whether a mode shows the stage machinery (brackets, Chase the Ace, seeding, duplicate). */
export function showsStageMachinery(mode: Mode): boolean {
  return mode === 'full';
}
