<script lang="ts">
  /**
   * Overlays (#12): where the race director finds the OBS browser-source pages. For each
   * overlay: what it shows, a contrast picker (the URL carries the choice), the URL to
   * paste into OBS with a copy button, an open link, and a live preview — the real page in
   * a frame over a dark backdrop standing in for the video, so what you see here is what
   * the stream gets.
   */
  import { Button, Card } from '@gridfpv/components';
  import {
    OVERLAY_CATALOG,
    overlayUrl,
    type OverlayName,
    type OverlayTheme
  } from '../lib/overlay.js';

  let themes = $state<Record<OverlayName, OverlayTheme>>({ race: 'dark' });
  let copied: OverlayName | null = $state(null);
  let copyFailed: OverlayName | null = $state(null);
  let copyTimer = 0;

  const urlFor = (name: OverlayName) => overlayUrl(window.location.origin, name, themes[name]);

  async function copy(name: OverlayName) {
    window.clearTimeout(copyTimer);
    copied = null;
    copyFailed = null;
    try {
      await navigator.clipboard.writeText(urlFor(name));
      copied = name;
    } catch {
      // The Clipboard API needs a secure context; over plain LAN HTTP it throws. The URL
      // sits in a selectable box right there, so say so rather than fail silently.
      copyFailed = name;
    }
    copyTimer = window.setTimeout(() => ((copied = null), (copyFailed = null)), 3000);
  }
</script>

<section class="page">
  <p class="intro">
    Overlays are pages you put on top of your video in OBS. Each one follows whatever is on the
    timer right now and only reads: closing OBS never touches a race. In OBS add a
    <strong>Browser</strong> source, paste the URL, and set its width and height to your video's. The
    background is see-through, and the page needs no login, so the URL works from any computer on the
    timer's network — at home or on the field hotspot.
  </p>

  {#each OVERLAY_CATALOG as info (info.name)}
    {@const url = urlFor(info.name)}
    <Card title={info.title}>
      <div class="overlay">
        <div class="controls">
          <p class="muted">{info.description}</p>
          <div class="pick" role="radiogroup" aria-label="{info.title} colors">
            <button
              type="button"
              class="opt"
              role="radio"
              aria-checked={themes[info.name] === 'dark'}
              onclick={() => (themes[info.name] = 'dark')}>Light text on dark</button
            >
            <button
              type="button"
              class="opt"
              role="radio"
              aria-checked={themes[info.name] === 'light'}
              onclick={() => (themes[info.name] = 'light')}>Dark text on light</button
            >
          </div>
          <code class="url" aria-label="{info.title} URL">{url}</code>
          <div class="actions">
            <Button size="sm" variant="secondary" onclick={() => copy(info.name)}>Copy URL</Button>
            <a class="open" href={url} target="_blank" rel="noopener">Open in a new tab</a>
            {#if copied === info.name}<span class="muted">Copied.</span>{/if}
            {#if copyFailed === info.name}<span class="muted"
                >Couldn't copy here — select the URL and copy it.</span
              >{/if}
          </div>
        </div>
        <div class="preview" aria-label="{info.title} preview">
          <iframe class="frame" title="{info.title} preview" src={url} tabindex="-1"></iframe>
        </div>
      </div>
    </Card>
  {/each}
</section>

<style>
  .page {
    display: grid;
    gap: var(--gf-space-3);
  }
  .intro {
    margin: 0;
    color: var(--gf-text-muted);
    max-width: 60rem;
  }
  .muted {
    margin: 0;
    color: var(--gf-text-muted);
    font-size: var(--gf-font-size-sm);
  }
  .overlay {
    display: grid;
    grid-template-columns: minmax(18rem, 1fr) minmax(20rem, 1.4fr);
    gap: var(--gf-space-5);
    align-items: start;
  }
  @media (max-width: 70rem) {
    .overlay {
      grid-template-columns: 1fr;
    }
  }
  .controls {
    display: flex;
    flex-direction: column;
    gap: var(--gf-space-3);
  }
  .pick {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--gf-radius-sm);
    border: 1px solid var(--gf-border);
    background: var(--gf-surface-sunken);
    align-self: flex-start;
  }
  .opt {
    appearance: none;
    border: 0;
    border-radius: calc(var(--gf-radius-sm) - 2px);
    padding: var(--gf-space-1) var(--gf-space-3);
    background: transparent;
    color: var(--gf-text-muted);
    font: inherit;
    font-size: var(--gf-font-size-sm);
    cursor: pointer;
  }
  .opt[aria-checked='true'] {
    background: var(--gf-elevated, var(--gf-surface));
    color: var(--gf-text);
    font-weight: 600;
  }
  .url {
    display: block;
    width: 100%;
    padding: var(--gf-space-3);
    border-radius: var(--gf-radius-sm);
    border: 1px solid var(--gf-border);
    background: var(--gf-surface-sunken);
    color: var(--gf-text);
    font-family: var(--gf-font-mono);
    font-size: var(--gf-font-size-xs);
    line-height: 1.5;
    user-select: all;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--gf-space-3);
    flex-wrap: wrap;
  }
  .open {
    color: var(--gf-accent);
    font-size: var(--gf-font-size-sm);
  }
  .preview {
    position: relative;
    aspect-ratio: 16 / 9;
    border-radius: var(--gf-radius-md);
    border: 1px solid var(--gf-border);
    background: linear-gradient(135deg, #1f2a3a 0%, #0b0f16 60%, #233047 100%);
    overflow: hidden;
  }
  .frame {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
    background: transparent;
    pointer-events: none;
  }
</style>
