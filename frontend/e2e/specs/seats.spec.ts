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
    await rig.deleteProfilesNamed('Lock test'); // an interrupted run leaves its profile behind
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

test.describe('Seats refusals (#88, #89)', () => {
  type Levels = { enter_at_levels: number[]; exit_at_levels: number[] };
  type Tuning = { profile_ids: number[]; profile_names: string[]; current_profile: number };
  const card = (page: import('@playwright/test').Page, n: number) =>
    page.locator('section.gf-card').filter({ has: page.locator('.num', { hasText: `Seat ${n}` }) });
  const notice = (page: import('@playwright/test').Page) =>
    page.locator('.gf-banner').filter({ hasText: 'Not written:' });

  test("enter and exit outside RotorHazard's 0–255 scale are refused, naming the box", async ({
    page,
    rig
  }) => {
    await rig.setSeatLevels(1, 105, 88);
    await page.goto('/grid/seats');
    const seat2 = card(page, 2);
    const enterIn = seat2.getByRole('spinbutton', { name: 'Enter' });
    await expect(enterIn).toHaveValue('105');
    const levels = () => rig.loadData<Levels>('enter_and_exit_at_levels');

    await enterIn.fill('300');
    await enterIn.press('Enter');
    await expect(notice(page)).toContainText(
      'Not written: Enter must be 255 or less (RSSI levels run 0–255).'
    );
    await expect(enterIn).toHaveValue('105');
    let l = await levels();
    expect([l.enter_at_levels[1], l.exit_at_levels[1]]).toEqual([105, 88]);

    await enterIn.fill('');
    await enterIn.press('Enter');
    await expect(notice(page)).toContainText('Not written: Enter needs a value.');
    await expect(enterIn).toHaveValue('105');
    l = await levels();
    expect([l.enter_at_levels[1], l.exit_at_levels[1]]).toEqual([105, 88]);

    const exitIn = seat2.getByRole('spinbutton', { name: 'Exit' });
    await exitIn.fill('0');
    await exitIn.press('Enter');
    await expect(notice(page)).toContainText('Not written: Exit must be above 0.');
    await expect(exitIn).toHaveValue('88');

    // A pair RotorHazard takes still goes through and reads back.
    await enterIn.fill('120');
    await enterIn.press('Enter');
    await expect(page.getByText('RotorHazard confirmed the change.')).toBeVisible();
    l = await levels();
    expect([l.enter_at_levels[1], l.exit_at_levels[1]]).toEqual([120, 88]);
    await rig.setSeatLevels(1, 105, 88);
  });

  test('a new or renamed profile cannot take a name another profile has', async ({ page, rig }) => {
    await rig.deleteProfilesNamed('Dup test');
    await page.goto('/grid/seats');
    await expect(page.getByRole('heading', { name: 'Seats' })).toBeVisible();
    const tuning = () => rig.loadData<Tuning>('node_tuning');
    const before = await tuning();
    const currentName = before.profile_names[before.profile_ids.indexOf(before.current_profile)];
    const confirmed = page.getByText('RotorHazard confirmed the change.');
    const dialog = page.getByRole('dialog');

    // New, with the active profile's own name (differently cased): refused before anything is sent.
    await page.getByRole('button', { name: 'New', exact: true }).click();
    const nameIn = dialog.getByPlaceholder('e.g. Outdoor, Indoor whoop');
    await nameIn.fill(currentName.toUpperCase());
    await expect(
      dialog.getByText(`A profile named “${currentName}” already exists.`)
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled();
    await nameIn.press('Enter');
    await expect(dialog).toBeVisible();
    expect((await tuning()).profile_ids).toEqual(before.profile_ids);

    // A fresh name goes through; renaming it to the first one's name is refused.
    await nameIn.fill('Dup test');
    await expect(dialog.getByRole('button', { name: 'Create' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(confirmed).toBeVisible();
    const withDup = await tuning();
    expect(withDup.profile_names).toContain('Dup test');
    await expect(confirmed).toBeHidden();

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const editName = dialog.getByPlaceholder('Profile name');
    await editName.fill(currentName);
    await expect(
      dialog.getByText(`A profile named “${currentName}” already exists.`)
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
    await editName.press('Enter');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect((await tuning()).profile_names).toEqual(withDup.profile_names);

    await page.locator('.bar').getByRole('button', { name: 'Delete' }).click();
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await expect(confirmed).toBeVisible();
    expect((await tuning()).profile_ids).toEqual(before.profile_ids);
  });
});
