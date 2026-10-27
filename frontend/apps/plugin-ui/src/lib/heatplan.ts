/**
 * RotorHazard's heat plan (#69): picking a seeded heat whose seats are not confirmed makes
 * RotorHazard answer `heat_plan_result` instead of loading it; its own Run page shows the
 * plan with Cancel / Reseed / Confirm. These helpers shape that payload for our dialog.
 */
import { SLOT_METHOD, type Setup } from './setup.js';

export type HeatPlanSlot = {
  id: number;
  nodeIndex: number | null;
  pilotId: number;
  callsign: string;
  method: number;
  seedId: number | null;
  seedRank: number | null;
  frequencyChange: boolean;
};

export type HeatPlan = {
  heatId: number;
  name: string;
  slots: HeatPlanSlot[];
  /** RotorHazard could compute every seeded seat. */
  ok: boolean;
  unassigned: number;
};

type Raw = Record<string, unknown>;
const num = (v: unknown, d = 0) => (v == null || v === '' ? d : Number(v));
const numOrNull = (v: unknown) => (v == null || v === '' ? null : Number(v));

export function applyHeatPlan(p: Raw): HeatPlan {
  const calc = (p.calc_result as Raw | undefined) ?? {};
  return {
    heatId: num(p.heat),
    name: String(p.displayname ?? ''),
    slots: ((p.slots as Raw[] | undefined) ?? []).map((s) => ({
      id: num(s.id),
      nodeIndex: numOrNull(s.node_index),
      pilotId: num(s.pilot_id),
      callsign: String(s.callsign ?? ''),
      method: num(s.method, SLOT_METHOD.NONE),
      seedId: numOrNull(s.seed_id),
      seedRank: numOrNull(s.seed_rank),
      frequencyChange: Boolean(s.frequency_change)
    })),
    ok: calc.calc_success !== false,
    unassigned: num(calc.unassigned_slots)
  };
}

export type PlanRow = { seat: string; who: string; from: string; waiting: boolean };

function ordinal(n: number): string {
  const s =
    ['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4] ?? 'th';
  return `${n}${s}`;
}

/** The plan as rows for the dialog: seat, who lands there, where they come from. */
export function planRows(plan: HeatPlan, setup: Setup): PlanRow[] {
  return plan.slots
    .filter((s) => s.nodeIndex != null)
    .sort((a, b) => (a.nodeIndex ?? 0) - (b.nodeIndex ?? 0))
    .map((s) => {
      let from = '';
      if (s.method === SLOT_METHOD.HEAT_RESULT) {
        const h = setup.heats.find((x) => x.id === s.seedId);
        from = `${ordinal(s.seedRank ?? 1)} from ${h?.displayName ?? 'a heat'}`;
      } else if (s.method === SLOT_METHOD.CLASS_RESULT) {
        const c = setup.classes.find((x) => x.id === s.seedId);
        from = `${ordinal(s.seedRank ?? 1)} in ${c?.displayName ?? 'a stage'}`;
      }
      const seeded = s.method === SLOT_METHOD.HEAT_RESULT || s.method === SLOT_METHOD.CLASS_RESULT;
      const who =
        s.callsign || (s.pilotId ? `Pilot ${s.pilotId}` : seeded ? 'waiting on results' : 'empty');
      return { seat: `Seat ${(s.nodeIndex ?? 0) + 1}`, who, from, waiting: seeded && !s.pilotId };
    });
}
