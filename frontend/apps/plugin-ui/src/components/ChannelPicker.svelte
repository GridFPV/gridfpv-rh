<script lang="ts">
  /**
   * One seat's channel: a single dropdown with the analog bands first, RotorHazard's other
   * channel sets under "Other", and "Custom…" for a hand-typed frequency (RotorHazard keeps
   * those with no band tag). Used by the quick grid and by the seat card.
   */
  import { Button, Input, Select } from '@gridfpv/components';
  import {
    bandName,
    channelLabel,
    COMMON_BANDS,
    CUSTOM_MAX_MHZ,
    CUSTOM_MIN_MHZ,
    frequencyFor,
    OTHER_BANDS,
    seatTag,
    tagFor
  } from '../lib/channels.js';
  import type { Seat } from '../lib/seats.js';
  import { setChannel, type WriteResult } from '../lib/rh.svelte.js';

  let {
    seat,
    size = 'sm',
    onresult
  }: {
    seat: Seat;
    size?: 'sm' | 'md';
    onresult: (r: WriteResult) => void;
  } = $props();

  // What RotorHazard stores, resolved to a table key where possible; `custom` otherwise.
  const tag = $derived(seatTag(seat));
  const current = $derived(!seat.frequency ? 'off' : tag ? `${tag.band}:${tag.channel}` : 'custom');

  let busy = $state(false);
  let editingCustom = $state(false);
  let customMhz = $state('');

  async function write(band: string | null, channel: number | null, frequency: number) {
    busy = true;
    try {
      onresult(await setChannel(seat.index, band, channel, frequency));
    } finally {
      busy = false;
    }
  }

  function onPick(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    if (v === 'custom') {
      editingCustom = true;
      customMhz = seat.frequency ? String(seat.frequency) : '';
      return;
    }
    editingCustom = false;
    if (v === 'off') return void write(null, null, 0);
    const [band, ch] = v.split(':');
    const freq = frequencyFor(band, Number(ch));
    if (freq) void write(band, Number(ch), freq);
  }

  const customValid = $derived.by(() => {
    const n = Number(customMhz);
    return Number.isInteger(n) && n >= CUSTOM_MIN_MHZ && n <= CUSTOM_MAX_MHZ;
  });

  async function applyCustom() {
    if (!customValid) return;
    // A custom frequency that happens to sit on a table channel gets that channel's tag, as
    // RotorHazard's own page does; otherwise it is stored untagged.
    const n = Number(customMhz);
    const t = tagFor(n);
    await write(t?.band ?? null, t?.channel ?? null, n);
    editingCustom = false;
  }
</script>

<div class="picker">
  <Select value={editingCustom ? 'custom' : current} {size} disabled={busy} onchange={onPick}>
    <option value="off">Off</option>
    {#if current === 'custom' && !editingCustom}
      <option value="custom">{channelLabel(null, null, seat.frequency)} (custom)</option>
    {:else}
      <option value="custom">Custom…</option>
    {/if}
    {#each COMMON_BANDS as b (b.key)}
      <optgroup label={bandName(b)}>
        {#each b.channels as c (c.key)}
          <option value="{b.key}:{c.channel}">{c.key} · {c.frequency}</option>
        {/each}
      </optgroup>
    {/each}
    <optgroup label="Other">
      {#each OTHER_BANDS as b (b.key)}
        {#each b.channels as c (c.key)}
          <option value="{b.key}:{c.channel}">{c.key} · {c.frequency}</option>
        {/each}
      {/each}
    </optgroup>
  </Select>
  {#if editingCustom}
    <div class="custom">
      <Input
        type="number"
        {size}
        bind:value={customMhz}
        min={CUSTOM_MIN_MHZ}
        max={CUSTOM_MAX_MHZ}
        placeholder="MHz"
        invalid={customMhz !== '' && !customValid}
        disabled={busy}
        onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && applyCustom()}
      />
      <Button {size} variant="primary" disabled={!customValid || busy} onclick={applyCustom}
        >Set</Button
      >
      <Button {size} variant="ghost" disabled={busy} onclick={() => (editingCustom = false)}
        >Cancel</Button
      >
    </div>
  {/if}
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: var(--gf-space-1);
    min-width: 0;
  }
  .custom {
    display: flex;
    gap: var(--gf-space-1);
    align-items: center;
  }
</style>
