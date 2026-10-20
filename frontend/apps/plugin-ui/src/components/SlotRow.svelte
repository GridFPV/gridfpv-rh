<script lang="ts">
  /**
   * One seat in a heat. The method picker (pilot / result of a heat / rank in a class /
   * empty) and the pick that goes with it write straight to RotorHazard, confirmed by
   * readback, like the channel pickers do.
   */
  import { Input, Select } from '@gridfpv/components';
  import { seatSlot, type WriteResult } from '../lib/rh.svelte.js';
  import { heatsInClass, SLOT_METHOD, type Heat, type Setup, type Slot } from '../lib/setup.js';

  let {
    heat,
    slot,
    setup,
    onresult
  }: {
    heat: Heat;
    slot: Slot;
    setup: Setup;
    onresult: (r: WriteResult) => void;
  } = $props();

  let busy = $state(false);
  const activePilots = $derived(
    [...setup.pilots]
      .filter((p) => p.active || p.id === slot.pilotId)
      .sort((a, b) =>
        (a.callsign || a.name).localeCompare(b.callsign || b.name, undefined, {
          sensitivity: 'base'
        })
      )
  );
  // Heats a slot can seed from: the same class, excluding this heat.
  const seedHeats = $derived(heatsInClass(setup, heat.classId).filter((h) => h.id !== heat.id));

  let rank = $state('1');
  $effect(() => {
    rank = String(slot.seedRank ?? 1);
  });

  async function write(seating: Parameters<typeof seatSlot>[2]) {
    busy = true;
    try {
      onresult(await seatSlot(heat.id, slot.id, seating));
    } finally {
      busy = false;
    }
  }

  function onMethod(e: Event) {
    const m = Number((e.currentTarget as HTMLSelectElement).value);
    if (m === SLOT_METHOD.ASSIGN)
      return void write({ method: SLOT_METHOD.ASSIGN, pilotId: slot.pilotId || 0 });
    if (m === SLOT_METHOD.HEAT_RESULT) {
      const first = seedHeats[0];
      if (!first) return;
      return void write({
        method: SLOT_METHOD.HEAT_RESULT,
        heatId: first.id,
        rank: Number(rank) || 1
      });
    }
    if (m === SLOT_METHOD.CLASS_RESULT) {
      return void write({
        method: SLOT_METHOD.CLASS_RESULT,
        classId: heat.classId,
        rank: Number(rank) || 1
      });
    }
    void write({ method: SLOT_METHOD.NONE });
  }
  function onPilot(e: Event) {
    void write({
      method: SLOT_METHOD.ASSIGN,
      pilotId: Number((e.currentTarget as HTMLSelectElement).value)
    });
  }
  function onSeedHeat(e: Event) {
    void write({
      method: SLOT_METHOD.HEAT_RESULT,
      heatId: Number((e.currentTarget as HTMLSelectElement).value),
      rank: Number(rank) || 1
    });
  }
  function onRank() {
    const r = Math.max(1, Number(rank) || 1);
    if (slot.method === SLOT_METHOD.HEAT_RESULT && slot.seedId != null)
      void write({ method: SLOT_METHOD.HEAT_RESULT, heatId: slot.seedId, rank: r });
    if (slot.method === SLOT_METHOD.CLASS_RESULT)
      void write({ method: SLOT_METHOD.CLASS_RESULT, classId: heat.classId, rank: r });
  }
</script>

<div class="slot" class:busy>
  <span class="seat">Seat {(slot.nodeIndex ?? 0) + 1}</span>
  <Select value={String(slot.method)} size="sm" disabled={busy || heat.locked} onchange={onMethod}>
    <option value={String(SLOT_METHOD.NONE)}>Empty</option>
    <option value={String(SLOT_METHOD.ASSIGN)}>Pilot</option>
    <option value={String(SLOT_METHOD.HEAT_RESULT)} disabled={!seedHeats.length}
      >Result of a heat</option
    >
    <option value={String(SLOT_METHOD.CLASS_RESULT)} disabled={!heat.classId}>Rank in class</option>
  </Select>
  {#if slot.method === SLOT_METHOD.ASSIGN}
    <Select
      value={String(slot.pilotId)}
      size="sm"
      disabled={busy || heat.locked}
      onchange={onPilot}
    >
      <option value="0">— pick a pilot —</option>
      {#each activePilots as p (p.id)}
        <option value={String(p.id)}>{p.callsign || p.name}{p.team ? ` · ${p.team}` : ''}</option>
      {/each}
    </Select>
  {:else if slot.method === SLOT_METHOD.HEAT_RESULT}
    <div class="seed">
      <Input
        type="number"
        size="sm"
        bind:value={rank}
        min="1"
        max="16"
        disabled={busy || heat.locked}
        onblur={onRank}
      />
      <span class="muted">place in</span>
      <Select
        value={String(slot.seedId ?? '')}
        size="sm"
        disabled={busy || heat.locked}
        onchange={onSeedHeat}
      >
        {#each seedHeats as h (h.id)}
          <option value={String(h.id)}>{h.displayName}</option>
        {/each}
      </Select>
    </div>
  {:else if slot.method === SLOT_METHOD.CLASS_RESULT}
    <div class="seed">
      <Input
        type="number"
        size="sm"
        bind:value={rank}
        min="1"
        max="64"
        disabled={busy || heat.locked}
        onblur={onRank}
      />
      <span class="muted">in the class ranking</span>
    </div>
  {:else}
    <span></span>
  {/if}
</div>

<style>
  .slot {
    display: grid;
    grid-template-columns: 4.5em 9.5em minmax(0, 1fr);
    align-items: center;
    gap: var(--gf-space-2);
  }
  .slot :global(select),
  .slot :global(input) {
    min-width: 0;
  }
  .slot .muted {
    white-space: nowrap;
  }
  .seed {
    display: grid;
    grid-template-columns: 5em auto minmax(0, 1fr);
    align-items: center;
    gap: var(--gf-space-2);
  }
  .slot.busy {
    opacity: 0.7;
  }
  .seat {
    min-width: 4.5em;
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .muted {
    color: var(--gf-text-muted);
    font-size: var(--gf-font-size-sm);
  }
</style>
