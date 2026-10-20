<script lang="ts">
  /**
   * Copy one seat's enter / exit levels to other seats — all of them, or a chosen few. Each
   * target is written separately and confirmed by readback, so a failure names the seat.
   */
  import { Button, Dialog } from '@gridfpv/components';
  import { rh, setLevels, type WriteResult } from '../lib/rh.svelte.js';
  import { channelLabel, tagFor } from '../lib/channels.js';
  import type { Seat } from '../lib/seats.js';

  let {
    open = $bindable(false),
    from,
    onresult
  }: {
    open?: boolean;
    from: Seat;
    onresult: (r: WriteResult) => void;
  } = $props();

  const timer = rh();
  const targets = $derived(timer.seats.filter((s) => s.index !== from.index));

  let chosen: Record<number, boolean> = $state({});
  let busy = $state(false);

  // Reset the selection each time the dialog opens.
  $effect(() => {
    if (open) chosen = {};
  });

  const count = $derived(Object.values(chosen).filter(Boolean).length);
  const allOn = $derived(targets.length > 0 && targets.every((s) => chosen[s.index]));

  function toggleAll() {
    const next: Record<number, boolean> = {};
    if (!allOn) for (const s of targets) next[s.index] = true;
    chosen = next;
  }

  const label = (s: Seat) => {
    const tag =
      s.band && s.channel != null ? { band: s.band, channel: s.channel } : tagFor(s.frequency);
    return channelLabel(tag?.band, tag?.channel, s.frequency);
  };

  async function apply() {
    if (from.enter == null || from.exit == null) return;
    const list = targets.filter((s) => chosen[s.index]);
    if (!list.length) return;
    busy = true;
    try {
      for (const s of list) {
        const r = await setLevels(s.index, from.enter, from.exit);
        if (!r.ok) {
          onresult(r);
          return;
        }
      }
      onresult({ ok: true });
      open = false;
    } finally {
      busy = false;
    }
  }
</script>

<Dialog bind:open title="Copy tuning from seat {from.index + 1}">
  <p class="muted">
    Enter <strong>{from.enter ?? '—'}</strong> and exit <strong>{from.exit ?? '—'}</strong> will be written
    to the seats you pick. Channels are not changed.
  </p>
  <div class="all">
    <label class="row">
      <input type="checkbox" checked={allOn} onchange={toggleAll} disabled={busy} />
      <span>All other seats</span>
    </label>
  </div>
  <div class="list">
    {#each targets as s (s.index)}
      <label class="row" class:off={!s.frequency}>
        <input type="checkbox" bind:checked={chosen[s.index]} disabled={busy} />
        <span class="seat">Seat {s.index + 1}</span>
        <span class="chan">{label(s)}</span>
        <span class="levels">{s.enter ?? '—'} / {s.exit ?? '—'}</span>
      </label>
    {/each}
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" disabled={!count || busy || from.enter == null} onclick={apply}>
      Copy to {count} seat{count === 1 ? '' : 's'}
    </Button>
  {/snippet}
</Dialog>

<style>
  .muted {
    color: var(--gf-text-muted);
    margin: 0 0 var(--gf-space-3);
  }
  .all {
    padding-bottom: var(--gf-space-2);
    margin-bottom: var(--gf-space-2);
    border-bottom: 1px solid var(--gf-border);
  }
  .all .row {
    grid-template-columns: auto 1fr;
  }
  .list {
    display: grid;
    gap: var(--gf-space-1);
  }
  .row {
    display: grid;
    grid-template-columns: auto 5em 1fr auto;
    gap: var(--gf-space-2);
    align-items: center;
    cursor: pointer;
  }
  .row.off .chan {
    color: var(--gf-text-muted);
  }
  .seat {
    font-weight: 600;
  }
  .chan {
    font-variant-numeric: tabular-nums;
  }
  .levels {
    color: var(--gf-text-muted);
    font-variant-numeric: tabular-nums;
  }
</style>
