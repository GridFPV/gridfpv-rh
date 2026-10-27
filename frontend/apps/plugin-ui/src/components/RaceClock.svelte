<script lang="ts">
  /**
   * The race clock (#39): countdown for a timed format, count-up otherwise, staging before
   * the start, time-up when a timed race runs over; a small elapsed line under a countdown so
   * the director always has a running clock. One implementation, `clockView`, shared with
   * the overlay; this component only lays it out.
   */
  import { clockView, formatClockMs, RACE_STATUS, type RaceStatus } from '../lib/race.js';

  let {
    race,
    differential,
    now,
    frozenAt,
    size = 'lg'
  }: {
    race: RaceStatus;
    /** RotorHazard's clock minus ours, from the pi_time samples; null until synced. */
    differential: number | null;
    /** `performance.now()` at the last tick. */
    now: number;
    /** Where the clock stopped, once the race is stopped. */
    frozenAt: number | null;
    size?: 'lg' | 'xl';
  } = $props();

  const clock = $derived(clockView(race, differential, now, frozenAt));
  /** Elapsed time under a countdown, once the race has started. */
  const elapsed = $derived(
    !race.unlimitedTime &&
      clock.raceMs != null &&
      clock.raceMs >= 0 &&
      race.status !== RACE_STATUS.READY
      ? formatClockMs(clock.raceMs)
      : ''
  );
  const label = $derived(
    clock.phase === 'staging'
      ? 'staging'
      : clock.phase === 'overtime'
        ? 'time up'
        : clock.phase === 'unsynced'
          ? 'not synced'
          : race.unlimitedTime && clock.phase !== 'idle'
            ? 'elapsed'
            : clock.phase === 'racing' || clock.phase === 'done'
              ? 'remaining'
              : ''
  );
</script>

<div class="raceclock" data-phase={clock.phase} data-size={size} aria-label="Race clock">
  <div class="time" aria-live="off">{clock.text}</div>
  <div class="under">
    {#if label}<span class="label">{label}</span>{/if}
    {#if elapsed}<span class="elapsed" aria-label="Elapsed">{elapsed} elapsed</span>{/if}
  </div>
</div>

<style>
  .raceclock {
    text-align: center;
    min-width: 200px;
  }
  .time {
    font-size: 56px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    letter-spacing: -0.02em;
  }
  .raceclock[data-size='xl'] .time {
    font-size: 84px;
  }
  .under {
    margin-top: 4px;
    display: flex;
    gap: var(--gf-space-2);
    justify-content: center;
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-variant-numeric: tabular-nums;
    min-height: 1.2em;
  }
  .raceclock[data-phase='staging'] .time {
    color: var(--gf-amber-400);
  }
  .raceclock[data-phase='racing'] .time {
    color: var(--gf-green-400);
  }
  .raceclock[data-phase='overtime'] .time {
    color: var(--gf-red-400);
  }
  .raceclock[data-phase='unsynced'] .time,
  .raceclock[data-phase='idle'] .time {
    color: var(--gf-text-muted);
  }
</style>
