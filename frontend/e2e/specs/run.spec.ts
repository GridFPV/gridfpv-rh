import { expect, test } from '../src/fixtures.js';

test.describe('Run', () => {
  test('an Off seat is warned about, practice never saves, the board waits for a race (#70, #50, #47)', async ({
    page,
    rig,
    rh
  }) => {
    test.setTimeout(120_000);
    const seat = 7;
    const [was] = [(await rig.frequencies())[seat]?.frequency ?? 0];
    try {
      await rig.setFrequency(seat, 0);
      // Ready with nothing loaded: no leaderboard, so no empty seat shown by its frequency (#47).
      await page.goto('/grid/run');
      await expect(page.getByText('Practice: whoever is on a seat')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Leaderboard' })).toHaveCount(0);

      // A pilot on the Off seat: the header and the seat card both say so (#70).
      const ace = await rig.addPilot({ callsign: 'Ace' });
      const cls = await rig.addClass({ name: 'E2E Off' });
      const pilots: Array<number | null> = [null, null, null, null, null, null, null, ace];
      const heat = await rig.addHeat({ name: 'Heat O', classId: cls, pilots });
      await page.getByRole('combobox').first().selectOption(String(heat));
      await expect(page.getByText(/Ace is on seat 8, which has no frequency/)).toBeVisible();
      await expect(
        page.getByText(/No frequency on this seat: Ace will not be timed/)
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();

      // Practice: Save is not offered; Stop, then Discard, clears the laps (#50).
      await page.getByRole('combobox').first().selectOption('0');
      await expect(page.getByText(/Ace is on seat 8/)).toHaveCount(0);
      await expect(page.getByText(/RotorHazard does not save practice laps/)).toBeVisible();
      await rig.setMinLap(1);
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      await rig.until('racing', async () => (await rig.status()).race_status === 1, 30_000);
      await rig.fly({ 1: [300, 1600] });
      await expect(page.getByRole('heading', { name: 'Leaderboard' })).toBeVisible();
      await page.getByRole('button', { name: 'Stop' }).click();
      await rig.until('stopped', async () => (await rig.status()).race_status === 2, 20_000);
      await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
      await page.getByRole('button', { name: 'Discard' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
      await rig.until('ready', async () => (await rig.status()).race_status === 0, 20_000);
      await expect(page.getByRole('heading', { name: 'Leaderboard' })).toHaveCount(0);

      // RotorHazard agrees: no round saved for any heat, and seat 8 is still Off.
      expect((await rig.rounds()).filter((h) => h.rounds > 0)).toEqual([]);
      expect((await rig.frequencies())[seat]?.frequency).toBe(0);
      await rh.expectResultsNotToMention('Heat O', 'Results');
    } finally {
      await rig.setFrequency(seat, was);
    }
  });

  test("a scheduled start counts down to RotorHazard's own staging; the practice format is RotorHazard's", async ({
    page,
    rig
  }) => {
    test.setTimeout(90_000);
    await page.goto('/grid/run'); // practice: the format can be picked here
    const f3 = (await rig.formats()).find((f) => /First to 3/.test(f.name))!;
    await page.getByLabel('Race format').selectOption(String(f3.id));
    await expect(page.getByText('Format set.')).toBeVisible();
    // RotorHazard agrees: its race_status carries that format.
    expect(
      Number((await rig.loadData<{ race_format_id: number }>('race_status')).race_format_id)
    ).toBe(f3.id);

    // Schedule 0:30, see the countdown, cancel it.
    await page.getByLabel('Minutes', { exact: true }).fill('0');
    await page.getByLabel('Seconds', { exact: true }).fill('30');
    await page.getByRole('button', { name: 'Schedule start' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: /^Starts in 0:[23]\d$/ })
    ).toBeVisible();
    expect((await rig.raceScheduled()).scheduled).toBe(true);
    await page.getByRole('button', { name: 'Cancel start' }).click();
    await expect(page.getByText('Scheduled start cancelled.')).toBeVisible();
    expect((await rig.raceScheduled()).scheduled).toBe(false);

    // Schedule 0:05: RotorHazard stages the race itself when the time is up.
    await page.getByLabel('Seconds', { exact: true }).fill('5');
    await page.getByRole('button', { name: 'Schedule start' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^Starts in 0:0\d$/ })).toBeVisible();
    await rig.until(
      'staged by the schedule',
      async () => (await rig.status()).race_status !== 0,
      20_000
    );
    await rig.stop();
    await rig.discard();
  });

  test("Sound settings written here are what RotorHazard's own Run page reads (same rotorhazard.* keys)", async ({
    page,
    rig
  }) => {
    test.setTimeout(90_000);
    await page.goto('/grid/run');
    await page.getByRole('button', { name: 'Sound settings…' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Sound settings' })).toBeVisible();
    const field = (key: string) => dialog.locator(`[data-key="${key}"]`).locator('select, input');
    await field('voice_race_timer').selectOption('0');
    await field('use_mp3_tones').check();
    await field('tone_volume').fill('0');
    await field('voice_rate').fill('1.5');
    // Export: RotorHazard's own file format.
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export audio settings' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^rhAudioSettings_\d{8}_\d{6}\.cfg$/);
    const text = await (await import('node:fs/promises')).readFile(await file.path(), 'utf8');
    expect(text).toContain('rotorhazard.voice_race_timer=0');
    expect(text).toContain('rotorhazard.use_mp3_tones=true');
    expect(text).toContain('rotorhazard.voice_rate=1.5');
    // Import: a file in that format changes the settings; unknown keys are reported.
    await dialog.getByLabel('Audio settings file to import').setInputFiles({
      name: 'in.cfg',
      mimeType: 'text/plain',
      buffer: Buffer.from('# test\nrotorhazard.voice_pitch=0.8\nrotorhazard.nope=1\n')
    });
    await dialog.getByRole('button', { name: 'Import audio settings' }).click();
    await expect(
      page.getByText('Imported 1 audio setting. Ignored: rotorhazard.nope.')
    ).toBeVisible();
    await expect(field('voice_pitch')).toHaveValue('0.8');
    await page.keyboard.press('Escape');

    // RotorHazard agrees: its own Run page, in this browser, reads the same settings.
    const rhSetting = async (key: string) => {
      const theirs = await page.context().newPage();
      await theirs.goto(rig.url + '/run');
      await theirs.waitForTimeout(1500);
      const v = await theirs.evaluate(
        (k) => (window as unknown as { rotorhazard: Record<string, unknown> }).rotorhazard[k],
        key
      );
      await theirs.close();
      return v;
    };
    expect(await rhSetting('voice_race_timer')).toBe(0);
    expect(await rhSetting('use_mp3_tones')).toBe(true);
    expect(Number(await rhSetting('tone_volume'))).toBeCloseTo(0.01, 6);
    expect(await rhSetting('voice_rate')).toBe(1.5);
    expect(await rhSetting('voice_pitch')).toBe(0.8);

    // Defaults: back to RotorHazard's, on its page too.
    await page.getByRole('button', { name: 'Sound settings…' }).click();
    await dialog.getByRole('button', { name: 'Set audio settings to defaults' }).click();
    await dialog.getByRole('button', { name: 'Reset' }).click();
    await expect(page.getByText('Audio settings back to RotorHazard defaults.')).toBeVisible();
    await expect(field('voice_race_timer')).toHaveValue('2');
    expect(await rhSetting('voice_rate')).toBe(1.25);
  });

  test("display preferences and callouts: RotorHazard's keys and its callout list", async ({
    page,
    rig
  }) => {
    test.setTimeout(90_000);
    const ace = await rig.addPilot({ callsign: 'Ace' });
    const heat = await rig.addHeat({ name: 'Heat P', pilots: [null, ace] });
    await rig.setMinLap(1);
    await page.goto('/grid/run');
    await page.getByRole('button', { name: 'Sound settings…' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('[data-key="display_laps_reversed"] input').check();
    await dialog.locator('[data-key="display_time_start"] input').check();
    // Callouts: add one, it is saved on the timer; ▶ has RotorHazard speak it everywhere.
    await dialog.getByRole('button', { name: 'Add callout' }).click();
    const line = dialog.getByLabel('Callout 1', { exact: true });
    await line.fill('Pilots to the line');
    await line.press('Tab');
    await expect(page.getByText('Callouts saved on the timer.')).toBeVisible();
    expect(await rig.callouts()).toEqual(['Pilots to the line']);
    const spoken = rig.next<{ text: string }>('phonetic_text', 10_000);
    await dialog.getByRole('button', { name: 'Play callout 1' }).click();
    expect((await spoken).text).toBe('Pilots to the line');
    await expect(page.getByText('Spoken: Pilots to the line')).toBeVisible();
    await page.keyboard.press('Escape');

    // The chips honour the preferences during a race.
    await page.getByRole('combobox').first().selectOption(String(heat));
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await rig.until('racing', async () => (await rig.status()).race_status === 1, 30_000);
    await rig.fly({ 1: [300, 1600] });
    const chips = page.locator('.seat', { hasText: 'Ace' }).locator('.lap');
    await expect(chips).toHaveCount(2);
    await expect(chips.first()).toContainText('L1'); // newest first
    await expect(chips.first()).toContainText(/@0:0\d\.\d{3}/);
    await page.getByRole('button', { name: 'Stop' }).click();
    await page.getByRole('button', { name: 'Discard' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();

    // RotorHazard agrees: its Run page reads the same preferences; its callouts list is ours.
    const theirs = await page.context().newPage();
    await theirs.goto(rig.url + '/run');
    await theirs.waitForTimeout(1500);
    const rhv = (k: string) =>
      theirs.evaluate(
        (key) => (window as unknown as { rotorhazard: Record<string, unknown> }).rotorhazard[key],
        k
      );
    expect(await rhv('display_laps_reversed')).toBe(true);
    expect(await rhv('display_time_start')).toBe(true);
    expect(await rhv('display_lap_id')).toBe(false);
    await theirs.close();
    expect(await rig.callouts()).toEqual(['Pilots to the line']);
  });

  test("a message sent from Run reaches every page as RotorHazard's priority message", async ({
    page,
    rig
  }) => {
    await page.goto('/grid/run');
    const plain = rig.next<{ message: string; interrupt?: boolean }>('priority_message', 10_000);
    await page.getByLabel('Message to every page').fill('Pilots to the line');
    await page.getByRole('button', { name: 'Send message' }).click();
    // Our own banner shows it (RotorHazard broadcasts to the sender too) …
    await expect(page.getByRole('status').filter({ hasText: 'Pilots to the line' })).toBeVisible();
    // … and RotorHazard agrees: the broadcast carried that text, not an interrupt.
    expect(await plain).toMatchObject({ message: 'Pilots to the line', interrupt: false });
    await expect(page.getByLabel('Message to every page')).toHaveValue('');

    const alert = rig.next<{ message: string; interrupt?: boolean }>('priority_message', 10_000);
    await page.getByLabel('Message to every page').fill('Red flag');
    await page.getByLabel('Pop-up alert').check();
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Red flag' })).toBeVisible();
    expect(await alert).toMatchObject({ message: 'Red flag', interrupt: true });
  });

  test("a grouped stage's raced heat is listed but not loadable: RotorHazard keeps it inactive (#80)", async ({
    page,
    rig
  }) => {
    test.setTimeout(90_000);
    const ace = await rig.addPilot({ callsign: 'Ace' });
    const mains = await rig.addClass({ name: 'E2E Mains', rounds: 2 });
    const m1 = await rig.addHeat({ name: 'Main A', classId: mains, pilots: [null, ace] });
    await rig.alterClass(mains, { roundType: 1, heatAdvanceType: 2 });
    await rig.setMinLap(1);
    await rig.raceHeat(m1, { 1: [500, 2000] }); // round 1 flown: RotorHazard deactivates M1
    const copy = await rig.until('round 2 heat', async () =>
      (await rig.heats()).find((h) => h.class_id === mains && h.heat_id !== m1)
    );
    expect((await rig.status()).current_heat).toBe(copy.heat_id);
    await page.goto('/grid/run');
    const picker = page.getByRole('combobox').first();
    const raced = picker.locator(`option[value="${m1}"]`);
    await expect(raced).toHaveCount(1);
    await expect(raced).toBeDisabled();
    await expect(raced).toHaveText(/Main A — raced; RotorHazard keeps grouped heats inactive/);
    // RotorHazard agrees: it would refuse to stage an inactive heat; its current heat is unchanged.
    expect((await rig.status()).current_heat).toBe(copy.heat_id);
  });

  test("RotorHazard's messages: a plain one fades after 8 s, an interrupt stays until dismissed or the heat changes (#71)", async ({
    page,
    rig
  }) => {
    test.setTimeout(90_000);
    await page.goto('/grid/run');
    await expect(page.getByText('Practice: whoever is on a seat')).toBeVisible();
    await rig.sendMessage('Pilots to the line');
    const plain = page.getByText('Pilots to the line');
    await expect(plain).toBeVisible();
    await expect(plain).toBeHidden({ timeout: 12_000 });

    await rig.sendMessage('Red flag', true);
    const red = page.getByText('Red flag');
    await expect(red).toBeVisible();
    await page.waitForTimeout(9_000);
    await expect(red).toBeVisible();
    // A new heat is a new context: the message goes with the old one.
    const ace = await rig.addPilot({ callsign: 'Ace' });
    const heat = await rig.addHeat({ name: 'Heat M', pilots: [null, ace] });
    await page.getByRole('combobox').first().selectOption(String(heat));
    await expect(red).toBeHidden();
    // RotorHazard agrees: the heat is loaded, and its message was the one we showed.
    expect((await rig.status()).current_heat).toBe(heat);
  });

  test("picking a seeded heat shows RotorHazard's heat plan; Confirm loads it (#69)", async ({
    page,
    rig,
    rh
  }) => {
    test.setTimeout(90_000);
    const ace = await rig.addPilot({ callsign: 'Ace' });
    const bee = await rig.addPilot({ callsign: 'Bee' });
    const quali = await rig.addClass({ name: 'E2E Quali' });
    const q1 = await rig.addHeat({ name: 'Q1', classId: quali, pilots: [null, ace, bee] });
    await rig.setMinLap(1);
    await rig.raceHeat(q1, { 1: [500, 2000, 3500], 2: [600, 2400] }); // Ace 1st, Bee 2nd
    const final = await rig.addClass({ name: 'E2E Final' });
    const f1 = await rig.addHeat({ name: 'Final 1', classId: final, pilots: [] });
    await rig.seedSeatFromHeat(f1, 1, q1, 1);
    await rig.seedSeatFromHeat(f1, 2, q1, 2);

    await page.goto('/grid/run');
    await page.getByRole('combobox').first().selectOption(String(f1));
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Heat plan: Final 1' })).toBeVisible();
    const table = dialog.getByLabel('Heat plan');
    await expect(table).toContainText('Ace');
    await expect(table).toContainText('1st from Q1');
    await expect(table).toContainText('Bee');
    // RotorHazard has not loaded it yet.
    expect((await rig.status()).current_heat).not.toBe(f1);

    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('Final 1 is loaded on the timer.')).toBeVisible();
    // RotorHazard agrees: Final 1 is the current heat, confirmed, with Ace and Bee seated.
    expect((await rig.status()).current_heat).toBe(f1);
    const h = (await rig.heats()).find((x) => x.heat_id === f1)!;
    expect([h.nodes_pilots['1'], h.nodes_pilots['2']]).toEqual([ace, bee]);
    expect(await rh.formatHeatNames()).toEqual(expect.arrayContaining(['Final 1']));
  });

  test('a race run from the Run page is saved with its laps in RotorHazard', async ({
    page,
    rig,
    rh
  }) => {
    const ace = await rig.addPilot({ callsign: 'Ace' });
    const cls = await rig.addClass({ name: 'E2E Practice' });
    // Seat 2: seat 1 carries the rig's emulated RSSI stream.
    const heat = await rig.addHeat({ name: 'Heat A', classId: cls, pilots: [null, ace] });
    await rig.setMinLap(1);

    await page.goto('/grid/run');
    // The race settings strip says what RotorHazard will race with (min lap 1 s was set above).
    await expect(page.getByLabel('Race settings')).toContainText('Min lap 1 s');
    expect((await rig.minLap()).min_lap).toBe(1);
    await page.getByRole('combobox').first().selectOption(String(heat));
    await expect(page.getByText('Ace', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop' })).toBeEnabled();
    await rig.until('racing', async () => (await rig.status()).race_status === 1, 30_000);
    await rig.fly({ 1: [300, 1600, 2900, 4200] });
    await expect(page.getByRole('button', { name: /^L3/ })).toBeVisible();

    // Delete lap 2 while the race is on (#49): RotorHazard drops it and renumbers the rest.
    // The page must not throw (the bug was a null read in the confirm handler).
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.getByRole('button', { name: /^L2/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete lap' }).click();
    await expect(page.getByRole('button', { name: /^L3/ })).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    await expect(page.getByRole('button', { name: /^L2/ })).toHaveCount(1);

    // "+ Lap" on the seat card: a manual pass lands as lap 3 (RotorHazard's simulate_lap).
    await page.getByRole('button', { name: 'Manual lap for seat 2' }).click();
    await expect(page.getByRole('button', { name: /^L3/ })).toHaveCount(1);

    await page.getByRole('button', { name: 'Stop' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Race saved.')).toBeVisible();

    const saved = await rig.race(heat, 1);
    const seat = saved.nodes.find((n) => n.node_index === 1);
    expect(seat?.callsign).toBe('Ace');
    expect(seat?.laps.filter((l) => !l.deleted)).toHaveLength(4); // hole shot + 2 of 3 + manual
    await rh.expectResultsToMention('Heat A');
  });
});
