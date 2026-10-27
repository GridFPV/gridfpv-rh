/**
 * Round management (#36): a round is one saved race of a heat. The plugin keeps a copy of
 * every deleted race (RotorHazard's own on main, the plugin's snapshot on 4.4.0) and lists
 * them in `gridfpv_races_deleted`; these helpers turn that list into what the board shows.
 */
import type { Results } from './results.js';
import { raceFor } from './results.js';
import type { Setup } from './setup.js';

export type DeletedRace = {
  id: string;
  heatId: number;
  round: number;
  classId: number;
  startTime: string;
  deletedAt: string;
  callsigns: string[];
  /** The pilots who flew it; a copy only goes back to a heat with the same pilots (#48). */
  pilotIds: number[];
};

export type DeletedRacesPayload = {
  races?: Array<Record<string, unknown>>;
  native?: boolean;
  backup?: string | null;
  changed?: { heat_id: number; round_id: number; action: 'deleted' | 'restored' };
};

const num = (v: unknown, d = 0) => (v == null || v === '' ? d : Number(v));
const str = (v: unknown) => (v == null ? '' : String(v));

export function applyDeletedRaces(payload: DeletedRacesPayload | null): DeletedRace[] {
  return (payload?.races ?? []).map((r) => ({
    id: str(r.id),
    heatId: num(r.heat_id),
    round: num(r.round_id),
    classId: num(r.class_id),
    startTime: str(r.start_time_formatted),
    deletedAt: str(r.deleted_at),
    callsigns: Array.isArray(r.callsigns) ? r.callsigns.map(str) : [],
    pilotIds: Array.isArray(r.pilot_ids) ? r.pilot_ids.map((p) => num(p)) : []
  }));
}

/** The deleted races that belong to these heats, newest deletion last. */
export function deletedRacesFor(list: DeletedRace[], heatIds: number[]): DeletedRace[] {
  const ids = new Set(heatIds);
  return list.filter((d) => ids.has(d.heatId));
}

/**
 * Why a deleted race cannot go back right now, or null when it can: the heat is gone, or
 * that round has been raced again since.
 */
export function restoreBlocker(d: DeletedRace, results: Results, setup: Setup): string | null {
  const heat = setup.heats.find((h) => h.id === d.heatId);
  if (!heat) return 'its heat no longer exists';
  // Heat ids are reused after a reset: the copy must match the heat as it is now (#48).
  if (d.classId !== heat.classId) return 'the heat is in a different stage now';
  const seated = new Set(heat.slots.map((s) => s.pilotId).filter((p) => p > 0));
  if (
    d.pilotIds.length &&
    (d.pilotIds.some((p) => !seated.has(p)) || seated.size !== d.pilotIds.length)
  )
    return "the heat's pilots are not the ones who flew it";
  if (raceFor(results, d.heatId, d.round)) return `round ${d.round} has been raced again`;
  return null;
}

/** `Heat A · round 2 · Ace, Bee`, for the restore list. */
export function deletedLabel(d: DeletedRace, setup: Setup): string {
  const heat = setup.heats.find((h) => h.id === d.heatId);
  const parts = [heat?.displayName ?? `Heat ${d.heatId}`, `round ${d.round}`];
  if (d.callsigns.length) parts.push(d.callsigns.filter((c) => c && c !== '—').join(', '));
  return parts.join(' · ');
}

/** What the notice says after a delete: the backup file is the way back if anything went wrong. */
export function deletedNotice(backup: string | null | undefined): string {
  return backup
    ? `Race deleted; a copy is kept below. RotorHazard backed up its database first (${backup}).`
    : 'Race deleted; a copy is kept below. RotorHazard could not back up its database first.';
}
