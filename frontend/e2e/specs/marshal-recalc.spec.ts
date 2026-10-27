import { expect, test } from '../src/fixtures.js';
import type { Page } from '@playwright/test';
import type { Rig } from '../src/rig.js';

/**
 * Marshal recalculation (#23, #56): one saved race with real RSSI history (the rig's seat 1
 * streams an emulated signal), re-marshalled case by case on /grid/marshal. For the cases
 * RotorHazard's own Marshal page gets right (thresholds unchanged, enter raised, exit lowered
 * so crossings merge, minimum lap set to highlight) ours must match its page lap for lap and
 * save the same laps. For "ignore crossings before" and "minimum lap, discard" RotorHazard
 * 4.4.0's page renders both options as 0 and ignores them (PM decision on #56): ours applies
 * the event's options, and the agrees step is RotorHazard's saved race after our commit and
 * its Results page.
 */
type Lap = { stamp: number; time: number; deleted: boolean; source: number };
const show = (ls: Lap[]) =>
  ls.map((l) => `${l.stamp}${l.deleted ? 'x' : ''}${l.source === 1 ? 'm' : ''}`);

async function apiLaps(rig: Rig, heat: number, round: number, seat: number): Promise<Lap[]> {
  const race = await rig.race(heat, round);
  const node = race.nodes.find((n) => n.node_index === seat)!;
  return node.laps.map((l) => ({
    stamp: Math.round(Number(l.lap_time_stamp)),
    time: Math.round(Number(l.lap_time ?? 0)),
    deleted: !!l.deleted,
    source: Number((l as unknown as { source: number }).source)
  }));
}

// ---- RotorHazard's own Marshal page, the oracle for the cases it gets right ----
async function rhLoad(page: Page, rig: Rig, heat: number, round: number, pilotId: number) {
  await page.goto(rig.url + '/marshal');
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('#selected_heat option')).some(
        (o) => (o as HTMLOptionElement).value !== '--'
      ),
    null,
    { timeout: 15_000 }
  );
  const pick = (sel: string, value: string) =>
    page.evaluate(
      ([s, v]) => {
        const el = document.querySelector(s) as HTMLSelectElement;
        el.value = v;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      },
      [sel, value]
    );
  await pick('#selected_heat', String(heat));
  await page.waitForTimeout(600);
  await pick('#selected_round', String(round));
  await page.waitForTimeout(600);
  const opt = await page
    .locator(`#selected_pilot option[data-pilot-id="${pilotId}"]`)
    .getAttribute('value');
  await pick('#selected_pilot', opt!);
  await page.waitForFunction(
    () =>
      (window as unknown as { marshal: { race: { history_values: unknown } } }).marshal?.race
        ?.history_values != null,
    null,
    { timeout: 15_000 }
  );
  await page.waitForTimeout(500);
}
const rhLaps = (page: Page): Promise<Lap[]> =>
  page.evaluate(() =>
    (
      window as unknown as { marshal: { race: { laps: Array<Record<string, unknown>> } } }
    ).marshal.race.laps.map((l) => ({
      stamp: Math.round(Number(l.lap_time_stamp)),
      time: Math.round(Number(l.lap_time ?? 0)),
      deleted: !!l.deleted,
      source: Number(l.source)
    }))
  );
async function rhSet(page: Page, enter: number, exit: number) {
  await page.fill('#exitat', String(exit));
  await page.dispatchEvent('#exitat', 'change');
  await page.waitForTimeout(400);
  await page.fill('#enterat', String(enter));
  await page.dispatchEvent('#enterat', 'change');
  await page.waitForTimeout(400);
}
async function rhSave(page: Page, rig: Rig) {
  const done = rig.next<{ message: string }>('priority_message', 10_000).catch(() => null);
  await page.click('#save-laps');
  await done;
  await page.waitForTimeout(600);
}

