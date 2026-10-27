import { expect, test } from '../src/fixtures.js';
import type { Rig } from '../src/rig.js';

/**
 * Heat advance: after a save RotorHazard loads the next heat by the stage's heat advance
 * type and round type (RHData.get_next_heat_id). The Run page follows its choice, says it in
 * words, and the Stages board marks the same race as next. All six combinations, each run
 * from the Run page; RotorHazard's current heat is the agrees step.
 */
const NONE = 0;
const NEXT_HEAT = 1;
const NEXT_ROUND = 2;
const PER_HEAT = 0;
const GROUPED = 1;

async function stage(rig: Rig, advance: number, roundType: number) {
  const ace = await rig.addPilot({ callsign: 'Ace' });
  const bee = await rig.addPilot({ callsign: 'Bee' });
  const cls = await rig.addClass({ name: 'E2E Advance', rounds: 2 });
  const h1 = await rig.addHeat({ name: 'H1', classId: cls, pilots: [null, ace, bee] });
  const h2 = await rig.addHeat({ name: 'H2', classId: cls, pilots: [null, bee, ace] });
  // Heats first: RotorHazard 4.4.0 raises on `rounds` for a grouped class without heats, and
  // switching to grouped forces advance "none" to "next heat", so the advance goes last.
  await rig.alterClass(cls, { roundType, heatAdvanceType: advance });
  await rig.setMinLap(1);
  return { cls, h1, h2 };
}

/** Race the loaded heat from the Run page: Start, two seats fly, Stop, Save. */
async function raceFromRunPage(page: Parameters<Parameters<typeof test>[2]>[0]['page'], rig: Rig) {
  await page.getByRole('button', { name: 'Start' }).click();
  await rig.until('racing', async () => (await rig.status()).race_status === 1, 30_000);
  await rig.fly({ 1: [300, 1600, 2900], 2: [500, 2400] }); // Ace 2 laps, Bee 1 lap
  await expect(page.locator('.seat', { hasText: 'Ace' }).locator('.laps .n')).toHaveText('2');
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Race saved.')).toBeVisible();
}

