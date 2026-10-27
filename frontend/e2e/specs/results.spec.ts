import { expect, test } from '../src/fixtures.js';
import type { Page } from '@playwright/test';

/**
 * Results (#23): our Results page shows what RotorHazard's Results page shows, from the
 * same result_data. A race is saved, then marshalled on /grid/marshal (a manual lap added,
 * a lap deleted and restored, a recalculation with the thresholds, committed); both pages
 * are then read, board by board, and must agree cell for cell.
 */
type Row = {
  pos: string;
  pilot: string;
  laps: string;
  total: string;
  fast: string;
  consecutive: string;
};
const CELLS = ['pos', 'pilot', 'laps', 'total', 'fast', 'consecutive'] as const;
async function tableRows(page: Page, selector: string): Promise<Row[]> {
  return page
    .locator(selector)
    .first()
    .evaluate((table, cells) => {
      const cell = (tr: Element, c: string) =>
        tr.querySelector(`td.${c}`)?.textContent?.trim() ?? '';
      return Array.from(table.querySelectorAll('tbody tr'))
        .filter((tr) => tr.querySelector('td.pilot'))
        .map((tr) => Object.fromEntries(cells.map((c) => [c, cell(tr, c)])) as Row);
    }, CELLS);
}
const norm = (r: Row) => ({ ...r, pos: r.pos === '—' ? '-' : r.pos });

