/**
 * RotorHazard's clock, on this machine. RotorHazard stamps staging and the start on its own
 * monotonic clock (seconds). Like Grid's run page, we sample it (`get_pi_time` → `pi_time`),
 * put each sample at the middle of its round trip, keep the median offset, and convert its
 * stamps to local milliseconds with that. Local time here is `performance.now()`.
 */
export const SYNC_SAMPLES = 10;

/** Add one sample: the timer said `piTimeS` to a request sent at `sentAt`, answered at `gotAt`. */
export function addSample(samples, piTimeS, sentAt, gotAt) {
  const mid = (sentAt + gotAt) / 2;
  const next = [...samples, { differential: piTimeS * 1000 - mid, response: gotAt - sentAt }];
  // Keep the quickest round trips: they place the sample best.
  return next.sort((a, b) => a.response - b.response).slice(0, SYNC_SAMPLES);
}

/** The median of the kept offsets (timer ms − local ms), or null with no samples. */
export function differential(samples) {
  if (!samples.length) return null;
  const a = samples.map((s) => s.differential).sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** A timer stamp (seconds) as local ms, given the differential. */
export function localMs(piTimeS, diff) {
  return piTimeS * 1000 - diff;
}

/**
 * Where the race start sits in the recording. At local time `nowLocal` the recording was
 * `recordMs` long and the race was `nowLocal - startLocal` old, so the start is at
 * `recordMs - (nowLocal - startLocal)` in the file. Milliseconds, may be negative if the
 * recording started after the start signal (then the file begins mid-race).
 */
export function raceStartInRecording(recordMs, nowLocal, startLocal) {
  return recordMs - (nowLocal - startLocal);
}
