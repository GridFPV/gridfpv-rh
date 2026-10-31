import { expect, test } from '../src/fixtures.js';

/**
 * RaceGOW mode (#95): seasons, tracks and runs in racegow's words, mapped onto
 * RotorHazard's event, classes, heats and rounds. The pilot never meets a class.
 */
test('RaceGOW: a new season, the pilot, two tracks — and RotorHazard holds the mapping', async ({
  page,
  rig,
  rh
}) => {
  // A season, two tracks, the seat flow and the names: long, by design one story.
  test.setTimeout(240_000);
  await rig.setMode('racegow');
  await page.goto('/grid/');
  // The nav is the lean one; Home is racegow's.
  const nav = page.getByRole('navigation');
  await expect(nav.getByRole('link', { name: 'Run' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Stages' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'RaceGOW', level: 1 })).toBeVisible();

  // A new season: the event is archived and renamed, the number recorded.
  await page.getByRole('button', { name: 'New season…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Season number').fill('2');
  await dialog.getByRole('button', { name: 'Start season' }).click();
  await expect(page.getByText(/^Season 2 started\./)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Season 2', level: 1 })).toBeVisible();
  expect((await rig.options())['eventName']).toBe('RaceGOW Season 2');

  // You: a callsign; the pilot is made in the event when the first track needs them.
  await page.getByLabel('Callsign').fill('Ryan');
  await page.getByRole('button', { name: 'Save pilot' }).click();
  await expect(page.getByText('Pilot saved.')).toBeVisible();

  // Two tracks: numbered 1 then 2, each loaded on the timer as it is made.
  await page.getByRole('button', { name: /^New track · Track 1$/ }).click();
  await expect(page.getByText('Track 1 is on the timer.')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /^New track · Track 2$/ }).click();
  await expect(page.getByText('Track 2 is on the timer.')).toBeVisible({ timeout: 30_000 });
  const list = page.getByRole('list', { name: 'Tracks' });
  await expect(list.locator('li').first()).toContainText('Track 2');
  await expect(list.locator('li').first()).toContainText('on the timer');
  await expect(list.locator('li').nth(1)).toContainText('Track 1');

  // RotorHazard agrees, class by class: Track 2 is a class with unlimited rounds that
  // stays on its one heat, named for the season and track, with Ryan on a seat; it is
  // the loaded heat; the RaceGOW format has no time limit and ranks by consecutive laps.
  const classes = await rig.classes();
  const t1 = classes.find((c) => c.name === 'Track 1')!;
  const t2 = classes.find((c) => c.name === 'Track 2')!;
  expect(t1 && t2).toBeTruthy();
  const data = (await rig.classData()).find((c) => c.id === t2.id)!;
  expect(Number(data.rounds)).toBe(0);
  expect(Number(data.heat_advance_type)).toBe(0);
  const heats = await rig.heats();
  const h2 = heats.find((h) => h.class_id === t2.id)!;
  expect(h2.displayname).toBe('RaceGOW 2 Track 2');
  const ryan = (await rig.pilots()).find((p) => p.callsign === 'Ryan') as
    { pilot_id?: number; id?: number } | undefined;
  expect(ryan).toBeTruthy();
  expect(Object.values(h2.nodes_pilots)).toContain(ryan!.pilot_id ?? ryan!.id);
  const current = await rig.loadData<{ current_heat: number }>('current_heat');
  expect(current.current_heat).toBe(h2.heat_id);
  const fmt = (await rig.formats()).find((f) => f.name === 'RaceGOW') as
    { win_condition?: number; unlimited_time?: number } | undefined;
  expect(fmt).toBeTruthy();
  expect(Number(fmt!.win_condition)).toBe(4);
  expect(Number(fmt!.unlimited_time)).toBe(1);
  expect(await rh.formatClassNames()).toEqual(expect.arrayContaining(['Track 1', 'Track 2']));
  // Making a track put RotorHazard's minimum-lap rule on discard.
  expect(
    Number((await rig.loadData<{ min_lap_behavior: number }>('min_lap')).min_lap_behavior)
  ).toBe(1);

  // Names: the template is refused until it can name a run and a file, then saved and
  // previewed for the next run of the track on the timer. (The RotorHazard-agrees check
  // above walked this page to RotorHazard's Format page; back to ours.)
  await page.goto('/grid/');
  const tpl = page.getByLabel('Run name template');
  await tpl.fill('Run {round}: {track}');
  await expect(page.getByRole('alert')).toContainText('cannot be in a name');
  await tpl.fill('S{season} {track} R{round}');
  await page.getByRole('button', { name: 'Save names' }).click();
  await expect(page.getByText('Names saved.')).toBeVisible();
  await expect(page.getByLabel('Name preview')).toHaveText('S2 Track 2 R1');
  expect(JSON.parse((await rig.options())['gridfpv_racegow'] ?? '{}').name_template).toBe(
    'S{season} {track} R{round}'
  );

  // Run: pick seat 2. A RaceGOW profile appears and is active, every other seat is off in
  // it, and Ryan moves to seat 2 on the track that is on the timer. (The fixture drops the
  // profile again before the next spec.)
  await page.goto('/grid/run');
  await page.getByRole('combobox', { name: 'Seat' }).selectOption('1');
  await expect(
    page.getByText('Seat set; the other seats are off in the RaceGOW profile.')
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole('status').filter({ hasText: 'RaceGOW profile active.' })
  ).toBeVisible();
  const profiles = await rig.profiles();
  expect(profiles.names[profiles.ids.indexOf(profiles.current)]).toBe('RaceGOW');
  const freqs = await rig.frequencies();
  expect(freqs.filter((f, i) => i !== 1 && f.frequency > 0)).toEqual([]);
  expect(freqs[1].frequency).toBeGreaterThan(0);
  const h2after = (await rig.heats()).find((h) => h.heat_id === h2.heat_id)!;
  expect(h2after.nodes_pilots['1']).toBe(ryan!.pilot_id ?? ryan!.id);
  expect(h2after.nodes_pilots['0'] ?? 0).not.toBe(ryan!.pilot_id ?? ryan!.id);
});
