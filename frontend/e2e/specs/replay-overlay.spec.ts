import { expect, test } from '../src/fixtures.js';

/**
 * The replay-mode overlay (#96, phase 1): the race overlay drawn from a saved race at a
 * chosen race time, deterministic under `window.gridfpvReplay.seek`, and showing the laps as
 * they stand *after* a marshal — which is the whole point of re-rendering a recording.
 */
type Handle = {
  seek: (ms: number) => Promise<{ t: number; lapStamps: number[]; title: string; round: number }>;
  ready: () => Promise<{ lapStamps: number[]; heatId: number; round: number }>;
};
declare global {
  interface Window {
    gridfpvReplay?: Handle;
  }
}

test('Replay overlay: a saved race at time t, seekable, and the marshalled laps are what it shows', async ({
  page,
  rig
}) => {
  test.setTimeout(150_000);
  const ace = await rig.addPilot({ callsign: 'Ace' });
  const heat = await rig.addHeat({ name: 'Heat A', pilots: [null, ace] }); // seat 2: no emulated signal
  await rig.setMinLap(1);
  // Hole shot at 0.5 s, laps at 2.0 s and 3.6 s.
  await rig.raceHeat(heat, { 1: [500, 2000, 3600] });
  const saved = await rig.race(heat, 1);
  const stamps = saved.nodes
    .find((n) => n.node_index === 1)!
    .laps.map((l) => l.lap_time_stamp)
    .sort((a, b) => a - b);
  expect(stamps).toHaveLength(3);

  await page.goto(`/grid/live/race?heat=${heat}&round=1&t=1000`);
  const panel = page.getByLabel('Race overlay');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  await expect(panel).toContainText('Heat A · Round 1');
  await expect(panel).toContainText('LIVE');
  // No shell around it, and no laps yet at one second.
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Recent laps' })).toHaveCount(0);

  // The handle: the scored crossings are RotorHazard's own stamps (the hole shot is not one).
  const info = await page.evaluate(() => window.gridfpvReplay!.ready());
  expect(info.heatId).toBe(heat);
  expect(info.lapStamps).toEqual(stamps.slice(1));

  // Seek past the first lap: one lap, its time the gap between the two crossings.
  const after1 = await page.evaluate((ms) => window.gridfpvReplay!.seek(ms), stamps[1] + 50);
  expect(after1.t).toBe(stamps[1] + 50);
  const laps = page.getByRole('list', { name: 'Recent laps' });
  await expect(laps.locator('li')).toHaveCount(1);
  await expect(laps.locator('li').first()).toHaveText(/L1\s*0:01\.(49|50)\d/);
  // One millisecond before that crossing: no lap. Frame-exact, not "about then".
  await page.evaluate((ms) => window.gridfpvReplay!.seek(ms), stamps[1] - 1);
  await expect(laps).toHaveCount(0);
  // Determinism: the same race time draws the same panel, twice.
  await page.evaluate((ms) => window.gridfpvReplay!.seek(ms), 5000);
  await expect(laps.locator('li')).toHaveCount(2);
  const first = await panel.innerHTML();
  await page.evaluate((ms) => window.gridfpvReplay!.seek(ms), 1234);
  await page.evaluate((ms) => window.gridfpvReplay!.seek(ms), 5000);
  expect(await panel.innerHTML()).toBe(first);
  // Staging before zero.
  await page.evaluate((ms) => window.gridfpvReplay!.seek(ms), -1500);
  await expect(panel).toContainText('STAGING');

  // `end` freezes the clock where the race stopped.
  await page.goto(`/grid/live/race?heat=${heat}&round=1&t=9000&end=7000`);
  await expect(panel).toHaveAttribute('data-state', 'ready');
  await expect(panel).toContainText('FINISHED');
  const frozen = await panel.locator('.clock').textContent();
  await page.evaluate((ms) => window.gridfpvReplay!.seek(ms), 20000);
  expect(await panel.locator('.clock').textContent()).toBe(frozen);

  // A round that was never saved says so.
  await page.goto(`/grid/live/race?heat=${heat}&round=9`);
  await expect(panel).toHaveAttribute('data-state', 'missing', { timeout: 10_000 });
  await expect(panel).toContainText('no such saved race');

  // Placed in a bottom corner, the panel's head sits where it was put and the laps hang
  // below it, growing down — the clock never creeps up as laps come in (#96).
  await rig.setOverlayPlacement({ corner: 'bottom-right', x: 40, y: 30, scale: 150 });
  await page.goto(`/grid/live/race?heat=${heat}&round=1&t=5000`);
  await expect(panel).toHaveAttribute('data-state', 'ready');
  await expect(laps.locator('li')).toHaveCount(2);
  const geometry = () =>
    page.evaluate(() => {
      const head = document.querySelector('.headblock')!.getBoundingClientRect();
      const list = document.querySelector('.laps')!.getBoundingClientRect();
      return {
        headBottom: head.bottom,
        listTop: list.top,
        listBottom: list.bottom,
        vh: window.innerHeight
      };
    });
  const g2 = await geometry();
  // clientHeight is whole pixels and the head is scaled by 1.5: within a couple of pixels.
  expect(Math.abs(g2.vh - 30 - g2.headBottom)).toBeLessThan(3);
  // The list starts in the head's bottom padding (tucked 8 px, scaled) and runs on below it.
  expect(g2.listTop).toBeGreaterThanOrEqual(g2.headBottom - 14);
  expect(g2.listBottom).toBeGreaterThan(g2.headBottom);
  // One lap fewer: the head does not move; the list is shorter.
  await page.evaluate((ms) => window.gridfpvReplay!.seek(ms), stamps[1] + 50);
  await expect(laps.locator('li')).toHaveCount(1);
  const g1 = await geometry();
  expect(Math.abs(g1.headBottom - g2.headBottom)).toBeLessThan(1.5);
  expect(g1.listBottom).toBeLessThan(g2.listBottom);
  await rig.resetOverlayPlacement();

  // Marshal the race in Grid: the second crossing goes; RotorHazard's saved race agrees.
  await page.goto('/grid/marshal');
  const race = page.getByRole('combobox', { name: /^Race/ });
  await expect(race.locator('option')).not.toHaveCount(0);
  await race.selectOption({ index: 0 });
  const who = page.getByRole('combobox', { name: /^Pilot/ });
  const aceOption = who.locator('option', { hasText: 'Ace' });
  await expect(aceOption).toHaveCount(1);
  await who.selectOption((await aceOption.getAttribute('value')) ?? '');
  const rows = page.locator('table.laps tbody tr');
  await expect(rows).toHaveCount(3);
  await rows.nth(1).click();
  await page.getByRole('button', { name: 'Save laps' }).click();
  await expect(page.getByText('Laps saved; RotorHazard rebuilt the results.')).toBeVisible();
  const resaved = await rig.race(heat, 1);
  expect(resaved.nodes.find((n) => n.node_index === 1)!.laps.map((l) => l.deleted)).toEqual([
    false,
    true,
    false
  ]);

  // The replay now shows the race as marshalled: one lap, from the hole shot to the last
  // crossing, appearing only when that crossing happens.
  await page.goto(`/grid/live/race?heat=${heat}&round=1&t=${stamps[1] + 50}`);
  await expect(panel).toHaveAttribute('data-state', 'ready');
  await expect(laps).toHaveCount(0);
  const final = await page.evaluate((ms) => window.gridfpvReplay!.seek(ms), 5000);
  expect(final.lapStamps).toEqual([stamps[2]]);
  await expect(laps.locator('li')).toHaveCount(1);
  await expect(laps.locator('li').first()).toHaveText(/L1\s*0:03\.(09|10)\d/);

  // The Overlays page builds the same URL, and offers the video companion for Windows — a
  // zip that carries node.exe, shipped inside the plugin.
  await page.goto('/grid/overlays');
  // Replay and the companion are folded by default.
  await page.getByRole('button', { name: 'Video companion' }).click();
  // Two forms (#99): the desktop helper's installer lives on the releases page; the console
  // zip is inside the plugin.
  await expect(
    page.getByRole('link', { name: /GridFPV Video for Windows \(installer/ })
  ).toHaveAttribute('href', /github\.com\/GridFPV\/gridfpv-rh\/releases/);
  const dl = page.getByRole('link', { name: /Console companion \(zip/ });
  await expect(dl).toHaveAttribute('href', '/grid/downloads/gridfpv-video-win64.zip');
  const zip = await page.request.get('/grid/downloads/gridfpv-video-win64.zip');
  expect(zip.status()).toBe(200);
  expect(zip.headers()['content-type']).toContain('zip');
  const body = await zip.body();
  expect(body.length).toBeGreaterThan(10_000_000);
  expect(body.subarray(0, 2).toString()).toBe('PK');
  await page.getByRole('button', { name: 'Replay' }).click();
  await page.getByLabel('Seconds into the race').fill('12.5');
  await expect(page.getByLabel('Replay URL')).toHaveText(
    new RegExp(`/grid/live/race\\?heat=${heat}&round=1&t=12500$`)
  );
});
