<script lang="ts">
  /**
   * The quick channel grid: one small cell per seat with just a channel picker, four across, so
   * a whole profile can be set up in a few clicks. Presets sit beside it: a **preset** is only
   * channels on seats; a **profile** is channels plus each seat's tuning. Applying a preset
   * writes its channels into the active profile and leaves the tuning alone. Under the grid, the
   * live IMD reading for the channels in use — the same number RotorHazard's IMDTabler gives.
   */
  import { Badge, Button, Dialog, Input, Select } from '@gridfpv/components';
  import ChannelPicker from './ChannelPicker.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import {
    imdOffenderMessage,
    imdRatingLabel,
    imdReading,
    imdTone,
    imdToneHint
  } from '../lib/imd.js';
  import { BUILT_IN, presetSeats, type Preset } from '../lib/presets.js';
  import type { Seat } from '../lib/seats.js';
  import { deletePreset, rh, savePreset, setChannel, type WriteResult } from '../lib/rh.svelte.js';

  let { seats, onresult }: { seats: Seat[]; onresult: (r: WriteResult) => void } = $props();

  const timer = rh();

  const inUse = $derived([...new Set(seats.map((s) => s.frequency).filter((f) => f > 0))]);
  const reading = $derived(imdReading(inUse));
  const tone = $derived(imdTone(reading, inUse.length));

  // ---- presets ----
  let selectedId = $state('');
  const selected = $derived(
    BUILT_IN.find((p) => p.id === selectedId) ??
      timer.presets.find((p) => p.id === selectedId) ??
      null
  );
  let busy = $state(false);
  let confirmApply: Preset | null = $state(null);
  let confirmDelete: Preset | null = $state(null);
  let saveOpen = $state(false);
  let saveName = $state('');

  const seatsUsedBy = (p: Preset) => presetSeats(p, seats.length).filter((s) => s.frequency).length;

  async function applyPreset(preset: Preset) {
    busy = true;
    try {
      // One seat at a time, each confirmed by readback, so a failure is named by seat.
      for (const [i, p] of presetSeats(preset, seats.length).entries()) {
        const r = await setChannel(i, p.band, p.channel, p.frequency);
        if (!r.ok) {
          onresult(r);
          return;
        }
      }
      onresult({ ok: true });
    } finally {
      busy = false;
    }
  }

  async function saveCurrent() {
    const name = saveName.trim();
    if (!name) return;
    busy = true;
    try {
      const layout = seats.map((s) => ({
        band: s.band,
        channel: s.channel,
        frequency: s.frequency
      }));
      const r = await savePreset(name, layout);
      onresult(r);
      if (r.ok) {
        saveOpen = false;
        selectedId =
          timer.presets.find((p) => p.name.toLowerCase() === name.toLowerCase())?.id ?? '';
      }
    } finally {
      busy = false;
    }
  }

  async function removePreset(preset: Preset) {
    busy = true;
    try {
      onresult(await deletePreset(preset.id));
      if (selectedId === preset.id) selectedId = '';
    } finally {
      busy = false;
    }
  }
</script>

{#if confirmApply}
  <ConfirmDialog
    open={true}
    title="Apply preset"
    confirmLabel="Apply"
    onconfirm={() => {
      const p = confirmApply;
      confirmApply = null;
      if (p) void applyPreset(p);
    }}
    oncancel={() => (confirmApply = null)}
  >
    Put <strong>{confirmApply.name}</strong> on the active profile? Seats 1–{seatsUsedBy(
      confirmApply
    )}
    get its channels and the rest turn off. Tuning is not touched.
  </ConfirmDialog>
{/if}

{#if confirmDelete}
  <ConfirmDialog
    open={true}
    title="Delete preset"
    confirmLabel="Delete"
    danger
    onconfirm={() => {
      const p = confirmDelete;
      confirmDelete = null;
      if (p) void removePreset(p);
    }}
    oncancel={() => (confirmDelete = null)}
  >
    Delete the preset <strong>{confirmDelete.name}</strong>? Profiles already using its channels are
    unaffected.
  </ConfirmDialog>
{/if}

<Dialog bind:open={saveOpen} title="Save channels as a preset">
  <div class="save">
    <p class="muted">
      Saves which channel each seat is on right now, including seats that are off. Tuning is not
      part of a preset.
    </p>
    <label class="field">
      <span>Name</span>
      <Input
        bind:value={saveName}
        placeholder="e.g. Club night, 6 pilots"
        maxlength="40"
        disabled={busy}
        onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && saveCurrent()}
      />
    </label>
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (saveOpen = false)}>Cancel</Button>
    <Button variant="primary" disabled={!saveName.trim() || busy} onclick={saveCurrent}>Save</Button
    >
  {/snippet}
</Dialog>

<div class="quick">
  <div class="head">
    <div>
      <div class="title">Channels</div>
      <div class="sub">
        Pick each seat's channel, or apply a preset. A preset is only channels on seats; the profile
        adds each seat's tuning.
      </div>
    </div>
  </div>

  <div class="grid">
    {#each seats as seat (seat.index)}
      <div class="cell" class:off={!seat.frequency}>
        <span class="seat">Seat {seat.index + 1}</span>
        <ChannelPicker {seat} {onresult} />
      </div>
    {/each}
  </div>

  <div class="presets">
    <label class="field grow">
      <span>Preset</span>
      <Select bind:value={selectedId} size="sm" disabled={busy}>
        <option value="">Choose a preset…</option>
        <optgroup label="Built in">
          {#each BUILT_IN as p (p.id)}
            <option value={p.id}>{p.name}</option>
          {/each}
        </optgroup>
        {#if timer.presets.length}
          <optgroup label="Custom">
            {#each timer.presets as p (p.id)}
              <option value={p.id}>{p.name} · {seatsUsedBy(p)} seats</option>
            {/each}
          </optgroup>
        {/if}
      </Select>
    </label>
    <div class="actions">
      <Button
        size="sm"
        variant="primary"
        disabled={!selected || busy}
        onclick={() => (confirmApply = selected)}
      >
        Apply
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={busy || inUse.length === 0}
        title="Save the channels currently on the seats as a custom preset"
        onclick={() => {
          saveName = '';
          saveOpen = true;
        }}
      >
        Save current…
      </Button>
      <Button
        size="sm"
        variant="danger"
        disabled={!selected || selected.builtin || busy}
        onclick={() => (confirmDelete = selected)}
      >
        Delete
      </Button>
    </div>
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
  .offender,
  .muted {
    color: var(--gf-text-muted);
    font-size: var(--gf-font-size-sm);
  }
  .muted {
    margin: 0 0 var(--gf-space-3);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .field.grow {
    flex: 1;
    min-width: 240px;
  }
  .field span,
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
  .presets {
    display: flex;
    gap: var(--gf-space-3);
    align-items: end;
    flex-wrap: wrap;
    padding-top: var(--gf-space-2);
    border-top: 1px solid var(--gf-border);
  }
  .actions {
    display: flex;
    gap: var(--gf-space-2);
  }
  .imd {
    display: flex;
    align-items: center;
    gap: var(--gf-space-2);
    flex-wrap: wrap;
  }
</style>
