import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import LeaderboardTable from '../src/components/LeaderboardTable.svelte';
import type { BoardMeta, BoardRow } from '../src/lib/resultBoards.js';

const meta: BoardMeta = {
  primary: 'by_race_time',
  teamRacing: false,
  startBehavior: 0,
  consecutivesCount: 3
};
const row = (callsign: string, position: number | null, points = ''): BoardRow => ({
  pilotId: callsign.length,
  callsign,
  team: '',
  position,
  starts: 2,
  laps: '5',
  total: '1:23.456',
  average: '0:16.691',
  fastest: '0:15.001',
  fastestSource: 'Heat 1 / Round 2',
  consecutives: '0:45.100',
  consecutivesBase: 3,
  consecutivesSource: 'Heat 1 / Round 1',
  points
});
const heads = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('th')).map((th) => th.textContent?.trim());
const cells = (c: HTMLElement, i: number) =>
  Array.from(c.querySelectorAll('tbody tr')[i].querySelectorAll('td')).map((td) =>
    td.textContent?.trim()
  );

describe("LeaderboardTable (RotorHazard's build_leaderboard columns)", () => {
  it('shows the race-time columns for a race-time board, with starts when asked', () => {
    const { container } = render(LeaderboardTable, {
      rows: [row('Ace', 1)],
      meta,
      kind: 'by_race_time',
      starts: true
    });
    expect(heads(container)).toEqual(['Rank', 'Pilot', 'Starts', 'Laps', 'Total', 'Avg']);
    expect(cells(container, 0)).toEqual(['1', 'Ace', '2', '5', '1:23.456', '0:16.691']);
  });
  it('shows every figure on a round board, points when scored, and "—" for an unranked pilot', () => {
    const { container } = render(LeaderboardTable, {
      rows: [row('Ace', 1, '7'), row('Cal', null, '0')],
      meta,
      kind: 'round'
    });
    expect(heads(container)).toEqual([
      'Rank',
      'Pilot',
      'Laps',
      'Total',
      'Avg',
      'Fastest',
      'From',
      '3 consec.',
      'From',
      'Points'
    ]);
    expect(cells(container, 1)[0]).toBe('—');
    expect(cells(container, 0)).toContain('7');
    expect(cells(container, 0)).toContain('3/0:45.100'); // RotorHazard shows base/time
  });
  it('shows the fastest-lap and consecutives columns with their source on single boards', () => {
    const f = render(LeaderboardTable, { rows: [row('Ace', 1)], meta, kind: 'by_fastest_lap' });
    expect(heads(f.container)).toEqual(['Rank', 'Pilot', 'Fastest', 'From']);
    expect(cells(f.container, 0)).toEqual(['1', 'Ace', '0:15.001', 'Heat 1 / Round 2']);
    const c = render(LeaderboardTable, {
      rows: [row('Ace', 1)],
      meta: { ...meta, startBehavior: 2 },
      kind: 'by_consecutives'
    });
    expect(heads(c.container)).toEqual(['Rank', 'Pilot', '3 consec.', 'From']);
    expect(cells(c.container, 0)).toEqual(['1', 'Ace', '3/0:45.100', 'Heat 1 / Round 1']);
  });
});
