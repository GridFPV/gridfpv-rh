/**
 * Gate-crossing detection over a dense RSSI trace, ported from the recalculation in
 * RotorHazard 4.4.0's `static/marshal.js` (the Marshal page's "what would the timer have
 * seen with these thresholds" pass). Kept pure so the Seats page and, later, Marshal
 * share one answer.
 *
 * The rule, as RotorHazard applies it: a crossing opens when RSSI rises above `enter`;
 * while open, the pass time is the midpoint of the plateau at the peak RSSI; the crossing
 * closes when RSSI drops below `exit`. A crossing still open at the end of the data is
 * reported with `open: true`.
 *
 * Race-only rules (start-threshold lowering, minimum first crossing, minimum lap time,
 * late-lap deletion) are deliberately not here: a tuning capture has no race clock.
 */

export type Trace = {
  /** Sample times, seconds (RotorHazard monotonic). Must be the same length as values. */
  times: number[];
  /** RSSI samples. */
  values: number[];
};

export type Crossing = {
  /** Time RSSI first exceeded `enter`. */
  start: number;
  /** Time RSSI first fell below `exit` (or the last sample when `open`). */
  end: number;
  /** The pass timestamp RotorHazard would record: midpoint of the peak plateau. */
  at: number;
  peak: number;
  /** True when the data ended before RSSI fell below `exit`. */
  open: boolean;
};

export function detectCrossings(trace: Trace, enter: number, exit: number): Crossing[] {
  const out: Crossing[] = [];
  const n = Math.min(trace.times.length, trace.values.length);
  let crossing = false;
  let start = 0;
  let peak = 0;
  let peakFirst = 0;
  let peakLast = 0;
  let time = 0;

  for (let i = 0; i < n; i++) {
    const rssi = trace.values[i];
    time = trace.times[i];

    if (!crossing && rssi > enter) {
      crossing = true;
      start = time;
    }

    // Peak tracking runs even outside a crossing, exactly as marshal.js does; the peak is
    // reset only when a crossing closes.
    if (rssi >= peak) {
      peakLast = time;
      if (rssi > peak) {
        peakFirst = time;
        peak = rssi;
      }
    }

    if (crossing && rssi < exit) {
      out.push({ start, end: time, at: (peakFirst + peakLast) / 2, peak, open: false });
      crossing = false;
      peak = 0;
    }
  }

  if (crossing) {
    out.push({ start, end: time, at: (peakFirst + peakLast) / 2, peak, open: true });
  }
  return out;
}

/** Min and max RSSI over a trace, or null for an empty one. */
export function traceRange(trace: Trace): { min: number; max: number } | null {
  if (trace.values.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const v of trace.values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}