test.describe('Heat advance', () => {
  test('races per heat, no advance: the same heat again at round 2', async ({ page, rig }) => {
    test.setTimeout(90_000);
    const { h1 } = await stage(rig, NONE, PER_HEAT);
    await page.goto('/grid/run');
    await page.getByRole('combobox').first().selectOption(String(h1));
    await raceFromRunPage(page, rig);
    await expect(page.getByRole('status').filter({ hasText: /^Next:/ })).toHaveText(
      'Next: H1 again, round 2 of 2.'
    );
    await expect(page.locator('.sub').filter({ hasText: 'Round 2 of 2' })).toBeVisible();
    await page.goto('/grid/stages');
    await expect(
      page.locator('tr.heat', { hasText: 'H1' }).getByTitle('Loaded on the timer')
    ).toBeVisible();
    expect((await rig.status()).current_heat).toBe(h1);
  });

  test('races per heat, next heat: H2 at round 1', async ({ page, rig }) => {
    test.setTimeout(90_000);
    const { h1, h2 } = await stage(rig, NEXT_HEAT, PER_HEAT);
    await page.goto('/grid/run');
    await page.getByRole('combobox').first().selectOption(String(h1));
    await raceFromRunPage(page, rig);
    await expect(page.getByRole('status').filter({ hasText: /^Next:/ })).toHaveText(
      'Next: H2, round 1 of 2.'
    );
    await expect(page.getByRole('combobox').first()).toHaveValue(String(h2));
    await page.goto('/grid/stages');
    await expect(
      page.locator('tr.heat', { hasText: 'H2' }).getByTitle('Loaded on the timer')
    ).toBeVisible();
    expect((await rig.status()).current_heat).toBe(h2);
  });

  test('races per heat, next round: the heat stays until its rounds are flown, then H2', async ({
    page,
    rig
  }) => {
    test.setTimeout(120_000);
    const { h1, h2 } = await stage(rig, NEXT_ROUND, PER_HEAT);
    await rig.raceHeat(h1, { 1: [500, 2000], 2: [600, 2400] }); // round 1 of 2
    expect((await rig.status()).current_heat).toBe(h1); // RotorHazard stays on H1
    await page.goto('/grid/run');
    await expect(page.getByRole('combobox').first()).toHaveValue(String(h1));
    await expect(page.locator('.sub').filter({ hasText: 'Round 2 of 2' })).toBeVisible();
    await raceFromRunPage(page, rig);
    await expect(page.getByRole('status').filter({ hasText: /^Next:/ })).toHaveText(
      'Next: H2, round 1 of 2.'
    );
    await page.goto('/grid/stages');
    await expect(
      page.locator('tr.heat', { hasText: 'H2' }).getByTitle('Loaded on the timer')
    ).toBeVisible();
    expect((await rig.status()).current_heat).toBe(h2);
  });

  test('grouped rounds, no advance: nothing loaded (practice)', async ({ page, rig }) => {
    test.setTimeout(90_000);
    const { h1 } = await stage(rig, NONE, GROUPED);
    await page.goto('/grid/run');
    await page.getByRole('combobox').first().selectOption(String(h1));
    await raceFromRunPage(page, rig);
    await expect(page.getByRole('status').filter({ hasText: /^Next:/ })).toContainText(
      'Next: nothing loaded'
    );
    await expect(page.getByRole('combobox').first()).toHaveValue('0');
    await page.goto('/grid/stages');
    await expect(page.getByRole('heading', { name: 'E2E Advance' })).toBeVisible();
    await expect(page.getByTitle('Loaded on the timer')).toHaveCount(0);
    // RotorHazard agrees: no heat is current (its status says null for practice).
    expect((await rig.status()).current_heat ?? 0).toBe(0);
  });

  test('grouped rounds, next heat: H2 in Round 1', async ({ page, rig }) => {
    test.setTimeout(90_000);
    const { h1, h2 } = await stage(rig, NEXT_HEAT, GROUPED);
    await page.goto('/grid/run');
    await page.getByRole('combobox').first().selectOption(String(h1));
    await raceFromRunPage(page, rig);
    await expect(page.getByRole('status').filter({ hasText: /^Next:/ })).toHaveText(
      'Next: H2 in Round 1 of E2E Advance.'
    );
    await page.goto('/grid/stages');
    await expect(
      page.locator('.roundsection', { hasText: 'Round 1' }).getByTitle('Loaded on the timer')
    ).toBeVisible();
    expect((await rig.status()).current_heat).toBe(h2);
  });

  test("grouped rounds, next round: RotorHazard's copy of H1 in Round 2", async ({ page, rig }) => {
    test.setTimeout(90_000);
    const { cls, h1, h2 } = await stage(rig, NEXT_ROUND, GROUPED);
    await page.goto('/grid/run');
    await page.getByRole('combobox').first().selectOption(String(h1));
    await raceFromRunPage(page, rig);
    const copy = await rig.until('round 2 heat', async () =>
      (await rig.heats()).find((h) => h.class_id === cls && h.heat_id !== h1 && h.heat_id !== h2)
    );
    await expect(page.getByRole('status').filter({ hasText: /^Next:/ })).toHaveText(
      'Next: H1 in Round 2 of E2E Advance.'
    );
    await page.goto('/grid/stages');
    await expect(
      page.locator('.roundsection', { hasText: 'Round 2' }).getByTitle('Loaded on the timer')
    ).toBeVisible();
    expect((await rig.status()).current_heat).toBe(copy.heat_id);
  });
});

test('seat cards show position, lap count and last lap as RotorHazard ranks them', async ({
  page,
  rig
}) => {
  test.setTimeout(90_000);
  const { h1 } = await stage(rig, NONE, PER_HEAT);
  await page.goto('/grid/run');
  await page.getByRole('combobox').first().selectOption(String(h1));
  const ace = page.locator('.seat', { hasText: 'Ace' });
  const bee = page.locator('.seat', { hasText: 'Bee' });
  await expect(ace.locator('.pos .n')).toHaveText('—'); // nothing ranked while Ready
  await page.getByRole('button', { name: 'Start' }).click();
  await rig.until('racing', async () => (await rig.status()).race_status === 1, 30_000);
  await rig.fly({ 1: [300, 1600, 2900], 2: [500, 2400] });
  await expect(ace.locator('.laps .n')).toHaveText('2');
  await expect(bee.locator('.laps .n')).toHaveText('1');
  await expect(ace.locator('.pos .n')).toHaveText('P1');
  await expect(bee.locator('.pos .n')).toHaveText('P2');
  await expect(ace.locator('.last .n')).toHaveText(/^0:01\.[23]/); // 1.3 s lap
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Race saved.')).toBeVisible();
  // RotorHazard agrees: its saved leaderboard ranks Ace first with 2 laps, Bee second with 1.
  const saved = await rig.race(h1, 1);
  const board = (
    saved.leaderboard as {
      by_race_time: Array<{ callsign: string; position: number; laps: number }>;
    }
  ).by_race_time;
  expect(board.map((r) => [r.position, r.callsign, r.laps])).toEqual([
    [1, 'Ace', 2],
    [2, 'Bee', 1]
  ]);
});