// ---- ours ----
async function gridLoad(page: Page, callsign: string) {
  await page.goto('/grid/marshal');
  const race = page.getByRole('combobox', { name: /^Race/ });
  await expect(race.locator('option')).not.toHaveCount(0);
  await race.selectOption({ index: 0 });
  const who = page.getByRole('combobox', { name: /^Pilot/ });
  const opt = who.locator('option', { hasText: callsign });
  await who.selectOption((await opt.first().getAttribute('value')) ?? '');
  await expect(page.locator('table.laps tbody tr').first()).toBeVisible();
}
async function gridLaps(page: Page): Promise<Lap[]> {
  const rows = await page.locator('table.laps tbody tr').evaluateAll((trs) =>
    trs.map((tr) => ({
      cells: Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim() ?? ''),
      deleted: tr.classList.contains('deleted')
    }))
  );
  const toMs = (s: string) => {
    const m = /(\d+):(\d\d)\.(\d{1,3})/.exec(s);
    return m ? (Number(m[1]) * 60 + Number(m[2])) * 1000 + Number(m[3].padEnd(3, '0')) : NaN;
  };
  const src: Record<string, number> = { timer: 0, manual: 1, recalc: 2, auto: 3, api: 4 };
  return rows
    .filter((r) => r.cells.length >= 5)
    .map((r) => ({
      stamp: toMs(r.cells[2]),
      time: r.deleted ? 0 : toMs(r.cells[1]),
      deleted: r.deleted,
      source: src[r.cells[4]] ?? -1
    }));
}
async function gridSet(page: Page, enter: number, exit: number) {
  // Exit first when it goes down, enter first when it goes up: a threshold never crosses the other.
  const cur = {
    enter: Number(await page.getByLabel('Enter at').inputValue()),
    exit: Number(await page.getByLabel('Exit at').inputValue())
  };
  const set = async (label: string, v: number) => {
    const el = page.getByLabel(label);
    await el.fill(String(v));
    await el.press('Tab');
    await page.waitForTimeout(300);
  };
  if (exit < cur.exit) await set('Exit at', exit);
  if (enter !== cur.enter) await set('Enter at', enter);
  if (exit > cur.exit) await set('Exit at', exit);
  if (enter === cur.enter && exit === cur.exit) {
    await set('Enter at', enter + 1);
    await set('Enter at', enter);
  }
}
const sameLaps = (a: Lap[], b: Lap[], tol: number) => {
  expect(show(a)).toEqual(show(b));
  a.forEach((l, i) => {
    expect(Math.abs(l.stamp - b[i].stamp)).toBeLessThanOrEqual(tol);
    if (!l.deleted) expect(Math.abs(l.time - b[i].time)).toBeLessThanOrEqual(tol);
  });
};

