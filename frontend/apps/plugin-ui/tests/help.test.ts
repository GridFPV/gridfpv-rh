import { describe, expect, it } from 'vitest';
import { CHECKLISTS, HELP_PAGES, helpPage, helpSlugFor } from '../src/lib/help.js';
import { SCREENS } from '../src/lib/screens.js';

describe('help pages', () => {
  it('has a page with a title for every screen the router knows', () => {
    for (const s of SCREENS) {
      const page = helpPage(s.help);
      expect(page, `help page for ${s.label}`).toBeDefined();
      expect(page!.title.length).toBeGreaterThan(0);
      expect(page!.markdown).toMatch(/^# /m);
    }
    // The screens' pages first, in nav order; after them only the pages for the modes
    // (#95) — anything else here is a stray file in docs/help.
    const slugs = HELP_PAGES.map((p) => p.slug);
    const screens = SCREENS.map((s) => s.help);
    expect(slugs.slice(0, screens.length)).toEqual(screens);
    expect(slugs.slice(screens.length)).toEqual(['racegow']);
  });
  it('bundles the race-day checklists', () => {
    expect(CHECKLISTS.markdown).toContain('## T2');
    expect(helpPage('checklists')?.title).toBe('Race-day checklists');
  });
  it('maps screen paths to pages', () => {
    expect(helpSlugFor('')).toBe('home');
    expect(helpSlugFor('seats/3')).toBe('seats');
    expect(helpSlugFor('nothing')).toBe('home');
  });
});