test("Results: a marshalled race shows on ours as on RotorHazard's Results page, board by board", async ({
  page,
  rig
}) => {
  test.setTimeout(180_000);
  const ace = await rig.addPilot({ callsign: 'Ace' });
  const bee = await rig.addPilot({ callsign: 'Bee' });
  const cls = await rig.addClass({ name: 'E2E Results', rounds: 2 });
  const heat = await rig.addHeat({ name: 'R1', classId: cls, pilots: [ace, bee] }); // Ace on seat 1: a real trace
  await rig.setMinLap(1);
  await rig.setHeat(heat);
  await rig.start();
  // Seat 1 streams the rig's emulated signal (a real trace, a varying number of crossings);
  // three hand-fed passes on it as well make the lap count deterministic enough, and those
  // passes (RotorHazard records them as manual) must survive the recalculation below.
  await rig.fly({ 0: [3000, 9000, 15000], 1: [2000, 8000, 14000] });
  await new Promise((r) => setTimeout(r, 4000));
  await rig.stop();
  await rig.save();

  // ---- marshal Ace's run: add, delete, restore, recalculate, commit ----
  await page.goto('/grid/marshal');
  const race = page.getByRole('combobox', { name: /^Race/ });
  await expect(race.locator('option')).not.toHaveCount(0);
  await race.selectOption({ index: 0 });
  const who = page.getByRole('combobox', { name: /^Pilot/ });
  await who.selectOption(
    (await who.locator('option', { hasText: 'Ace' }).getAttribute('value')) ?? ''
  );
  // Real lap rows only (the table shows one "No laps." row when there are none).
  const rows = page.locator('table.laps tbody tr', { has: page.locator('td:nth-child(5)') });
  await expect(rows.first()).toBeVisible();
  const before = await rows.count();
  expect(before).toBeGreaterThanOrEqual(3);
  await page.getByLabel('Manual lap time').fill('5');
  await page.getByRole('button', { name: 'Add lap' }).click();
  await expect(rows).toHaveCount(before + 1);
  await rows.nth(1).click();
  await expect(rows.nth(1)).toHaveClass(/deleted/);
  await rows.nth(1).click();
  await expect(rows.nth(1)).not.toHaveClass(/deleted/);
  const enter = page.getByLabel('Enter at');
  const e = Number(await enter.inputValue());
  await enter.fill(String(e + 1));
  await enter.press('Tab');
  await enter.fill(String(e));
  await enter.press('Tab');
  // Our 5.000 s lap (and the rig's hand-fed passes, which RotorHazard records as manual too)
  // survive the recalculation from the trace.
  await expect(page.locator('table.laps tbody tr', { hasText: '0:05.000' })).toContainText(
    'manual'
  );
  expect(
    await page.locator('table.laps tbody tr', { hasText: 'manual' }).count()
  ).toBeGreaterThanOrEqual(4);
  const countedAfter = await page
    .locator('table.laps tbody tr', { has: page.locator('td:nth-child(5)') })
    .evaluateAll((trs) => trs.filter((tr) => !tr.classList.contains('deleted')).length);
  await page.getByRole('button', { name: 'Save laps' }).click();
  await expect(page.getByText('Laps saved; RotorHazard rebuilt the results.')).toBeVisible();

  // ---- ours ----
  await page.goto('/grid/results');
  const stage = page.getByLabel('E2E Results', { exact: true });
  await expect(stage).toBeVisible();
  await stage.getByRole('button', { name: 'R1' }).click();
  const oursRound = await tableRows(page, '[aria-label="R1"] [data-round="1"] table.leaderboard');
  const oursClass = await tableRows(page, '[aria-label="E2E Results"] table.leaderboard');
  expect(oursRound.map((r) => r.pilot).sort()).toEqual(['Ace', 'Bee']);
  // Laps on the board: what the marshal table holds minus the hole shot (counted laps − 1).
  expect(oursRound.find((r) => r.pilot === 'Ace')?.laps).toBe(String(countedAfter - 1));

  // ---- RotorHazard agrees: its Results page, same boards, same cells ----
  const theirs = await page.context().newPage();
  await theirs.goto(rig.url + '/results');
  // RotorHazard ids its panels by index (class_0_heat_0_round_1), so find the class panel by
  // its header text; its round and class-summary panels are collapsed (attached, not visible).
  const classPanel = theirs
    .locator('.panel', { has: theirs.locator('.panel-header button', { hasText: 'E2E Results' }) })
    .first();
  await classPanel
    .locator('.round.panel table.leaderboard')
    .first()
    .waitFor({ state: 'attached', timeout: 20_000 });
  const theirRound = await classPanel
    .locator('.round.panel table.leaderboard')
    .first()
    .evaluate((table, cells) => {
      const cell = (tr: Element, c: string) =>
        tr.querySelector(`td.${c}`)?.textContent?.trim() ?? '';
      return Array.from(table.querySelectorAll('tbody tr'))
        .filter((tr) => tr.querySelector('td.pilot'))
        .map((tr) => Object.fromEntries(cells.map((c) => [c, cell(tr, c)])) as Row);
    }, CELLS);
  const theirClass = await classPanel
    .locator('.class-leaderboard table.leaderboard')
    .first()
    .evaluate((table, cells) => {
      const cell = (tr: Element, c: string) =>
        tr.querySelector(`td.${c}`)?.textContent?.trim() ?? '';
      return Array.from(table.querySelectorAll('tbody tr'))
        .filter((tr) => tr.querySelector('td.pilot'))
        .map((tr) => Object.fromEntries(cells.map((c) => [c, cell(tr, c)])) as Row);
    }, CELLS);
  await theirs.close();
  expect(oursRound.map(norm)).toEqual(theirRound.map(norm));
  expect(oursClass.map(norm)).toEqual(theirClass.map(norm));
  // … and its saved race holds the marshalled laps the boards were built from (the manual
  // lap at exactly 5000 ms, source manual).
  const saved = await rig.race(heat, 1);
  const seat = saved.nodes.find((n) => n.node_index === 0)!;
  expect(
    seat.laps.some(
      (l) =>
        Math.round(l.lap_time_stamp) === 5000 && (l as unknown as { source: number }).source === 1
    )
  ).toBe(true);
  expect(seat.laps.filter((l) => !l.deleted).length - 1).toBe(
    Number(oursRound.find((r) => r.pilot === 'Ace')?.laps)
  );
  console.log(
    `[results] round 1: ${oursRound.map((r) => `${r.pos} ${r.pilot} ${r.laps} ${r.total}`).join(' | ')}`
  );
});
