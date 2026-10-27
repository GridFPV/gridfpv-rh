<script lang="ts">
  /**
   * RotorHazard's Sensor Tuning settings (its Settings page): calibration mode and the
   * start-of-race lowering of enter/exit. Each write is read back from RotorHazard (#57).
   */
  import { Card, Input, Select } from '@gridfpv/components';
  import {
    setCalibrationMode,
    setLowerAmount,
    setLowerDuration,
    type WriteResult
  } from '../lib/rh.svelte.js';
  import {
    CALIBRATION_MODES,
    LOWER_AMOUNT_MAX,
    LOWER_DURATION_MAX,
    type Tuning
  } from '../lib/tuning.js';

  let { tuning, onresult }: { tuning: Tuning; onresult: (r: WriteResult) => void } = $props();

  let busy = $state(false);
  async function run(fn: () => Promise<WriteResult>) {
    busy = true;
    try {
      const r = await fn();
      onresult(r);
      return r;
    } finally {
      busy = false;
    }
  }

  const mode = $derived(CALIBRATION_MODES.find((m) => m.value === tuning.calibrationMode) ?? null);
  async function onMode(e: Event) {
    const el = e.currentTarget as HTMLSelectElement;
    const v = Number(el.value) === 1 ? 1 : 0;
    if (v === tuning.calibrationMode) return;
    const r = await run(() => setCalibrationMode(v));
    if (!r.ok) el.value = String(tuning.calibrationMode ?? '');
  }

  // The lowering boxes follow RotorHazard only when its value changes, so a readback of one
  // does not reset the other while it is being typed.
  let amount = $state('');
  let duration = $state('');
  let lastAmount: number | null | undefined;
  let lastDuration: number | null | undefined;
  $effect(() => {
    if (tuning.lowerAmount !== lastAmount) {
      lastAmount = tuning.lowerAmount;
      amount = tuning.lowerAmount == null ? '' : String(tuning.lowerAmount);
    }
  });
  $effect(() => {
    if (tuning.lowerDuration !== lastDuration) {
      lastDuration = tuning.lowerDuration;
      duration = tuning.lowerDuration == null ? '' : String(tuning.lowerDuration);
    }
  });
  async function commit(which: 'amount' | 'duration') {
    const current = which === 'amount' ? tuning.lowerAmount : tuning.lowerDuration;
    const typed = which === 'amount' ? amount : duration;
    if (String(typed) === (current == null ? '' : String(current))) return;
    const r = await run(() =>
      which === 'amount' ? setLowerAmount(typed) : setLowerDuration(typed)
    );
    if (!r.ok) {
      // Refused or unconfirmed: RotorHazard's value again.
      if (which === 'amount') amount = current == null ? '' : String(current);
      else duration = current == null ? '' : String(current);
    }
  }
  const onEnterKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
  };
  const loweringOn = $derived((tuning.lowerAmount ?? 0) > 0 && (tuning.lowerDuration ?? 0) > 0);
</script>

<Card elevation="xs" title="Calibration">
  <div class="row">
    <label class="field">
      <span>Calibration mode</span>
      <Select value={tuning.calibrationMode ?? ''} disabled={busy} onchange={onMode}>
        {#each CALIBRATION_MODES as m (m.value)}
          <option value={m.value}>{m.label}</option>
        {/each}
      </Select>
    </label>
    <p class="text">{mode?.text ?? 'Waiting for RotorHazard…'}</p>
  </div>
  <div class="row">
    <label class="field narrow">
      <span>Amount (%)</span>
      <Input
        type="number"
        size="sm"
        bind:value={amount}
        min="0"
        max={LOWER_AMOUNT_MAX}
        onblur={() => commit('amount')}
        onkeydown={onEnterKey}
      />
    </label>
    <label class="field narrow">
      <span>Duration (s)</span>
      <Input
        type="number"
        size="sm"
        bind:value={duration}
        min="0"
        max={LOWER_DURATION_MAX}
        onblur={() => commit('duration')}
        onkeydown={onEnterKey}
      />
    </label>
    <p class="text">
      <strong>Start-of-race lowering{loweringOn ? '' : ' (off)'}.</strong>
      {#if loweringOn}
        For the first {tuning.lowerDuration} s after the start, a seat with a pilot in the heat whose
        signal is below Enter gets Enter and Exit lowered by {tuning.lowerAmount} % of their gap, so the
        hole shot registers; the seat is back to its levels at its first pass. Practice races are not
        lowered. The profile's levels never change; each card says what its seat was lowered to.
      {:else}
        An amount above 0 and a duration above 0 lower Enter and Exit for the first seconds of a
        heat's race on seats with a pilot whose signal is below Enter, so the hole shot registers.
      {/if}
    </p>
  </div>
</Card>

<style>
  .row {
    display: flex;
    gap: var(--gf-space-3);
    align-items: start;
    flex-wrap: wrap;
  }
  .row + .row {
    margin-top: var(--gf-space-3);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 160px;
  }
  .field.narrow {
    min-width: 0;
    width: 7rem;
  }
  .field span {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .text {
    flex: 1;
    min-width: 220px;
    margin: 0;
    color: var(--gf-text-muted);
    font-size: var(--gf-font-size-sm);
  }
</style>
