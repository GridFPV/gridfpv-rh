/**
 * A small Markdown renderer for the help pages (#41): headings, paragraphs, bulleted and
 * numbered lists, bold, italic, inline code, links. Nothing is loaded from the network;
 * HTML in the source is escaped, so the pages are data, not markup.
 */

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Inline marks on already-escaped text. */
export function inline(text: string): string {
  let t = escape(text);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    const safe = /^(\/|#|https?:\/\/)/.test(url) ? url : '#';
    const ext = /^https?:\/\//.test(safe) ? ' rel="noopener"' : '';
    return `<a href="${safe}"${ext}>${label}</a>`;
  });
  return t;
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list)
      out.push(
        `<${list.kind}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.kind}>`
      );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }
    const li = /^\s*(?:[-*]|(\d+)\.)\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      const kind = li[1] ? 'ol' : 'ul';
      if (!list || list.kind !== kind) {
        flushList();
        list = { kind, items: [] };
      }
      list.items.push(li[2]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += ' ' + line.trim();
      continue;
    }
    if (line.trim() === '') {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return out.join('\n');
}

/** The first `# Title` of a page, or a fallback. */
export function titleOf(src: string, fallback = 'Help'): string {
  const m = /^#\s+(.+)$/m.exec(src);
  return m ? m[1].trim() : fallback;
}
