/** The admin screens, in navigation order; the help section has one page per screen (#41). */
export const SCREENS: Array<{ path: string; label: string; help: string }> = [
  { path: '', label: 'Home', help: 'home' },
  { path: 'event', label: 'Event', help: 'event' },
  { path: 'seats', label: 'Seats', help: 'seats' },
  { path: 'pilots', label: 'Pilots', help: 'pilots' },
  { path: 'teams', label: 'Teams', help: 'teams' },
  { path: 'stages', label: 'Stages', help: 'stages' },
  { path: 'formats', label: 'Formats', help: 'formats' },
  { path: 'run', label: 'Run', help: 'run' },
  { path: 'marshal', label: 'Marshal', help: 'marshal' },
  { path: 'results', label: 'Results', help: 'results' },
  { path: 'overlays', label: 'Overlays', help: 'overlays' }
];
