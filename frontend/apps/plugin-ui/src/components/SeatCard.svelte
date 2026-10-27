<script lang="ts">
  /**
   * One seat (RotorHazard node) in the active profile: its channel, thresholds, live RSSI
   * and status, with the edits that write straight back to RotorHazard. Every write goes
   * through the store, which confirms it by readback and reports the outcome up.
   */
  import { Badge, Button, Card, Input } from '@gridfpv/components';
  import ChannelPicker from './ChannelPicker.svelte';
  import CopyLevelsDialog from './CopyLevelsDialog.svelte';
  import { channelLabel, seatTag } from '../lib/channels.js';
  import { seatStatus, type Seat } from '../lib/seats.js';
  import { setLevels, type WriteResult } from '../lib/rh.svelte.js';
  import { go } from '../lib/router.svelte.js';

  let {
    seat,
    raceOn = false,
    onresult
  }: {
    seat: Seat;
    /** A race is staged or running: the channel is locked, thresholds still write live (#87). */
    raceOn?: boolean;
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
  const tag = $derived(seatTag(seat));

  // ---- thresholds ----
  let busy = $state(false);
  let enter = $state('');
  let exit = $state('');
  // The inputs follow RotorHazard only when RotorHazard's value actually changes. A readback
  // after writing enter re-delivers the whole seat; without this guard it would reset an exit
  // value the director is still typing (and vice versa).
  let lastEnter: number | null | undefined;
  let lastExit: number | null | undefined;
  $effect(() => {
    if (seat.enter !== lastEnter) {
      lastEnter = seat.enter;
      enter = seat.enter == null ? '' : String(seat.enter);
    }
  });
  $effect(() => {
    if (seat.exit !== lastExit) {
      lastExit = seat.exit;
      exit = seat.exit == null ? '' : String(seat.exit);
    }
  });
  const levelsDirty = $derived(
    enter !== (seat.enter == null ? '' : String(seat.enter)) ||
      exit !== (seat.exit == null ? '' : String(seat.exit))
  );
  const levelsValid = $derived(Number(enter) > Number(exit) && Number(exit) > 0);

  /**
   * Write the thresholds when an edit completes (blur / Enter), if they changed and are sane.
   * Leaving enter for exit fires a blur mid-edit; a commit that arrives while one is in
   * flight is queued and runs once with the final values rather than dropped. The inputs are
   * never disabled during a write — tabbing from enter to exit would otherwise lose keystrokes.
   */
  let queued = false;
  function revertLevels() {
    enter = seat.enter == null ? '' : String(seat.enter);
    exit = seat.exit == null ? '' : String(seat.exit);
  }
  async function commitLevels(e?: FocusEvent) {
    if (!levelsDirty) return;
    if (!levelsValid) {
      // Still inside the pair (enter → exit by Tab): wait for the other field.
      const next = e?.relatedTarget as HTMLElement | null;
      if (next && next.closest('.levels') === (e?.currentTarget as HTMLElement)?.closest('.levels'))
        return;
      // Leaving with a pair RotorHazard would not take: say so and show its values again (#77).
      onresult({
        ok: false,
        message:
          "Not written: Exit must be above 0 and below Enter. Values are RotorHazard's again."
      });
      revertLevels();
      return;
    }
    if (busy) {
      queued = true;
      return;
    }
    busy = true;
    try {
      onresult(await setLevels(seat.index, Number(enter), Number(exit)));
    } finally {
      busy = false;
    }
    if (queued) {
      queued = false;
      void commitLevels();
    }
  }
  const onEnterKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
  };

  let copyOpen = $state(false);

  // ---- live bar ----
  const scale = $derived(Math.max(seat.peak ?? 0, seat.enter ?? 0, seat.rssi, 100));
  const pct = (v: number | null) => (v == null ? 0 : Math.min(100, (v / scale) * 100));
</script>

<CopyLevelsDialog bind:open={copyOpen} from={seat} {onresult} />

<Card elevation="xs">
  <div class="head">
    <div class="title">
      <span class="num">Seat {seat.index + 1}</span>
      <span class="chan">{channelLabel(tag?.band, tag?.channel, seat.frequency)}</span>
    </div>
    <div class="badges">
      {#if raceOn}
        <span title="Channel locked while the race is on; thresholds still write live">
          <Badge tone="warn">Race on</Badge>
        </span>
      {/if}
      <Badge tone={STATUS[status].tone} dot={status === 'crossing'}>{STATUS[status].label}</Badge>
    </div>
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

  <div class="row levels">
    <label class="field narrow">
      <span>Enter</span>
      <Input
        type="number"
        size="sm"
        bind:value={enter}
        min="1"
        max="255"
        onblur={commitLevels}
        onkeydown={onEnterKey}
      />
    </label>
    <label class="field narrow">
      <span>Exit</span>
      <Input
        type="number"
        size="sm"
        bind:value={exit}
        min="1"
        max="255"
        onblur={commitLevels}
        onkeydown={onEnterKey}
      />
    </label>
    <div class="actions">
      <Button
        size="sm"
        variant="ghost"
        disabled={seat.enter == null || seat.exit == null}
        title="Copy this seat's enter / exit to other seats"
        onclick={() => (copyOpen = true)}
      >
        Copy…
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
  .badges {
    display: flex;
    gap: var(--gf-space-1);
    align-items: center;
  }
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
