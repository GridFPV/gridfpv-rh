<script lang="ts">
  /**
   * The RSSI trace: a dense signal recording with the enter / exit thresholds drawn as
   * draggable lines, the crossings those thresholds would produce shaded underneath, and
   * (optionally) the crossings the firmware actually reported, as ticks along the top.
   *
   * Pure SVG, no chart library: the trace is one polyline, and dragging a threshold just
   * moves a line and re-runs `detectCrossings`. Shared by the Seats tuning drill-in now
   * and by Marshal later.
   */
  import { detectCrossings, traceRange, type Crossing, type Trace } from '../lib/crossings.js';

  let {
    trace,
    enter = $bindable(),
    exit = $bindable(),
    firmware = [],
    height = 260,
    readonly = false,
    oncommit = undefined,
    detectOn = undefined
  }: {
    trace: Trace;
    enter: number;
    exit: number;
    /** Crossings the firmware reported, drawn as reference ticks. */
    firmware?: Crossing[];
    height?: number;
    readonly?: boolean;
    /** Fires when a threshold edit is complete: a drag released, or a key nudge. */
    oncommit?: (enter: number, exit: number) => void;
    /** Trace to detect crossings on, when it differs from the drawn one (samples + extrema). */
    detectOn?: Trace;
  } = $props();

  const W = 1000; // viewBox units; the SVG scales to its container
  const PAD = { top: 18, right: 12, bottom: 24, left: 36 };

  const t0 = $derived(trace.times[0] ?? 0);
  const t1 = $derived(trace.times[trace.times.length - 1] ?? t0 + 1);
  const span = $derived(Math.max(t1 - t0, 0.001));

  // Y range: the data's own span with headroom, always wide enough to show both lines.
  // While a line is being dragged the range is frozen: if it followed the line, moving
  // the line would rescale the plot, which moves the line under the cursor, which
  // rescales again.
  const liveRange = $derived.by(() => {
    const r = traceRange(detectOn ?? trace) ?? { min: 0, max: 100 };
    const lo = Math.max(0, Math.min(r.min, exit) - 8);
    const hi = Math.min(255, Math.max(r.max, enter) + 12);
    return { lo, hi: Math.max(hi, lo + 10) };
  });
  let frozen: { lo: number; hi: number } | null = $state(null);
  const yRange = $derived(frozen ?? liveRange);

  const x = (t: number) => PAD.left + ((t - t0) / span) * (W - PAD.left - PAD.right);
  const y = (v: number) =>
    PAD.top + (1 - (v - yRange.lo) / (yRange.hi - yRange.lo)) * (height - PAD.top - PAD.bottom);
  const vFromY = (py: number) =>
    yRange.hi - ((py - PAD.top) / (height - PAD.top - PAD.bottom)) * (yRange.hi - yRange.lo);

  const points = $derived(
    trace.times.map((t, i) => `${x(t).toFixed(1)},${y(trace.values[i]).toFixed(1)}`).join(' ')
  );

  const computed = $derived(detectCrossings(detectOn ?? trace, enter, exit));

  // Gridlines at sensible RSSI steps.
  const yTicks = $derived.by(() => {
    const spanV = yRange.hi - yRange.lo;
    const step = spanV > 120 ? 40 : spanV > 60 ? 20 : spanV > 30 ? 10 : 5;
    const out: number[] = [];
    for (let v = Math.ceil(yRange.lo / step) * step; v <= yRange.hi; v += step) out.push(v);
    return out;
  });

  // ---- dragging a threshold line ----
  let svg: SVGSVGElement | undefined = $state();
  let dragging: 'enter' | 'exit' | null = $state(null);

  function valueAt(ev: PointerEvent): number {
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    const py = ((ev.clientY - rect.top) / rect.height) * height;
    return Math.round(vFromY(py));
  }

  function startDrag(which: 'enter' | 'exit', ev: PointerEvent) {
    if (readonly) return;
    dragging = which;
    frozen = { ...liveRange };
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
  }
  function drag(ev: PointerEvent) {
    if (!dragging) return;
    // Clamp to the (frozen) plot so the line can't leave the visible range mid-drag;
    // release and drag again to go further, the range grows to make room.
    const v = Math.max(yRange.lo + 1, Math.min(yRange.hi - 1, valueAt(ev)));
    // RotorHazard never lets exit rise above enter; mirror that while dragging.
    if (dragging === 'enter') enter = Math.max(v, exit + 1);
    else exit = Math.min(v, enter - 1);
  }
  function endDrag() {
    const was = dragging;
    dragging = null;
    frozen = null;
    if (was) oncommit?.(enter, exit);
  }
  function keyNudge(which: 'enter' | 'exit', ev: KeyboardEvent) {
    const step = ev.shiftKey ? 5 : 1;
    const delta = ev.key === 'ArrowUp' ? step : ev.key === 'ArrowDown' ? -step : 0;
    if (!delta) return;
    ev.preventDefault();
    if (which === 'enter') enter = Math.max(exit + 1, enter + delta);
    else exit = Math.max(1, Math.min(enter - 1, exit + delta));
    oncommit?.(enter, exit);
  }

  export function crossings(): Crossing[] {
    return computed;
  }
