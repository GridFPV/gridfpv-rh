import { describe, expect, it } from 'vitest';
import { inline, renderMarkdown, titleOf } from '../src/lib/markdown.js';

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
