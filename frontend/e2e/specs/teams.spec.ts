import { expect, test } from '../src/fixtures.js';

test.describe('Teams', () => {
  test('a second team with the same name is refused with the reason, at once (#67)', async ({
    page,
    rig,
    rh
  }) => {
    for (const t of await rig.teams()) {
      const done = rig.next('gridfpv_teams');
      rig.emit('gridfpv_teams_delete', { id: t.id });
      await done;
    }
    await page.goto('/grid/teams');
    const create = async (name: string) => {
      await page.getByRole('button', { name: 'New team' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByPlaceholder('e.g. Red Rockets').fill(name);
      await dialog.getByRole('button', { name: /^(Create|Save)$/ }).click();
    };
    await create('Red');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await rig.teams()).map((t) => t.name)).toEqual(['Red']);

    const started = Date.now();
    await create('red');
    await expect(page.getByText('there is already a team called Red')).toBeVisible();
    expect(Date.now() - started).toBeLessThan(5000);
    // RotorHazard's plugin agrees: still one team.
    expect((await rig.teams()).map((t) => t.name)).toEqual(['Red']);
    expect(await rh.eventName()).toBeTruthy();
  });
});