</script>

<div class="trace" class:dragging={dragging !== null}>
  <svg
    bind:this={svg}
    viewBox="0 0 {W} {height}"
    preserveAspectRatio="none"
    role="img"
    aria-label="RSSI trace with enter and exit thresholds"
    onpointermove={drag}
    onpointerup={endDrag}
    onpointercancel={endDrag}
  >
    <!-- gridlines + axis labels -->
    {#each yTicks as v (v)}
      <line class="grid" x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
      <text class="axis" x={PAD.left - 6} y={y(v) + 4} text-anchor="end">{v}</text>
    {/each}
    <text class="axis" x={PAD.left} y={height - 6}>0s</text>
    <text class="axis" x={W - PAD.right} y={height - 6} text-anchor="end">{span.toFixed(1)}s</text>

    <!-- computed crossings: shaded bands with the pass instant -->
    {#each computed as c, i (i)}
      <rect
        class="pass"
        class:open={c.open}
        x={x(c.start)}
        y={PAD.top}
        width={Math.max(x(c.end) - x(c.start), 2)}
        height={height - PAD.top - PAD.bottom}
      />
      <line class="pass-at" x1={x(c.at)} x2={x(c.at)} y1={PAD.top} y2={height - PAD.bottom} />
    {/each}

    <!-- firmware crossings: ticks along the top -->
    {#each firmware as c, i (i)}
      <rect
        class="fw"
        x={x(c.start)}
        y={PAD.top - 10}
        width={Math.max(x(c.end) - x(c.start), 2)}
        height={6}
      />
    {/each}

    <!-- the signal -->
    {#if points}
      <polyline class="rssi" {points} />
    {/if}

    <!-- thresholds -->
    <line class="enter" x1={PAD.left} x2={W - PAD.right} y1={y(enter)} y2={y(enter)} />
    <line class="exit" x1={PAD.left} x2={W - PAD.right} y1={y(exit)} y2={y(exit)} />
    <text class="label enter" x={W - PAD.right - 4} y={y(enter) - 5} text-anchor="end"
      >enter {enter}</text
    >
    <text class="label exit" x={W - PAD.right - 4} y={y(exit) + 14} text-anchor="end"
      >exit {exit}</text
    >
    {#if !readonly}
      <!-- fat invisible hit areas so the lines are draggable on a phone; also keyboard sliders -->
      <rect
        class="handle"
        role="slider"
        tabindex="0"
        aria-label="Enter threshold"
        aria-valuenow={enter}
        aria-valuemin={exit + 1}
        aria-valuemax={255}
        x={PAD.left}
        y={y(enter) - 12}
        width={W - PAD.left - PAD.right}
        height={24}
        onpointerdown={(e) => startDrag('enter', e)}
        onkeydown={(e) => keyNudge('enter', e)}
      />
      <rect
        class="handle"
        role="slider"
        tabindex="0"
        aria-label="Exit threshold"
        aria-valuenow={exit}
        aria-valuemin={1}
        aria-valuemax={enter - 1}
        x={PAD.left}
        y={y(exit) - 12}
        width={W - PAD.left - PAD.right}
        height={24}
        onpointerdown={(e) => startDrag('exit', e)}
        onkeydown={(e) => keyNudge('exit', e)}
      />
    {/if}
  </svg>
</div>

<style>
  .trace {
    width: 100%;
    touch-action: none;
  }
  svg {
    display: block;
    width: 100%;
    height: auto;
    background: var(--gf-surface);
    border: 1px solid var(--gf-border);
    border-radius: var(--gf-radius-md);
  }
  .grid {
    stroke: var(--gf-border);
    stroke-width: 1;
  }
  .axis {
    fill: var(--gf-text-muted);
    font-size: 12px;
    font-family: var(--gf-font-family);
  }
  .rssi {
    fill: none;
    stroke: var(--gf-accent);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .pass {
    fill: color-mix(in srgb, var(--gf-success) 18%, transparent);
  }
  .pass.open {
    fill: color-mix(in srgb, var(--gf-warn) 18%, transparent);
  }
  .pass-at {
    stroke: var(--gf-success);
    stroke-width: 1;
    stroke-dasharray: 4 3;
    vector-effect: non-scaling-stroke;
  }
  .fw {
    fill: var(--gf-info);
  }
  .enter {
    stroke: var(--gf-danger);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .exit {
    stroke: var(--gf-warn);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .label {
    font-size: 12px;
    font-family: var(--gf-font-family);
    font-weight: 600;
  }
  .label.enter {
    fill: var(--gf-danger);
  }
  .label.exit {
    fill: var(--gf-warn);
  }
  .handle {
    fill: transparent;
    cursor: ns-resize;
  }
  .dragging {
    cursor: ns-resize;
    user-select: none;
  }
</style>
