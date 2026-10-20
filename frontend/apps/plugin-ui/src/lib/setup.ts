/**
 * Pure models and reducers for RotorHazard's setup entities — pilots, classes, heats with
 * their seat slots, and race formats — as RotorHazard 4.4.0 emits them (RHUI.py:
 * emit_pilot_data / emit_class_data / emit_heat_data / emit_format_data). The store applies
 * these; screens read them; tests exercise them directly.
 *
 * Shapes are RotorHazard's own. Names are theirs too: a "class" is a race class (a bracket
 * or qualifying group), a "heat" is a group of pilots who fly together, a "slot" is one seat
 * in a heat. A heat's slots are seated either directly (a pilot) or dynamically (the result
 * of another heat, or the class ranking, at a given rank).
 */

/** How a slot gets its pilot (Database.py: ProgramMethod). */
export const SLOT_METHOD = { NONE: -1, ASSIGN: 0, HEAT_RESULT: 1, CLASS_RESULT: 2 } as const;
/** Database.py: HeatAdvanceType. */
export const HEAT_ADVANCE = { NONE: 0, NEXT_HEAT: 1, NEXT_ROUND: 2 } as const;
/** Database.py: RoundType. */
export const ROUND_TYPE = { RACES_PER_HEAT: 0, GROUPED: 1 } as const;

/** A plugin-registered attribute field, as RotorHazard describes it (UIField.frontend_repr). */
export type AttributeType = {
  name: string;
  label: string;
  field_type: string;
  value?: unknown;
  desc?: string | null;
  placeholder?: string | null;
  options?: Array<{ value: string; label: string }> | null;
};

export type Pilot = {
  id: number;
  callsign: string;
  name: string;
  phonetic: string;
  team: string;
  color: string;
  active: boolean;
  /** True once the pilot appears in a saved race; RotorHazard refuses to delete them. */
  locked: boolean;
  /** Plugin attributes by name (MultiGP id, …). */
  attributes: Record<string, unknown>;
};

export type Slot = {
  id: number;
  nodeIndex: number | null;
  pilotId: number;
  method: number;
  seedRank: number | null;
  seedId: number | null;
};

export type Heat = {
  id: number;
  /** The name RotorHazard shows (the custom name, or its automatic one). */
  displayName: string;
  name: string;
  autoName: string;
  classId: number;
  groupId: number | null;
  order: number | null;
  status: number;
  autoFrequency: boolean;
  active: boolean;
  nextRound: number;
  dynamic: boolean;
  locked: boolean;
  slots: Slot[];
  attributes: Record<string, unknown>;
};

export type RaceClass = {
  id: number;
  name: string;
  displayName: string;
  description: string;
  formatId: number;
  winCondition: string;
  rankMethodLabel: string | null;
  rounds: number;
  heatAdvanceType: number;
  roundType: number;
  order: number | null;
  locked: boolean;
  attributes: Record<string, unknown>;
};

export type RaceFormat = {
  id: number;
  name: string;
  unlimitedTime: boolean;
  raceTimeSec: number;
  numberLapsWin: number;
  winCondition: number;
  teamRacingMode: number;
  locked: boolean;
};

export type Setup = {
  pilots: Pilot[];
  pilotAttributes: AttributeType[];
  heats: Heat[];
  heatAttributes: AttributeType[];
  classes: RaceClass[];
  classAttributes: AttributeType[];
  formats: RaceFormat[];
};

export function emptySetup(): Setup {
  return {
    pilots: [],
    pilotAttributes: [],
    heats: [],
    heatAttributes: [],
    classes: [],
    classAttributes: [],
    formats: []
  };
}

/** RotorHazard's pilot id for "no pilot" (RHUtils.PILOT_ID_NONE). */
export const PILOT_NONE = 0;
/** RotorHazard's class id for "unclassified" heats. */
export const CLASS_NONE = 0;

type Raw = Record<string, unknown>;
const num = (v: unknown, d = 0) => (v == null || v === '' ? d : Number(v));
const numOrNull = (v: unknown) => (v == null || v === '' ? null : Number(v));
const str = (v: unknown) => (v == null ? '' : String(v));

/** Pull the plugin attributes off a raw record, by the attribute types RotorHazard sent. */
function pickAttributes(raw: Raw, types: AttributeType[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const t of types) if (t.name in raw) out[t.name] = raw[t.name];
  return out;
}

function readAttributeTypes(v: unknown): AttributeType[] {
  return Array.isArray(v) ? (v as AttributeType[]) : [];
}

export function applyPilotData(
  setup: Setup,
  payload: { pilots: Raw[]; attributes?: AttributeType[] }
): Setup {
  const types = readAttributeTypes(payload.attributes);
  const pilots = (payload.pilots ?? []).map((p) => ({
    id: num(p.pilot_id),
    callsign: str(p.callsign),
    name: str(p.name),
    phonetic: str(p.phonetic),
    team: str(p.team),
    color: str(p.color),
    active: p.active !== false && p.active !== 0 && p.active !== '0',
    locked: Boolean(p.locked),
    attributes: pickAttributes(p, types)
  }));
  return { ...setup, pilots, pilotAttributes: types };
}

