<script lang="ts">
  /**
   * The quick channel grid: one small cell per seat with just a channel picker, four across, so
   * a whole profile can be set up in a few clicks, plus a preset to fill it from. Above it, the
   * live IMD reading for the channels currently in use — the same number RotorHazard's
   * IMDTabler page gives — so the RD sees the set get cleaner or dirtier as they pick.
   */
  import { Badge, Select } from '@gridfpv/components';
  import ChannelPicker from './ChannelPicker.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import {
    imdOffenderMessage,
    imdRatingLabel,
    imdReading,
    imdTone,
    imdToneHint
  } from '../lib/imd.js';
  import { PRESETS, presetSeats, type Preset } from '../lib/presets.js';
  import type { Seat } from '../lib/seats.js';
  import { setChannel, type WriteResult } from '../lib/rh.svelte.js';

  let { seats, onresult }: { seats: Seat[]; onresult: (r: WriteResult) => void } = $props();

  const inUse = $derived([...new Set(seats.map((s) => s.frequency).filter((f) => f > 0))]);
  const reading = $derived(imdReading(inUse));
  const tone = $derived(imdTone(reading, inUse.length));

  let applying = $state(false);

  let pending: { preset: Preset; used: number } | null = $state(null);

  function onPreset(e: Event) {
    const sel = e.currentTarget as HTMLSelectElement;
    const preset = PRESETS.find((p) => p.id === sel.value);
    sel.value = '';
    if (!preset) return;
    const used = presetSeats(preset, seats.length).filter((p) => p.frequency).length;
    pending = { preset, used };
  }

  async function applyPreset() {
    if (!pending) return;
    const plan = presetSeats(pending.preset, seats.length);
    pending = null;
    applying = true;
    try {
      // One seat at a time, each confirmed by readback, so a failure is named by seat.
      for (const [i, p] of plan.entries()) {
        const r = await setChannel(i, p.band, p.channel, p.frequency);
        if (!r.ok) {
          onresult(r);
          return;
        }
      }
      onresult({ ok: true });
    } finally {
      applying = false;
    }
  }
</script>

{#if pending}
  <ConfirmDialog
    open={true}
    title="Fill from preset"
    confirmLabel="Fill"
    onconfirm={applyPreset}
    oncancel={() => (pending = null)}
  >
    Fill the active profile from <strong>{pending.preset.name}</strong>? Seats 1–{pending.used}
    get its channels; the rest turn off.
  </ConfirmDialog>
{/if}

<div class="quick">
  <div class="head">
    <div>
      <div class="title">Channels</div>
      <div class="sub">Pick each seat's channel; the IMD reading updates as you go.</div>
    </div>
    <label class="preset">
      <span>Fill from preset</span>
      <Select value="" size="sm" disabled={applying} onchange={onPreset}>
        <option value="">Choose…</option>
        {#each PRESETS as p (p.id)}
          <option value={p.id}>{p.name}</option>
        {/each}
      </Select>
    </label>
  </div>
  <div class="grid">
    {#each seats as seat (seat.index)}
      <div class="cell" class:off={!seat.frequency}>
        <span class="seat">Seat {seat.index + 1}</span>
        <ChannelPicker {seat} {onresult} />
      </div>
    {/each}
  </div>
  <div class="imdrow">
    {#if inUse.length >= 2}
      <div class="imd" title={imdToneHint(reading, inUse.length)}>
        <Badge {tone} variant="solid">{imdRatingLabel(reading)}</Badge>
        <span class="offender"
          >{reading.worst ? 'worst offender: ' : ''}{imdOffenderMessage(reading)}</span
        >
      </div>
    {:else}
      <span class="offender">IMD needs at least two seats on.</span>
    {/if}
  </div>
</div>

<style>
  .quick {
    padding: var(--gf-space-3);
    background: var(--gf-surface);
    border: 1px solid var(--gf-border);
    border-radius: var(--gf-radius-md);
    display: grid;
    gap: var(--gf-space-3);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: end;
    gap: var(--gf-space-3);
    flex-wrap: wrap;
  }
  .title {
    font-weight: 700;
  }
  .sub,
  .offender {
    color: var(--gf-text-muted);
    font-size: var(--gf-font-size-sm);
  }
  .preset {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 240px;
  }
  .preset span,
  .seat {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--gf-space-2);
  }
  @media (max-width: 720px) {
    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .cell.off .seat {
    opacity: 0.6;
  }
  .imd {
    display: flex;
    align-items: center;
    gap: var(--gf-space-2);
    flex-wrap: wrap;
  }
</style>
