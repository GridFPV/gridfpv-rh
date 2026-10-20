import { describe, expect, it } from 'vitest';
import {
  applyClassData,
  applyFormatData,
  applyHeatData,
  applyPilotData,
  emptySetup,
  heatsInClass,
  ordinal,
  pilotName,
  SLOT_METHOD,
  slotLabel,
  teamsInUse
} from '../src/lib/setup.js';

const PILOTS = {
  pilots: [
    {
      pilot_id: 2,
      callsign: 'Skitzo',
      name: 'Alex',
      phonetic: '',
      team: 'A',
      color: '#ff0000',
      active: true,
      locked: false,
      mgp_pilot_id: '123'
    },
    {
      pilot_id: 1,
      callsign: 'ReconFPV',
      name: 'Ryan',
      phonetic: 'recon',
      team: 'B',
      color: '#00ff00',
      active: true,
      locked: true
    }
  ],
  attributes: [{ name: 'mgp_pilot_id', label: 'MultiGP ID', field_type: 'text' }]
};

describe('setup reducers', () => {
  it('reads pilots with their plugin attributes and lock state', () => {
    const s = applyPilotData(emptySetup(), PILOTS);
    expect(s.pilots.map((p) => p.callsign)).toEqual(['Skitzo', 'ReconFPV']);
    expect(s.pilots[0].attributes).toEqual({ mgp_pilot_id: '123' });
    expect(s.pilots[1].locked).toBe(true);
    expect(s.pilotAttributes[0].label).toBe('MultiGP ID');
    expect(teamsInUse(s)).toEqual(['A', 'B']);
  });

  it('reads heats with ordered slots and the dynamic flag', () => {
    const s = applyHeatData(emptySetup(), {
      heats: [
        {
          id: 5,
          displayname: 'Heat 1',
          name: '',
          auto_name: 'Heat 1',
          class_id: 3,
          group_id: null,
          order: 1,
          status: 0,
          auto_frequency: false,
          active: true,
          next_round: 2,
          dynamic: true,
          locked: false,
          slots: [
            { id: 11, node_index: 0, pilot_id: 2, method: 0, seed_rank: null, seed_id: null },
            { id: 12, node_index: 1, pilot_id: 0, method: 1, seed_rank: 2, seed_id: 4 }
          ]
        }
      ]
    });
    expect(s.heats[0]).toMatchObject({
      id: 5,
      displayName: 'Heat 1',
      classId: 3,
      nextRound: 2,
      dynamic: true
    });
    expect(s.heats[0].slots[1]).toEqual({
      id: 12,
      nodeIndex: 1,
      pilotId: 0,
      method: 1,
      seedRank: 2,
      seedId: 4
    });
  });

  it('reads classes and formats', () => {
    let s = applyClassData(emptySetup(), {
      classes: [
        {
          id: 3,
          name: 'Open',
          displayname: 'Open',
          description: '',
          format: 7,
          win_condition: 'best_fastest_lap',
          rank_method_label: 'Best fastest lap',
          rounds: 3,
          heat_advance_type: 1,
          round_type: 0,
          order: 0,
          locked: false
        }
      ]
    });
    s = applyFormatData(s, {
      formats: [
        {
          id: 7,
          name: '2 min',
          unlimited_time: 0,
          race_time_sec: 120,
          number_laps_win: 0,
          win_condition: 1,
          team_racing_mode: 0,
          locked: false
        }
      ]
    });
    expect(s.classes[0]).toMatchObject({
      id: 3,
      formatId: 7,
      rankMethodLabel: 'Best fastest lap',
      rounds: 3
    });
    expect(s.formats[0]).toMatchObject({ id: 7, name: '2 min', raceTimeSec: 120 });
  });

  it('labels slots and pilots by name, never by raw id', () => {
    let s = applyPilotData(emptySetup(), PILOTS);
    s = applyClassData(s, {
      classes: [
        {
          id: 3,
          name: 'Open',
          displayname: 'Open',
          description: '',
          format: 7,
          win_condition: '',
          rounds: 1,
          heat_advance_type: 0,
          round_type: 0,
          order: 0,
          locked: false
        }
      ]
    });
    s = applyHeatData(s, {
      heats: [
        {
          id: 4,
          displayname: 'Heat 1',
          name: '',
          auto_name: 'Heat 1',
          class_id: 3,
          group_id: null,
          order: 1,
          status: 0,
          auto_frequency: false,
          active: true,
          next_round: 1,
          dynamic: false,
          locked: false,
          slots: []
        },
        {
          id: 9,
          displayname: 'Final',
          name: 'Final',
          auto_name: 'Heat 2',
          class_id: 3,
          group_id: null,
          order: 2,
          status: 0,
          auto_frequency: false,
          active: true,
          next_round: 1,
          dynamic: true,
          locked: false,
          slots: []
        }
      ]
    });
    expect(pilotName(s, 2)).toBe('Skitzo');
    expect(pilotName(s, 0)).toBe('—');
    expect(pilotName(s, 99)).toBe('Unknown pilot');
    expect(
      slotLabel(s, {
        id: 1,
        nodeIndex: 0,
        pilotId: 2,
        method: SLOT_METHOD.ASSIGN,
        seedRank: null,
        seedId: null
      })
    ).toBe('Skitzo');
    expect(
      slotLabel(s, {
        id: 1,
        nodeIndex: 0,
        pilotId: 0,
        method: SLOT_METHOD.HEAT_RESULT,
        seedRank: 2,
        seedId: 4
      })
    ).toBe('2nd from Heat 1');
    expect(
      slotLabel(s, {
        id: 1,
        nodeIndex: 0,
        pilotId: 0,
        method: SLOT_METHOD.CLASS_RESULT,
        seedRank: 1,
        seedId: 3
      })
    ).toBe('1st in Open');
    expect(
      slotLabel(s, {
        id: 1,
        nodeIndex: 0,
        pilotId: 0,
        method: SLOT_METHOD.NONE,
        seedRank: null,
        seedId: null
      })
    ).toBe('—');
    expect(heatsInClass(s, 3).map((h) => h.displayName)).toEqual(['Heat 1', 'Final']);
  });

  it('spells ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '101st'
    ]);
  });
});
