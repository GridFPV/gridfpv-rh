/**
 * RaceGOW mode's flows (#95): what "new season", "new track" and "switch season" do to
 * RotorHazard, composed from the same confirmed writes the rest of Grid uses. The pilot
 * never meets a class, a heat or a format; these functions do.
 */
import {
  addFormat,
  addFromRoster,
  addPilot,
  addProfile,
  alterClass,
  alterFormat,
  alterHeat,
  alterPilot,
  alterProfile,
  archiveEvent,
  createStage,
  newEvent,
  restoreArchive,
  rh,
  saveRaceGow,
  seatSlot,
  setChannel,
  setCurrentHeat,
  setMinLapBehavior,
  setProfile,
  type WriteResult
} from './rh.svelte.js';
import { MIN_LAP_BEHAVIOR } from './timing.js';
import { HEAT_ADVANCE, ROUND_TYPE, SLOT_METHOD } from './setup.js';
import {
  findRaceGowFormat,
  heatNameFor,
  nextTrackNumber,
  racegowFormatFields,
  seasonName,
  trackName
} from './racegow.js';

/** The RaceGOW format: no time limit, ranked by consecutive laps. Made once, found after. */
export async function ensureFormat(): Promise<WriteResult & { id?: number }> {
  const s = rh();
  const have = findRaceGowFormat(s.setup.formats);
  if (have) return { ok: true, id: have.id };
  const source = s.setup.formats.find((f) => f.unlimitedTime) ?? s.setup.formats[0];
  if (!source) return { ok: false, message: 'RotorHazard has no race format to start from.' };
  const made = await addFormat(source.id);
  if (!made.ok || made.id == null) return made;
  const set = await alterFormat(made.id, racegowFormatFields());
  return set.ok ? { ok: true, id: made.id } : { ...set, id: made.id };
}

/** The pilot, in this season: already here, else from the roster, else made by callsign. */
export async function ensurePilot(callsign: string): Promise<WriteResult & { id?: number }> {
  const key = callsign.trim().toLowerCase();
  if (!key) return { ok: false, message: 'Say who is flying first: a callsign, under You.' };
  const s = rh();
  const find = () => s.setup.pilots.find((p) => p.callsign.trim().toLowerCase() === key);
  const here = find();
  if (here) return { ok: true, id: here.id };
  const roster = s.roster.find((p) => p.callsign.trim().toLowerCase() === key);
  if (roster) {
    const r = await addFromRoster([roster]);
    if (!r.ok) return r;
    const p = find();
    return p ? { ok: true, id: p.id } : { ok: false, message: 'The roster pilot did not appear.' };
  }
  const made = await addPilot();
  if (!made.ok || made.id == null) return made;
  const named = await alterPilot(made.id, { callsign: callsign.trim() });
  return named.ok ? { ok: true, id: made.id } : { ...named, id: made.id };
}

/**
 * A new track: the next number in the season; a class with unlimited rounds that stays on
 * its one heat after a run; the heat named `RaceGOW {season} Track {n}`, the pilot on the
 * chosen seat; loaded on the timer, so Run is ready.
 */
export async function newTrack(): Promise<
  WriteResult & { classId?: number; heatId?: number; number?: number }
