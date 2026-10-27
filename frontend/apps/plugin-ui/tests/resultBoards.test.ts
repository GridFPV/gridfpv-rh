import { describe, expect, it } from 'vitest';
import { applyResultBoards, boardsOf, primaryRows } from '../src/lib/resultBoards.js';

const row = (callsign: string, position: number | null, extra: Record<string, unknown> = {}) => ({
  pilot_id: callsign.length,
  callsign,
  team_name: 'A',
  position,
  starts: 2,
  laps: 5,
  total_time: '1:23.456',
  average_lap: '0:16.691',
  fastest_lap: '0:15.001',
  fastest_lap_source: { displayname: 'Heat 1', round: 2 },
  consecutives: '0:45.100',
  consecutives_base: 3,
  consecutives_source: { displayname: 'Heat 1', round: 1 },
  ...extra
});
const lb = (primary: string) => ({
  meta: {
    primary_leaderboard: primary,
    team_racing_mode: 0,
    start_behavior: 0,
    consecutives_count: 3
  },
  by_race_time: [row('Ace', 1), row('Bee', 2, { total_time: '0:00.000', points: 7 })],
  by_fastest_lap: [row('Bee', 1), row('Ace', 2)],
  by_consecutives: [row('Ace', 1), row('Bee', null)]
});

describe("result boards (RotorHazard's Results page as data)", () => {
  it("reads every board with RotorHazard's columns, an em dash for an empty time, and the primary first", () => {
    const b = boardsOf(lb('by_fastest_lap'));
    expect(b.meta).toEqual({
      primary: 'by_fastest_lap',
      teamRacing: false,
      startBehavior: 0,
      consecutivesCount: 3
    });
    expect(primaryRows(b).map((r) => r.callsign)).toEqual(['Bee', 'Ace']);
    const bee = b.byRaceTime[1];
    expect(bee.total).toBe('—');
    expect(bee.points).toBe('7');
    expect(b.byRaceTime[0].fastestSource).toBe('Heat 1 / Round 2');
    // #83: RotorHazard appends the round only when truthy (a grouped heat's round is 0).
    expect(
      boardsOf({
        ...lb('by_race_time'),
        by_race_time: [
          row('Ace', 1, { fastest_lap_source: { displayname: 'Round 2 / G1', round: 0 } })
        ]
      }).byRaceTime[0].fastestSource
    ).toBe('Round 2 / G1');
    expect(b.byConsecutives[1].position).toBeNull();
  });
  it('groups heats under their classes with rounds in order, keeps unclassified heats and the event totals', () => {
    const r = applyResultBoards({
      heats: {
        '2': {
          heat_id: 2,
          displayname: 'Q2',
          leaderboard: lb('by_race_time'),
          rounds: [
            { id: 2, start_time_formatted: 'b', leaderboard: lb('by_race_time') },
            { id: 1, start_time_formatted: 'a', leaderboard: lb('by_race_time') }
          ]
        },
        '3': {
          heat_id: 3,
          displayname: 'Loose',
          leaderboard: lb('by_race_time'),
          rounds: []
        }
      },
      heats_by_class: { '1': [2], '0': [3] },
      classes: {
        '1': {
          id: 1,
          name: 'Quali',
          leaderboard: lb('by_consecutives'),
          ranking: {
            meta: {
              method_label: 'Best 3 Consecutive',
              rank_fields: [{ name: 'heat', label: 'Heat' }]
            },
            ranking: [{ pilot_id: 3, callsign: 'Ace', position: 1, heat: 'Q2' }]
          }
        }
      },
      event_leaderboard: lb('by_race_time')
    });
    expect(r.classes.map((c) => [c.name, c.heats.map((h) => h.displayName)])).toEqual([
      ['Quali', ['Q2']]
    ]);
    expect(r.classes[0].ranking).toEqual({
      methodLabel: 'Best 3 Consecutive',
      fields: [{ name: 'heat', label: 'Heat' }],
      teamRacing: false,
      rows: [{ pilot_id: 3, callsign: 'Ace', position: 1, heat: 'Q2', team: '' }]
    });
    expect(r.classes[0].heats[0].rounds.map((x) => x.round)).toEqual([1, 2]);
    expect(r.unclassified.map((h) => h.displayName)).toEqual(['Loose']);
    expect(primaryRows(r.event!).map((x) => x.callsign)).toEqual(['Ace', 'Bee']);
    expect(applyResultBoards(null)).toEqual({ classes: [], unclassified: [], event: null });
  });
});
