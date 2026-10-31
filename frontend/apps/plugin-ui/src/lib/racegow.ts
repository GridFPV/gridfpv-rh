/**
 * RaceGOW mode (#95), the pure part: how racegow's words map onto RotorHazard's data.
 *
 * - A **season** is the event (one database); its name is `RaceGOW Season N`, so its
 *   archive is a file by that name and past seasons can be found among the archives.
 * - A **track** is a class named `Track N`, numbered next in the season from 1, with one
 *   heat. Every track is unique — within and across seasons — so a track's best is its
 *   all-time best.
 * - A **run** is a round of that heat (rounds unlimited, advance = stay on this heat).
 *
 * Names a video or a title carries are composed from a template; the heat itself holds
 * only the static part (`RaceGOW {season} Track {n}`), since a heat has no round.
 */
import type { Heat, RaceClass, RaceFormat, Setup } from './setup.js';
import { WIN_CONDITION } from './setup.js';
import { racesFor, type Results } from './results.js';
import type { ClassBoards, ResultBoards } from './resultBoards.js';

export const DEFAULT_NAME_TEMPLATE = 'RaceGOW {season} {track} Round {round}';
export const TEMPLATE_TOKENS = ['{season}', '{track}', '{round}', '{heat}'] as const;
const TEMPLATE_MAX = 120;

export type RaceGowSettings = {
  season: number;
  seat: number | null;
  callsign: string;
  /** What a run is called, from the tokens above; the plugin keeps it as `name_template`. */
  nameTemplate: string;
};
export const DEFAULT_RACEGOW: RaceGowSettings = {
  season: 1,
  seat: null,
  callsign: '',
  nameTemplate: DEFAULT_NAME_TEMPLATE
};

/** The plugin's record (`gridfpv_racegow`), read defensively. */
export function applyRaceGow(
  p: Partial<Record<'season' | 'seat' | 'callsign' | 'name_template', unknown>> | null
) {
  const season = Number(p?.season);
  const seat = p?.seat == null || p.seat === '' ? null : Number(p.seat);
  const template = String(p?.name_template ?? '').trim();
  return {
    season: Number.isInteger(season) && season >= 1 ? season : 1,
    seat: seat != null && Number.isInteger(seat) && seat >= 0 ? seat : null,
    callsign: String(p?.callsign ?? ''),
    nameTemplate: template || DEFAULT_NAME_TEMPLATE
  } satisfies RaceGowSettings;
}

/**
 * Why a name template is refused, or null (the plugin applies the same rules): it must name
 * the run, and it must be a usable file name, since it also names the recording (#96).
 */
export function templateProblem(template: string): string | null {
  const t = template.trim();
  if (!t) return null;
  if (t.length > TEMPLATE_MAX) return `Keep the template under ${TEMPLATE_MAX} characters.`;
  if (!t.includes('{round}'))
    return 'The template needs {round}, or every run of a track would share a name.';
  // eslint-disable-next-line no-control-regex
  const bad = /[\\/:*?"<>|\u0000-\u001f]/.exec(t);
  if (bad) return `"${bad[0]}" cannot be in a name: it also names the recording file.`;
  const unknown = (t.match(/\{[^}]*\}/g) ?? []).find(
    (tok) => !(TEMPLATE_TOKENS as readonly string[]).includes(tok)
  );
  if (unknown) return `Unknown token ${unknown}; the tokens are ${TEMPLATE_TOKENS.join(', ')}.`;
  return null;
}

// ---- seasons ----------------------------------------------------------------------

export const SEASON_PREFIX = 'RaceGOW Season ';

export function seasonName(n: number): string {
  return `${SEASON_PREFIX}${n}`;
}

/** The season number an event name carries, or null when the event is not a season. */
export function seasonNumberOf(eventName: string): number | null {
  const m = /^RaceGOW Season (\d+)$/i.exec(eventName.trim());
  return m ? Number(m[1]) : null;
}

/**
 * Past seasons among RotorHazard's archives (`RaceGOW Season 2.db`, or with a counter when
 * archived more than once), newest season first, one file per season: the last listed,
 * since RotorHazard lists backups oldest first.
 */
