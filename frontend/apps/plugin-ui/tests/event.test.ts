import { describe, expect, it } from 'vitest';
import { archiveFileName, eventNameProblem } from '../src/lib/event.js';

describe('eventNameProblem', () => {
  it('accepts ordinary names', () => {
    expect(eventNameProblem('Club Night 27 Oct')).toBeNull();
    expect(eventNameProblem("Ryan's RaceGOW #6 & friends")).toBeNull();
  });
  it('refuses path and control characters, blanks and overlong names', () => {
    expect(eventNameProblem('Club Night 10/27')).toMatch(/"\/" cannot be in an event name/);
    expect(eventNameProblem('a\\b')).toContain('"\\" cannot be in an event name');
    expect(eventNameProblem('a:b')).toMatch(/":"/);
    expect(eventNameProblem('a\u0007b')).toMatch(/control character/);
    expect(eventNameProblem('   ')).toBe('An event needs a name.');
    expect(eventNameProblem('x'.repeat(81))).toMatch(/under 80/);
  });
});

describe('archiveFileName', () => {
  it('mirrors the plugin: bad characters become dashes', () => {
    expect(archiveFileName('Club Night 10/27')).toBe('Club Night 10-27.db');
    expect(archiveFileName('  ..  ')).toBe('event.db');
    expect(archiveFileName('With "quotes"')).toBe('With -quotes.db'); // trailing dashes go
  });
});
