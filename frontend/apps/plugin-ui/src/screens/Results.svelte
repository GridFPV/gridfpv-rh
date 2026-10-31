<script lang="ts">
  /**
   * RotorHazard's Results page, ours, widest first: the event overall, then each stage (its
   * ranking when it has a rank method, else race totals / fastest laps / fastest consecutive
   * laps), then its heats, and inside a heat its summary across rounds and each round's board.
   * Every section is a Collapsible, so a day with many rounds folds down to the standings the
   * director is actually reading. All of it is RotorHazard's own result_data, which it
   * broadcasts after every save, marshal commit or reassignment, so the page follows the day.
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

{#snippet heats(list: typeof boards.unclassified, level: 3 | 4)}
  <div class="sections">
    {#each list as h (h.heatId)}
      <Collapsible title={h.displayName} headingLevel={level} open={false}>
        {#snippet summary()}
          {h.rounds.length} {h.rounds.length === 1 ? 'round' : 'rounds'}
        {/snippet}
        <section class="heat sections" aria-label={h.displayName}>
          {#if h.rounds.length > 1}
            <Collapsible title="Heat summary">
              <LeaderboardTable
                rows={primaryRows(h.summary)}
                meta={h.summary.meta}
                kind="heat"
                starts
              />
            </Collapsible>
          {/if}
          {#each h.rounds as r (r.round)}
            <Collapsible title="Round {r.round}">
              {#snippet summary()}{r.startTime}{/snippet}
              <div data-round={r.round}>
                <LeaderboardTable rows={primaryRows(r.boards)} meta={r.boards.meta} kind="round" />
              </div>
            </Collapsible>
          {/each}
        </section>
      </Collapsible>
    {/each}
  </div>
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
  <!-- Widest first: the event overall, then stage by stage, then round by round (#94). -->
  {#if boards.event}
    <Card>
      <Collapsible title="Overall" headingLevel={2}>
        {#snippet summary()}every race in the event{/snippet}
        <section class="stage" aria-label="Event totals">
          {@render three(boards.event, true)}
        </section>
      </Collapsible>
    </Card>
  {/if}
  {#each boards.classes as c (c.classId)}
    <Card>
      <Collapsible title={c.name} headingLevel={2}>
        {#snippet summary()}
          {c.heats.length} {c.heats.length === 1 ? 'heat' : 'heats'}
        {/snippet}
        <section class="stage sections" aria-label={c.name}>
          {#if c.ranking}
            {@const rank = c.ranking}
            <Collapsible title="Stage ranking" headingLevel={3}>
              {#snippet summary()}{rank.methodLabel}{/snippet}
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
                      {#each c.ranking.fields as f (f.name)}<td class={f.name}
                          >{row[f.name] ?? ''}</td
                        >{/each}
                    </tr>
                  {/each}
                </tbody>
              </table>
            </Collapsible>
          {/if}
          <Collapsible title="Stage summary" headingLevel={3}>
            {@render three(c.summary, true)}
          </Collapsible>
          <Collapsible title="Heats" headingLevel={3}>
            {#snippet summary()}
              {c.heats.length} {c.heats.length === 1 ? 'heat' : 'heats'}
            {/snippet}
            {@render heats(c.heats, 4)}
          </Collapsible>
        </section>
      </Collapsible>
    </Card>
  {/each}
  {#if boards.unclassified.length}
    <Card>
      <Collapsible title="Unclassified" headingLevel={2}>
        {#snippet summary()}heats outside any stage{/snippet}
        <section class="stage" aria-label="Unclassified">
          {@render heats(boards.unclassified, 3)}
        </section>
      </Collapsible>
    </Card>
  {/if}
</section>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--gf-space-3);
  }
  /* Collapsibles stack; the gap is what separates one section's header from the one above. */
  .sections {
    display: flex;
    flex-direction: column;
    gap: var(--gf-space-2);
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
