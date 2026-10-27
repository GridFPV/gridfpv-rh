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

  test("lap detection and scoring options set in Grid are RotorHazard's (#35)", async ({
    page,
    rig,
    rh
  }) => {
    await page.goto('/grid/event');
    const minLap = page.getByLabel('Minimum lap time (s)');
    await expect(minLap).toHaveValue('10'); // the fixture's reset
    await minLap.fill('5');
    await minLap.press('Tab');
    await expect(page.getByText('Minimum lap time set to 5 s.')).toBeVisible();

    await page.getByLabel('Short laps').selectOption('1');
    await expect(page.getByText('Discard new short laps.')).toBeVisible();

    const first = page.getByLabel('Ignore crossings before (s)');
    await first.fill('2');
    await first.press('Tab');
    await expect(page.getByText('Ignore crossings before set to 2 s.')).toBeVisible();

    const consec = page.getByLabel('Consecutive laps base');
    await consec.fill('4');
    await consec.press('Tab');
    await expect(page.getByText('Results now rank the best 4 consecutive laps.')).toBeVisible();
    await expect(
      page.getByText('Laps under 5 s are discarded · crossings in the first 2 s ignored')
    ).toBeVisible();

    // RotorHazard agrees: its socket answer, its options API, and its Format page's Event panel.
    const m = await rig.minLap();
    expect([Number(m.min_lap), Number(m.min_lap_behavior), Number(m.min_first_crossing)]).toEqual([
      5, 1, 2
    ]);
    expect((await rig.options()).consecutivesCount).toBe('4');
    expect(await rh.formatEventOptions()).toEqual({
      consecutivesBase: '4',
      minLap: '5',
      minLapBehavior: '1',
      minFirstCrossing: '2'
    });
  });
});
