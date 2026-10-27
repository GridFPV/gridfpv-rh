<script lang="ts">
  /**
   * One of RotorHazard's leaderboards, with its columns (rotorhazard.js build_leaderboard):
   * rank, pilot, team on team races, starts on boards that span races, then laps / total /
   * average for a race-time board, fastest (+ where) for a fastest-lap board, consecutives
   * (+ where) for a consecutives board; a heat or round board shows all of them, and a round
   * adds points when the format scores them. Cell classes match RotorHazard's.
   */
  import type { BoardMeta, BoardRow } from '../lib/resultBoards.js';

  let {
    rows,
    meta,
    kind,
    starts = false
  }: {
    rows: BoardRow[];
    meta: BoardMeta;
    /** Which columns: a single board, or a heat/round board that shows every figure. */
    kind: 'by_race_time' | 'by_fastest_lap' | 'by_consecutives' | 'heat' | 'round';
    starts?: boolean;
  } = $props();
  const all = $derived(kind === 'heat' || kind === 'round');
  const timeCols = $derived(all || kind === 'by_race_time');
  const fastCols = $derived(all || kind === 'by_fastest_lap');
  const consCols = $derived(all || kind === 'by_consecutives');
  const points = $derived(kind === 'round' && rows.some((r) => r.points !== ''));
  const totalLabel = $derived(meta.startBehavior === 2 ? 'Laps total' : 'Total');
</script>

<div class="wrap">
  <table class="leaderboard">
    <thead>
      <tr>
        <th class="pos"><span class="sr">Rank</span></th>
        <th class="pilot">Pilot</th>
        {#if meta.teamRacing}<th class="team">Team</th>{/if}
        {#if starts}<th class="starts">Starts</th>{/if}
        {#if timeCols}<th class="laps">Laps</th><th class="total">{totalLabel}</th><th class="avg"
            >Avg</th
          >{/if}
        {#if fastCols}<th class="fast">Fastest</th>{#if kind === 'by_fastest_lap' || all}<th
              class="source">From</th
            >{/if}{/if}
        {#if consCols}<th class="consecutive">{meta.consecutivesCount || ''} consec.</th
          >{#if kind === 'by_consecutives' || all}<th class="source">From</th>{/if}{/if}
        {#if points}<th class="points">Points</th>{/if}
      </tr>
    </thead>
    <tbody>
      {#each rows as r (r.pilotId + ':' + r.callsign)}
        <tr>
          <td class="pos">{r.position ?? '—'}</td>
          <td class="pilot">{r.callsign}</td>
          {#if meta.teamRacing}<td class="team">{r.team}</td>{/if}
          {#if starts}<td class="starts">{r.starts}</td>{/if}
          {#if timeCols}<td class="laps">{r.laps}</td><td class="total">{r.total}</td><td
              class="avg">{r.average}</td
            >{/if}
          {#if fastCols}<td class="fast">{r.fastest}</td>{#if kind === 'by_fastest_lap' || all}<td
                class="source muted">{r.fastestSource}</td
              >{/if}{/if}
          {#if consCols}<td class="consecutive"
              >{r.consecutives === '—' ? '—' : `${r.consecutivesBase}/${r.consecutives}`}</td
            >{#if kind === 'by_consecutives' || all}<td class="source muted"
                >{r.consecutivesSource}</td
              >{/if}{/if}
          {#if points}<td class="points">{r.points}</td>{/if}
        </tr>
      {/each}
      {#if !rows.length}
        <tr><td colspan="9" class="muted">Nothing yet.</td></tr>
      {/if}
    </tbody>
  </table>
</div>

<style>
  .wrap {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: var(--gf-font-size-sm);
  }
  th,
  td {
    text-align: left;
    padding: var(--gf-space-1) var(--gf-space-2);
    border-bottom: 1px solid var(--gf-border);
    white-space: nowrap;
  }
  th {
    color: var(--gf-text-muted);
    font-weight: 500;
  }
  .pos {
    width: 2.5rem;
    color: var(--gf-text-muted);
  }
  .muted {
    color: var(--gf-text-muted);
  }
  .sr {
    position: absolute;
    left: -10000px;
  }
</style>
