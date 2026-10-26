import { expect, test } from '../src/fixtures.js';

test.describe('Seats', () => {
  test("a channel picked in Grid is the seat's frequency in RotorHazard", async ({ page, rig }) => {
    await page.goto('/grid/seats');
    await expect(page.getByRole('heading', { name: 'Seats' })).toBeVisible();
    const seat1 = page.locator('.grid').getByText('Seat 1').locator('..').locator('..');
    const picker = seat1.locator('select').first();
    await expect(picker).toBeVisible();
    const was = (await rig.frequencies())[0];
    const want =
      was.band === 'R' && was.channel === 8
        ? { label: 'R7 · 5880', band: 'R', channel: 7, frequency: 5880 }
        : { label: 'R8 · 5917', band: 'R', channel: 8, frequency: 5917 };
    await picker.selectOption({ label: want.label });

    await expect(page.getByText('RotorHazard confirmed the change.')).toBeVisible();
    const f = await rig.frequencies();
    expect(f[0]).toMatchObject({
      band: want.band,
      channel: want.channel,
      frequency: want.frequency
    });
  });
});
