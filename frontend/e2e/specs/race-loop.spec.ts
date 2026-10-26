import { expect, test } from '../src/fixtures.js';

/**
 * The race loop driven from the rig alone — stage, start, simulated laps, stop, save — to
 * prove the scenario helpers (#30) before the Run page tests (T3) lean on them.
 */
test.describe('Race loop (rig-driven)', () => {
  test('a simulated race saves with the laps that were flown', async ({ page, rig, rh }) => {
    const ace = await rig.addPilot({ callsign: 'Ace' });
    const bee = await rig.addPilot({ callsign: 'Bee' });
    const cls = await rig.addClass({ name: 'E2E Qualifying' });
    const heat = await rig.addHeat({ name: 'Heat A', classId: cls, pilots: [ace, bee] });
    await rig.setMinLap(1);

    await rig.setHeat(heat);
    await rig.start();
    // Hole shot at 0.5 s, then laps: Ace flies three, Bee two.
    await rig.fly({ 0: [500, 2000, 3500, 5000], 1: [600, 2400, 4200] });

    // Our Run page shows the live race while it is on.
    await page.goto('/grid/run');
    await expect(page.getByText('Ace').first()).toBeVisible();
    await expect(page.getByText('Bee').first()).toBeVisible();

    await rig.stop();
    const race = await rig.save();

    expect(race.heat_id).toBe(heat);
    expect(race.round_id).toBe(1);
    const bySeat = Object.fromEntries(race.nodes.map((n) => [n.node_index, n]));
    expect(bySeat[0].callsign).toBe('Ace');
    expect(bySeat[0].laps.filter((l) => !l.deleted)).toHaveLength(4);
    expect(bySeat[1].callsign).toBe('Bee');
    expect(bySeat[1].laps.filter((l) => !l.deleted)).toHaveLength(3);

    // RotorHazard agrees: its Format page has the class and heat, its Results page the race.
    expect(await rh.formatClassNames()).toContain('E2E Qualifying');
    expect(await rh.formatHeatNames()).toContain('Heat A');
    await rh.expectResultsToMention('Heat A');
  });
});
