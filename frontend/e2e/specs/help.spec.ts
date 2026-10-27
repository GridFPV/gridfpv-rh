import { expect, test } from '../src/fixtures.js';

/**
 * Offline help (#41): the help section renders with every off-origin request refused, so
 * nothing on it can depend on the internet at the field.
 */
test.describe('Help', () => {
  test('every help page and the checklists render with the network blocked', async ({
    page,
    rig
  }) => {
    const blocked: string[] = [];
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(rig.url).origin) return route.continue();
      blocked.push(url.href);
      return route.abort();
    });

    await page.goto('/grid/help');
    await expect(page.getByRole('heading', { name: 'Help', level: 1 })).toBeVisible();
    const tiles = page.locator('a.tile');
    const count = await tiles.count();
    expect(count).toBeGreaterThanOrEqual(10);
    for (let i = 0; i < count; i++) {
      await page.goto('/grid/help');
      const tile = page.locator('a.tile').nth(i);
      const title = (await tile.locator('strong').textContent())!.trim();
      await tile.click();
      await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
      await expect(page.locator('article.doc p, article.doc li').first()).toBeVisible();
    }
    await page.goto('/grid/help/checklists');
    await expect(page.locator('article.doc')).toContainText('T2');
    expect(blocked).toEqual([]);
    // Nothing to agree on in RotorHazard; its status answers, which is all the page needs.
    expect((await rig.status()).num_nodes).toBeGreaterThan(0);
  });

  test('the ? on each admin page lands on its help page', async ({ page, rig }) => {
    for (const [path, slug, title] of [
      ['event', 'event', 'Event'],
      ['pilots', 'pilots', 'Pilots'],
      ['teams', 'teams', 'Teams'],
      ['formats', 'formats', 'Race formats'],
      ['stages', 'stages', 'Stages']
    ]) {
      await page.goto(`/grid/${path}`);
      await page.getByRole('link', { name: 'Help for this page' }).first().click();
      await expect(page).toHaveURL(new RegExp(`/grid/help/${slug}$`));
      await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    }
    expect((await rig.status()).num_nodes).toBeGreaterThan(0);
  });
});
