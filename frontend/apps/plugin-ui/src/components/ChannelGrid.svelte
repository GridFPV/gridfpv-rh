<script lang="ts">
  /**
   * The quick channel grid: one small cell per seat with just a channel picker, four across, so
   * a whole profile can be set up in a few clicks. Above it, the live IMD reading for the
   * channels currently in use — the same number RotorHazard's IMDTabler page gives — so the RD
   * sees the set get cleaner or dirtier as they pick.
   */
  import { Badge, Select } from '@gridfpv/components';
  import { BANDS, channelLabel, tagFor } from '../lib/channels.js';
  import {
    imdOffenderMessage,
    imdRatingLabel,
    imdReading,
    imdTone,
    imdToneHint
  } from '../lib/imd.js';
  import type { Seat } from '../lib/seats.js';
  import { setChannel, type WriteResult } from '../lib/rh.svelte.js';

  let { seats, onresult }: { seats: Seat[]; onresult: (r: WriteResult) => void } = $props();

  const inUse = $derived([...new Set(seats.map((s) => s.frequency).filter((f) => f > 0))]);
  const reading = $derived(imdReading(inUse));
  const tone = $derived(imdTone(reading, inUse.length));

  let busy: Record<number, boolean> = $state({});

  /** The <option> value for a seat: `R:1`, or `off`. */
  function valueFor(seat: Seat): string {
    if (!seat.frequency) return 'off';
    const tag =
      seat.band && seat.channel != null
        ? { band: seat.band, channel: seat.channel }
        : tagFor(seat.frequency);
    return tag ? `${tag.band}:${tag.channel}` : 'raw';
  }

  async function onPick(seat: Seat, e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    busy[seat.index] = true;
    try {
      if (v === 'off') {
        onresult(await setChannel(seat.index, null, null, 0));
        return;
      }
      const [band, ch] = v.split(':');
      const freq = BANDS.find((b) => b.key === band)?.channels.find(
        (c) => c.channel === Number(ch)
      )?.frequency;
      if (!freq) return;
      onresult(await setChannel(seat.index, band, Number(ch), freq));
    } finally {
      busy[seat.index] = false;
    }
  }
</script>

<div class="quick">
  <div class="head">
    <div>
      <div class="title">Channels</div>
      <div class="sub">Pick each seat's channel; the IMD reading updates as you go.</div>
    </div>
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
  <div class="grid">
    {#each seats as seat (seat.index)}
      <label class="cell" class:off={!seat.frequency}>
        <span class="seat">Seat {seat.index + 1}</span>
        <Select
          value={valueFor(seat)}
          size="sm"
          disabled={busy[seat.index]}
          onchange={(e: Event) => onPick(seat, e)}
        >
          <option value="off">Off</option>
          {#if valueFor(seat) === 'raw'}
            <option value="raw">{channelLabel(null, null, seat.frequency)}</option>
          {/if}
          {#each BANDS as b (b.key)}
            <optgroup label="{b.key} · {b.name}">
              {#each b.channels as c (c.key)}
                <option value="{b.key}:{c.channel}">{c.key} · {c.frequency}</option>
              {/each}
            </optgroup>
          {/each}
        </Select>
      </label>
    {/each}
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
    align-items: start;
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
  .imd {
    display: flex;
    align-items: center;
    gap: var(--gf-space-2);
    flex-wrap: wrap;
    justify-content: end;
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
  }
  .cell.off .seat {
    opacity: 0.6;
  }
  .seat {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
</style>
