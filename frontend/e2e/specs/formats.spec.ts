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
});
