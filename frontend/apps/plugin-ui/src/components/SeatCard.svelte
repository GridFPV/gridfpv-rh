<script lang="ts">
  /**
   * One seat (RotorHazard node) in the active profile: its channel, thresholds, live RSSI
   * and status, with the edits that write straight back to RotorHazard. Every write goes
   * through the store, which confirms it by readback and reports the outcome up.
   */
  import { Badge, Button, Card, Input } from '@gridfpv/components';
  import ChannelPicker from './ChannelPicker.svelte';
  import { channelLabel, tagFor } from '../lib/channels.js';
  import { seatStatus, type Seat } from '../lib/seats.js';
  import { setLevels, type WriteResult } from '../lib/rh.svelte.js';
  import { go } from '../lib/router.svelte.js';

  let {
    seat,
    onresult
  }: {
    seat: Seat;
    onresult: (r: WriteResult) => void;
  } = $props();

  const status = $derived(seatStatus(seat));
  const STATUS: Record<
    ReturnType<typeof seatStatus>,
    { tone: 'neutral' | 'success' | 'warn' | 'info'; label: string }
  > = {
    off: { tone: 'neutral', label: 'Off' },
    untuned: { tone: 'warn', label: 'Untuned' },
    idle: { tone: 'success', label: 'Ready' },
    crossing: { tone: 'info', label: 'Crossing' }
  };

  // RotorHazard stores band/channel only when the channel was picked from its table; a bare
  // frequency (typed by hand, or set by a tool) is labelled from ours where it matches.
  const tag = $derived(
    seat.band && seat.channel != null
      ? { band: seat.band, channel: seat.channel }
      : tagFor(seat.frequency)
  );

  // ---- thresholds ----
  let busy = $state(false);
  let enter = $state('');
  let exit = $state('');
  $effect(() => {
    enter = seat.enter == null ? '' : String(seat.enter);
    exit = seat.exit == null ? '' : String(seat.exit);
  });
  const levelsDirty = $derived(
    enter !== (seat.enter == null ? '' : String(seat.enter)) ||
      exit !== (seat.exit == null ? '' : String(seat.exit))
  );
  const levelsValid = $derived(Number(enter) > Number(exit) && Number(exit) > 0);

  async function applyLevels() {
    busy = true;
    try {
      onresult(await setLevels(seat.index, Number(enter), Number(exit)));
    } finally {
      busy = false;
    }
  }

  // ---- live bar ----
  const scale = $derived(Math.max(seat.peak ?? 0, seat.enter ?? 0, seat.rssi, 100));
  const pct = (v: number | null) => (v == null ? 0 : Math.min(100, (v / scale) * 100));
</script>

<Card elevation="xs">
  <div class="head">
    <div class="title">
      <span class="num">Seat {seat.index + 1}</span>
      <span class="chan">{channelLabel(tag?.band, tag?.channel, seat.frequency)}</span>
    </div>
    <Badge tone={STATUS[status].tone} dot={status === 'crossing'}>{STATUS[status].label}</Badge>
  </div>

  <div class="bar" title="Live RSSI {seat.rssi}">
    <div class="fill" class:crossing={seat.crossing} style="width: {pct(seat.rssi)}%"></div>
    {#if seat.enter != null}
      <div class="mark enter" style="left: {pct(seat.enter)}%" title="enter {seat.enter}"></div>
    {/if}
    {#if seat.exit != null}
      <div class="mark exit" style="left: {pct(seat.exit)}%" title="exit {seat.exit}"></div>
    {/if}
    <span class="rssi">{seat.rssi}</span>
  </div>

  <div class="row">
    <div class="field">
      <span>Channel</span>
      <ChannelPicker {seat} {onresult} />
    </div>
  </div>

  <div class="row">
    <label class="field narrow">
      <span>Enter</span>
      <Input type="number" size="sm" bind:value={enter} min="1" max="255" disabled={busy} />
    </label>
    <label class="field narrow">
      <span>Exit</span>
      <Input type="number" size="sm" bind:value={exit} min="1" max="255" disabled={busy} />
    </label>
    <div class="actions">
      <Button
        size="sm"
        variant="secondary"
        disabled={!levelsDirty || !levelsValid || busy}
        onclick={applyLevels}
      >
        Apply
      </Button>
      <Button
        size="sm"
        variant="primary"
        disabled={!seat.frequency}
        onclick={() => go(`seats/${seat.index}`)}
      >
        Tune
      </Button>
    </div>
  </div>
</Card>

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--gf-space-2);
    margin-bottom: var(--gf-space-2);
  }
  .title {
    display: flex;
    flex-direction: column;
  }
  .num {
    font-weight: 700;
  }
  .chan {
    color: var(--gf-text-muted);
    font-size: var(--gf-font-size-sm);
    font-variant-numeric: tabular-nums;
  }
  .bar {
    position: relative;
    height: 14px;
    background: var(--gf-surface-sunken);
    border-radius: 7px;
    overflow: hidden;
    margin-bottom: var(--gf-space-3);
  }
  .fill {
    height: 100%;
    background: var(--gf-accent);
    transition: width 120ms linear;
  }
  .fill.crossing {
    background: var(--gf-success);
  }
  .mark {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
  }
  .mark.enter {
    background: var(--gf-danger);
  }
  .mark.exit {
    background: var(--gf-warn);
  }
  .rssi {
    position: absolute;
    right: 6px;
    top: -1px;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--gf-text);
  }
  .row {
    display: flex;
    gap: var(--gf-space-2);
    align-items: end;
    flex-wrap: wrap;
  }
  .row + .row {
    margin-top: var(--gf-space-2);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 120px;
  }
  .field.narrow {
    flex: 0 0 84px;
    min-width: 0;
  }
  .field span {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .actions {
    display: flex;
    gap: var(--gf-space-2);
    margin-left: auto;
  }
</style>
