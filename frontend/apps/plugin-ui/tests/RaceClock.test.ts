import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import RaceClock from '../src/components/RaceClock.svelte';
import { emptyRaceStatus, RACE_STATUS, type RaceStatus } from '../src/lib/race.js';

// RotorHazard's clock minus ours is 0 here, so startsAt (seconds) maps straight onto `now` (ms).
const timed30 = (status: number, startsAt: number): RaceStatus => ({
  ...emptyRaceStatus(),
  status,
  unlimitedTime: false,
  raceTimeSec: 30,
  startsAt,
  stagingAt: startsAt - 3
});
const text = (c: HTMLElement, sel: string) => c.querySelector(sel)?.textContent?.trim() ?? '';

describe('RaceClock', () => {
  it('counts down the staging seconds before the start', () => {
    const { container } = render(RaceClock, {
      race: timed30(RACE_STATUS.STAGING, 10),
      differential: 0,
      now: 7_400,
      frozenAt: null
    });
    expect(container.querySelector('.raceclock')?.getAttribute('data-phase')).toBe('staging');
    expect(text(container, '.time')).toBe('0:02.6');
    expect(text(container, '.label')).toBe('staging');
    expect(container.querySelector('.elapsed')).toBeNull();
  });

  it('shows remaining time live, with the elapsed line under it', () => {
    const { container } = render(RaceClock, {
      race: timed30(RACE_STATUS.RACING, 10),
      differential: 0,
      now: 15_000,
      frozenAt: null
    });
    expect(container.querySelector('.raceclock')?.getAttribute('data-phase')).toBe('racing');
    expect(text(container, '.time')).toBe('0:25.0');
    expect(text(container, '.elapsed')).toBe('0:05.0 elapsed');
    expect(text(container, '.label')).toBe('remaining');
  });

  it('goes to time up when a timed race runs over', () => {
    const { container } = render(RaceClock, {
      race: timed30(RACE_STATUS.RACING, 10),
      differential: 0,
      now: 42_000,
      frozenAt: null
    });
    expect(container.querySelector('.raceclock')?.getAttribute('data-phase')).toBe('overtime');
    expect(text(container, '.time')).toBe('-0:02.0');
    expect(text(container, '.label')).toBe('time up');
  });

  it('counts up for a format with no time limit, and freezes where the race stopped', () => {
    const race = { ...timed30(RACE_STATUS.RACING, 10), unlimitedTime: true, raceTimeSec: 0 };
    const live = render(RaceClock, { race, differential: 0, now: 73_500, frozenAt: null });
    expect(text(live.container, '.time')).toBe('1:03.5');
    expect(text(live.container, '.label')).toBe('elapsed');
    expect(live.container.querySelector('.elapsed')).toBeNull();
    const done = render(RaceClock, {
      race: { ...race, status: RACE_STATUS.DONE },
      differential: 0,
      now: 99_000,
      frozenAt: 80_000
    });
    expect(text(done.container, '.time')).toBe('1:10.0');
  });

  it('says it is not synced until the pi_time samples are in', () => {
    const { container } = render(RaceClock, {
      race: timed30(RACE_STATUS.RACING, 10),
      differential: null,
      now: 15_000,
      frozenAt: null
    });
    expect(text(container, '.time')).toBe('--:--');
    expect(text(container, '.label')).toBe('not synced');
  });
});