export function applyHeatData(
  setup: Setup,
  payload: { heats: Raw[]; attributes?: AttributeType[] }
): Setup {
  const types = readAttributeTypes(payload.attributes);
  const heats = (payload.heats ?? []).map((h) => ({
    id: num(h.id),
    displayName: str(h.displayname),
    name: str(h.name),
    autoName: str(h.auto_name),
    classId: num(h.class_id),
    groupId: numOrNull(h.group_id),
    order: numOrNull(h.order),
    status: num(h.status),
    autoFrequency: Boolean(h.auto_frequency),
    active: h.active !== false && h.active !== 0,
    nextRound: num(h.next_round, 1),
    dynamic: Boolean(h.dynamic),
    locked: Boolean(h.locked),
    slots: ((h.slots as Raw[]) ?? []).map((s) => ({
      id: num(s.id),
      nodeIndex: numOrNull(s.node_index),
      pilotId: num(s.pilot_id),
      method: num(s.method, SLOT_METHOD.NONE),
      seedRank: numOrNull(s.seed_rank),
      seedId: numOrNull(s.seed_id)
    })),
    attributes: pickAttributes(h, types)
  }));
  return { ...setup, heats, heatAttributes: types };
}

export function applyClassData(
  setup: Setup,
  payload: { classes: Raw[]; attributes?: AttributeType[] }
): Setup {
  const types = readAttributeTypes(payload.attributes);
  const classes = (payload.classes ?? []).map((c) => ({
    id: num(c.id),
    name: str(c.name),
    displayName: str(c.displayname),
    description: str(c.description),
    formatId: num(c.format),
    winCondition: str(c.win_condition),
    rankMethodLabel: c.rank_method_label == null ? null : str(c.rank_method_label),
    rounds: num(c.rounds),
    heatAdvanceType: num(c.heat_advance_type),
    roundType: num(c.round_type),
    order: numOrNull(c.order),
    locked: Boolean(c.locked),
    attributes: pickAttributes(c, types)
  }));
  return { ...setup, classes, classAttributes: types };
}

export function applyFormatData(setup: Setup, payload: { formats: Raw[] }): Setup {
  const formats = (payload.formats ?? []).map((f) => ({
    id: num(f.id),
    name: str(f.name),
    unlimitedTime: Boolean(f.unlimited_time),
    raceTimeSec: num(f.race_time_sec),
    numberLapsWin: num(f.number_laps_win),
    winCondition: num(f.win_condition),
    teamRacingMode: num(f.team_racing_mode),
    locked: Boolean(f.locked)
  }));
  return { ...setup, formats };
}

// ---- lookups screens need ---------------------------------------------------------

export function pilotById(setup: Setup, id: number): Pilot | undefined {
  return setup.pilots.find((p) => p.id === id);
}

export function classById(setup: Setup, id: number): RaceClass | undefined {
  return setup.classes.find((c) => c.id === id);
}

export function heatById(setup: Setup, id: number): Heat | undefined {
  return setup.heats.find((h) => h.id === id);
}

/** Heats in a class (0 = unclassified), in RotorHazard's order. */
export function heatsInClass(setup: Setup, classId: number): Heat[] {
  return setup.heats
    .filter((h) => h.classId === classId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id);
}

/** Friendly name for a pilot id: callsign, or a placeholder — never the raw id. */
export function pilotName(setup: Setup, id: number): string {
  if (id === PILOT_NONE) return '—';
  const p = pilotById(setup, id);
  return p ? p.callsign || p.name || `Pilot ${p.id}` : 'Unknown pilot';
}

/** What a slot shows: its pilot, or where its pilot will come from. */
export function slotLabel(setup: Setup, slot: Slot): string {
  switch (slot.method) {
    case SLOT_METHOD.ASSIGN:
      return pilotName(setup, slot.pilotId);
    case SLOT_METHOD.HEAT_RESULT: {
      const h = slot.seedId == null ? undefined : heatById(setup, slot.seedId);
      return `${ordinal(slot.seedRank ?? 1)} from ${h?.displayName ?? 'a heat'}`;
    }
    case SLOT_METHOD.CLASS_RESULT: {
      const c = slot.seedId == null ? undefined : classById(setup, slot.seedId);
      return `${ordinal(slot.seedRank ?? 1)} in ${c?.displayName ?? 'a class'}`;
    }
    default:
      return '—';
  }
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Teams in use across the pilots, for a datalist. */
export function teamsInUse(setup: Setup): string[] {
  return [...new Set(setup.pilots.map((p) => p.team).filter(Boolean))].sort();
}
