import { expect, test } from '../src/fixtures.js';

test.describe('Formats', () => {
  test('New format or Duplicate then Cancel/Esc leaves no copy behind (#42, #45)', async ({
    page,
    rig,
    rh
  }) => {
    const before = (await rig.formats()).map((f) => f.name);
    await page.goto('/grid/formats');
    await expect(page.getByRole('heading', { name: 'Race formats' })).toBeVisible();
    await page.getByRole('button', { name: 'New format' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'New format' })).toBeVisible();
    await expect(dialog.getByLabel('Name')).toHaveValue(/\(copy\)$/);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);

    // Duplicate on a card, then Esc (#45): the same shape.
    await page.getByRole('button', { name: 'Duplicate' }).first().click();
    await expect(dialog.getByRole('heading', { name: 'New format' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await expect(page.locator('.name', { hasText: '(copy)' })).toHaveCount(0);
    // RotorHazard agrees: the same formats as before, no copy.
    expect((await rig.formats()).map((f) => f.name)).toEqual(before);
    expect(await rh.formatNames()).not.toContainEqual(expect.stringContaining('(copy)'));
  });

  test("a format created in Grid is offered on RotorHazard's Format page", async ({ page, rh }) => {
    await page.goto('/grid/formats');
    await expect(page.getByRole('heading', { name: 'Race formats' })).toBeVisible();
    await page.getByRole('button', { name: 'New format' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'New format' })).toBeVisible();
    await dialog.getByLabel('Name').fill('E2E 90s Sprint');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('RotorHazard confirmed the change.')).toBeVisible();
    await expect(page.locator('.name', { hasText: 'E2E 90s Sprint' })).toHaveCount(1);
    expect(await rh.formatNames()).toContain('E2E 90s Sprint');
  });

  test("a points method and its settings set in Grid are the format's in RotorHazard (set_points_params)", async ({
    page,
    rig
  }) => {
    await page.goto('/grid/formats');
    const card = page.locator('.gf-card, article', { hasText: '2:00 Standard Race' }).first();
    await card.getByRole('button', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Edit format' })).toBeVisible();
    await dialog.getByLabel('Points').selectOption({ label: 'Position' });
    const settings = dialog.getByLabel('Points settings');
    await expect(settings).toBeVisible();
    await settings.getByLabel('Points (CSV)').fill('10,8,6,4');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('RotorHazard confirmed the change.')).toBeVisible();

    // RotorHazard agrees: the format stores the method and its settings.
    const stored = (await rig.formats()).find((f) => f.name === '2:00 Standard Race') as
      { points_method?: string | null } | undefined;
    expect(JSON.parse(stored?.points_method ?? 'null')).toEqual({
      t: 'Position',
      s: { points_list: '10,8,6,4' }
    });
  });
});
