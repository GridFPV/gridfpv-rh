import { expect, test } from '../src/fixtures.js';

/**
 * The race clock (#39) against RotorHazard's own Run page clock, both open in the same
 * browser on the same race: sampled together once a second, they agree within 0.1 s.
 */
/** A clock display as whole tenths: "m:ss.t" or "mm:ss.t", ours and RotorHazard's; '-' is time over. */
function tenths(text: string): number {
  const m = /(-?)(\d+):(\d\d)\.(\d)/.exec(text);
  if (!m) throw new Error(`not a clock: "${text}"`);
  const v = Number(m[2]) * 600 + Number(m[3]) * 10 + Number(m[4]);
  return m[1] ? -v : v;
}

test.describe('Run clock', () => {
  test("the Run page clock agrees with RotorHazard's own within 0.1 s", async ({
    page,
    context,
    rig
  }) => {
    test.setTimeout(90_000);
    const ace = await rig.addPilot({ callsign: 'Ace' });
    const cls = await rig.addClass({ name: 'E2E Clock' });
    const heat = await rig.addHeat({ name: 'Heat C', classId: cls, pilots: [null, ace] });
    await rig.setHeat(heat);

    const rhPage = await context.newPage();
    await rhPage.goto('/run');
    await page.goto('/grid/run');
    // Both pages sample RotorHazard's clock (pi_time) for a few seconds before they are exact.
    await page.waitForTimeout(3500);
    await expect(page.getByLabel('Race clock')).toBeVisible();

    await rig.start();
    const ours = page.getByLabel('Race clock').locator('.time');
    const theirs = rhPage.locator('.time-display').first();
    const deltas: number[] = [];
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(1000);
      // Both reads go out together; the two pages still answer a few ms apart, so the
      // displays may sit one tenth apart (their granularity). Whole tenths, no float drift.
      const [a, b] = await Promise.all([ours.textContent(), theirs.textContent()]);
      deltas.push(Math.abs(tenths(a ?? '') - tenths(b ?? '')));
    }
    await rig.stop();
    await rig.discard();
    // RotorHazard agrees: the two clocks read the same race, within 0.1 s (one tenth).
    expect(Math.max(...deltas)).toBeLessThanOrEqual(1);
    expect((await rig.status()).race_status).toBe(0);
  });
});
