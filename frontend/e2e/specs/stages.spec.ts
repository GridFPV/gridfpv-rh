import { expect, test } from '../src/fixtures.js';

test.describe('Stages', () => {
  test('a stage with heats, seated in Grid, is a class with heats in RotorHazard', async ({
    page,
    rig,
    rh
  }) => {
    const ace = await rig.addPilot({ callsign: 'Ace' });
    await rig.addPilot({ callsign: 'Bee' });

    await page.goto('/grid/stages');
    await expect(page.getByRole('heading', { name: 'Stages' })).toBeVisible();
    await page.getByRole('button', { name: 'Add stage' }).click();
    await page.getByLabel('Name').fill('E2E Qualifying');
    await page.getByLabel('Heats').fill('2');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByRole('heading', { name: 'E2E Qualifying' })).toBeVisible();
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
    await dialog.getByRole('button', { name: 'Done' }).click();

    // RotorHazard agrees: the class, two heats, and Ace on seat 1 of the first.
    const heats = await rig.heats();
    expect(heats).toHaveLength(2);
    const seated = heats.find((h) => h.nodes_pilots['0'] === ace);
    expect(seated).toBeTruthy();
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
});
