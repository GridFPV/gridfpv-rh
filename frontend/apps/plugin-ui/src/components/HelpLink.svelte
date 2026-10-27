<script lang="ts">
  /** The "?" beside a page title: its help page, served by the plugin, offline. */
  import { href, link } from '../lib/router.svelte.js';
  let { page }: { page: string } = $props();
</script>

<a
  class="help"
  href={href(`help/${page}`)}
  onclick={link}
  title="Help for this page"
  aria-label="Help for this page">?</a
>

<style>
  .help {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    margin-left: var(--gf-space-2);
    border: 1px solid var(--gf-border);
    border-radius: 50%;
    color: var(--gf-text-muted);
    font-size: var(--gf-font-size-sm);
    font-weight: 600;
    text-decoration: none;
    vertical-align: middle;
  }
  .help:hover {
    color: var(--gf-text);
    border-color: var(--gf-text-muted);
  }
</style>
