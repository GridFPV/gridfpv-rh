import { expect, test } from '../src/fixtures.js';

/**
 * RaceGOW mode's Results (#95): the track on the timer only — its best lap and best 3
 * consecutive, each with the run it came from, and every run newest first, a run opening
 * onto its laps. The figures are RotorHazard's own class board.
 */
test('RaceGOW results: one track, its bests with their run, runs newest first with laps', async ({
  page,
  rig
}) => {
  test.setTimeout(120_000);
  await rig.setMode('racegow');
  const ryan = await rig.addPilot({ callsign: 'Ryan' });
  const cls = await rig.addClass({ name: 'Track 1' });
  await rig.alterClass(cls, { heatAdvanceType: 0 });
  // Seat 1 carries the rig's emulated signal; fly seat 2.
  const heat = await rig.addHeat({ name: 'RaceGOW 1 Track 1', classId: cls, pilots: [null, ryan] });
  await rig.setMinLap(1);
  // Run 1: two laps. Run 2: four laps, the better best lap and the only best-3.
  await rig.raceHeat(heat, { 1: [500, 2000, 3600] });
  await rig.raceHeat(heat, { 1: [500, 1800, 3100, 4500, 5900] });
  expect((await rig.rounds()).find((h) => h.id === heat)?.rounds).toBe(2);

  await page.goto('/grid/results');
  await expect(page.getByRole('heading', { name: /^Track 1 · Season/ })).toBeVisible();
  // RotorHazard's own stamps on the rig's injected passes wander by a millisecond.
  await expect(page.getByLabel('Best lap')).toContainText(/0:01\.(29|30)\d/);
  await expect(page.getByLabel('Best lap')).toContainText('Run 2');
  await expect(page.getByLabel('Best 3 consecutive')).toContainText('Run 2');
  await expect(page.getByLabel('Runs', { exact: true }).first()).toContainText('2');

  const runs = page.getByRole('list', { name: 'Runs' });
  await expect(runs.locator('li').first()).toContainText('Run 2');
  await expect(runs.locator('li').first()).toContainText('best 3');
  await expect(runs.locator('li').nth(1)).toContainText('Run 1');
  // Nothing of the event or other classes is on the page.
  await expect(page.getByText('Overall')).toHaveCount(0);
  await expect(page.getByText('Event totals')).toHaveCount(0);

  // A run opens onto its laps, as RotorHazard counts them (no hole shot).
  await runs.getByRole('button', { name: /^Run 2/ }).click();
  const laps = page.getByRole('list', { name: 'Laps of run 2' });
  await expect(laps.locator('li')).toHaveCount(4);
  // The board's figure is RotorHazard's stored lap time; the list is rebuilt from the
  // crossing stamps, which can differ by a millisecond — so to the hundredth.
  await expect(laps.locator('li').first()).toHaveText(/L1\s*0:01\.(29|30)\d/);

  // RotorHazard agrees: its saved race for run 2 holds those four laps, and its class
  // board's best-3 is what the page shows.
  const saved = await rig.race(heat, 2);
  const seat = saved.nodes.find((n) => n.node_index === 1)!;
  expect(seat.laps.filter((l) => !l.deleted)).toHaveLength(5);
  const best3Text = (await page.getByLabel('Best 3 consecutive').textContent()) ?? '';
  const resultData = await rig.loadData<{
    classes: Record<string, { leaderboard: { by_consecutives: Array<{ consecutives: string }> } }>;
  }>('result_data');
  const theirs = resultData.classes[String(cls)].leaderboard.by_consecutives[0].consecutives;
  expect(best3Text).toContain(theirs);
});
