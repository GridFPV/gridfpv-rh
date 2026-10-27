/**
 * The roster (#14): pilots that outlive events, kept by the plugin outside RotorHazard's
 * per-event database and captured automatically as pilots are added or edited. These
 * helpers shape the plugin's `gridfpv_roster` payload for the Pilots page.
 */

export type RosterPilot = {
  id: string;
  callsign: string;
  name: string;
  team: string;
  color: string;
  phonetic: string;
  attributes: Record<string, string>;
  lastSeen: string;
  /** A pilot with this callsign is in the current event already. */
  inEvent: boolean;
};

export type RosterPayload = {
  pilots?: Array<Record<string, unknown>>;
  path?: string;
  added?: string[];
};

const str = (v: unknown) => (v == null ? '' : String(v));

export function applyRoster(payload: RosterPayload | null): RosterPilot[] {
  return (payload?.pilots ?? [])
    .map((p) => ({
      id: str(p.id),
      callsign: str(p.callsign),
      name: str(p.name),
      team: str(p.team),
      color: str(p.color),
      phonetic: str(p.phonetic),
      attributes:
        p.attributes && typeof p.attributes === 'object'
          ? Object.fromEntries(
              Object.entries(p.attributes as Record<string, unknown>).map(([k, v]) => [k, str(v)])
            )
          : {},
      lastSeen: str(p.last_seen),
      inEvent: Boolean(p.in_event)
    }))
    .sort((a, b) => a.callsign.localeCompare(b.callsign, undefined, { sensitivity: 'base' }));
}

/** Roster pilots not in this event: the ones "Add from roster" offers. */
export function rosterMissing(roster: RosterPilot[]): RosterPilot[] {
  return roster.filter((p) => !p.inEvent);
}

/** `Add 3 pilots`, `Add Ace` — the button for a selection. */
export function addLabel(selected: RosterPilot[]): string {
  if (selected.length === 0) return 'Add pilots';
  if (selected.length === 1) return `Add ${selected[0].callsign}`;
  return `Add ${selected.length} pilots`;
}
