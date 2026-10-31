<script lang="ts">
  /**
   * What RotorHazard's own Run page keeps in its Race Management panel, as rows of the Run
   * card's Details: the seat profile, and the minimum lap with what happens to short laps.
   * Each links to the page that sets it (Seats, Event). Nothing here writes. The format row
   * is the Run page's own, next to these.
   */
  import { href, link } from '../lib/router.svelte.js';

  let {
    profileName,
    minLapS,
    behaviorLabel
  }: {
    profileName: string;
    minLapS: number;
    behaviorLabel: string;
  } = $props();
</script>

<div class="strip" aria-label="Race settings">
  <div class="row">
    <dt>Profile</dt>
    <dd>
      <a href={href('seats')} onclick={link} title="Set on the Seats page">{profileName || '—'}</a>
    </dd>
  </div>
  <div class="row">
    <dt>Min lap</dt>
    <dd>
      <a href={href('event')} onclick={link} title="Set on the Event page"
        >{minLapS} s, {behaviorLabel}</a
      >
    </dd>
  </div>
</div>

<style>
  .strip {
    display: contents;
  }
  .row {
    display: grid;
    grid-template-columns: 9rem 1fr;
    gap: var(--gf-space-3);
    align-items: center;
  }
  dt {
    font-size: var(--gf-font-size-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--gf-text-muted);
  }
  dd {
    margin: 0;
  }
  a {
    color: var(--gf-text);
  }
</style>
