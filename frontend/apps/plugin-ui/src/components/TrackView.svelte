<script lang="ts">
  /**
   * RaceGOW mode's Results (#95): one track at a time — the one on the timer unless another
   * is picked — never the event or the other tracks. Its best lap and best N consecutive,
   * each with the run it came from, over every run newest first; a run opens onto its laps
   * and a one-tap Marshal. Every figure is RotorHazard's own class board, so it agrees with
   * RotorHazard's Results page; the laps come from the saved race as Marshal reads it.
   */
  import { Badge, Button, Card, Select } from '@gridfpv/components';
  import { loadPilotRace, rh } from '../lib/rh.svelte.js';
  import { go, href, link } from '../lib/router.svelte.js';
  import { formatLapMs } from '../lib/race.js';
  import { currentTrack, runNumberOf, trackBoards, tracksOf } from '../lib/racegow.js';

  const timer = rh();
  const tracks = $derived(tracksOf(timer.setup, timer.results));
  /** A track picked by hand; null follows the timer. */
  let pickedId: number | null = $state(null);
  const track = $derived(
    pickedId != null
      ? (tracks.find((t) => t.cls.id === pickedId) ?? currentTrack(tracks, timer.current.heatId))
      : currentTrack(tracks, timer.current.heatId)
  );
  const boards = $derived(track ? trackBoards(timer.boards, track.cls.id) : null);

  // ---- the track's bests: RotorHazard's class board, first row (one pilot) ----
  const bestLap = $derived(boards?.summary.byFastestLap[0]);
  const best3 = $derived(boards?.summary.byConsecutives[0]);
  const hasBestLap = $derived(!!bestLap && bestLap.fastest !== '—');
  const hasBest3 = $derived(!!best3 && best3.consecutives !== '—');
  const bestLapRun = $derived(hasBestLap ? runNumberOf(bestLap!.fastestSource) : null);
  const best3Run = $derived(hasBest3 ? runNumberOf(best3!.consecutivesSource) : null);
  const n = $derived(best3?.consecutivesBase || timer.timing.consecutivesBase || 3);

  // ---- the runs, newest first ----
  const runs = $derived(boards ? [...(boards.heats[0]?.rounds ?? [])].reverse() : []);
  const holeShot = $derived((boards?.summary.meta.startBehavior ?? 0) === 0);

  // ---- a run's laps, loaded when it is opened (the saved race, as Marshal reads it) ----
  let openRuns: Record<number, boolean> = $state({});
  let laps: Record<number, number[] | 'loading' | 'none'> = $state({});
  // A new track, or new results, starts the lap cache over.
  let lapsFor: string | null = null;
  $effect(() => {
    const key = `${track?.cls.id ?? 0}:${timer.resultsVersion}`;
    if (key !== lapsFor) {
      lapsFor = key;
      laps = {};
    }
  });
  async function toggle(round: number) {
    openRuns[round] = !openRuns[round];
    if (openRuns[round] && laps[round] == null) await loadLaps(round);
  }
  async function loadLaps(round: number) {
    const heatId = track?.heat?.id;
    if (!heatId) return;
    const listed = timer.marshal.raceList
      .find((h) => h.heatId === heatId)
      ?.rounds.find((r) => r.round === round);
    // The pilot's own record: a seat with a frequency but no pilot can be listed too.
    const mine = timer.setup.pilots.find(
      (x) => x.callsign.trim().toLowerCase() === timer.racegow.callsign.trim().toLowerCase()
    );
    const entry =
      listed?.pilots.find((x) => mine && x.pilotId === mine.id) ??
      listed?.pilots.find((x) => x.pilotId > 0) ??
      listed?.pilots[0];
    const pilotraceId = entry?.pilotraceId;
    if (!pilotraceId) {
      laps[round] = 'none';
      return;
    }
    laps[round] = 'loading';
    const r = await loadPilotRace(pilotraceId);
    const d = timer.marshal.details;
    if (!r.ok || !d || d.pilotraceId !== pilotraceId) {
      laps[round] = 'none';
      return;
    }
    const counted = d.laps.filter((l) => !l.deleted).map((l) => l.timeMs);
    // RotorHazard's lap count leaves out the first crossing when the format starts with a hole shot.
    laps[round] = holeShot ? counted.slice(1) : counted;
  }
  function fix(round: number) {
    if (track?.heat) go(`marshal?heat=${track.heat.id}&round=${round}`);
  }
</script>

