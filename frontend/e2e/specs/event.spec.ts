import { expect, test } from '../src/fixtures.js';

test.describe('Event', () => {
  test('renaming the event in Grid renames it in RotorHazard', async ({ page, rh }) => {
    await page.goto('/grid/event');
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: 'Edit event' })).toBeVisible();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('E2E Club Night');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('heading', { name: 'E2E Club Night', level: 1 })).toBeVisible();
    expect(await rh.eventName()).toBe('E2E Club Night');
  });
});
