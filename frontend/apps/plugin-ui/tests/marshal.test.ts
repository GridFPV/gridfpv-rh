import { describe, expect, it } from 'vitest';
import {
  addManualLap,
  cleanDeletedLaps,
  incrementalLapTimes,
  recalcLaps,
  recalcRace,
  setEnterThreshold,
  setExitThreshold,
  toggleLap,
  type MarshalLap,
  type MarshalRules
} from '../src/lib/race.js';

/**
 * QA's marshal reference (#56): one saved race with real RSSI history on the rig's seat 1,
 * recorded on RotorHazard 4.4.0's own Marshal page case by case (e2e/fixtures/marshal/*.json,
 * copied from the QA worktree). page_laps is what RotorHazard's page computed.
 */
// The fixtures, bundled by Vite (no node fs in the component test environment).
const FILES = import.meta.glob('../../../e2e/fixtures/marshal/*.json', {
  eager: true,
  import: 'default'
}) as Record<string, unknown>;
const file = (name: string): unknown => {
  const key = Object.keys(FILES).find((k) => k.endsWith(`/${name}.json`));
  if (!key) throw new Error(`fixture ${name} missing`);
  return FILES[key];
};
type FixLap = {
  stamp: number;
  time: number;
  deleted: boolean;
  source: number;
  peak: number | null;
};
type Fixture = {
  name: string;
  enter: number;
  exit: number;
  options?: { minLap?: number; behavior?: number; firstCrossing?: number };
  manualLapS?: number;
  deleteIndex?: number;
  clean?: boolean;
  page_laps: FixLap[];
  saved_laps: FixLap[];
};
const race = file('race') as {
  enter: number;
  exit: number;
  start_time: number;
  history_times: number[];
  history_values: number[];
};
const fixture = (name: string): Fixture => file(name) as Fixture;
const trace = { times: race.history_times, values: race.history_values };
/** The rig's lap options as the recorder set them (minLap 1 s, keep, no first-crossing gap). */
const rules = (o: Fixture['options'] = {}): MarshalRules => ({
  minLapMs: (o.minLap ?? 1) * 1000,
  minFirstCrossingMs: (o.firstCrossing ?? 0) * 1000,
  minLapBehavior: o.behavior ?? 0,
  unlimitedTime: false,
  raceTimeSec: 60
});
const show = (ls: Array<{ stampMs: number; deleted: boolean; source: number }>) =>
  ls.map((l) => `${Math.round(l.stampMs)}${l.deleted ? 'x' : ''}${l.source === 1 ? 'm' : ''}`);
const showFix = (ls: FixLap[]) =>
  ls.map((l) => `${l.stamp}${l.deleted ? 'x' : ''}${l.source === 1 ? 'm' : ''}`);
const recalc = (fx: Fixture) =>
  recalcRace(trace, fx.enter, fx.exit, race.start_time, rules(fx.options), []);

describe("marshal recalculation against RotorHazard's own Marshal page (QA fixtures, #56)", () => {
  it.each(['unchanged', 'enter-above-crossing', 'exit-merges', 'min-lap-highlight'])(
    '%s: the same laps, lap for lap, stamps within 1 ms',
    (name) => {
      const fx = fixture(name);
      const ours = recalc(fx);
      expect(show(ours)).toEqual(showFix(fx.page_laps));
      ours.forEach((l, i) => {
        expect(Math.abs(l.stampMs - fx.page_laps[i].stamp)).toBeLessThanOrEqual(1);
        if (!l.deleted) expect(Math.abs(l.timeMs - fx.page_laps[i].time)).toBeLessThanOrEqual(1);
      });
    }
  );
  it("ignore-crossings-before and min-lap-discard apply the event's options, which RotorHazard's page renders as 0 (PM decision on #56)", () => {
    const first = fixture('first-crossing-ignored');
    const ours = recalc(first);
    const gap = (first.options?.firstCrossing ?? 0) * 1000;
    expect(ours.map((l) => l.deleted)).toEqual(ours.map((l) => l.stampMs < gap));
    expect(ours.filter((l) => l.deleted).length).toBeGreaterThan(0);
    // RotorHazard's page deleted none (it read the option as 0); same stamps otherwise.
    expect(first.page_laps.every((l) => !l.deleted)).toBe(true);
    expect(ours.map((l) => Math.round(l.stampMs))).toEqual(first.page_laps.map((l) => l.stamp));

    const discard = fixture('min-lap-discard');
    const d = recalc(discard);
    const minLap = (discard.options?.minLap ?? 0) * 1000;
    let last = -Infinity;
    const expected = d.map((l) => {
      const short = l.stampMs < last + minLap;
      if (!short) last = l.stampMs;
      return short;
    });
    expect(d.map((l) => l.deleted)).toEqual(expected);
    expect(d.filter((l) => l.deleted).length).toBeGreaterThan(0);
    expect(discard.page_laps.every((l) => !l.deleted)).toBe(true);
  });
  it("adds a manual lap by time, kept through a recalculation, with RotorHazard's lap times", () => {
    const fx = fixture('manual-lap');
    const withManual = addManualLap(recalc(fx), fx.manualLapS!);
    expect(show(withManual)).toEqual(showFix(fx.page_laps));
    withManual.forEach((l, i) => {
      expect(Math.abs(l.timeMs - fx.page_laps[i].time)).toBeLessThanOrEqual(1);
    });
    // A later recalculation keeps the manual lap and merges it in by time.
    const again = recalcRace(trace, fx.enter, fx.exit, race.start_time, rules(), withManual);
    expect(show(again)).toEqual(showFix(fx.page_laps));
  });
  it('deletes a lap and cleans deleted laps away, as RotorHazard saves them', () => {
    const fx = fixture('delete-and-clean');
    const cleaned = cleanDeletedLaps(toggleLap(recalc(fx), fx.deleteIndex!));
    expect(show(cleaned)).toEqual(showFix(fx.page_laps));
    expect(cleaned.some((l) => l.deleted)).toBe(false);
    cleaned.forEach((l, i) =>
      expect(Math.abs(l.timeMs - fx.page_laps[i].time)).toBeLessThanOrEqual(1)
    );
  });
});

describe('marshal threshold and lap-time rules (marshal.js)', () => {
  it('clamps a threshold to the range and drags the other one along', () => {
    expect(setEnterThreshold(98, 80, 120)).toEqual({ enter: 120, exit: 80 });
    expect(setEnterThreshold(98, 80, 70)).toEqual({ enter: 80, exit: 70 });
    expect(setEnterThreshold(98, 80, 300)).toEqual({ enter: 255, exit: 80 });
    expect(setExitThreshold(98, 80, 60)).toEqual({ enter: 98, exit: 60 });
    expect(setExitThreshold(98, 80, 110)).toEqual({ enter: 110, exit: 98 });
    expect(setExitThreshold(98, 80, -5)).toEqual({ enter: 98, exit: 0 });
  });
  it('gives a deleted lap time 0 and measures the next counted lap from the last counted one', () => {
    const lap = (stampMs: number, deleted = false): MarshalLap => ({
      stampMs,
      timeMs: 0,
      deleted,
      source: 2,
      peakRssi: null
    });
    const out = incrementalLapTimes([lap(9000), lap(3000), lap(6000, true)]);
    expect(out.map((l) => [l.stampMs, l.timeMs])).toEqual([
      [3000, 3000],
      [6000, 0],
      [9000, 6000]
    ]);
    expect(recalcLaps(trace, 98, 80, race.start_time, rules()).length).toBe(14);
  });
});
