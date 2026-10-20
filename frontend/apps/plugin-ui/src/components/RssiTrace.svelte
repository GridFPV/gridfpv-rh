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

  // Time scale. RotorHazard's tuning page draws at a fixed pixels-per-second in a small
  // strip, which is what makes the same data look calmer there; stretching a 12 s capture
  // across the whole modal gives every sample several pixels and reads as jagged. So the
  // plot spans a chosen number of seconds (default 60) and scrolls when the capture is
  // longer; "Fit" stretches the whole capture as before.
  const SCALES: Array<{ label: string; seconds: number | null }> = [
    { label: '30 s', seconds: 30 },
    { label: '60 s', seconds: 60 },
    { label: '2 min', seconds: 120 },
    { label: 'Fit', seconds: null }
  ];
  let scaleSeconds: number | null = $state(60);
  let offsetSec = $state(0);
  const viewSpan = $derived(scaleSeconds ?? span);
  const maxOffset = $derived(Math.max(0, span - viewSpan));
  const viewStart = $derived(t0 + Math.min(Math.max(0, offsetSec), maxOffset));
  const viewEnd = $derived(viewStart + viewSpan);
  // While recording, keep the newest samples in view.
  $effect(() => {
    if (readonly) offsetSec = maxOffset;
  });

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

  const x = (t: number) => PAD.left + ((t - viewStart) / viewSpan) * (W - PAD.left - PAD.right);
  const y = (v: number) =>
    PAD.top + (1 - (v - yRange.lo) / (yRange.hi - yRange.lo)) * (height - PAD.top - PAD.bottom);
  const vFromY = (py: number) =>
    yRange.hi - ((py - PAD.top) / (height - PAD.top - PAD.bottom)) * (yRange.hi - yRange.lo);

  // Samples in view (plus one either side so the line runs off the edges), as a smooth
  // Catmull-Rom curve — display only; detection uses the raw samples.
  const path = $derived.by(() => {
    const n = trace.times.length;
    if (!n) return '';
    let a = 0;
    while (a < n && trace.times[a] < viewStart) a++;
    let b = n - 1;
    while (b >= 0 && trace.times[b] > viewEnd) b--;
    a = Math.max(0, a - 1);
    b = Math.min(n - 1, b + 1);
    if (b < a) return '';
    const px: number[] = [];
    const py: number[] = [];
    for (let i = a; i <= b; i++) {
      px.push(x(trace.times[i]));
      py.push(y(trace.values[i]));
    }
    if (px.length === 1) return `M${px[0].toFixed(1)},${py[0].toFixed(1)}`;
    let d = `M${px[0].toFixed(1)},${py[0].toFixed(1)}`;
    for (let i = 0; i < px.length - 1; i++) {
      const p0x = px[Math.max(0, i - 1)],
        p0y = py[Math.max(0, i - 1)];
      const p1x = px[i],
        p1y = py[i];
      const p2x = px[i + 1],
        p2y = py[i + 1];
      const p3x = px[Math.min(px.length - 1, i + 2)],
        p3y = py[Math.min(px.length - 1, i + 2)];
      const c1x = p1x + (p2x - p0x) / 6,
        c1y = p1y + (p2y - p0y) / 6;
      const c2x = p2x - (p3x - p1x) / 6,
        c2y = p2y - (p3y - p1y) / 6;
      d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2x.toFixed(1)},${p2y.toFixed(1)}`;
    }
    return d;
  });
  const inView = (start: number, end: number) => end >= viewStart && start <= viewEnd;
  const clampX = (v: number) => Math.max(PAD.left, Math.min(W - PAD.right, v));

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
  <div class="toolbar">
    <span class="muted">Scale</span>
    {#each SCALES as sc (sc.label)}
      <button
        type="button"
        class="scale"
        class:active={scaleSeconds === sc.seconds}
        onclick={() => (scaleSeconds = sc.seconds)}>{sc.label}</button
      >
    {/each}
    {#if maxOffset > 0}
      <input
        class="scroll"
        type="range"
        min="0"
        max={maxOffset}
        step="0.1"
        bind:value={offsetSec}
        disabled={readonly}
        aria-label="Scroll the trace"
      />
    {/if}
  </div>
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
    <text class="axis" x={PAD.left} y={height - 6}>{(viewStart - t0).toFixed(1)}s</text>
    <text class="axis" x={W - PAD.right} y={height - 6} text-anchor="end"
      >{(viewEnd - t0).toFixed(1)}s</text
    >

    <!-- computed crossings: shaded bands with the pass instant -->
    {#each computed as c, i (i)}
      {#if inView(c.start, c.end)}
        <rect
          class="pass"
          class:open={c.open}
          x={clampX(x(c.start))}
          y={PAD.top}
          width={Math.max(clampX(x(c.end)) - clampX(x(c.start)), 2)}
          height={height - PAD.top - PAD.bottom}
        />
        {#if inView(c.at, c.at)}
          <line class="pass-at" x1={x(c.at)} x2={x(c.at)} y1={PAD.top} y2={height - PAD.bottom} />
        {/if}
      {/if}
    {/each}

    <!-- firmware crossings: ticks along the top -->
    {#each firmware as c, i (i)}
      {#if inView(c.start, c.end)}
        <rect
          class="fw"
          x={clampX(x(c.start))}
          y={PAD.top - 10}
          width={Math.max(clampX(x(c.end)) - clampX(x(c.start)), 2)}
          height={6}
        />
      {/if}
    {/each}

    <!-- the signal -->
    {#if path}
      <path class="rssi" d={path} />
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
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--gf-space-1);
    margin-bottom: var(--gf-space-2);
    font-size: var(--gf-font-size-sm);
  }
  .muted {
    color: var(--gf-text-muted);
    margin-right: var(--gf-space-1);
  }
  .scale {
    font: inherit;
    font-size: var(--gf-font-size-xs);
    padding: 2px 8px;
    border-radius: var(--gf-radius-md);
    border: 1px solid var(--gf-border);
    background: transparent;
    color: var(--gf-text-muted);
    cursor: pointer;
  }
  .scale.active {
    color: var(--gf-text);
    background: var(--gf-surface);
    border-color: var(--gf-accent);
  }
  .scroll {
    flex: 1;
    min-width: 120px;
    margin-left: var(--gf-space-2);
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