<section class="page">
  {#if tracks.length === 0}
    <Card title="Results">
      <p class="muted">
        No tracks yet this season. <a href={href('')} onclick={link}>New track</a> is on Home.
      </p>
    </Card>
  {:else if track}
    <div class="pickrow">
      <label class="field">
        <span>Track</span>
        <Select
          size="sm"
          value={String(track.cls.id)}
          aria-label="Track"
          onchange={(e: Event) => (pickedId = Number((e.currentTarget as HTMLSelectElement).value))}
        >
          {#each tracks as t (t.cls.id)}
            <option value={String(t.cls.id)}
              >{t.cls.displayName}{t.heat?.id === timer.current.heatId
                ? ' · on the timer'
                : ''}</option
            >
          {/each}
        </Select>
      </label>
    </div>

    <Card title="{track.cls.displayName} · Season {timer.racegow.season}">
      <div class="bests">
        <div class="stat" aria-label="Best lap">
          <span class="l">Best lap</span>
          <span class="n">{hasBestLap ? bestLap!.fastest : '—'}</span>
          <span class="src"
            >{bestLapRun != null ? `Run ${bestLapRun}` : hasBestLap ? '' : 'no run yet'}</span
          >
        </div>
        <div class="stat" aria-label="Best {n} consecutive">
          <span class="l">Best {n} consecutive</span>
          <span class="n">{hasBest3 ? best3!.consecutives : '—'}</span>
          <span class="src"
            >{best3Run != null ? `Run ${best3Run}` : hasBest3 ? '' : `needs a ${n}-lap run`}</span
          >
        </div>
        <div class="stat" aria-label="Runs">
          <span class="l">Runs</span>
          <span class="n">{runs.length}</span>
          <span class="src">{runs.length ? `last ${runs[0].startTime}` : 'none yet'}</span>
        </div>
      </div>

      {#if runs.length === 0}
        <p class="muted">No runs yet. <a href={href('run')} onclick={link}>Run</a> is ready.</p>
      {:else}
        <ul class="runs" aria-label="Runs">
          {#each runs as r (r.round)}
            {@const row = r.boards.byRaceTime[0] ?? r.boards.byFastestLap[0]}
            <li class:open={openRuns[r.round]}>
              <button
                type="button"
                class="runrow"
                aria-expanded={!!openRuns[r.round]}
                onclick={() => toggle(r.round)}
              >
                <strong>Run {r.round}</strong>
                <span class="muted">{r.startTime}</span>
                <span class="fig"><span class="k">laps</span>{row?.laps ?? '0'}</span>
                <span class="fig"><span class="k">best</span>{row?.fastest ?? '—'}</span>
                <span class="fig"><span class="k">best {n}</span>{row?.consecutives ?? '—'}</span>
                {#if r.round === best3Run}<Badge tone="accent">best {n}</Badge>{/if}
                {#if r.round === bestLapRun}<Badge tone="accent">best lap</Badge>{/if}
              </button>
              {#if openRuns[r.round]}
                <div class="detail">
                  {#if laps[r.round] === 'loading' || laps[r.round] == null}
                    <p class="muted">Loading the laps…</p>
                  {:else if laps[r.round] === 'none'}
                    <p class="muted">RotorHazard has no lap record for this run.</p>
                  {:else}
                    <ol class="laps" aria-label="Laps of run {r.round}">
                      {#each laps[r.round] as number[] as ms, i (i)}
                        <li>
                          <span class="ln">L{i + 1}</span><span class="lt">{formatLapMs(ms)}</span>
                        </li>
                      {/each}
                    </ol>
                  {/if}
                  <div class="actions">
                    <Button size="sm" variant="primary" onclick={() => fix(r.round)}
                      >Fix the laps</Button
                    >
                  </div>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </Card>
  {/if}
</section>

<style>
  .page {
    display: grid;
    gap: var(--gf-space-3);
  }
  .muted {
    color: var(--gf-text-muted);
    margin: 0;
  }
  .pickrow {
    display: flex;
    justify-content: flex-end;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 200px;
  }
  .field > span {
    font-size: var(--gf-font-size-sm);
    color: var(--gf-text-muted);
  }
  .bests {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: var(--gf-space-3);
    margin-bottom: var(--gf-space-4);
  }
  .stat {
    display: grid;
    gap: 2px;
    padding: var(--gf-space-3);
    border: 1px solid var(--gf-border);
    border-radius: var(--gf-radius-md);
  }
  .stat .l {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .stat .n {
    font-size: var(--gf-font-size-xl);
    font-weight: var(--gf-font-weight-semibold);
    font-variant-numeric: tabular-nums;
  }
  .stat .src {
    font-size: var(--gf-font-size-sm);
    color: var(--gf-text-muted);
  }
  .runs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--gf-space-1);
  }
  .runs li {
    border: 1px solid var(--gf-border);
    border-radius: var(--gf-radius-md);
  }
  .runs li.open {
    border-color: var(--gf-brand-500);
  }
  .runrow {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--gf-space-3);
    flex-wrap: wrap;
    padding: var(--gf-space-2) var(--gf-space-3);
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .runrow:focus-visible {
    outline: none;
    box-shadow: var(--gf-focus-ring);
    border-radius: var(--gf-radius-md);
  }
  .fig {
    display: inline-flex;
    gap: var(--gf-space-1);
    align-items: baseline;
    font-variant-numeric: tabular-nums;
  }
  .fig .k {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
  }
  .detail {
    padding: 0 var(--gf-space-3) var(--gf-space-3);
    display: grid;
    gap: var(--gf-space-2);
  }
  .laps {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: var(--gf-space-2);
  }
  .laps li {
    display: inline-flex;
    gap: var(--gf-space-1);
    padding: 2px var(--gf-space-2);
    border: 1px solid var(--gf-border-subtle);
    border-radius: var(--gf-radius-sm);
    font-variant-numeric: tabular-nums;
  }
  .ln {
    color: var(--gf-text-muted);
    font-size: var(--gf-font-size-xs);
  }
  .actions {
    display: flex;
    gap: var(--gf-space-2);
  }
</style>
