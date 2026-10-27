import { expect, test } from '../src/fixtures.js';

test.describe('Run', () => {
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
    await page.getByRole('combobox').first().selectOption(String(heat));
    await expect(page.getByText('Ace').first()).toBeVisible();

    await page.getByRole('button', { name: 'Start' }).click();
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

    await page.getByRole('button', { name: 'Stop' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Race saved.')).toBeVisible();

    const saved = await rig.race(heat, 1);
    const seat = saved.nodes.find((n) => n.node_index === 1);
    expect(seat?.callsign).toBe('Ace');
    expect(seat?.laps.filter((l) => !l.deleted)).toHaveLength(3); // hole shot + 2 of the 3 laps
    await rh.expectResultsToMention('Heat A');
  });
});
