<script lang="ts">
  /**
   * Help (#41): one page per screen plus the race-day checklists, from Markdown bundled
   * into the plugin. Works at the field with no internet: nothing here loads from the
   * network, and the ? on every page lands here.
   */
  import { Card } from '@gridfpv/components';
  import { CHECKLISTS, HELP_PAGES, helpPage } from '../lib/help.js';
  import { renderMarkdown } from '../lib/markdown.js';
  import { href, link } from '../lib/router.svelte.js';

  let { slug = '' }: { slug?: string } = $props();
  const page = $derived(slug ? helpPage(slug) : undefined);
  const html = $derived(page ? renderMarkdown(page.markdown) : '');

  /** Links inside a page to /grid/... route in-app; anything else stays a plain link. */
  function routeLinks(node: HTMLElement, _html: string) {
    const wire = () => {
      for (const a of node.querySelectorAll<HTMLAnchorElement>('a[href^="/grid"]')) {
        a.onclick = link;
      }
    };
    wire();
    return { update: wire };
  }
</script>

<section class="page">
  <header class="pagehead">
    <div>
      <h1>{page ? page.title : 'Help'}</h1>
      <p class="lede">
        {#if page}
          <a href={href('help')} onclick={link}>All help pages</a> · built into the plugin, works offline.
        {:else}
          What every page does and how a race day flows through it. Built into the plugin; nothing
          here needs the internet.
        {/if}
      </p>
    </div>
  </header>

  {#if page}
    <Card>
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- our own Markdown, HTML escaped by the renderer -->
      <article class="doc" use:routeLinks={html}>{@html html}</article>
    </Card>
  {:else}
    <div class="grid">
      {#each HELP_PAGES as p (p.slug)}
        <a class="tile" href={href(`help/${p.slug}`)} onclick={link}>
          <strong>{p.title}</strong>
        </a>
      {/each}
      <a class="tile checklist" href={href(`help/${CHECKLISTS.slug}`)} onclick={link}>
        <strong>{CHECKLISTS.title}</strong>
        <span>The day's script, step by step, with what RotorHazard must show.</span>
      </a>
    </div>
  {/if}
</section>

<style>
  .page {
    display: grid;
    gap: var(--gf-space-3);
  }
  .pagehead h1 {
    margin: 0 0 var(--gf-space-1);
    font-size: var(--gf-font-size-xl);
  }
  .lede {
    margin: 0;
    color: var(--gf-text-muted);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: var(--gf-space-2);
  }
  .tile {
    display: grid;
    gap: var(--gf-space-1);
    padding: var(--gf-space-3);
    border: 1px solid var(--gf-border);
    border-radius: var(--gf-radius-md);
    color: inherit;
    text-decoration: none;
    background: var(--gf-surface);
  }
  .tile span {
    color: var(--gf-text-muted);
    font-size: var(--gf-font-size-sm);
  }
  .tile.checklist {
    grid-column: 1 / -1;
  }
  .doc :global(h1) {
    display: none;
  }
  .doc :global(h2) {
    margin: var(--gf-space-3) 0 var(--gf-space-1);
    font-size: var(--gf-font-size-lg);
  }
  .doc :global(h3) {
    margin: var(--gf-space-3) 0 var(--gf-space-1);
    font-size: var(--gf-font-size-md);
  }
  .doc :global(p),
  .doc :global(li) {
    line-height: 1.5;
    max-width: 70ch;
  }
  .doc :global(ul.checklist) {
    list-style: none;
    padding-left: 0;
  }
  .doc :global(ul.checklist li) {
    display: flex;
    gap: var(--gf-space-2);
    align-items: baseline;
    margin: var(--gf-space-1) 0;
  }
  .doc :global(ul.checklist .num) {
    color: var(--gf-text-muted);
    min-width: 2.2em;
    font-variant-numeric: tabular-nums;
  }
  .doc :global(code) {
    font-family: var(--gf-font-mono, monospace);
    background: var(--gf-surface-sunken);
    padding: 0 4px;
    border-radius: var(--gf-radius-sm);
  }
</style>