> {
  const s = rh();
  const pilot = await ensurePilot(s.racegow.callsign);
  if (!pilot.ok || pilot.id == null) return pilot;
  const fmt = await ensureFormat();
  if (!fmt.ok || fmt.id == null) return fmt;
  const number = nextTrackNumber(s.setup.classes);
  const made = await createStage({
    name: trackName(number),
    formatId: fmt.id,
    rounds: 0,
    winCondition: '',
    heats: 1,
    roundType: ROUND_TYPE.RACES_PER_HEAT
  });
  if (!made.ok || made.id == null) return made;
  const classId = made.id;
  const stay = await alterClass(classId, { heatAdvanceType: HEAT_ADVANCE.NONE });
  if (!stay.ok) return { ...stay, classId };
  const heat = s.setup.heats.find((h) => h.classId === classId);
  if (!heat) return { ok: false, message: 'The track has no heat.', classId };
  const named = await alterHeat(heat.id, { name: heatNameFor(s.racegow.season, number) });
  if (!named.ok) return { ...named, classId, heatId: heat.id };
  const seat = s.racegow.seat ?? s.seats.find((x) => x.frequency > 0)?.index ?? 0;
  const slot = heat.slots.find((sl) => sl.nodeIndex === seat) ?? heat.slots[0];
  if (!slot) return { ok: false, message: `The heat has no slot for seat ${seat + 1}.`, classId };
  const seated = await seatSlot(heat.id, slot.id, {
    method: SLOT_METHOD.ASSIGN,
    pilotId: pilot.id
  });
  if (!seated.ok) return { ...seated, classId, heatId: heat.id };
  const loaded = await setCurrentHeat(heat.id);
  if (!loaded.ok) return { ...loaded, classId, heatId: heat.id };
  // Racegow tracks are small: a short lap is a false crossing, and RotorHazard can drop it
  // as it lands instead of flagging it for Marshal. One-time; the Event page shows the rule.
  if (s.timing.minLapBehavior !== MIN_LAP_BEHAVIOR.DISCARD) {
    const rule = await setMinLapBehavior(MIN_LAP_BEHAVIOR.DISCARD);
    if (!rule.ok) return { ...rule, classId, heatId: heat.id };
  }
  return { ok: true, classId, heatId: heat.id, number };
}

/** A new season: archive this one, start clean (pilots kept), name it, record the number. */
export async function newSeason(n: number): Promise<WriteResult & { archive?: string }> {
  const r = await newEvent(seasonName(n), true);
  if (!r.ok) return r;
  const saved = await saveRaceGow({ season: n });
  return saved.ok ? r : saved;
}

/** Back to a past season: archive this one first, then restore that one's database. */
export async function switchSeason(file: string): Promise<WriteResult> {
  const a = await archiveEvent(rh().event.name);
  if (!a.ok) return a;
  return restoreArchive(file);
}

// ---- the seat ---------------------------------------------------------------------

/** The frequency profile racegow flies on: one seat live, the rest off. */
export const RACEGOW_PROFILE_NAME = 'RaceGOW';

const isRaceGowProfile = (name: string) =>
  name.trim().toLowerCase() === RACEGOW_PROFILE_NAME.toLowerCase();

/**
 * The RaceGOW profile: found and selected, or made once as a copy of the active profile
 * (RotorHazard's "add" duplicates and switches). Seat frequencies and enter/exit live in a
 * profile and outlive resets, so turning seats off happens here and nowhere near the club's.
 */
export async function ensureProfile(): Promise<WriteResult> {
  const s = rh();
  if (isRaceGowProfile(s.profiles.name)) return { ok: true };
  const have = s.profiles.list.find((p) => isRaceGowProfile(p.name));
  if (have) return setProfile(have.id);
  const made = await addProfile();
  if (!made.ok) return made;
  return alterProfile(RACEGOW_PROFILE_NAME, 'One seat live for racegow; the others off.');
}

/**
 * Fly this seat: remember it, turn every other seat off in the RaceGOW profile, and move
 * the pilot onto it in the track that is on the timer. The seat's own channel is the
 * pilot's to pick (it keeps whatever the profile had).
 */
export async function flySeat(seat: number): Promise<WriteResult> {
  const s = rh();
  const prof = await ensureProfile();
  if (!prof.ok) return prof;
  for (const x of s.seats) {
    if (x.index === seat || x.frequency <= 0) continue;
    const off = await setChannel(x.index, null, null, 0);
    if (!off.ok) return off;
  }
  const saved = await saveRaceGow({ seat });
  if (!saved.ok) return saved;
  const heat = s.setup.heats.find((h) => h.id === s.current.heatId);
  if (heat) {
    const from = heat.slots.find((sl) => sl.pilotId > 0 && sl.nodeIndex !== seat);
    const to = heat.slots.find((sl) => sl.nodeIndex === seat);
    if (from && to && to.pilotId !== from.pilotId) {
      const pilotId = from.pilotId;
      const cleared = await seatSlot(heat.id, from.id, { method: SLOT_METHOD.NONE });
      if (!cleared.ok) return cleared;
      const moved = await seatSlot(heat.id, to.id, { method: SLOT_METHOD.ASSIGN, pilotId });
      if (!moved.ok) return moved;
    }
  }
  return { ok: true };
}
