import { expect, test } from '../src/fixtures.js';

/**
 * The mode (#95): one setting for the whole timer. Switched on Home, the nav follows on
 * every client, and RotorHazard holds it as a plugin option that outlives a reload.
 */
test('Simple mode hides Teams and Formats for every client, and the timer keeps it', async ({
  page,
  rig,
  browser
}) => {
  await page.goto('/grid/');
  const nav = page.getByRole('navigation');
  await expect(nav.getByRole('link', { name: 'Teams' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Formats' })).toBeVisible();

  const modes = page.getByRole('radiogroup', { name: 'Mode' });
  await expect(modes.getByRole('radio', { name: /^Full/ })).toHaveAttribute('aria-checked', 'true');
  await modes.getByRole('radio', { name: /^Simple/ }).click();
  await expect(page.getByText('Simple mode, for every client of this timer.')).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Teams' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Formats' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Run' })).toBeVisible();
  // Hidden is not locked: the page is still there by URL.
  await page.goto('/grid/teams');
  await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible();

  // A second client sees the same mode without being told.
  const other = await browser.newPage();
  await other.goto('/grid/');
  await expect(other.getByRole('navigation').getByRole('link', { name: 'Run' })).toBeVisible();
  await expect(other.getByRole('navigation').getByRole('link', { name: 'Teams' })).toHaveCount(0);
  await other.close();

  // RotorHazard agrees: it is the plugin's option, and a reload comes back Simple.
  expect((await rig.options())['gridfpv_mode']).toBe('simple');
  await page.goto('/grid/');
  await expect(
    page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: /^Simple/ })
  ).toHaveAttribute('aria-checked', 'true');
  await expect(nav.getByRole('link', { name: 'Teams' })).toHaveCount(0);

  // Back to Full from the other direction: the timer's option is what the page follows.
  await rig.setMode('full');
  await expect(nav.getByRole('link', { name: 'Teams' })).toBeVisible();
});
