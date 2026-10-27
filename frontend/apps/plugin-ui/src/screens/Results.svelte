<script lang="ts">
  /**
   * RotorHazard's Results page, ours: every stage's summary (its ranking when it has a rank
   * method, else race totals / fastest laps / fastest consecutive laps), each heat's summary
   * across its rounds and every round's board, the unclassified heats, and the event totals.
   * All of it is RotorHazard's own result_data, which it broadcasts after every save,
   * marshal commit or reassignment, so the page follows the day.
   */
  import { Card, Collapsible } from '@gridfpv/components';
  import LeaderboardTable from '../components/LeaderboardTable.svelte';
  import { rh } from '../lib/rh.svelte.js';
  import { primaryRows, type Boards } from '../lib/resultBoards.js';
  import { href, link } from '../lib/router.svelte.js';

  const timer = rh();
  const boards = $derived(timer.boards);
  const empty = $derived(!boards.classes.length && !boards.unclassified.length && !boards.event);
</script>

{#snippet three(b: Boards, starts: boolean)}
  <h4>Race totals</h4>
  <LeaderboardTable rows={b.byRaceTime} meta={b.meta} kind="by_race_time" {starts} />
  <h4>Fastest laps</h4>
  <LeaderboardTable rows={b.byFastestLap} meta={b.meta} kind="by_fastest_lap" {starts} />
  <h4>Fastest consecutive laps</h4>
  <LeaderboardTable rows={b.byConsecutives} meta={b.meta} kind="by_consecutives" {starts} />
{/snippet}

{#snippet heats(list: typeof boards.unclassified)}
  {#each list as h (h.heatId)}
    <Collapsible title={h.displayName} open={false}>
      <section class="heat" aria-label={h.displayName}>
        {#if h.rounds.length > 1}
          <h4>Heat summary</h4>
          <LeaderboardTable
            rows={primaryRows(h.summary)}
            meta={h.summary.meta}
            kind="heat"
            starts
          />
        {/if}
        {#each h.rounds as r (r.round)}
          <h4 class="round">Round {r.round} <span class="muted">({r.startTime})</span></h4>
          <div data-round={r.round}>
            <LeaderboardTable rows={primaryRows(r.boards)} meta={r.boards.meta} kind="round" />
          </div>
        {/each}
      </section>
    </Collapsible>
  {/each}
{/snippet}

<section class="page">
  {#if empty}
    <Card title="Results">
      <p class="muted">
        No saved races yet. Race on <a href={href('run')} onclick={link}>Run</a>; results appear
        here as RotorHazard saves them.
      </p>
    </Card>
  {/if}
  {#each boards.classes as c (c.classId)}
    <Card title={c.name}>
      <section class="stage" aria-label={c.name}>
        {#if c.ranking}
          <h3>Class ranking <span class="muted">— {c.ranking.methodLabel}</span></h3>
          <table class="ranking leaderboard" aria-label="Class ranking">
            <thead>
              <tr>
                <th class="pos"><span class="sr">Rank</span></th>
                <th class="pilot">Pilot</th>
                {#if c.ranking.teamRacing}<th class="team">Team</th>{/if}
                {#each c.ranking.fields as f (f.name)}<th class={f.name}>{f.label}</th>{/each}
              </tr>
            </thead>
            <tbody>
              {#each c.ranking.rows as row, i (i)}
                <tr>
                  <td class="pos">{row.position ?? '—'}</td>
                  <td class="pilot">{row.callsign}</td>
                  {#if c.ranking.teamRacing}<td class="team">{row.team}</td>{/if}
                  {#each c.ranking.fields as f (f.name)}<td class={f.name}>{row[f.name] ?? ''}</td
                    >{/each}
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
        <h3>Class summary</h3>
        {@render three(c.summary, true)}
        <h3>Heats</h3>
        {@render heats(c.heats)}
      </section>
    </Card>
  {/each}
  {#if boards.unclassified.length}
    <Card title="Unclassified">
      <section class="stage" aria-label="Unclassified">
        {@render heats(boards.unclassified)}
      </section>
    </Card>
  {/if}
  {#if boards.event}
    <Card title="Event totals">
      <section class="stage" aria-label="Event totals">
        {@render three(boards.event, true)}
      </section>
    </Card>
  {/if}
</section>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--gf-space-3);
  }
  h3 {
    margin: var(--gf-space-2) 0 var(--gf-space-1);
    font-size: var(--gf-font-size-md);
  }
  h4 {
    margin: var(--gf-space-2) 0 var(--gf-space-1);
    font-size: var(--gf-font-size-sm);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .muted {
    color: var(--gf-text-muted);
  }
  .ranking {
    border-collapse: collapse;
    font-size: var(--gf-font-size-sm);
  }
  .ranking td,
  .ranking th {
    padding: var(--gf-space-1) var(--gf-space-2);
    border-bottom: 1px solid var(--gf-border);
    text-align: left;
  }
  .sr {
    position: absolute;
    left: -10000px;
  }
</style>
