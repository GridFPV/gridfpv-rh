import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import RaceSettingsStrip from '../src/components/RaceSettingsStrip.svelte';
import type { RaceFormat } from '../src/lib/setup.js';

const format = {
  id: 3,
  name: '2:00 Standard Race',
  raceTimeSec: 120,
  unlimitedTime: false,
  winCondition: 1
} as unknown as RaceFormat;

describe('RaceSettingsStrip', () => {
  it('names the profile, minimum lap and format, each linking to the page that sets it', () => {
    const { container } = render(RaceSettingsStrip, {
      profileName: 'Raceband',
      minLapS: 5,
      behaviorLabel: 'Highlight short laps',
      format
    });
    const strip = container.querySelector('[aria-label="Race settings"]')!;
    expect(strip.textContent?.replace(/\s+/g, ' ').trim()).toContain('Profile Raceband');
    expect(strip.textContent).toContain('Min lap 5 s, Highlight short laps');
    expect(strip.textContent).toContain('Format 2:00 Standard Race');
    const links = Array.from(strip.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links.map((h) => h?.split('/').pop())).toEqual(['seats', 'event', 'formats']);
    expect(strip.querySelector('button')).toBeNull(); // no edit without a handler
  });
  it('offers edit for the format and says "none" without one', async () => {
    const onEditFormat = vi.fn();
    const { container } = render(RaceSettingsStrip, {
      profileName: '',
      minLapS: 0,
      behaviorLabel: 'Discard new short laps',
      format,
      onEditFormat
    });
    await fireEvent.click(container.querySelector('button')!);
    expect(onEditFormat).toHaveBeenCalledTimes(1);
    const none = render(RaceSettingsStrip, {
      profileName: '',
      minLapS: 0,
      behaviorLabel: '',
      format: undefined,
      onEditFormat
    });
    expect(none.container.textContent).toContain('Profile —');
    expect(none.container.textContent).toContain('Format none');
    expect(none.container.querySelector('button')).toBeNull();
  });
});