test("marshal recalculation: RotorHazard's page lap for lap where it is right, the event's options where its page is not (#56)", async ({
  browser,
  page,
  rig,
  rh
}) => {
  test.setTimeout(420_000);
  // ---- one saved race with a real trace on seat 1 ----
  // Seat 1's thresholds survive the rig's resets; pin them so the emulated signal crosses.
  await rig.setSeatLevels(0, 90, 80);
  const ace = await rig.addPilot({ callsign: 'Ace' });
  const bee = await rig.addPilot({ callsign: 'Bee' });
  const std = (await rig.formats()).find((f) => /2:00 Standard/.test(f.name))!;
  rig.emit('alter_race_format', {
    format_id: std.id,
    race_time_sec: 60,
    lap_grace_sec: -1,
    start_delay_min_ms: 1000,
    start_delay_max_ms: 0
  });
  await rig.until(
    '60 s format',
    async () =>
      (
        await rig.api<{ formats: Array<{ id: number; race_time_sec: number }> }>('/api/format/all')
      ).formats.find((f) => f.id === std.id)?.race_time_sec === 60
  );
  const cls = await rig.addClass({ name: 'Marshal', formatId: std.id, rounds: 2 });
  const heat = await rig.addHeat({ name: 'M1', classId: cls, pilots: [ace, bee] });
  const options = async (o: { minLap?: number; behavior?: number; firstCrossing?: number }) => {
    await rig.setLapOptions({
      minLap: o.minLap ?? 1,
      behavior: o.behavior ?? 0,
      minFirstCrossing: o.firstCrossing ?? 0
    });
    await new Promise((r) => setTimeout(r, 600));
  };
  await options({});
  await rig.setHeat(heat);
  await rig.start();
  await rig.fly({ 1: [2000, 8000, 15000, 22000, 30000, 38000] });
  await new Promise((r) => setTimeout(r, 8000));
  await rig.stop();
  const saved = await rig.save();
  const round = saved.round_id;

  const ctx = await browser.newContext({
    httpCredentials: { username: 'admin', password: 'rotorhazard' }
  });
  const their = await ctx.newPage();
  await rhLoad(their, rig, heat, round, ace);
  const race = await their.evaluate(() => {
    const m = (
      window as unknown as {
        marshal: { race: Record<string, unknown>; getRaceData: () => Record<string, unknown> };
      }
    ).marshal;
    return {
      enter: Number(m.race.enter_at),
      exit: Number(m.race.exit_at),
      start: Number(m.race.start_time),
      times: m.race.history_times as number[],
      values: m.race.history_values as number[],
      original: m.getRaceData()
    };
  });
  await rhSet(their, race.enter, race.exit);
  const base = await rhLaps(their);
  expect(base.length).toBeGreaterThan(3);
  // thresholds for the cases, from the recorded crossings (as QA's recorder derives them)
  const peaks = (await their.evaluate(() =>
    (
      window as unknown as { marshal: { race: { laps: Array<{ peak_rssi?: number }> } } }
    ).marshal.race.laps
      .map((l) => l.peak_rssi)
      .filter((p) => p != null)
  )) as number[];
  const sortedPeaks = [...peaks].sort((x, y) => x - y);
  const enterAbove = sortedPeaks[Math.floor(sortedPeaks.length / 2)] + 1;
  let trough = 255;
  const a = base[0].stamp / 1000 + race.start;
  const b = base[1].stamp / 1000 + race.start;
  for (let i = 0; i < race.values.length; i++)
    if (race.times[i] > a && race.times[i] < b) trough = Math.min(trough, race.values[i]);
  const gaps = base.slice(1).map((l, i) => l.stamp - base[i].stamp);
  const shortest = Math.min(...gaps);
  const restore = async () => {
    rig.emit('resave_laps', race.original);
    await new Promise((r) => setTimeout(r, 1200));
  };

  type Case = {
    name: string;
    enter: number;
    exit: number;
    options?: { minLap?: number; behavior?: number; firstCrossing?: number };
    oracle: 'page' | 'options';
  };
  const cases: Case[] = [
    { name: 'unchanged', enter: race.enter, exit: race.exit, oracle: 'page' },
    { name: 'enter raised above crossings', enter: enterAbove, exit: race.exit, oracle: 'page' },
    {
      name: 'exit lowered so crossings merge',
      enter: race.enter,
      exit: Math.max(1, trough - 1),
      oracle: 'page'
    },
    {
      name: 'minimum lap, highlight',
      enter: race.enter,
      exit: race.exit,
      options: { minLap: Math.ceil(shortest / 1000) + 1, behavior: 0 },
      oracle: 'page'
    },
    {
      name: 'ignore crossings before',
      enter: race.enter,
      exit: race.exit,
      options: { firstCrossing: Math.ceil(base[0].stamp / 1000) + 1 },
      oracle: 'options'
    },
    {
      name: 'minimum lap, discard',
      enter: race.enter,
      exit: race.exit,
      options: { minLap: Math.ceil(shortest / 1000) + 1, behavior: 1 },
      oracle: 'options'
    }
  ];
  for (const c of cases) {
    await options(c.options ?? {});
    let theirPage: Lap[] = [];
    let theirSaved: Lap[] = [];
    if (c.oracle === 'page') {
      await restore();
      await rhLoad(their, rig, heat, round, ace);
      await rhSet(their, c.enter, c.exit);
      theirPage = await rhLaps(their);
      await rhSave(their, rig);
      theirSaved = await apiLaps(rig, heat, round, 0);
    }
    await restore();
    await gridLoad(page, 'Ace');
    await gridSet(page, c.enter, c.exit);
    const ours = await gridLaps(page);
    if (c.oracle === 'page') {
      sameLaps(theirPage, ours, 1); // RotorHazard's page and ours, lap for lap
    } else if (c.options?.firstCrossing != null) {
      const gap = c.options.firstCrossing * 1000;
      expect(ours.map((l) => l.deleted)).toEqual(ours.map((l) => l.stamp < gap));
      expect(ours.filter((l) => l.deleted).length).toBeGreaterThan(0);
    } else {
      const minLap = (c.options!.minLap ?? 0) * 1000;
      let last = -Infinity;
      const expected = ours.map((l) => {
        const short = l.stamp < last + minLap;
        if (!short) last = l.stamp;
        return short;
      });
      expect(ours.map((l) => l.deleted)).toEqual(expected);
      expect(ours.filter((l) => l.deleted).length).toBeGreaterThan(0);
    }
    await page.getByRole('button', { name: 'Save laps' }).click();
    await expect(page.getByText('Laps saved; RotorHazard rebuilt the results.')).toBeVisible();
    const oursSaved = await apiLaps(rig, heat, round, 0);
    // RotorHazard agrees: what it holds after our commit is what we showed (and, where its page
    // is right, what its own page saved).
    sameLaps(ours, oursSaved, 1);
    if (c.oracle === 'page') sameLaps(theirSaved, oursSaved, 1);
    console.log(`[marshal] ${c.name}: ${show(ours).join(' ')}`);
  }
  await rh.expectResultsToMention('M1');
  await ctx.close();
});
