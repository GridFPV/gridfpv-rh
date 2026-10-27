import { expect, test } from '../src/fixtures.js';

test.describe('Stages', () => {
  test('a stage with heats, seated in Grid, is a class with heats in RotorHazard', async ({
    page,
    rig,
    rh
  }) => {
    const ace = await rig.addPilot({ callsign: 'Ace' });
    const bee = await rig.addPilot({ callsign: 'Bee' });

    await page.goto('/grid/stages');
    await expect(page.getByRole('heading', { name: 'Stages' })).toBeVisible();
    await page.getByRole('button', { name: 'Add stage' }).click();
    await page.getByLabel('Name').fill('E2E Qualifying');
    await page.getByLabel('Heats').fill('2');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByRole('heading', { name: 'E2E Qualifying' })).toBeVisible();
    // The empty ranking choice says what RotorHazard does with it (#46), and the Qualifying
    // template leaves it there when its format ranks by consecutive laps (#66).
    await expect(page.getByLabel('Ranked by').locator('option').first()).toHaveText(
      /^By the format's win condition \(/
    );
    const qual = (await rig.classes()).find((c) => c.name === 'E2E Qualifying') as {
      format_id?: number;
      win_condition?: string;
    };
    const qualFormat = (await rig.formats()).find((f) => f.id === qual.format_id) as {
      win_condition?: number;
    };
    if (qualFormat?.win_condition === 4) expect(qual.win_condition ?? '').toBe('');
    const rows = page.locator('tr.heat');
    await expect(rows).toHaveCount(2);

    // Seat Ace on seat 1 of the first heat through the heat dialog.
    await rows.first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // A new RotorHazard slot is already "Pilot" with nobody picked; pick Ace by id.
    await dialog.locator('select').nth(1).selectOption(String(ace));
    await expect(
      dialog
        .getByText('RotorHazard confirmed the change.')
        .or(page.getByText('RotorHazard confirmed the change.'))
    ).toBeVisible();
    // Ace is seated, so seat 2's picker no longer offers him (#61); Bee it does.
    await expect(dialog.locator('select').nth(3).locator(`option[value="${ace}"]`)).toHaveCount(0);
    await expect(dialog.locator('select').nth(3).locator(`option[value="${bee}"]`)).toHaveCount(1);
    await dialog.getByRole('button', { name: 'Done' }).click();

    // RotorHazard agrees: the class, two heats, and Ace on seat 1 of the first, once.
    const heats = await rig.heats();
    expect(heats).toHaveLength(2);
    const seated = heats.find((h) => h.nodes_pilots['0'] === ace);
    expect(seated).toBeTruthy();
    expect(Object.values(seated!.nodes_pilots).filter((p) => p === ace)).toHaveLength(1);
    expect(await rh.formatClassNames()).toContain('E2E Qualifying');
    expect((await rh.formatHeatNames()).length).toBeGreaterThanOrEqual(2);
  });

  test('rounds on the board: delete a saved race (copy kept), restore it, re-run a heat (#36)', async ({
    page,
    rig,
    rh
  }) => {
    test.setTimeout(120_000);
    const ace = await rig.addPilot({ callsign: 'Ace' });
    const bee = await rig.addPilot({ callsign: 'Bee' });
    const cls = await rig.addClass({ name: 'E2E Rounds' });
    // Seat 1 carries the rig's emulated signal; use seats 2 and 3.
    const heatA = await rig.addHeat({ name: 'Heat A', classId: cls, pilots: [null, ace, bee] });
    const heatB = await rig.addHeat({ name: 'Heat B', classId: cls, pilots: [null, bee, ace] });
    await rig.setMinLap(1);
    // Heat A twice, Heat B once. Laps: Ace 2 + 1 + 2, Bee 1 + 4 + 1 — ranked by best rounds
    // (laps), Bee leads only while A2 stands, so deleting it changes the class standings.
    await rig.raceHeat(heatA, { 1: [500, 2000, 3500], 2: [600, 2400] });
    await rig.raceHeat(heatB, { 1: [500, 2000], 2: [600, 2400, 4000] });
    await rig.raceHeat(heatA, { 1: [500, 2000], 2: [600, 1800, 3000, 4200, 5400] });
    expect((await rig.rounds()).find((h) => h.id === heatA)?.rounds).toBe(2);
    const lapsBefore = (await rig.race(heatA, 2)).nodes.find((n) => n.callsign === 'Bee')!.laps;
    expect(lapsBefore.filter((l) => !l.deleted)).toHaveLength(5);

    await page.goto('/grid/stages');
    await expect(page.getByRole('heading', { name: 'E2E Rounds' })).toBeVisible();
    // Rank the stage by laps over its best rounds (RotorHazard's bundled method).
    const ranked = page.getByLabel('Ranked by');
    const bestRounds = await ranked.locator('option', { hasText: /Best/ }).getAttribute('value');
    await ranked.selectOption(bestRounds ?? '');
    const standings = page.locator('.standings', { hasText: 'Standings' }).first();
    await expect(standings).toContainText('1 Bee');
    const standingsBefore = (await standings.textContent()) ?? '';
    const rowA = page.locator('tr.heat', { hasText: 'Heat A' });
    // Both rounds of Heat A are raced cells with the winner's callsign.
    await expect(rowA.getByTitle(/Round 1, raced/)).toHaveText(/Ace/);
    await expect(rowA.getByTitle(/Round 2, raced/)).toHaveText(/Bee/);

    // Delete Heat A round 2 from its cell: two clicks, no browser pop-up.
    await rowA.getByTitle(/Round 2, raced/).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Heat A · round 2' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete race…' }).click();
    await dialog.getByRole('button', { name: 'Confirm delete' }).click();
    await expect(
      page.getByText(/Race deleted; a copy is kept below\. RotorHazard backed up/)
    ).toBeVisible({
      timeout: 15_000
    });
    await expect(rowA.getByTitle(/Round 2, raced/)).toHaveCount(0);
    await expect(page.getByLabel('Deleted races')).toContainText('Heat A · round 2 · Ace, Bee');
    await expect(standings).toContainText('1 Ace');
    expect((await standings.textContent()) ?? '').not.toBe(standingsBefore);

    // The safety copy is listed apart on the Event page, without Restore (#54).
    await page.goto('/grid/event');
    const summary = page.locator('details.safety summary');
    await expect(summary).toContainText(/\d+ safety cop(y|ies) taken before\s+race deletes/);
    await expect(page.getByLabel('Event archives').getByText(/before a race delete/)).toHaveCount(
      0
    );
    await summary.click();
    const safety = page.getByLabel('Safety copies');
    await expect(safety).toContainText('before a race delete · E2E event');
    await expect(safety.getByRole('button', { name: 'Restore' })).toHaveCount(0);

    // RotorHazard agrees the race is gone: its API, its race list, its Results page, and a backup exists.
    expect((await rig.rounds()).find((h) => h.id === heatA)?.rounds).toBe(1);
    expect(await rig.apiStatus(`/api/race/${heatA}/2`)).toBeGreaterThanOrEqual(400);
    await rh.expectResultsNotToMention('Round 2', 'Heat A');

    // Restore it from the board.
    await page.goto('/grid/stages');
    await page.getByLabel('Deleted races').getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText('Round 2 is back in the results.')).toBeVisible({
      timeout: 15_000
    });
    await expect(rowA.getByTitle(/Round 2, raced/)).toHaveText(/Bee/);
    await expect(page.getByLabel('Deleted races')).toHaveCount(0);
    await expect(standings).toHaveText(standingsBefore);

    // RotorHazard agrees the race is back, laps included, and its Results page shows round 2 again.
    expect((await rig.rounds()).find((h) => h.id === heatA)?.rounds).toBe(2);
    const restored = await rig.race(heatA, 2);
    const beeLaps = restored.nodes.find((n) => n.callsign === 'Bee')!.laps;
    expect(beeLaps.filter((l) => !l.deleted).map((l) => Math.round(l.lap_time))).toEqual(
      lapsBefore.filter((l) => !l.deleted).map((l) => Math.round(l.lap_time))
    );
    await rh.expectResultsToMention('Round 2');

    // Re-run: RotorHazard advanced to Heat B after the last save ("next heat"), so Heat A's
    // next-round cell is the open one; clicking it loads Heat A on the timer for round 3.
    await page.goto('/grid/stages');
    expect((await rig.status()).current_heat).toBe(heatB);
    await page.getByRole('button', { name: 'Load Heat A for round 3' }).click();
    await expect(page.getByText('Heat A is loaded on the timer.')).toBeVisible();
    expect((await rig.status()).current_heat).toBe(heatA);
    await expect(rowA.getByTitle('Loaded on the timer')).toBeVisible();
  });

  test('a raced heat and stage stay locked until unlocked with a warning (unlock_heat, unlock_class)', async ({
    page,
    rig,
    rh
  }) => {
    test.setTimeout(90_000);
    const ace = await rig.addPilot({ callsign: 'Ace' });
    const bee = await rig.addPilot({ callsign: 'Bee' });
    const cee = await rig.addPilot({ callsign: 'Cee' });
    const cls = await rig.addClass({ name: 'E2E Locked' });
    const heat = await rig.addHeat({ name: 'Heat L', classId: cls, pilots: [null, ace, bee] });
    await rig.setMinLap(1);
    await rig.raceHeat(heat, { 1: [500, 2000], 2: [600, 2400] });

    await page.goto('/grid/stages');
    const row = page.locator('tr.heat', { hasText: 'Heat L' });
    await expect(row.getByText('raced')).toBeVisible();
    await row.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('raced · seats locked')).toBeVisible();
    // Seat 3 (Bee) is locked: its pilot select is disabled until unlocked.
    const seatSelects = dialog.locator('select');
    await expect(seatSelects.nth(1)).toBeDisabled();
    await dialog.getByRole('button', { name: 'Unlock seats…' }).click();
    await expect(dialog.getByRole('alert')).toContainText('changes its saved results');
    await dialog.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(dialog.getByText('raced · unlocked')).toBeVisible();
    // Put Cee on seat 3 in Bee's place; the slot's pilot select is the one holding Bee.
    const beeSelect = dialog.locator('select').filter({ has: page.locator('option[selected]') });
    expect(beeSelect).toBeDefined();
    const pilotSelects = dialog.locator('select');
    const count = await pilotSelects.count();
    let changed = false;
    for (let i = 0; i < count; i++) {
      const sel = pilotSelects.nth(i);
      if ((await sel.inputValue()) === String(bee) && (await sel.isEnabled())) {
        await sel.selectOption(String(cee));
        changed = true;
        break;
      }
    }
    expect(changed).toBe(true);
    await expect(page.getByText('RotorHazard confirmed the change.').first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();

    // The stage's format is locked too, until unlocked.
    const stage = page.locator('.classhead', { hasText: 'E2E Locked' }).locator('..');
    // The label wraps the select, so its accessible name carries every option: find it by structure.
    const formatSelect = stage
      .locator('label', { has: page.locator('span', { hasText: /^Format$/ }) })
      .locator('select');
    await expect(formatSelect).toBeDisabled();
    await stage.getByRole('button', { name: 'Unlock…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(formatSelect).toBeEnabled();
    const practice = await formatSelect
      .locator('option', { hasText: /Practice/i })
      .first()
      .getAttribute('value');
    await formatSelect.selectOption(practice ?? '');
    await expect(page.getByText('RotorHazard confirmed the change.').first()).toBeVisible();

    // RotorHazard agrees: Cee is on seat 3 of the raced heat, and the class has the new format.
    const h = (await rig.heats()).find((x) => x.heat_id === heat)!;
    expect(h.nodes_pilots['2']).toBe(cee);
    const c = (await rig.classes()).find((x) => x.id === cls) as { format_id?: number };
    expect(String(c.format_id)).toBe(practice);
    expect(await rh.formatClassNames()).toContain('E2E Locked');
  });

  test('Chase the Ace: the first pilot to win twice is the ace, and RotorHazard ranks them first (#37)', async ({
    page,
    rig,
    rh
  }) => {
    test.setTimeout(120_000);
    const ace = await rig.addPilot({ callsign: 'Ace' });
    const bee = await rig.addPilot({ callsign: 'Bee' });
    await rig.setMinLap(1);

    // The stage from the Add stage dialog's template: one heat, no round limit, last heat position.
    await page.goto('/grid/stages');
    await page.getByRole('button', { name: 'Add stage' }).click();
    await page.getByRole('button', { name: /Chase the Ace/ }).click();
    await expect(page.getByLabel('Name')).toHaveValue('Chase the Ace');
    await page.getByLabel('Name').fill('E2E Ace');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('heading', { name: 'E2E Ace' })).toBeVisible();
    await expect(page.getByLabel('Chase the Ace')).toContainText('First to win two rounds');

    // RotorHazard agrees on the stage: a class with the plugin's attribute, one heat, no round limit.
    const cls = (await rig.classes()).find((c) => c.name === 'E2E Ace')!;
    expect(cls).toBeTruthy();
    expect((await rig.classData()).find((c) => c.id === cls.id)?.gridfpv_stage).toBe('ace');
    const heat = (await rig.heats()).find((h) => h.class_id === cls.id)!;
    expect(heat).toBeTruthy();
    await rig.seatHeat(heat.heat_id, [null, ace, bee]);

    // Round 1 Ace, round 2 Bee, round 3 nobody finishes a lap (no win, #52), round 4 Ace.
    await rig.raceHeat(heat.heat_id, { 1: [500, 2000, 3500], 2: [600, 2400] });
    await expect(page.getByLabel('Chase the Ace')).toContainText('Wins: Ace 1');
    await rig.raceHeat(heat.heat_id, { 1: [500, 2000], 2: [600, 1800, 3000] });
    await expect(page.getByLabel('Chase the Ace')).toContainText('Wins: Ace 1 · Bee 1');
    await rig.raceHeat(heat.heat_id, {});
    await expect(page.getByLabel('Chase the Ace')).toContainText('Wins: Ace 1 · Bee 1');
    await rig.raceHeat(heat.heat_id, { 1: [500, 1800, 3000, 4200], 2: [600, 2400] });
    await expect(page.getByLabel('Chase the Ace')).toContainText(
      'Ace is the ace — decided in round 4'
    );
    await expect(
      page.locator('.classhead', { hasText: 'E2E Ace' }).getByText('Done')
    ).toBeVisible();

    // RotorHazard agrees: its class ranking (last heat position) has Ace first, on its Results page too.
    const ranking = await rig.classRanking(cls.id);
    expect(ranking[0]?.callsign).toBe('Ace');
    await rh.expectResultsToMention('E2E Ace');
    expect((await rig.rounds()).find((h) => h.id === heat.heat_id)?.rounds).toBe(4);

    // The Run page no longer offers the decided stage's heat, and says why while it is loaded (#52).
    await page.goto('/grid/run');
    const heatName = (await rig.heats()).find((h) => h.heat_id === heat.heat_id)!.displayname;
    const picker = page.locator('select').first();
    const loaded = (await rig.status()).current_heat === heat.heat_id;
    await expect(picker.locator('option', { hasText: heatName })).toHaveCount(loaded ? 1 : 0);
    if (loaded) await expect(page.getByRole('note')).toContainText('Another round here changes');
  });

  test("a stage ranked by the format's win condition shows standings after a round (#62)", async ({
    page,
    rig,
    rh
  }) => {
    const ace = await rig.addPilot({ callsign: 'Ace' });
    const bee = await rig.addPilot({ callsign: 'Bee' });
    const cls = await rig.addClass({ name: 'E2E Default Rank' }); // win_condition '' = format default
    const heat = await rig.addHeat({ name: 'Heat D', classId: cls, pilots: [null, ace, bee] });
    await rig.setMinLap(1);
    await rig.raceHeat(heat, { 1: [500, 2000], 2: [600, 1800, 3000] });
    await page.goto('/grid/stages');
    const standings = page.locator('.standings', { hasText: 'Standings' }).first();
    await expect(standings).toContainText('1 Bee');
    await expect(standings).toContainText('2 Ace');
    // RotorHazard agrees: its class leaderboard is what the line shows.
    expect(await rig.classRanking(cls)).toEqual([]);
    await rh.expectResultsToMention('Heat D');
  });

  test('a grouped-rounds stage shows the loaded heat as next on its round section (#58)', async ({
    page,
    rig
  }) => {
    const ace = await rig.addPilot({ callsign: 'Ace' });
    await page.goto('/grid/stages');
    await page.getByRole('button', { name: 'Add stage' }).click();
    await page.getByLabel('Name').fill('E2E Grouped');
    await page.getByLabel('Heats').fill('1');
    await page.getByText(/Grouped rounds/).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('heading', { name: 'E2E Grouped' })).toBeVisible();
    const cls = (await rig.classes()).find((c) => c.name === 'E2E Grouped')!;
    const heat = (await rig.heats()).find((h) => h.class_id === cls.id)!;
    await rig.seatHeat(heat.heat_id, [null, ace]);
    await rig.setHeat(heat.heat_id);
    const section = page.locator('.roundsection', { hasText: 'Round 1' });
    await expect(section.getByTitle('Loaded on the timer')).toBeVisible();
    // After round 1 is flown RotorHazard makes the round-2 heat; loaded, it is next in Round 2.
    await rig.setMinLap(1);
    await rig.raceHeat(heat.heat_id, { 1: [500, 2000] });
    const round2 = await rig.until('round 2 heat', async () =>
      (await rig.heats()).find((h) => h.class_id === cls.id && h.heat_id !== heat.heat_id)
    );
    await rig.setHeat(round2.heat_id);
    await expect(
      page.locator('.roundsection', { hasText: 'Round 2' }).getByTitle('Loaded on the timer')
    ).toBeVisible();
    // RotorHazard agrees: the heat is the current one and the class runs grouped rounds.
    expect((await rig.status()).current_heat).toBe(round2.heat_id);
    expect(Number((await rig.classData()).find((c) => c.id === cls.id)?.round_type)).toBe(1);
  });

  test('a refused delete says why at once: a race is on the timer (#53)', async ({
    page,
    rig,
    rh
  }) => {
    test.setTimeout(90_000);
    const ace = await rig.addPilot({ callsign: 'Ace' });
    const cls = await rig.addClass({ name: 'E2E Busy' });
    const heat = await rig.addHeat({ name: 'Heat B', classId: cls, pilots: [null, ace] });
    await rig.setMinLap(1);
    await rig.raceHeat(heat, { 1: [500, 2000] });
    await rig.setHeat(heat);
    await rig.start();
    try {
      await page.goto('/grid/stages');
      const row = page.locator('tr.heat', { hasText: 'Heat B' });
      await row.getByTitle(/Round 1, raced/).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Delete race…' }).click();
      const started = Date.now();
      await dialog.getByRole('button', { name: 'Confirm delete' }).click();
      await expect(
        page.getByText(/a race is on the timer; save or discard it first/)
      ).toBeVisible();
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      await rig.stop();
      await rig.discard();
    }
    // RotorHazard agrees: the round is still there.
    expect((await rig.rounds()).find((h) => h.id === heat)?.rounds).toBe(1);
    expect(await rh.formatHeatNames()).toContain('Heat B');
  });
});
