<script lang="ts">
  /**
   * One heat, opened from the board: rename, seat each slot (SlotRow writes on change),
   * duplicate, delete. The page unmounts this on close, so `open` starts true.
   */
  import { Badge, Button, Dialog, Input } from '@gridfpv/components';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import SlotRow from './SlotRow.svelte';
  import { alterHeat, deleteHeat, duplicateHeat, type WriteResult } from '../lib/rh.svelte.js';
  import type { Heat, Setup } from '../lib/setup.js';

  let {
    heat,
    setup,
    onresult,
    onclose
  }: {
    heat: Heat;
    setup: Setup;
    onresult: (r: WriteResult) => void;
    onclose: () => void;
  } = $props();

  let open = $state(true);
  /** RotorHazard's own page locks a raced heat's seats behind a confirmation; so do we. */
  let unlocked = $state(false);
  let unlocking = $state(false);
  let busy = $state(false);
  let name = $state('');
  let removing = $state(false);
  $effect(() => {
    name = heat.name;
  });
  const nameDirty = $derived(name.trim() !== heat.name);

  async function run(fn: () => Promise<WriteResult>, closeAfter = false) {
    busy = true;
    try {
      const r = await fn();
      onresult(r);
      if (r.ok && closeAfter) open = false;
    } finally {
      busy = false;
    }
  }
</script>

{#if removing}
  <ConfirmDialog
    open={true}
    title="Delete heat"
    confirmLabel="Delete"
    danger
    onconfirm={() => {
      removing = false;
      void run(() => deleteHeat(heat.id), true);
    }}
    oncancel={() => (removing = false)}
  >
    Delete <strong>{heat.displayName}</strong>? A heat with saved races cannot be deleted.
  </ConfirmDialog>
{/if}

<Dialog bind:open title={heat.displayName} {onclose} size="wide">
  <div class="form">
    <div class="namerow">
      <label class="field grow">
        <span>Name</span>
        <Input
          bind:value={name}
          placeholder={heat.autoName}
          maxlength="80"
          onkeydown={(e: KeyboardEvent) =>
            e.key === 'Enter' && nameDirty && run(() => alterHeat(heat.id, { name: name.trim() }))}
        />
      </label>
      <Button
        variant="secondary"
        disabled={busy || !nameDirty}
        onclick={() => run(() => alterHeat(heat.id, { name: name.trim() }))}>Rename</Button
      >
    </div>
    <small class="muted"
      >Leave the name empty to use RotorHazard's automatic one ({heat.autoName}).</small
    >

    <div class="seats">
      <div class="seatshead">
        <span class="label">Seats</span>
        {#if heat.locked && !unlocked}
          <Badge tone="neutral" variant="outline">raced · seats locked</Badge>
          <Button size="sm" variant="ghost" disabled={busy} onclick={() => (unlocking = true)}
            >Unlock seats…</Button
          >
        {:else if heat.locked}
          <Badge tone="warn" variant="outline">raced · unlocked</Badge>
        {/if}
      </div>
      {#if unlocking}
        <p class="warn" role="alert">
          Changing a raced heat's seats changes its saved results, as RotorHazard warns on its own
          page. Unlock anyway?
          <Button size="sm" variant="ghost" onclick={() => (unlocking = false)}>Keep locked</Button>
          <Button
            size="sm"
            variant="danger"
            onclick={() => {
              unlocking = false;
              unlocked = true;
            }}>Unlock</Button
          >
        </p>
      {/if}
      {#each heat.slots as s (s.id)}
        <SlotRow {heat} slot={s} {setup} {onresult} locked={heat.locked && !unlocked} />
      {/each}
    </div>
  </div>
  {#snippet footer()}
    <Button variant="ghost" disabled={busy} onclick={() => run(() => duplicateHeat(heat.id))}
      >Duplicate</Button
    >
    <Button variant="ghost" disabled={busy || heat.locked} onclick={() => (removing = true)}
      >Delete</Button
    >
    <span class="spacer"></span>
    <Button variant="primary" onclick={() => (open = false)}>Done</Button>
  {/snippet}
</Dialog>

<style>
  .form {
    display: grid;
    gap: var(--gf-space-2);
  }
  .namerow {
    display: flex;
    gap: var(--gf-space-2);
    align-items: end;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .field.grow {
    flex: 1;
  }
  .warn {
    margin: 0;
    padding: var(--gf-space-2) var(--gf-space-3);
    border: 1px solid var(--gf-warning-500, #d29922);
    border-radius: var(--gf-radius-md);
    font-size: var(--gf-font-size-sm);
    display: flex;
    gap: var(--gf-space-2);
    align-items: center;
    flex-wrap: wrap;
  }
  .field > span,
  .label {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .muted {
    color: var(--gf-text-muted);
  }
  .seats {
    display: grid;
    gap: var(--gf-space-1);
    margin-top: var(--gf-space-2);
    padding-top: var(--gf-space-2);
    border-top: 1px solid var(--gf-border);
  }
  .seatshead {
    display: flex;
    align-items: center;
    gap: var(--gf-space-2);
    margin-bottom: var(--gf-space-1);
  }
  .spacer {
    flex: 1;
  }
</style>
