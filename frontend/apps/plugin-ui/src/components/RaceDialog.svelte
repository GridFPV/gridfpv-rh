<script lang="ts">
  /**
   * One saved race, as RotorHazard ranked it: who flew, where they finished, laps and
   * times — the check before advancing, with the way to Marshal if something is wrong.
   */
  import { Button, Dialog } from '@gridfpv/components';
  import type { RaceResult } from '../lib/results.js';
  import { href, link } from '../lib/router.svelte.js';

  let { race, heatName, onclose }: { race: RaceResult; heatName: string; onclose: () => void } =
    $props();
  let open = $state(true);
</script>

<Dialog bind:open title="{heatName} · round {race.round}" {onclose}>
  <p class="muted when">Raced {race.startTime}</p>
  <table class="lb">
    <thead><tr><th>#</th><th>Pilot</th><th>Laps</th><th>Time</th><th>Fastest</th></tr></thead>
    <tbody>
      {#each race.rows as r (r.pilotId + ':' + r.node)}
        <tr>
          <td class="pos">{r.position}</td>
          <td>{r.callsign}</td>
          <td>{r.laps}</td>
          <td>{r.totalTime || '—'}</td>
          <td>{r.fastestLap || '—'}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#snippet footer()}
    <a class="marshal" href={href(`marshal?heat=${race.heatId}&round=${race.round}`)} onclick={link}
      >Marshal this race</a
    >
    <Button variant="primary" onclick={() => (open = false)}>Done</Button>
  {/snippet}
</Dialog>

<style>
  .when {
    margin: 0 0 var(--gf-space-2);
    font-size: var(--gf-font-size-sm);
  }
  .lb {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  .lb th,
  .lb td {
    text-align: left;
    padding: 4px var(--gf-space-2);
    border-bottom: 1px solid var(--gf-border);
  }
  .lb th {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .pos {
    font-weight: 700;
    width: 2em;
  }
  .marshal {
    margin-right: auto;
    align-self: center;
  }
  .muted {
    color: var(--gf-text-muted);
  }
</style>
