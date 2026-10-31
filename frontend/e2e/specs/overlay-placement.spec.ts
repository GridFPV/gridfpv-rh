import { expect, test } from '../src/fixtures.js';

/**
 * Where the race overlay sits (#96): set on the Overlays page, kept by the timer, and drawn
 * the same by the live page, the replay page (so every render) and the preview.
 */
test('Overlay placement: a corner, offsets and size set once show on every page that draws the overlay', async ({
  page,
  rig
}) => {
  await page.goto('/grid/overlays');
  const corner = page.getByRole('radiogroup', { name: 'Corner' });
  await expect(corner.getByRole('radio', { name: 'Top left' })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await corner.getByRole('radio', { name: 'Bottom right' }).click();
  await expect(corner.getByRole('radio', { name: 'Bottom right' })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await page.getByLabel('In from the side').fill('40');
  await page.getByLabel('In from the side').press('Tab');
  await page.getByLabel('In from the top or bottom').fill('30');
  await page.getByLabel('In from the top or bottom').press('Tab');
  await page.getByLabel('Size', { exact: true }).fill('150');
  await page.getByLabel('Size', { exact: true }).press('Tab');
  await expect(page.getByLabel('Size slider')).toHaveValue('150');

  // The timer holds it.
  await expect
    .poll(async () => JSON.parse((await rig.options())['gridfpv_overlay'] ?? '{}'))
    .toEqual({ corner: 'bottom-right', x: 40, y: 30, scale: 150 });

  // The preview on this page already shows it (its own socket got the broadcast).
  // The preview is the page at 1920×1080, scaled to fit (#97), so the panel is to scale.
  await expect(page.locator('iframe[title="Race timer preview"]')).toHaveCSS('width', '1920px');
  const previewPanel = page.frameLocator('iframe[title="Race timer preview"]').locator('.panel');
  await expect(previewPanel).toHaveAttribute('data-corner', 'bottom-right');

  const style = async () =>
    page.locator('.panel').evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        bottom: s.bottom,
        right: s.right,
        transform: s.transform,
        origin: s.transformOrigin
      };
    });
  // The live page.
  await page.goto('/grid/live/race');
  await expect(page.locator('.panel')).toHaveAttribute('data-corner', 'bottom-right');
  const live = await style();
  expect(live.bottom).toBe('30px');
  expect(live.right).toBe('40px');
  expect(live.transform).toBe('matrix(1.5, 0, 0, 1.5, 0, 0)');
  // The replay page (what the video companion renders), even before its race is found.
  await page.goto('/grid/live/race?heat=1&round=9');
  await expect(page.locator('.panel')).toHaveAttribute('data-corner', 'bottom-right');
  expect(await style()).toEqual(live);

  // Reset puts the default back, and the pages follow.
  await page.goto('/grid/overlays');
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(corner.getByRole('radio', { name: 'Top left' })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await expect
    .poll(async () => JSON.parse((await rig.options())['gridfpv_overlay'] ?? '{}'))
    .toEqual({ corner: 'top-left', x: 24, y: 24, scale: 100 });
  await page.goto('/grid/live/race');
  await expect(page.locator('.panel')).toHaveAttribute('data-corner', 'top-left');
});
