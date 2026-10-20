/**
 * A tiny path router. Routes are real paths under /grid (not hashes) because the plugin
 * gates admin pages by URL on the server, and because a deep link must survive a refresh:
 * the blueprint serves index.html for any /grid/... path.
 */

export const BASE = '/grid';

const state = $state({ path: normalize(window.location.pathname) });

/** The current path relative to BASE: '' for the landing, 'seats', 'live/race', … */
export function route(): string {
  return state.path;
}

function normalize(pathname: string): string {
  let p = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  p = p.replace(/^\/+|\/+$/g, '');
  return p;
}

/** Navigate (pushState) to a path relative to BASE. */
export function go(path: string, replace = false): void {
  const rel = path.replace(/^\/+|\/+$/g, '');
  const url = rel ? `${BASE}/${rel}` : BASE;
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  state.path = rel;
}

/** Absolute href for a route, for <a> tags so middle-click and copy-link work. */
export function href(path: string): string {
  const rel = path.replace(/^\/+|\/+$/g, '');
  return rel ? `${BASE}/${rel}` : BASE;
}

/** Click handler for in-app <a> links: same-tab plain clicks route client-side. */
export function link(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const a = (event.currentTarget as HTMLAnchorElement | null) ?? null;
  if (!a || a.target === '_blank') return;
  event.preventDefault();
  go(normalize(new URL(a.href).pathname));
}

window.addEventListener('popstate', () => {
  state.path = normalize(window.location.pathname);
});
