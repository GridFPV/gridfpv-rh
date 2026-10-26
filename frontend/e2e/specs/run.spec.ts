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
    await rig.fly({ 1: [300, 1600, 2900] });
    await expect(page.getByText('2').first()).toBeVisible();

    await page.getByRole('button', { name: 'Stop' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Race saved.')).toBeVisible();

    const saved = await rig.race(heat, 1);
    const seat = saved.nodes.find((n) => n.node_index === 1);
    expect(seat?.callsign).toBe('Ace');
    expect(seat?.laps.filter((l) => !l.deleted)).toHaveLength(3);
    await rh.expectResultsToMention('Heat A');
  });
});
