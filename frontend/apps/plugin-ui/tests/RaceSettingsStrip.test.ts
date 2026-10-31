import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import RaceSettingsStrip from '../src/components/RaceSettingsStrip.svelte';

describe('RaceSettingsStrip', () => {
  it('names the profile and the minimum lap rule, each linking to the page that sets it', () => {
    const { container } = render(RaceSettingsStrip, {
      profileName: 'Raceband',
      minLapS: 5,
      behaviorLabel: 'Highlight short laps'
    });
    const strip = container.querySelector('[aria-label="Race settings"]')!;
    const text = strip.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(text).toContain('Profile Raceband');
    expect(text).toContain('Min lap 5 s, Highlight short laps');
    const links = Array.from(strip.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links.map((h) => h?.split('/').pop())).toEqual(['seats', 'event']);
  });
  it('shows a dash with no profile', () => {
    const { container } = render(RaceSettingsStrip, {
      profileName: '',
      minLapS: 0,
      behaviorLabel: ''
    });
    expect(container.textContent?.replace(/\s+/g, ' ')).toContain('Profile —');
  });
});
