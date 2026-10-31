<script lang="ts">
  /** The timer's mode (#95): one setting for every client, switched here from any Home. */
  import { Banner, Card } from '@gridfpv/components';
  import { rh, setMode } from '../lib/rh.svelte.js';
  import { MODES, MODE_DESCRIPTIONS, MODE_LABELS, type Mode } from '../lib/mode.js';

  const timer = rh();
  let busy = $state(false);
  let notice: { tone: 'success' | 'danger'; text: string } | null = $state(null);
  async function choose(mode: Mode) {
    if (mode === timer.mode || busy) return;
    busy = true;
    notice = null;
    try {
      const r = await setMode(mode);
      notice = r.ok
        ? { tone: 'success', text: `${MODE_LABELS[mode]} mode, for every client of this timer.` }
        : { tone: 'danger', text: r.message ?? 'The timer did not confirm the mode.' };
    } finally {
      busy = false;
    }
  }
</script>

<Card
  title="Mode"
  subtitle="How much of Grid this timer shows. One setting for every phone, laptop and overlay machine on it."
>
  {#if notice}
    <Banner tone={notice.tone} ondismiss={() => (notice = null)}>{notice.text}</Banner>
  {/if}
  <div class="modes" role="radiogroup" aria-label="Mode">
    {#each MODES as mode (mode)}
      <button
        type="button"
        class="mode"
        role="radio"
        aria-checked={timer.mode === mode}
        disabled={busy || timer.connection !== 'connected'}
        onclick={() => choose(mode)}
      >
        <span class="name">{MODE_LABELS[mode]}</span>
        <span class="desc">{MODE_DESCRIPTIONS[mode]}</span>
      </button>
    {/each}
  </div>
</Card>

<style>
  .modes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--gf-space-2);
  }
  .mode {
    display: grid;
    gap: var(--gf-space-1);
    padding: var(--gf-space-3);
    text-align: left;
    border: 1px solid var(--gf-border);
    border-radius: var(--gf-radius-md);
    background: var(--gf-surface);
    color: var(--gf-text);
    font: inherit;
    cursor: pointer;
  }
  .mode[aria-checked='true'] {
    border-color: var(--gf-brand-500);
    box-shadow: inset 0 0 0 1px var(--gf-brand-500);
  }
  .mode:disabled {
    cursor: default;
    opacity: 0.7;
  }
  .mode:focus-visible {
    outline: none;
    box-shadow: var(--gf-focus-ring);
  }
  .name {
    font-weight: var(--gf-font-weight-semibold);
  }
  .desc {
    font-size: var(--gf-font-size-sm);
    color: var(--gf-text-muted);
  }
</style>
