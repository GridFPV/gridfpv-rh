<script lang="ts">
  /**
   * A path with a Browse… button: the OS's own dialog when the helper can open one (Windows,
   * macOS, zenity on Linux), else a small folder browser of our own over the helper's
   * `/api/browse`. Files (ffmpeg) only get the native dialog; the fallback is typing.
   */
  import { Button, Dialog, Input } from '@gridfpv/components';
  import { api } from '../lib/api.js';

  let {
    value = '',
    kind = 'folder',
    label,
    placeholder = '',
    onpick
  }: {
    value?: string;
    kind?: 'folder' | 'file';
    label: string;
    placeholder?: string;
    onpick: (path: string) => void;
  } = $props();

  let busy = $state(false);
  let browsing = $state(false);
  let dir = $state('');
  let parent = $state<string | null>(null);
  let folders = $state<string[]>([]);
  let fallbackNote = $state('');

  async function browse() {
    busy = true;
    try {
      const r = await api.pick(kind, value || undefined);
      if (r.unsupported) {
        if (kind === 'file') {
          fallbackNote = 'No file dialog on this machine: type the path.';
          return;
        }
        await open(value || undefined);
        browsing = true;
      } else if (r.path) onpick(r.path);
    } catch (e) {
      fallbackNote = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
  async function open(d?: string) {
    const r = await api.browse(d);
    dir = r.dir;
    parent = r.parent;
    folders = r.folders;
  }
  const join = (d: string, name: string) =>
    d.endsWith('/') || d.endsWith('\\') ? d + name : d + (d.includes('\\') ? '\\' : '/') + name;
</script>

<div class="pathfield">
  <Input
    {value}
    {placeholder}
    aria-label={label}
    onchange={(e: Event) => onpick((e.currentTarget as HTMLInputElement).value)}
  />
  <Button size="sm" variant="secondary" disabled={busy} loading={busy} onclick={browse}
    >Browse…</Button
  >
</div>
{#if fallbackNote}<p class="note">{fallbackNote}</p>{/if}

{#if browsing}
  <Dialog open={true} title="Choose a folder" onclose={() => (browsing = false)}>
    <p class="dir"><code>{dir}</code></p>
    <ul class="folders">
      {#if parent}
        <li><button type="button" class="item" onclick={() => open(parent!)}>..</button></li>
      {/if}
      {#each folders as f (f)}
        <li><button type="button" class="item" onclick={() => open(join(dir, f))}>{f}</button></li>
      {/each}
      {#if !folders.length}<li class="note">No folders inside.</li>{/if}
    </ul>
    {#snippet footer()}
      <Button variant="ghost" onclick={() => (browsing = false)}>Cancel</Button>
      <Button
        onclick={() => {
          onpick(dir);
          browsing = false;
        }}>Use this folder</Button
      >
    {/snippet}
  </Dialog>
{/if}

<style>
  .pathfield {
    display: flex;
    gap: var(--gf-space-2);
    align-items: center;
  }
  .pathfield :global(.gf-input) {
    flex: 1;
  }
  .note {
    margin: var(--gf-space-1) 0 0;
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
  }
  .dir {
    margin: 0 0 var(--gf-space-2);
    overflow-wrap: anywhere;
  }
  .folders {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 18rem;
    overflow: auto;
    display: grid;
    gap: 2px;
  }
  .item {
    width: 100%;
    text-align: left;
    appearance: none;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    padding: var(--gf-space-1) var(--gf-space-2);
    border-radius: var(--gf-radius-sm);
    cursor: pointer;
  }
  .item:hover {
    background: var(--gf-surface-alt);
  }
</style>
