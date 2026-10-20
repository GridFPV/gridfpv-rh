<script lang="ts">
  /**
   * Capture-mode tuning for one seat (#7, review item 8): start a capture, fly passes, stop,
   * then drag enter / exit on the recording until the crossings look right, and apply.
   */
  import { Badge, Banner, Button, Card } from '@gridfpv/components';
  import RssiTrace from '../components/RssiTrace.svelte';
  import { channelLabel, tagFor } from '../lib/channels.js';
  import { detectCrossings, mergeTraces, sortedTrace } from '../lib/crossings.js';
  import {
    captureStart,
    captureStop,
    firmwareCrossings,
    rh,
    setLevels,
    type WriteResult
  } from '../lib/rh.svelte.js';

  let { seatIndex }: { seatIndex: number } = $props();

  const timer = rh();
  const seat = $derived(timer.seats[seatIndex]);
  const tag = $derived(
    seat?.band && seat.channel != null
      ? { band: seat.band, channel: seat.channel }
      : tagFor(seat?.frequency ?? 0)
  );
  const cap = $derived(timer.capture && timer.capture.seat === seatIndex ? timer.capture : null);
  const recording = $derived(cap?.state === 'recording');
  const otherSeatRecording = $derived(
    timer.capture?.state === 'recording' && timer.capture.seat !== seatIndex
  );

  // Thresholds being tuned: start from the seat's, then follow the drag.
  let enter = $state(0);
  let exit = $state(0);
  let seeded = $state(false);
  $effect(() => {
    if (!seeded && seat && seat.enter != null && seat.exit != null) {
      enter = seat.enter;
      exit = seat.exit;
      seeded = true;
    }
  });

  // Drawn: the steady current-RSSI samples. Detected on: samples plus RotorHazard's history
  // extrema, so a peak between two samples still counts (as it does on the Marshal page).
  const trace = $derived(
    sortedTrace({ times: cap?.sampleTimes ?? [], values: cap?.sampleValues ?? [] })
  );
  const detectOn = $derived(
    mergeTraces(trace, { times: cap?.times ?? [], values: cap?.values ?? [] })
  );
  const computed = $derived(detectCrossings(detectOn, enter, exit));
  const firmware = $derived(cap ? firmwareCrossings(cap) : []);

  let busy = $state(false);
  let notice: { tone: 'success' | 'danger' | 'info'; text: string } | null = $state(null);

  async function run(fn: () => Promise<WriteResult>, okText: string) {
    busy = true;
    try {
      const r = await fn();
      notice = r.ok
        ? { tone: 'success', text: okText }
        : { tone: 'danger', text: r.message ?? 'RotorHazard did not confirm.' };
    } finally {
      busy = false;
    }
  }

  // Thresholds write to RotorHazard as soon as an edit completes (a drag released, a nudge),
  // debounced so a run of +/- clicks is one write, and confirmed by readback like every write.
  let commitTimer = 0;
  function commit() {
    window.clearTimeout(commitTimer);
    commitTimer = window.setTimeout(() => {
      if (!seat || recording || exit < 1 || enter <= exit) return;
      if (enter === seat.enter && exit === seat.exit) return;
      void run(
        () => setLevels(seatIndex, enter, exit),
        `Seat ${seatIndex + 1} now enters at ${enter}, exits at ${exit}.`
      );
    }, 400);
  }

  function nudge(which: 'enter' | 'exit', delta: number) {
    if (which === 'enter') enter = Math.max(exit + 1, enter + delta);
    else exit = Math.max(1, Math.min(enter - 1, exit + delta));
    commit();
  }
</script>

