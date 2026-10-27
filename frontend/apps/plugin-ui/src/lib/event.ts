/**
 * Event names and archive files (#43). RotorHazard names an archive after the event, so
 * a name has to be a usable file name; the plugin sanitises it the same way, and the UI
 * refuses the characters outright so what the director sees is what gets archived.
 */

/** Characters no filesystem (or RotorHazard's path building) accepts in a file name. */
// eslint-disable-next-line no-control-regex
const BAD = /[\\/:*?"<>|\u0000-\u001f]/;
export const EVENT_NAME_MAX = 80;

/** Why a name cannot be an event name, or null when it can. */
export function eventNameProblem(name: string): string | null {
  const n = name.trim();
  if (!n) return 'An event needs a name.';
  if (n.length > EVENT_NAME_MAX) return `Keep the name under ${EVENT_NAME_MAX} characters.`;
  const m = BAD.exec(n);
  if (m) {
    const shown = m[0] < ' ' ? 'a control character' : `"${m[0]}"`;
    return `${shown} cannot be in an event name: the archive is a file named after the event. Use "-" instead.`;
  }
  return null;
}

/** The archive file RotorHazard will write for this event name (mirrors the plugin). */
export function archiveFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  let cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/^[\s.-]+|[\s.-]+$/g, '');
  cleaned = cleaned
    .replace(/\s+/g, ' ')
    .slice(0, EVENT_NAME_MAX)
    .replace(/^[\s.-]+|[\s.-]+$/g, '');
  return `${cleaned || 'event'}.db`;
}
