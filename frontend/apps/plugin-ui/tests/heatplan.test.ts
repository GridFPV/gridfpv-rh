import { describe, expect, it } from 'vitest';
import { applyHeatPlan, planRows } from '../src/lib/heatplan.js';
import { emptySetup, type Heat, type RaceClass, type Setup } from '../src/lib/setup.js';

const payload = {
  heat: 5,
  displayname: 'Final 1',
  slots: [
    {
      id: 11,
      node_index: 2,
      pilot_id: 2,
      callsign: 'Bee',
      method: 1,
      seed_rank: 2,
      seed_id: 3,
      frequency_change: true
    },
    {
      id: 10,
      node_index: 1,
      pilot_id: 1,
      callsign: 'Ace',
      method: 1,
      seed_rank: 1,
      seed_id: 3,
      frequency_change: false
    },
    { id: 12, node_index: 3, pilot_id: 0, callsign: null, method: 2, seed_rank: 1, seed_id: 9 },
    { id: 13, node_index: 0, pilot_id: 0, callsign: null, method: -1 }
  ],
  calc_result: { calc_success: true, unassigned_slots: 1 }
};
const setup: Setup = {
  ...emptySetup(),
  heats: [{ id: 3, displayName: 'Quali 1' } as Heat],
  classes: [{ id: 9, displayName: 'Qualifying' } as RaceClass]
};

describe('heat plan', () => {
  it("shapes RotorHazard's heat_plan_result", () => {
    const plan = applyHeatPlan(payload);
    expect(plan.heatId).toBe(5);
    expect(plan.name).toBe('Final 1');
    expect(plan.ok).toBe(true);
    expect(plan.unassigned).toBe(1);
    expect(plan.slots).toHaveLength(4);
    expect(applyHeatPlan({ heat: 5, calc_result: { calc_success: false } }).ok).toBe(false);
  });
  it('lists the seats in order with who lands there and where they come from', () => {
    const rows = planRows(applyHeatPlan(payload), setup);
    expect(rows).toEqual([
      { seat: 'Seat 1', who: 'empty', from: '', waiting: false },
      { seat: 'Seat 2', who: 'Ace', from: '1st from Quali 1', waiting: false },
      { seat: 'Seat 3', who: 'Bee', from: '2nd from Quali 1', waiting: false },
      { seat: 'Seat 4', who: 'waiting on results', from: '1st in Qualifying', waiting: true }
    ]);
  });
});