<section class="page">
  <div class="status">
    {#if seat}
      <span class="chan">{channelLabel(tag?.band, tag?.channel, seat.frequency)}</span>
    {/if}
    {#if recording}
      <Badge tone="danger" dot>Recording · {cap?.seconds ?? 0}s · {cap?.samples ?? 0} samples</Badge
      >
    {:else if cap}
      <Badge tone="success">Captured · {cap.seconds}s · {cap.samples} samples</Badge>
    {/if}
  </div>

  {#if !seat}
    <p class="muted">Waiting for RotorHazard to report this seat…</p>
  {:else if !seat.frequency}
    <Banner tone="warn">This seat is off. Pick a channel on the Seats page first.</Banner>
  {:else}
    <Card
      title="Capture"
      subtitle="Record the signal, fly a few passes, then tune on the recording"
    >
      <div class="controls">
        {#if recording}
          <Button
            variant="danger"
            disabled={busy}
            onclick={() => run(captureStop, 'Capture stopped.')}
          >
            Stop capture
          </Button>
        {:else}
          <Button
            variant="primary"
            disabled={busy || otherSeatRecording}
            onclick={() => run(() => captureStart(seatIndex), 'Recording. Fly through the gate.')}
          >
            {cap ? 'Capture again' : 'Start capture'}
          </Button>
        {/if}
        {#if otherSeatRecording}
          <span class="muted"
            >Seat {(timer.capture?.seat ?? 0) + 1} is recording; stop it first.</span
          >
        {/if}
        <span class="live muted"
          >Live RSSI <strong>{seat.rssi}</strong>{seat.crossing ? ' · crossing' : ''}</span
        >
      </div>
    </Card>

    {#if notice}
      <Banner tone={notice.tone} ondismiss={() => (notice = null)}>{notice.text}</Banner>
    {/if}

    <Card
      title="Trace"
      subtitle="Drag the lines. Green bands are the passes these thresholds would record; blue ticks are what the firmware saw."
    >
      {#if trace.times.length === 0}
        <p class="muted">No recording yet{recording ? ' — samples arrive every second' : ''}.</p>
      {:else}
        <RssiTrace
          {trace}
          {detectOn}
          bind:enter
          bind:exit
          {firmware}
          readonly={recording}
          oncommit={commit}
        />
      {/if}
      <div class="tune">
        <div class="level">
          <span class="lbl enter">Enter</span>
          <Button size="sm" variant="ghost" onclick={() => nudge('enter', -1)}>−</Button>
          <strong>{enter}</strong>
          <Button size="sm" variant="ghost" onclick={() => nudge('enter', 1)}>+</Button>
        </div>
        <div class="level">
          <span class="lbl exit">Exit</span>
          <Button size="sm" variant="ghost" onclick={() => nudge('exit', -1)}>−</Button>
          <strong>{exit}</strong>
          <Button size="sm" variant="ghost" onclick={() => nudge('exit', 1)}>+</Button>
        </div>
        <div class="counts muted">
          {computed.length} pass{computed.length === 1 ? '' : 'es'} with these thresholds
          {#if firmware.length}· {firmware.length} seen by the firmware{/if}
        </div>
      </div>
      {#if computed.length}
        <ol class="passes">
          {#each computed as c, i (i)}
            <li>
              <span>Pass {i + 1}</span>
              <span class="muted">at {(c.at - (trace.times[0] ?? 0)).toFixed(2)}s</span>
              <span class="muted">peak {c.peak}</span>
              <span class="muted">{(c.end - c.start).toFixed(2)}s wide</span>
              {#if c.open}<Badge tone="warn">still open</Badge>{/if}
            </li>
          {/each}
        </ol>
      {/if}
    </Card>
  {/if}
</section>

<style>
  .page {
    display: grid;
    gap: var(--gf-space-3);
  }
  .status {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--gf-space-3);
    flex-wrap: wrap;
  }
  .chan {
    color: var(--gf-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .controls {
    display: flex;
    gap: var(--gf-space-3);
    align-items: center;
    flex-wrap: wrap;
  }
  .live {
    margin-left: auto;
  }
  .muted {
    color: var(--gf-text-muted);
    margin: 0;
  }
  .tune {
    display: flex;
    gap: var(--gf-space-4);
    align-items: center;
    flex-wrap: wrap;
    margin-top: var(--gf-space-3);
  }
  .level {
    display: flex;
    gap: var(--gf-space-1);
    align-items: center;
    font-variant-numeric: tabular-nums;
  }
  .level strong {
    min-width: 2.5ch;
    text-align: center;
  }
  .lbl {
    font-size: var(--gf-font-size-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 700;
  }
  .lbl.enter {
    color: var(--gf-danger);
  }
  .lbl.exit {
    color: var(--gf-warn);
  }
  .passes {
    margin: var(--gf-space-3) 0 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: var(--gf-space-1);
  }
  .passes li {
    display: flex;
    gap: var(--gf-space-3);
    align-items: center;
    font-variant-numeric: tabular-nums;
  }
</style>
