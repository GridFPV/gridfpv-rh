/**
 * The help pages (#41): Markdown from docs/help/*.md and the race-day checklists from
 * docs/rehearsal.md, bundled at build time so the same text reads on GitHub and on the
 * timer, with nothing fetched at runtime.
 */
import { checklistSections, titleOf } from './markdown.js';
import { SCREENS } from './screens.js';

const pages = import.meta.glob('../../../../../docs/help/*.md', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>;
const checklists = import.meta.glob('../../../../../docs/rehearsal.md', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>;

export type HelpPage = { slug: string; title: string; markdown: string };

function slugOf(path: string): string {
  return path.replace(/^.*\//, '').replace(/\.md$/, '');
}

export const HELP_PAGES: HelpPage[] = Object.entries(pages)
  .map(([path, markdown]) => ({
    slug: slugOf(path),
    title: titleOf(markdown, slugOf(path)),
    markdown
  }))
  .sort((a, b) => {
    const order = SCREENS.map((s) => s.help);
    return (
      (order.indexOf(a.slug) + 1 || 99) - (order.indexOf(b.slug) + 1 || 99) ||
      a.slug.localeCompare(b.slug)
    );
  });

export const CHECKLISTS: HelpPage = {
  slug: 'checklists',
  title: 'Race-day checklists',
  markdown: checklistSections(
    Object.values(checklists)[0] ?? '# Race-day checklists\n\nNot bundled.'
  )
};

export function helpPage(slug: string): HelpPage | undefined {
  if (slug === CHECKLISTS.slug) return CHECKLISTS;
  return HELP_PAGES.find((p) => p.slug === slug);
}

/** The help page for a screen path ('' for home, 'stages', 'seats/3' …). */
export function helpSlugFor(screenPath: string): string {
  const head = screenPath.split('/')[0];
  return SCREENS.find((s) => s.path === head)?.help ?? 'home';
}
