import { expect, test } from '../src/fixtures.js';

test.describe('Pilots', () => {
  test('a pilot added in Grid is a pilot in RotorHazard', async ({ page, rig, rh }) => {
    await page.goto('/grid/pilots');
    await expect(page.getByRole('heading', { name: 'Pilots' })).toBeVisible();
    await expect(page.getByText('0 pilots')).toBeVisible();

    await page.getByRole('button', { name: 'New pilot' }).click();
    await expect(page.getByRole('heading', { name: 'New pilot' })).toBeVisible();
    await page.getByPlaceholder('What the announcer says').fill('E2E Ace');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('RotorHazard confirmed the change.')).toBeVisible();
    await expect(page.getByText('E2E Ace')).toBeVisible();

    // RotorHazard agrees: its API and its own Format page both list the pilot.
    const pilots = await rig.pilots();
    expect(pilots.map((p) => p.callsign)).toEqual(['E2E Ace']);
    expect(await rh.formatPilotCallsigns()).toContain('E2E Ace');
  });
});
