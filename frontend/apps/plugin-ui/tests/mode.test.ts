import { describe, expect, it } from 'vitest';
import { MODES, isMode, showsStageMachinery, visibleScreens } from '../src/lib/mode.js';
import { SCREENS } from '../src/lib/screens.js';

describe('mode (#95)', () => {
  it('full shows every screen, in nav order', () => {
    expect(visibleScreens('full')).toEqual(SCREENS);
  });

  it('simple keeps Teams and Formats out of the nav, nothing else', () => {
    const paths = visibleScreens('simple').map((s) => s.path);
    expect(paths).toEqual([
      '',
      'event',
      'seats',
      'pilots',
      'stages',
      'run',
      'marshal',
      'results',
      'overlays'
    ]);
  });

  it('racegow keeps only what a season needs: home, seats, run, marshal, results, overlays', () => {
    const paths = visibleScreens('racegow').map((s) => s.path);
    expect(paths).toEqual(['', 'seats', 'run', 'marshal', 'results', 'overlays']);
  });

  it('only full shows the stage machinery', () => {
    expect(MODES.filter(showsStageMachinery)).toEqual(['full']);
  });

  it('recognises its own modes and nothing else', () => {
    expect(isMode('racegow')).toBe(true);
    expect(isMode('turbo')).toBe(false);
    expect(isMode(undefined)).toBe(false);
  });
});
