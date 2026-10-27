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

  test("a double quote in a callsign is kept, with a note about RotorHazard's page (#44)", async ({
    page,
    rig
  }) => {
    await page.goto('/grid/pilots');
    await page.getByRole('button', { name: 'New pilot' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('What the announcer says').fill('O\'Brien "Oby"');
    await expect(dialog.getByRole('note')).toContainText('cuts the name at it');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('RotorHazard confirmed the change.')).toBeVisible();
    // RotorHazard agrees on the data (its Format page is the known exception, #44).
    expect((await rig.pilots()).map((p) => p.callsign)).toEqual(['O\'Brien "Oby"']);
  });

  test('a pilot added in one event comes back from the roster in the next (#14)', async ({
    page,
    rig,
    rh
  }) => {
    test.setTimeout(90_000);
    // The roster outlives the fixture's reset: forget this spec's pilots from earlier runs.
    await rig.rosterForget(/^E2E Rosty/);
    // Added in Grid (captured into the roster by RotorHazard's pilotAlter event).
    await page.goto('/grid/pilots');
    await page.getByRole('button', { name: 'New pilot' }).click();
    await page.getByPlaceholder('What the announcer says').fill('E2E Rosty');
    await page.getByPlaceholder('Optional').first().fill('Rosty Roster');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('RotorHazard confirmed the change.')).toBeVisible();

    // A new event with the pilots cleared: RotorHazard has nobody.
    await rig.reset('pilots');
    expect(await rig.pilots()).toEqual([]);
    await page.goto('/grid/pilots');
    await expect(page.getByText('0 pilots')).toBeVisible();

    await page.getByRole('button', { name: 'Add from roster' }).click();
    const dialog = page.getByRole('dialog');
    const row = dialog.getByLabel('Roster').locator('li', { hasText: 'E2E Rosty' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Rosty Roster');
    // Only Rosty: untick anything else the roster holds from earlier runs.
    for (const box of await dialog.getByRole('checkbox').all()) {
      const li = box.locator('xpath=ancestor::li');
      if ((await li.textContent())?.includes('E2E Rosty')) await box.check();
      else await box.uncheck();
    }
    await dialog.getByRole('button', { name: 'Add E2E Rosty' }).click();
    await expect(page.getByText('E2E Rosty is in this event.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('1 pilot', { exact: false }).first()).toBeVisible();

    // RotorHazard agrees: the pilot is back with the name and no team (#60), in its API and on
    // its Format page.
    const pilots = await rig.pilots();
    expect(pilots.map((p) => [p.callsign, p.name, p.team])).toEqual([
      ['E2E Rosty', 'Rosty Roster', '']
    ]);
    expect(await rh.formatPilotCallsigns()).toContain('E2E Rosty');

    // Renamed in this event, the roster still has one entry for them, under the new name (#59).
    await page.goto('/grid/pilots');
    await page.getByRole('button', { name: 'Edit' }).first().click();
    const edit = page.getByRole('dialog');
    await edit.getByPlaceholder('What the announcer says').fill('E2E Rosty II');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('RotorHazard confirmed the change.')).toBeVisible();
    await page.getByRole('button', { name: 'Add from roster' }).click();
    const rosterDialog = page.getByRole('dialog');
    await expect(rosterDialog.getByText('E2E Rosty', { exact: true })).toHaveCount(0);
    await rosterDialog.getByRole('button', { name: 'Cancel' }).click();
    await rig.reset('pilots');
    await page.goto('/grid/pilots');
    await page.getByRole('button', { name: 'Add from roster' }).click();
    const entries = page
      .getByRole('dialog')
      .getByLabel('Roster')
      .locator('li', { hasText: 'E2E Rosty' });
    await expect(entries).toHaveCount(1);
    await expect(entries).toContainText('E2E Rosty II');
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
