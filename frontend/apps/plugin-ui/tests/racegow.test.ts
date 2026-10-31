import { describe, expect, it } from 'vitest';
import {
  applyRaceGow,
  currentTrack,
  heatNameFor,
  nextTrackNumber,
  renderName,
  runName,
  runNumberOf,
  templateProblem,
  trackBoards,
  seasonArchives,
  seasonName,
  seasonNumberOf,
  trackNumberOf,
  tracksOf
} from '../src/lib/racegow.js';
import type { Heat, RaceClass, Setup } from '../src/lib/setup.js';
import type { Results } from '../src/lib/results.js';
import type { ResultBoards } from '../src/lib/resultBoards.js';

const cls = (id: number, name: string): RaceClass =>
  ({ id, name, displayName: name, description: '', formatId: 0, winCondition: '' }) as RaceClass;
const heat = (id: number, classId: number): Heat => ({ id, classId, slots: [] }) as unknown as Heat;

describe('racegow (#95)', () => {
  it('seasons are events named RaceGOW Season N, found again among the archives', () => {
    expect(seasonName(3)).toBe('RaceGOW Season 3');
    expect(seasonNumberOf('RaceGOW Season 3')).toBe(3);
    expect(seasonNumberOf('racegow season 12 ')).toBe(12);
    expect(seasonNumberOf('Club night')).toBeNull();
    expect(
      seasonArchives([
        'Club night.db',
        'RaceGOW Season 1.db',
        'RaceGOW Season 2.db',
        'RaceGOW Season 2 (2).db',
        'before-delete_RaceGOW Season 2_20261031_120000.db'
      ])
    ).toEqual([
      { season: 2, file: 'RaceGOW Season 2 (2).db' },
      { season: 1, file: 'RaceGOW Season 1.db' }
    ]);
  });

  it('tracks are classes named Track N, numbered next from 1, newest first', () => {
    expect(trackNumberOf('Track 4')).toBe(4);
    expect(trackNumberOf('Qualifying')).toBeNull();
    expect(nextTrackNumber([])).toBe(1);
    expect(nextTrackNumber([cls(1, 'Track 2'), cls(2, 'Track 3'), cls(3, 'Final')])).toBe(4);
    const setup = {
      classes: [cls(1, 'Track 2'), cls(2, 'Track 3'), cls(3, 'Final')],
      heats: [heat(10, 1), heat(11, 2), heat(12, 3)]
    } as unknown as Setup;
    const results = { races: { 10: [{}, {}], 11: [{}] } } as unknown as Results;
    const tracks = tracksOf(setup, results);
    expect(tracks.map((t) => [t.number, t.heat?.id, t.runs])).toEqual([
      [3, 11, 1],
      [2, 10, 2]
    ]);
    expect(currentTrack(tracks, 10)?.number).toBe(2);
    expect(currentTrack(tracks, 999)?.number).toBe(3);
  });

  it('names: the heat carries the static part, a run adds its round', () => {
    expect(heatNameFor(1, 3)).toBe('RaceGOW 1 Track 3');
    expect(runName(1, 'Track 3', 7)).toBe('RaceGOW 1 Track 3 Round 7');
    expect(runName(1, 'Track 3')).toBe('RaceGOW 1 Track 3');
    expect(renderName('{season}-{track}-R{round}', { season: 2, track: 'Track 4', round: 1 })).toBe(
      '2-Track 4-R1'
    );
    expect(renderName('{track} Round {round}', { season: 2, track: 'Backyard Loop' })).toBe(
      'Backyard Loop Round'
    );
  });

  it('reads the plugin record defensively', () => {
    const T = 'RaceGOW {season} {track} Round {round}';
    expect(applyRaceGow(null)).toEqual({ season: 1, seat: null, callsign: '', nameTemplate: T });
    expect(
      applyRaceGow({
        season: '4',
        seat: '2',
        callsign: 'Ryan',
        name_template: 'S{season} R{round}'
      })
    ).toEqual({ season: 4, seat: 2, callsign: 'Ryan', nameTemplate: 'S{season} R{round}' });
    expect(applyRaceGow({ season: 0, seat: -1 })).toEqual({
      season: 1,
      seat: null,
      callsign: '',
      nameTemplate: T
    });
  });

  it("finds a track's boards and the run a figure came from", () => {
    const boards = {
      classes: [{ classId: 7, name: 'Track 1' }],
      unclassified: [],
      event: null
    } as unknown as ResultBoards;
    expect(trackBoards(boards, 7)?.name).toBe('Track 1');
    expect(trackBoards(boards, 8)).toBeNull();
    expect(runNumberOf('RaceGOW 2 Track 3 / Round 7')).toBe(7);
    expect(runNumberOf('RaceGOW 2 Track 3')).toBeNull();
    expect(runNumberOf('None')).toBeNull();
  });

  it('refuses a template that cannot name a run or a file, as the plugin does', () => {
    expect(templateProblem('RaceGOW {season} {track} Round {round}')).toBeNull();
    expect(templateProblem('')).toBeNull();
    expect(templateProblem('RaceGOW {season} {track}')).toMatch(/needs \{round\}/);
    expect(templateProblem('Run {round}: {track}')).toMatch(/cannot be in a name/);
    expect(templateProblem('{round} {lap}')).toMatch(/Unknown token \{lap\}/);
    expect(runName(2, 'Track 4', 7, 'S{season} {track} R{round}')).toBe('S2 Track 4 R7');
  });
});
