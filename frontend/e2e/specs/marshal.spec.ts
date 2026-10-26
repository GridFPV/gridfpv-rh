import { expect, test } from '../src/fixtures.js';

test.describe('Marshal', () => {
  test("a lap deleted in Grid is deleted in RotorHazard's saved race", async ({ page, rig }) => {
    const ace = await rig.addPilot({ callsign: 'Ace' });
    const heat = await rig.addHeat({ name: 'Heat A', pilots: [null, ace] }); // seat 2: no emulated signal
    await rig.setMinLap(1);
    await rig.setHeat(heat);
    await rig.start();
    await rig.fly({ 1: [500, 2000, 3500] });
    await rig.stop();
    await rig.save();

    await page.goto('/grid/marshal');
    const race = page.getByRole('combobox', { name: /^Race/ });
    await expect(race.locator('option')).not.toHaveCount(0);
    await race.selectOption({ index: 0 });
    // Every seat has a pilot-race in a saved race; pick Ace's, not seat 1's empty one.
    const who = page.getByRole('combobox', { name: /^Pilot/ });
    const aceOption = who.locator('option', { hasText: 'Ace' });
    await expect(aceOption).toHaveCount(1);
    await who.selectOption((await aceOption.getAttribute('value')) ?? '');
    const laps = page.locator('table.laps tbody tr');
    await expect(laps).toHaveCount(3);
    await laps.nth(1).click();
    await expect(laps.nth(1)).toHaveClass(/deleted/);
    await page.getByRole('button', { name: 'Save laps' }).click();
    await expect(page.getByText('Laps saved; RotorHazard rebuilt the results.')).toBeVisible();

    const saved = await rig.race(heat, 1);
    const seat = saved.nodes.find((n) => n.node_index === 1);
    expect(seat?.laps.map((l) => l.deleted)).toEqual([false, true, false]);
  });
});
