import { describe, expect, it } from 'vitest';
import { checklistSections, inline, renderMarkdown, titleOf } from '../src/lib/markdown.js';

describe('renderMarkdown', () => {
  it('renders headings, paragraphs and lists', () => {
    const html = renderMarkdown(
      '# Title\n\nA line\nsame paragraph.\n\n- one\n- two\n  wrapped\n\n1. first\n2. second\n'
    );
    expect(html).toBe(
      '<h1>Title</h1>\n<p>A line same paragraph.</p>\n<ul><li>one</li><li>two wrapped</li></ul>\n<ol><li>first</li><li>second</li></ol>'
    );
  });
  it('escapes html and keeps marks', () => {
    expect(
      inline('a <b>bold</b> **x** *y* `z` [in](/grid/event) [out](https://x.y) [bad](javascript:1)')
    ).toBe(
      'a &lt;b&gt;bold&lt;/b&gt; <strong>x</strong> <em>y</em> <code>z</code> <a href="/grid/event">in</a> <a href="https://x.y" rel="noopener">out</a> <a href="#">bad</a>'
    );
  });
  it('finds the title', () => {
    expect(titleOf('intro\n# Stages\n## more')).toBe('Stages');
    expect(titleOf('no title', 'Help')).toBe('Help');
  });
});

describe('checklists (#64)', () => {
  it('renders checkbox items with their own numbers, sub-steps included', () => {
    const html = renderMarkdown('8. [ ] **Seed**: now.\n8b. [x] Raced.\n9. [ ] Rounds.\n');
    expect(html).toBe(
      '<ul class="checklist"><li><input type="checkbox" disabled /> <span class="num">8.</span> <strong>Seed</strong>: now.</li>' +
        '<li><input type="checkbox" disabled checked /> <span class="num">8b.</span> Raced.</li>' +
        '<li><input type="checkbox" disabled /> <span class="num">9.</span> Rounds.</li></ul>'
    );
  });
  it('keeps only sections that hold a checklist', () => {
    const md =
      '# Title\n\nintro\n\n## T1 — harness (no rehearsal)\n\n## T2 — event\n\n1. [ ] Event.\n\n## T3\n\nTo be written.\n';
    expect(checklistSections(md)).toBe('# Title\n\nintro\n\n## T2 — event\n\n1. [ ] Event.\n\n');
  });
});
