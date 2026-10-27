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
    await expect(page.getByText('E2E Ace').first()).toBeVisible();

    // RotorHazard agrees: its API and its own Format page both list the pilot.
    const pilots = await rig.pilots();
    expect(pilots.map((p) => p.callsign)).toEqual(['E2E Ace']);
    expect(await rh.formatPilotCallsigns()).toContain('E2E Ace');
  });

  test('New pilot then Cancel, ×, or Esc writes nothing (#42)', async ({ page, rig, rh }) => {
    await rig.addPilot({ callsign: 'Bee' });
    await page.goto('/grid/pilots');
    await expect(page.getByText('1 pilot')).toBeVisible();

    await page.getByRole('button', { name: 'New pilot' }).click();
    await expect(page.getByRole('heading', { name: 'New pilot' })).toBeVisible();
    await page.getByPlaceholder('What the announcer says').fill('Nobody');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'New pilot' })).toHaveCount(0);

    await page.getByRole('button', { name: 'New pilot' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'New pilot' })).toHaveCount(0);

    await expect(page.getByText('1 pilot')).toBeVisible();
    // RotorHazard agrees: still one pilot, and no "~Callsign" placeholder anywhere.
    const pilots = await rig.pilots();
    expect(pilots.map((p) => p.callsign)).toEqual(['Bee']);
    expect(await rh.formatPilotCallsigns()).toEqual(['Bee']);
  });
});