export function seasonArchives(files: string[]): Array<{ file: string; season: number }> {
  const byseason = new Map<number, string>();
  for (const f of files) {
    const base = f.replace(/\.db$/, '').replace(/ \(\d+\)$/, '');
    const n = seasonNumberOf(base);
    if (n != null) byseason.set(n, f);
  }
  return [...byseason.entries()]
    .map(([season, file]) => ({ file, season }))
    .sort((a, b) => b.season - a.season);
}

// ---- tracks -----------------------------------------------------------------------

export function trackName(n: number): string {
  return `Track ${n}`;
}

export function trackNumberOf(className: string): number | null {
  const m = /^Track (\d+)$/i.exec(className.trim());
  return m ? Number(m[1]) : null;
}

export type Track = { cls: RaceClass; number: number; heat: Heat | null; runs: number };

/** The season's tracks, newest first. A class that is not `Track N` is not a track. */
export function tracksOf(setup: Setup, results: Results): Track[] {
  const out: Track[] = [];
  for (const cls of setup.classes) {
    const number = trackNumberOf(cls.name);
    if (number == null) continue;
    const heat = setup.heats.find((h) => h.classId === cls.id) ?? null;
    out.push({ cls, number, heat, runs: heat ? racesFor(results, heat.id).length : 0 });
  }
  return out.sort((a, b) => b.number - a.number);
}

export function nextTrackNumber(classes: RaceClass[]): number {
  let max = 0;
  for (const c of classes) max = Math.max(max, trackNumberOf(c.name) ?? 0);
  return max + 1;
}

/** The track on the timer: the class of the loaded heat, else the newest track. */
export function currentTrack(tracks: Track[], currentHeatId: number): Track | undefined {
  return tracks.find((t) => t.heat?.id === currentHeatId) ?? tracks[0];
}

/** The static part of a run's name — what the heat is called. */
export function heatNameFor(season: number, track: number): string {
  return `RaceGOW ${season} Track ${track}`;
}

// ---- names ------------------------------------------------------------------------

/** Fill a name template; `{track}` is the track's name ("Track 3"), so no number parsing. */
export function renderName(
  template: string,
  vars: { season: number; track: string; round?: number | null; heat?: string }
): string {
  return template
    .replace(/\{season\}/g, String(vars.season))
    .replace(/\{track\}/g, vars.track)
    .replace(/\{round\}/g, vars.round == null ? '' : String(vars.round))
    .replace(/\{heat\}/g, vars.heat ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `RaceGOW 1 Track 3 Round 7`, for a run, from the timer's template; the track alone without a round. */
export function runName(
  season: number,
  track: Track | string,
  round?: number | null,
  template: string = DEFAULT_NAME_TEMPLATE
): string {
  const name = typeof track === 'string' ? track : track.cls.name;
  return renderName(round == null ? 'RaceGOW {season} {track}' : template, {
    season,
    track: name,
    round
  });
}

// ---- the format a run uses --------------------------------------------------------

/** No time limit (a run ends when the pilot lands), ranked by consecutive laps. */
export const RACEGOW_FORMAT_NAME = 'RaceGOW';

export function racegowFormatFields() {
  return {
    name: RACEGOW_FORMAT_NAME,
    unlimitedTime: true,
    winCondition: WIN_CONDITION.FASTEST_CONSECUTIVE
  };
}

export function findRaceGowFormat(formats: RaceFormat[]): RaceFormat | undefined {
  return formats.find((f) => f.name.trim().toLowerCase() === RACEGOW_FORMAT_NAME.toLowerCase());
}

// ---- the track view ---------------------------------------------------------------

/** The class's boards from RotorHazard's Results page data, for one track. */
export function trackBoards(boards: ResultBoards, classId: number): ClassBoards | null {
  return boards.classes.find((c) => c.classId === classId) ?? null;
}

/**
 * The run a board figure came from. RotorHazard's source reads "<heat> / Round N" when
 * the figure was flown in a round (lib/resultBoards sourceText); without a round there is
 * no run to name.
 */
export function runNumberOf(source: string): number | null {
  const m = /\/ Round (\d+)$/.exec(source.trim());
  return m ? Number(m[1]) : null;
}
