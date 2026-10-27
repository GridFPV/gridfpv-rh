import { expect, test } from '../src/fixtures.js';

test.describe('Run', () => {
  test('a race run from the Run page is saved with its laps in RotorHazard', async ({
    page,
    rig,
    rh
  }) => {
    const ace = await rig.addPilot({ callsign: 'Ace' });
    const cls = await rig.addClass({ name: 'E2E Practice' });
    // Seat 2: seat 1 carries the rig's emulated RSSI stream.
    const heat = await rig.addHeat({ name: 'Heat A', classId: cls, pilots: [null, ace] });
    await rig.setMinLap(1);

    await page.goto('/grid/run');
    await page.getByRole('combobox').first().selectOption(String(heat));
    await expect(page.getByText('Ace').first()).toBeVisible();

    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByRole('button', { name: 'Stop' })).toBeEnabled();
    await rig.until('racing', async () => (await rig.status()).race_status === 1, 30_000);
    await rig.fly({ 1: [300, 1600, 2900, 4200] });
    await expect(page.getByRole('button', { name: /^L3/ })).toBeVisible();

    // Delete lap 2 while the race is on (#49): RotorHazard drops it and renumbers the rest.
    // The page must not throw (the bug was a null read in the confirm handler).
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.getByRole('button', { name: /^L2/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete lap' }).click();
    await expect(page.getByRole('button', { name: /^L3/ })).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    await expect(page.getByRole('button', { name: /^L2/ })).toHaveCount(1);

    await page.getByRole('button', { name: 'Stop' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Race saved.')).toBeVisible();

    const saved = await rig.race(heat, 1);
    const seat = saved.nodes.find((n) => n.node_index === 1);
    expect(seat?.callsign).toBe('Ace');
    expect(seat?.laps.filter((l) => !l.deleted)).toHaveLength(3); // hole shot + 2 of the 3 laps
    await rh.expectResultsToMention('Heat A');
  });
});
