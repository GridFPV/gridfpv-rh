import { expect, test } from '../src/fixtures.js';

test.describe('Seats', () => {
  test("a channel picked in Grid is the seat's frequency in RotorHazard", async ({ page, rig }) => {
    await page.goto('/grid/seats');
    await expect(page.getByRole('heading', { name: 'Seats' })).toBeVisible();
    // The seat card, not the quick Channels row above it (both say "Seat N").
    const seat1 = page
      .locator('section.gf-card')
      .filter({ has: page.locator('.num', { hasText: /^Seat 1$/ }) });
    const picker = seat1.locator('select').first();
    await expect(picker).toBeVisible();
    const was = (await rig.frequencies())[0];
    const want =
      was.band === 'R' && was.channel === 8
        ? { label: 'R7 · 5880', band: 'R', channel: 7, frequency: 5880 }
        : { label: 'R8 · 5917', band: 'R', channel: 8, frequency: 5917 };
    await picker.selectOption({ label: want.label });

    await expect(page.getByText('RotorHazard confirmed the change.')).toBeVisible();
    const f = await rig.frequencies();
    expect(f[0]).toMatchObject({
      band: want.band,
      channel: want.channel,
      frequency: want.frequency
    });
  });
});

test.describe('Seats while a race is on (#87)', () => {
  type Tuning = { profile_ids: number[]; current_profile: number };
  const tuning = (rig: { loadData<T>(t: string): Promise<T> }) =>
    rig.loadData<Tuning>('node_tuning');

  test('channel and profile changes are refused with the reason, RotorHazard untouched, until the race stops', async ({
    page,
    rig
  }) => {
    test.setTimeout(120_000);
    await page.goto('/grid/seats');
    await expect(page.getByRole('heading', { name: 'Seats' })).toBeVisible();
    const confirmed = page.getByText('RotorHazard confirmed the change.');
    const refused = page
      .locator('.gf-banner, [class*=banner]')
      .filter({ hasText: 'Not written: a race is' });

    // A second profile so there is something to switch to; created before the race.
    const before = await tuning(rig);
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByRole('dialog').getByPlaceholder('e.g. Outdoor, Indoor whoop').fill('Lock test');
    await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
    await expect(confirmed).toBeVisible();
    const withTest = await tuning(rig);
    await expect(page.getByRole('combobox', { name: 'Profile' })).toHaveValue(
      String(withTest.current_profile)
    );
    expect(withTest.profile_ids.length).toBe(before.profile_ids.length + 1);
    expect(withTest.current_profile).not.toBe(before.current_profile);
    await expect(confirmed).toBeHidden();

    const seat2 = page
      .locator('section.gf-card')
      .filter({ has: page.locator('.num', { hasText: /^Seat 2$/ }) });
    const picker = seat2.locator('select').first();
    const freqBefore = (await rig.frequencies())[1];

    // Start a race (practice if no heat is loaded) and wait until the page knows.
    await rig.start();
    await expect(
      page.getByRole('alert').filter({ hasText: 'A race is running: channel and profile' })
    ).toBeVisible();
    await expect(seat2.getByText('Race on')).toBeVisible();

    // 1. a channel change
    const other = freqBefore.band === 'R' && freqBefore.channel === 1 ? 'R2 · 5695' : 'R1 · 5658';
    await picker.selectOption({ label: other });
    await expect(refused.first()).toContainText('a race is running');
    await expect(picker).toHaveValue(
      freqBefore.frequency ? `${freqBefore.band}:${freqBefore.channel}` : 'off'
    );
    expect((await rig.frequencies())[1]).toEqual(freqBefore);

    // 2. a new profile
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(refused.first()).toContainText('a race is running');
    expect((await tuning(rig)).profile_ids).toEqual(withTest.profile_ids);

    // 3. a profile switch
    const profileSelect = page.getByRole('combobox', { name: 'Profile' });
    await profileSelect.selectOption(String(before.current_profile));
    await expect(refused.first()).toContainText('a race is running');
    await expect(profileSelect).toHaveValue(String(withTest.current_profile));
    expect((await tuning(rig)).current_profile).toBe(withTest.current_profile);

    // 4. a delete
    await page.locator('.bar').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(refused.first()).toContainText('a race is running');
    expect((await tuning(rig)).profile_ids).toEqual(withTest.profile_ids);
    expect((await rig.status()).race_status).toBe(1); // still racing throughout

    // Stop and discard: the lock lifts and the same writes go through, read back from RotorHazard.
    await rig.stop();
    await rig.discard();
    await expect(
      page.getByRole('alert').filter({ hasText: 'refused until it stops' })
    ).toBeHidden();
    await expect(seat2.getByText('Race on')).toBeHidden();

    await picker.selectOption({ label: other });
    await expect(confirmed).toBeVisible();
    const [band, ch, freq] = other === 'R2 · 5695' ? ['R', 2, 5695] : ['R', 1, 5658];
    expect((await rig.frequencies())[1]).toMatchObject({ band, channel: ch, frequency: freq });
    await expect(confirmed).toBeHidden();
    await picker.selectOption({
      label: `${freqBefore.band}${freqBefore.channel} · ${freqBefore.frequency}`
    });
    await expect(confirmed).toBeVisible();
    expect((await rig.frequencies())[1]).toEqual(freqBefore);
    await expect(confirmed).toBeHidden();

    await page.locator('.bar').getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(confirmed).toBeVisible();
    const after = await tuning(rig);
    expect(after.profile_ids).toEqual(before.profile_ids);
  });
});
