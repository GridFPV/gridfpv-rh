import { expect, test } from '../src/fixtures.js';

/**
 * Round management from the rig alone (#36): the plugin's delete-with-copy and restore,
 * driven over the socket, so the same scenario runs against RotorHazard 4.4.0 (the
 * plugin's snapshot path) and RotorHazard main (its native race_delete path).
 */
test.describe('Rounds (rig-driven)', () => {
  test('a deleted race leaves RotorHazard and comes back with its laps', async ({ rig, rh }) => {
    test.setTimeout(90_000);
    const ace = await rig.addPilot({ callsign: 'Ace' });
    const bee = await rig.addPilot({ callsign: 'Bee' });
    const cls = await rig.addClass({ name: 'E2E Rig Rounds' });
    const heat = await rig.addHeat({ name: 'Heat R', classId: cls, pilots: [null, ace, bee] });
    await rig.setMinLap(1);
    await rig.raceHeat(heat, { 1: [500, 2000, 3500], 2: [600, 2400] });
    await rig.raceHeat(heat, { 1: [500, 2000], 2: [600, 1800, 3000, 4200] });
    const before = await rig.race(heat, 2);
    const beeLaps = (n: typeof before) =>
      n.nodes.find((x) => x.callsign === 'Bee')!.laps.filter((l) => !l.deleted).length;
    expect(beeLaps(before)).toBe(4);

    const backup = await rig.deleteRace(heat, 2);
    expect(backup).toMatch(/\.db$/);
    expect((await rig.rounds()).find((h) => h.id === heat)?.rounds).toBe(1);
    expect(await rig.apiStatus(`/api/race/${heat}/2`)).toBeGreaterThanOrEqual(400);
    const kept = (await rig.deletedRaces()).find((d) => d.heat_id === heat && d.round_id === 2);
    expect(kept).toBeTruthy();
    await rh.expectResultsNotToMention('Round 2', 'Heat R');

    await rig.restoreRace(kept!.id);
    expect((await rig.rounds()).find((h) => h.id === heat)?.rounds).toBe(2);
    expect(beeLaps(await rig.race(heat, 2))).toBe(4);
    await rh.expectResultsToMention('Round 2');
  });

  test('a copy never goes back to a heat that changed, and dies with its event (#48)', async ({
    rig,
    rh
  }) => {
    test.setTimeout(90_000);
    const ace = await rig.addPilot({ callsign: 'Ace' });
    const bee = await rig.addPilot({ callsign: 'Bee' });
    const cee = await rig.addPilot({ callsign: 'Cee' });
    const cls = await rig.addClass({ name: 'E2E Stale' });
    const heat = await rig.addHeat({ name: 'Heat S', classId: cls, pilots: [null, ace, bee] });
    await rig.setMinLap(1);
    await rig.raceHeat(heat, { 1: [500, 2000], 2: [600, 2400] });
    await rig.deleteRace(heat, 1);
    const kept = (await rig.deletedRaces()).find((d) => d.heat_id === heat)!;
    expect(kept).toBeTruthy();

    // Seat Cee where Bee was: the heat is no longer the one that flew the race.
    await rig.seatHeat(heat, [null, ace, cee]);
    expect(await rig.restoreRaceRefusal(kept.id)).toMatch(/pilots are not the ones who flew it/);
    expect((await rig.rounds()).find((h) => h.id === heat)?.rounds ?? 0).toBe(0);

    // A new event (reset keeping pilots, then the plugin's event clear): the copy is gone, and a
    // fresh heat that reuses the id lists nothing.
    await rig.reset('classes');
    rig.emit('gridfpv_event_clear');
    await rig.until('copies dropped', async () => (await rig.deletedRaces()).length === 0);
    const cls2 = await rig.addClass({ name: 'E2E Fresh' });
    const heat2 = await rig.addHeat({ name: 'Fresh 1', classId: cls2, pilots: [null, bee] });
    expect(heat2).toBe(heat); // RotorHazard reuses the id
    expect(await rig.deletedRaces()).toEqual([]);
    expect(await rig.restoreRaceRefusal(kept.id)).toMatch(/no longer kept/);
    expect((await rig.rounds()).find((h) => h.id === heat2)?.rounds ?? 0).toBe(0);
    // RotorHazard agrees: the only heat is the fresh one, with no race on it.
    expect(await rh.formatHeatNames()).toEqual(['Fresh 1']);
  });
});
