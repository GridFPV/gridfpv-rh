import { expect, test } from '../src/fixtures.js';

test.describe('Stages', () => {
  test('a stage with heats, seated in Grid, is a class with heats in RotorHazard', async ({
    page,
    rig,
    rh
  }) => {
    const ace = await rig.addPilot({ callsign: 'Ace' });
    await rig.addPilot({ callsign: 'Bee' });

    await page.goto('/grid/stages');
    await expect(page.getByRole('heading', { name: 'Stages' })).toBeVisible();
    await page.getByRole('button', { name: 'Add stage' }).click();
    await page.getByLabel('Name').fill('E2E Qualifying');
    await page.getByLabel('Heats').fill('2');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByRole('heading', { name: 'E2E Qualifying' })).toBeVisible();
    const rows = page.locator('tr.heat');
    await expect(rows).toHaveCount(2);

    // Seat Ace on seat 1 of the first heat through the heat dialog.
    await rows.first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // A new RotorHazard slot is already "Pilot" with nobody picked; pick Ace by id.
    await dialog.locator('select').nth(1).selectOption(String(ace));
    await expect(
      dialog
        .getByText('RotorHazard confirmed the change.')
        .or(page.getByText('RotorHazard confirmed the change.'))
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();

    // RotorHazard agrees: the class, two heats, and Ace on seat 1 of the first.
    const heats = await rig.heats();
    expect(heats).toHaveLength(2);
    const seated = heats.find((h) => h.nodes_pilots['0'] === ace);
    expect(seated).toBeTruthy();
    expect(await rh.formatClassNames()).toContain('E2E Qualifying');
    expect((await rh.formatHeatNames()).length).toBeGreaterThanOrEqual(2);
  });
});
