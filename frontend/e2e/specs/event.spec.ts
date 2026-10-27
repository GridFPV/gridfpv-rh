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

  test('the event name refuses characters that cannot name an archive (#43)', async ({
    page,
    rh
  }) => {
    await page.goto('/grid/event');
    await page.getByRole('button', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Club Night 10/27');
    await expect(dialog.getByRole('alert')).toContainText('"/" cannot be in an event name');
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
    await dialog.getByLabel('Name').fill('Club Night 10-27');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Save' }).click();
    expect(await rh.eventName()).toBe('Club Night 10-27');
  });

  test('New event archives first, under a safe file name, and resets only after it (#43)', async ({
    page,
    rig,
    rh
  }) => {
    test.setTimeout(90_000);
    // RotorHazard itself accepts a "/" in the name (its Event page, an older Grid): it is in
    // the database already when the director starts a new event.
    await rig.setOption('eventName', 'Club Night 10/27');
    const ace = await rig.addPilot({ callsign: 'Ace' });
    const cls = await rig.addClass({ name: 'E2E Old' });
    const heat = await rig.addHeat({ name: 'Old heat', classId: cls, pilots: [null, ace] });
    await rig.setMinLap(1);
    await rig.raceHeat(heat, { 1: [500, 2000] });
    expect((await rig.rounds()).find((h) => h.id === heat)?.rounds).toBe(1);
    // Leftovers from an earlier run would shift the counter.
    for (const f of await rig.backups())
      if (/^Club Night 10-27( \(\d+\))?\.db$/.test(f)) await rig.deleteBackup(f);
    const before = await rig.backups();

    await page.goto('/grid/event');
    await page.getByRole('button', { name: 'New event' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('archived first as Club Night 10-27.db');
    await dialog.getByLabel('Name').fill('Next Night');
    await dialog.getByRole('button', { name: 'Archive and start' }).click();
    await expect(
      page.getByText('New event started. The previous one is archived as "Club Night 10-27.db".')
    ).toBeVisible({ timeout: 20_000 });

    // RotorHazard agrees: the archive is listed, the old races are gone, the name is new.
    const after = await rig.backups();
    expect(after.filter((f) => !before.includes(f))).toEqual(['Club Night 10-27.db']);
    expect(await rig.rounds()).toEqual([]);
    expect(await rig.classes()).toEqual([]);
    expect((await rig.options()).eventName).toBe('Next Night');
    expect(await rh.eventName()).toBe('Next Night');

    // The same name again gets a counter, not RotorHazard's bare timestamp (#54).
    await rig.setOption('eventName', 'Club Night 10/27');
    await page.goto('/grid/event');
    await page.getByRole('button', { name: 'New event' }).click();
    await page.getByRole('dialog').getByLabel('Name').fill('Third Night');
    await page.getByRole('dialog').getByRole('button', { name: 'Archive and start' }).click();
    await expect(
      page.getByText(
        'New event started. The previous one is archived as "Club Night 10-27 (2).db".'
      )
    ).toBeVisible({ timeout: 20_000 });
    expect(await rig.backups()).toEqual(expect.arrayContaining(['Club Night 10-27 (2).db']));
    await rig.deleteBackup('Club Night 10-27.db');
    await rig.deleteBackup('Club Night 10-27 (2).db');
  });

  test('New event does not reset when the archive cannot be made (#43)', async ({
    page,
    rig,
    rh
  }) => {
    test.setTimeout(90_000);
    await rig.setOption('eventName', 'Keep Me');
    const ace = await rig.addPilot({ callsign: 'Ace' });
    const cls = await rig.addClass({ name: 'E2E Keep' });
    const heat = await rig.addHeat({ name: 'Kept heat', classId: cls, pilots: [null, ace] });
    await rig.setMinLap(1);
    await rig.raceHeat(heat, { 1: [500, 2000] });
    await rig.blockBackups(true);
    try {
      await page.goto('/grid/event');
      await page.getByRole('button', { name: 'New event' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Name').fill('Should Not Happen');
      await dialog.getByRole('button', { name: 'Archive and start' }).click();
      await expect(page.getByText(/could not copy the database.*Nothing was reset/)).toBeVisible({
        timeout: 20_000
      });
    } finally {
      await rig.blockBackups(false);
    }
    // RotorHazard agrees: the races, the class and the name are all still there.
    expect((await rig.rounds()).find((h) => h.id === heat)?.rounds).toBe(1);
    expect((await rig.classes()).map((c) => c.name)).toEqual(['E2E Keep']);
    expect((await rig.options()).eventName).toBe('Keep Me');
    expect(await rh.eventName()).toBe('Keep Me');
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

    // RotorHazard agrees: its socket answer, its options API, and its Format page's Event
    // panel. Each is polled for a few seconds: our notice fires on our readback, and
    // RotorHazard's own write can land a beat after it.
    await expect
      .poll(
        async () => {
          const m = await rig.minLap();
          return [Number(m.min_lap), Number(m.min_lap_behavior), Number(m.min_first_crossing)];
        },
        { message: 'RotorHazard min_lap answer', timeout: 5000 }
      )
      .toEqual([5, 1, 2]);
    await expect
      .poll(async () => (await rig.options()).consecutivesCount, {
        message: 'RotorHazard /api/options consecutivesCount',
        timeout: 5000
      })
      .toBe('4');
    await expect
      .poll(() => rh.formatEventOptions(), {
        message: "RotorHazard Format page's Event panel",
        timeout: 8000
      })
      .toEqual({
        consecutivesBase: '4',
        minLap: '5',
        minLapBehavior: '1',
        minFirstCrossing: '2'
      });
  });
});
