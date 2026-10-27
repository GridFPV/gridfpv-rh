/**
 * RotorHazard's db_bkp folder holds two kinds of file (#54): event archives (named after
 * the event: a new event, "Archive now", RotorHazard's own backups) and the safety copies
 * the plugin takes before deleting a race. The Event page lists them apart; safety copies
 * are never offered to restore.
 */

export const SAFETY_PREFIX = 'before-delete_';

export function isSafetyCopy(file: string): boolean {
  return file.startsWith(SAFETY_PREFIX);
}

export function splitArchives(files: string[]): { events: string[]; safety: string[] } {
  return {
    events: files.filter((f) => !isSafetyCopy(f)),
    safety: files.filter(isSafetyCopy)
  };
}

/** `Club Night 10-27`, or for a safety copy `before a race delete · Club Night 10-27 · 2026-10-27 04:23:59`. */
export function archiveLabel(file: string): string {
  const base = file.replace(/\.db$/, '');
  if (!isSafetyCopy(base)) return base;
  const m = /^before-delete_(.*)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(base);
  if (!m) return base;
  return `before a race delete · ${m[1]} · ${m[2]}-${m[3]}-${m[4]} ${m[5]}:${m[6]}:${m[7]}`;
}

/** The archive files that belong to the named event: its name, or its name with a counter. */
export function isArchiveOf(file: string, eventArchiveBase: string): boolean {
  const base = file.replace(/\.db$/, '');
  return base === eventArchiveBase || /^(.*) \(\d+\)$/.exec(base)?.[1] === eventArchiveBase;
}
