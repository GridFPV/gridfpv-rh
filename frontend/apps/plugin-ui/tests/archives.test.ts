import { describe, expect, it } from 'vitest';
import { archiveLabel, isArchiveOf, splitArchives } from '../src/lib/archives.js';

describe('splitArchives', () => {
  it('keeps safety copies apart from event archives', () => {
    const { events, safety } = splitArchives([
      'Club Night 10-27.db',
      'before-delete_Club Night 10-27_20261027_042359.db',
      'database_20261027_031500.db'
    ]);
    expect(events).toEqual(['Club Night 10-27.db', 'database_20261027_031500.db']);
    expect(safety).toEqual(['before-delete_Club Night 10-27_20261027_042359.db']);
  });
});

describe('archiveLabel and isArchiveOf', () => {
  it('reads a safety copy for what it is', () => {
    expect(archiveLabel('before-delete_Club Night 10-27_20261027_042359.db')).toBe(
      'before a race delete · Club Night 10-27 · 2026-10-27 04:23:59'
    );
    expect(archiveLabel('Club Night 10-27.db')).toBe('Club Night 10-27');
  });
  it('matches an event to its archives, counters included', () => {
    expect(isArchiveOf('Club Night 10-27.db', 'Club Night 10-27')).toBe(true);
    expect(isArchiveOf('Club Night 10-27 (2).db', 'Club Night 10-27')).toBe(true);
    expect(isArchiveOf('Club Night 10-28.db', 'Club Night 10-27')).toBe(false);
  });
});
