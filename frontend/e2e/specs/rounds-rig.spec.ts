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
});
