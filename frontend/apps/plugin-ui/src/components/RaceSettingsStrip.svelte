<script lang="ts">
  /**
   * One line under the Run header with what RotorHazard's own Run page keeps in its Race
   * Management panel: the seat profile, the minimum lap and what happens to short laps, and
   * the format on the timer. Each links to the page that sets it (Seats, Event, Formats);
   * the format's "edit" opens the existing dialog. Nothing here writes.
   */
  import { formatSummary, type RaceFormat } from '../lib/setup.js';
  import { href, link } from '../lib/router.svelte.js';

  let {
    profileName,
    minLapS,
    behaviorLabel,
    format,
    onEditFormat = undefined
  }: {
    profileName: string;
    minLapS: number;
    behaviorLabel: string;
    format: RaceFormat | undefined;
    onEditFormat?: () => void;
  } = $props();
</script>

<p class="strip" aria-label="Race settings">
  <span class="item"
    >Profile <a href={href('seats')} onclick={link} title="Set on the Seats page"
      >{profileName || '—'}</a
    ></span
  >
  <span class="item"
    >Min lap <a href={href('event')} onclick={link} title="Set on the Event page"
      >{minLapS} s, {behaviorLabel}</a
    ></span
  >
  <span class="item"
    >Format <a href={href('formats')} onclick={link} title="Set on the Formats page"
      >{format ? `${format.name}, ${formatSummary(format)}` : 'none'}</a
    >{#if format && onEditFormat}
      <button type="button" class="linkish" onclick={onEditFormat}>edit</button>{/if}</span
  >
</p>

<style>
  .strip {
    margin: var(--gf-space-1) 0 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--gf-space-1) var(--gf-space-3);
    font-size: var(--gf-font-size-sm);
    color: var(--gf-text-muted);
  }
  .item a {
    color: var(--gf-text);
  }
  .linkish {
    background: none;
    border: 0;
    padding: 0 0 0 var(--gf-space-1);
    color: var(--gf-accent-500, var(--gf-text));
    cursor: pointer;
    font: inherit;
    text-decoration: underline;
  }
</style>
