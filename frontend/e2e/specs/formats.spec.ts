import { expect, test } from '../src/fixtures.js';

test.describe('Formats', () => {
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
