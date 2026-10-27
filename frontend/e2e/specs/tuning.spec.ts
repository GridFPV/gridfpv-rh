import { expect, test } from '../src/fixtures.js';

/**
 * RotorHazard's Sensor Tuning settings from the Seats page (#57, the planned:T5 rows):
 * calibration mode and start-of-race lowering, each read back; the lowering a race start
 * applies, as RotorHazard logs it (it tells the UI nothing), shown per seat.
 */
test.describe('Seats: calibration and start-of-race lowering', () => {
  const card = (page: import('@playwright/test').Page, n: number) =>
    page.locator('section.gf-card').filter({ has: page.locator('.num', { hasText: `Seat ${n}` }) });

  test('calibration mode and lowering are set with readback, and a race start shows what was lowered', async ({
    page,
    rig
  }) => {
    test.setTimeout(150_000);
    const cal0 = String((await rig.config('TIMING', ['calibrationMode'])).calibrationMode);
    const low0 = await rig.lowering();
    const levels0 = await rig.loadData<{ enter_at_levels: number[]; exit_at_levels: number[] }>(
      'enter_and_exit_at_levels'
    );
    try {
      await rig.setLowering(0, 0);
      await rig.setConfig('TIMING', 'calibrationMode', '1');
      await rig.setSeatLevels(1, 100, 80);
      await page.goto('/grid/seats');
      const confirmed = page.getByText('RotorHazard confirmed the change.');
      const mode = page.getByRole('combobox', { name: 'Calibration mode' });
      await expect(mode).toHaveValue('1');
      await expect(
        card(page, 2).getByText('Adaptive: enter/exit follow marshalled races')
      ).toBeVisible();

      // Calibration mode, both ways, read back from RotorHazard's config.
      await mode.selectOption('0');
      await expect(confirmed).toBeVisible();
      expect(String((await rig.config('TIMING', ['calibrationMode'])).calibrationMode)).toBe('0');
      await expect(
        card(page, 2).getByText('Adaptive: enter/exit follow marshalled races')
      ).toBeHidden();
      await expect(confirmed).toBeHidden();
      await mode.selectOption('1');
      await expect(confirmed).toBeVisible();
      expect(String((await rig.config('TIMING', ['calibrationMode'])).calibrationMode)).toBe('1');
      await expect(confirmed).toBeHidden();

      // Lowering amount and duration; an out-of-range amount is refused and RotorHazard keeps its value.
      const amount = page.getByRole('spinbutton', { name: 'Amount (%)' });
      const duration = page.getByRole('spinbutton', { name: 'Duration (s)' });
      await expect(amount).toHaveValue('0');
      await amount.fill('30');
      await amount.press('Enter');
      await expect(confirmed).toBeVisible();
      expect((await rig.lowering()).amount).toBe(30);
      await expect(confirmed).toBeHidden();
      await duration.fill('5');
      await duration.press('Enter');
      await expect(confirmed).toBeVisible();
      expect(await rig.lowering()).toEqual({ amount: 30, duration: 5 });
      await expect(confirmed).toBeHidden();
      await expect(page.getByText('For the first 5 s after the start')).toBeVisible();

      await amount.fill('250');
      await amount.press('Enter');
      await expect(page.locator('.gf-banner').filter({ hasText: 'Not written:' })).toContainText(
        'Not written: Amount must be 0–200 percent.'
      );
      await expect(amount).toHaveValue('30');
      expect((await rig.lowering()).amount).toBe(30);

      // A heat with a pilot on seat 2 starts: seat 2 (100/80, no signal) is lowered by
      // int(20 × 30 / 100) = 6. (A practice race has no pilots on its nodes: RotorHazard lowers
      // nothing, which is how the first run of this spec found that out.)
      const bee = await rig.addPilot({ callsign: 'Bee' });
      const heat = await rig.addHeat({ name: 'L1', pilots: [null, bee] });
      await rig.setHeat(heat);
      const logBefore = (await rig.log('lowering EnterAt from')).length;
      await rig.start();
      expect((await rig.status()).race_status).toBe(1);
      await expect(card(page, 2).getByText('Lowered to 94/74 for 5 s at start')).toBeVisible();
      const noted = new Set<number>();
      for (let n = 1; n <= 8; n++)
        if (
          (await card(page, n)
            .getByText(/^Lowered to \d+\/\d+ for 5 s at start$/)
            .count()) > 0
        )
          noted.add(n);

      // RotorHazard agrees: its log names the same seats with the same levels (the node alone;
      // the profile's levels are unchanged).
      const lines = (await rig.log('lowering EnterAt from')).slice(logBefore);
      expect(lines.join('\n')).toContain(
        'For node 2 lowering EnterAt from 100 to 94 and ExitAt from 80 to 74'
      );
      const logged = new Set(lines.map((l) => Number(/For node (\d+)/.exec(l)?.[1])));
      // Seat 1 streams an emulated signal that may sit above its enter at the start; every other seat must match.
      logged.delete(1);
      noted.delete(1);
      expect([...noted].sort()).toEqual([...logged].sort());
      const during = await rig.loadData<{ enter_at_levels: number[]; exit_at_levels: number[] }>(
        'enter_and_exit_at_levels'
      );
      expect([during.enter_at_levels[1], during.exit_at_levels[1]]).toEqual([100, 80]);

      await rig.stop();
      await rig.discard();
      await expect(card(page, 2).getByText('Lowered to 94/74 for 5 s at start')).toBeHidden();
    } finally {
      await rig.setLowering(low0.amount, low0.duration);
      await rig.setConfig('TIMING', 'calibrationMode', cal0);
      await rig.setSeatLevels(1, levels0.enter_at_levels[1], levels0.exit_at_levels[1]);
    }
  });
});
