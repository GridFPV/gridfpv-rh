<script lang="ts">
  /**
   * One seat in a heat. The method picker (pilot / result of a heat / rank in a class /
   * empty) and the pick that goes with it write straight to RotorHazard, confirmed by
   * readback, like the channel pickers do.
   */
  import { Input, Select } from '@gridfpv/components';
  import { rh, seatSlot, type WriteResult } from '../lib/rh.svelte.js';
  import { seatLabel, seatTag } from '../lib/channels.js';
  import { CLASS_NONE, SLOT_METHOD, type Heat, type Setup, type Slot } from '../lib/setup.js';

  let {
    heat,
    slot,
    setup,
    onresult,
    locked = heat.locked
  }: {
    /** Seats of a raced heat are locked until the director unlocks them in the dialog. */
    locked?: boolean;
    heat: Heat;
    slot: Slot;
    setup: Setup;
    onresult: (r: WriteResult) => void;
  } = $props();

  const timer = rh();
  /** The seat's channel from the active profile, so you know what you're putting a pilot on. */
  const channel = $derived.by(() => {
    const seat = slot.nodeIndex == null ? undefined : timer.seats[slot.nodeIndex];
    return seat ? seatLabel(seat) : '';
  });
  const band = $derived.by(() => {
    const seat = slot.nodeIndex == null ? undefined : timer.seats[slot.nodeIndex];
    return seat?.frequency ? (seatTag(seat)?.band ?? '') : '';
  });

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
  // Heats a slot can seed from: any other heat (a bracket seeds from an earlier stage),
  // grouped by stage in event order.
  const stages = $derived(
    [...setup.classes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id)
  );
  const seedGroups = $derived(
    [
      ...stages.map((c) => ({ id: c.id, label: c.displayName })),
      { id: CLASS_NONE, label: 'No stage' }
    ]
      .map((g) => ({
        ...g,
        heats: setup.heats.filter((h) => h.classId === g.id && h.id !== heat.id)
      }))
      .filter((g) => g.heats.length)
  );
  const seedHeats = $derived(seedGroups.flatMap((g) => g.heats));
  const seedClassId = $derived(
    slot.method === SLOT_METHOD.CLASS_RESULT && slot.seedId != null
      ? slot.seedId
      : heat.classId || stages[0]?.id || 0
  );

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
      if (!seedClassId) return;
      return void write({
        method: SLOT_METHOD.CLASS_RESULT,
        classId: seedClassId,
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
  function onSeedClass(e: Event) {
    void write({
      method: SLOT_METHOD.CLASS_RESULT,
      classId: Number((e.currentTarget as HTMLSelectElement).value),
      rank: Number(rank) || 1
    });
  }
  function onRank() {
    const r = Math.max(1, Number(rank) || 1);
    if (slot.method === SLOT_METHOD.HEAT_RESULT && slot.seedId != null)
      void write({ method: SLOT_METHOD.HEAT_RESULT, heatId: slot.seedId, rank: r });
    if (slot.method === SLOT_METHOD.CLASS_RESULT)
      void write({ method: SLOT_METHOD.CLASS_RESULT, classId: seedClassId, rank: r });
  }
</script>

<div class="slot" class:busy>
  <span class="seat">
    <span>Seat {(slot.nodeIndex ?? 0) + 1}</span>
    {#if channel}<span class="chan" data-band={band}>{channel}</span>{/if}
  </span>
  <Select value={String(slot.method)} size="sm" disabled={busy || locked} onchange={onMethod}>
    <option value={String(SLOT_METHOD.NONE)}>Empty</option>
    <option value={String(SLOT_METHOD.ASSIGN)}>Pilot</option>
    <option value={String(SLOT_METHOD.HEAT_RESULT)} disabled={!seedHeats.length}
      >Result of a heat</option
    >
    <option value={String(SLOT_METHOD.CLASS_RESULT)} disabled={!stages.length}
      >Rank in a stage</option
    >
  </Select>
  {#if slot.method === SLOT_METHOD.ASSIGN}
    <Select value={String(slot.pilotId)} size="sm" disabled={busy || locked} onchange={onPilot}>
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
        disabled={busy || locked}
        onblur={onRank}
      />
      <span class="muted">place in</span>
      <Select
        value={String(slot.seedId ?? '')}
        size="sm"
        disabled={busy || locked}
        onchange={onSeedHeat}
      >
        {#each seedGroups as g (g.id)}
          <optgroup label={g.label}>
            {#each g.heats as h (h.id)}
              <option value={String(h.id)}>{h.displayName}</option>
            {/each}
          </optgroup>
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
        disabled={busy || locked}
        onblur={onRank}
      />
      <span class="muted">in the ranking of</span>
      <Select
        value={String(seedClassId)}
        size="sm"
        disabled={busy || locked}
        onchange={onSeedClass}
      >
        {#each stages as c (c.id)}
          <option value={String(c.id)}>{c.displayName}</option>
        {/each}
      </Select>
    </div>
  {:else}
    <span></span>
  {/if}
</div>

<style>
  .slot {
    display: grid;
    grid-template-columns: 8.5em 9.5em minmax(0, 1fr);
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
    display: grid;
    line-height: 1.2;
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .seat .chan {
    color: var(--gf-text);
    text-transform: none;
    letter-spacing: 0;
    font-variant-numeric: tabular-nums;
  }
  .chan[data-band='R'] {
    color: var(--gf-red-400);
  }
  .chan[data-band='F'] {
    color: var(--gf-amber-400);
  }
  .chan[data-band='E'] {
    color: var(--gf-green-400);
  }
  .chan[data-band='B'] {
    color: var(--gf-blue-400);
  }
  .chan[data-band='A'] {
    color: var(--gf-violet-400);
  }
  .chan[data-band='L'] {
    color: var(--gf-cyan-400);
  }
  .muted {
    color: var(--gf-text-muted);
    font-size: var(--gf-font-size-sm);
  }
</style>
