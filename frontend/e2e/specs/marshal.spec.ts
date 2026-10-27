import { expect, test } from '../src/fixtures.js';

test.describe('Marshal', () => {
  test("a lap deleted in Grid is deleted in RotorHazard's saved race", async ({ page, rig }) => {
    const ace = await rig.addPilot({ callsign: 'Ace' });
    const heat = await rig.addHeat({ name: 'Heat A', pilots: [null, ace] }); // seat 2: no emulated signal
    await rig.setMinLap(1);
    await rig.setHeat(heat);
    await rig.start();
    await rig.fly({ 1: [500, 2000, 3500] });
    await rig.stop();
    await rig.save();

    await page.goto('/grid/marshal');
    const race = page.getByRole('combobox', { name: /^Race/ });
    await expect(race.locator('option')).not.toHaveCount(0);
    await race.selectOption({ index: 0 });
    // Every seat has a pilot-race in a saved race; pick Ace's, not seat 1's empty one.
    const who = page.getByRole('combobox', { name: /^Pilot/ });
    const aceOption = who.locator('option', { hasText: 'Ace' });
    await expect(aceOption).toHaveCount(1);
    await who.selectOption((await aceOption.getAttribute('value')) ?? '');
    const laps = page.locator('table.laps tbody tr');
    await expect(laps).toHaveCount(3);
    await laps.nth(1).click();
    await expect(laps.nth(1)).toHaveClass(/deleted/);
    await page.getByRole('button', { name: 'Save laps' }).click();
    await expect(page.getByText('Laps saved; RotorHazard rebuilt the results.')).toBeVisible();

    const saved = await rig.race(heat, 1);
    const seat = saved.nodes.find((n) => n.node_index === 1);
    expect(seat?.laps.map((l) => l.deleted)).toEqual([false, true, false]);
  });

  test("RotorHazard's marshal tools, ours: manual lap by time, clean deleted laps, load from seat, reassign heat", async ({
    page,
    rig,
    rh
  }) => {
    test.setTimeout(120_000);
    const ace = await rig.addPilot({ callsign: 'Ace' });
    const h1 = await rig.addHeat({ name: 'Heat A', pilots: [null, ace] });
    const h2 = await rig.addHeat({ name: 'Heat B', pilots: [null, ace] });
    await rig.setMinLap(1);
    await rig.setHeat(h1);
    await rig.start();
    await rig.fly({ 1: [500, 4000, 10000] }); // laps at 3.5 and 6.0 s
    await rig.stop();
    await rig.save();

    await page.goto('/grid/marshal');
    const race = page.getByRole('combobox', { name: /^Race/ });
    await expect(race.locator('option')).not.toHaveCount(0);
    await race.selectOption({ index: 0 });
    const who = page.getByRole('combobox', { name: /^Pilot/ });
    await who.selectOption(
      (await who.locator('option', { hasText: 'Ace' }).getAttribute('value')) ?? ''
    );
    const rows = page.locator('table.laps tbody tr');
    await expect(rows).toHaveCount(3);

    // Manual lap at 7.5 s: a fourth lap, source manual, lap times re-measured around it.
    await page.getByLabel('Manual lap time').fill('7.5');
    await page.getByRole('button', { name: 'Add lap' }).click();
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(2)).toContainText('manual');
    await expect(rows.nth(2)).toContainText('0:07.500');
    // Delete the 10 s lap, then clean: it is gone, not flagged.
    await rows.nth(3).click();
    await expect(rows.nth(3)).toHaveClass(/deleted/);
    await page.getByRole('button', { name: 'Clean deleted laps' }).click();
    await expect(rows).toHaveCount(3);
    await page.getByRole('button', { name: 'Save laps' }).click();
    await expect(page.getByText('Laps saved; RotorHazard rebuilt the results.')).toBeVisible();
    // RotorHazard agrees: three laps saved, none flagged; the rig's passes carry its own few
    // ms of jitter (and RotorHazard records a simulated pass as source manual too); ours at
    // exactly 7500 with source 1, and every lap time re-measured around it.
    const saved = await rig.race(h1, 1);
    const seat = saved.nodes.find((n) => n.node_index === 1)!;
    const stamps = seat.laps.map((l) => Math.round(l.lap_time_stamp));
    expect(stamps.length).toBe(3);
    expect(Math.abs(stamps[0] - 500)).toBeLessThanOrEqual(20);
    expect(Math.abs(stamps[1] - 4000)).toBeLessThanOrEqual(20);
    expect(stamps[2]).toBe(7500);
    expect((seat.laps[2] as unknown as { source: number }).source).toBe(1);
    expect(seat.laps.map((l) => l.deleted)).toEqual([false, false, false]);
    const times = seat.laps.map((l) => Math.round(l.lap_time));
    expect(Math.abs(times[0] - stamps[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(times[1] - (stamps[1] - stamps[0]))).toBeLessThanOrEqual(1);
    expect(Math.abs(times[2] - (7500 - stamps[1]))).toBeLessThanOrEqual(1);

    // Load from seat: the seat's current thresholds become the marshal thresholds.
    await rig.setSeatLevels(1, 120, 70);
    await page.getByRole('button', { name: 'Load from seat' }).click();
    await expect(page.getByLabel('Enter at')).toHaveValue('120');
    await expect(page.getByLabel('Exit at')).toHaveValue('70');

    // Reassign: the race moves under Heat B with its round; RotorHazard lists it there.
    await page.getByLabel('Move to heat').selectOption(String(h2));
    await page.getByRole('button', { name: 'Reassign' }).click();
    await expect(page.getByText(/Race moved to Heat B/)).toBeVisible();
    await rig.until('race under Heat B', async () => {
      const rounds = await rig.rounds();
      return (
        rounds.find((h) => h.id === h2)?.rounds === 1 &&
        !(rounds.find((h) => h.id === h1)?.rounds ?? 0)
      );
    });
    await rh.expectResultsToMention('Heat B');
  });
});
