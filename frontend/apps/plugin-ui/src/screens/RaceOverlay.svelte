<script lang="ts">
  /**
   * The race overlay: the OBS browser source at `/grid/live/race` (#12). A glass panel over
   * the video with the race clock and phase, the event, stage and heat, and a row per pilot
   * on the timer with their laps. One pilot gets the long form — recent laps with the best
   * run of laps in a row lit up, this heat's best and the best of the day — which is the
   * RaceGOW shape: a timer in the video, fastest three in a row. Public, read-only; it
   * controls nothing.
   *
   * `theme` is the panel's contrast for the footage it sits over: light text on dark glass
   * (default, reads over most DVR) or dark text on a light panel for a bright room camera.
   */
  import { rh } from '../lib/rh.svelte.js';
  import {
    bestConsecutive,
    formatLapMs,
    inWindow,
    phaseLabel,
    racingLaps,
    type OverlayTheme
  } from '../lib/overlay.js';
  import { clockView, formatClockMs, RACE_STATUS } from '../lib/race.js';
  import { classById, heatById, pilotById, WIN_CONDITION } from '../lib/setup.js';

  let { theme = 'dark' }: { theme?: OverlayTheme } = $props();

  // Flag the document while mounted: app.css makes the page see-through.
  $effect(() => {
    document.documentElement.dataset.overlay = 'race';
    return () => {
      delete document.documentElement.dataset.overlay;
    };
  });

  const timer = rh();
  const setup = $derived(timer.setup);
  const race = $derived(timer.race);
  const status = $derived(race.status);
  const heat = $derived(heatById(setup, race.heatId));
  const cls = $derived(heat && heat.classId ? classById(setup, heat.classId) : undefined);
  const format = $derived(
    cls
      ? setup.formats.find((f) => f.id === cls.formatId)
      : race.formatId != null
        ? setup.formats.find((f) => f.id === race.formatId)
        : undefined
  );
  const flying = $derived(status === RACE_STATUS.RACING || status === RACE_STATUS.STAGING);

  // ---- clock ----
  let now = $state(performance.now());
  $effect(() => {
    const id = window.setInterval(() => (now = performance.now()), 100);
    return () => window.clearInterval(id);
  });
  const clock = $derived(clockView(race, timer.sync.differential, now, timer.clockFrozenAt));
  const phase = $derived(phaseLabel(status, clock.phase));
  /** Elapsed time, shown small under a countdown so a clip always carries a running clock. */
  const elapsed = $derived(
    !race.unlimitedTime && clock.raceMs != null && clock.raceMs >= 0
      ? formatClockMs(clock.raceMs)
      : ''
  );

  // ---- what the format scores ----
  /** Laps in a row to score, when the format ranks by them; else undefined. */
  const windowN = $derived(
    format?.winCondition === WIN_CONDITION.FASTEST_CONSECUTIVE
      ? timer.leaderboard?.consecutivesCount || 3
      : undefined
  );

  // ---- the pilots on the timer ----
  type Row = {
    seat: number;
    pilotId: number;
    name: string;
    color: string;
    lapMs: number[];
    last: number | undefined;
    best: number | undefined;
    window: ReturnType<typeof bestConsecutive>;
    /** This pilot's best of the day in this heat: best run, or best lap. */
    today: number | null;
    position: number | null;
  };
  const rows = $derived.by((): Row[] => {
    const today = timer.results.heatBest[race.heatId] ?? [];
    const board = timer.leaderboard?.heatId === race.heatId ? timer.leaderboard.rows : [];
    const out: Row[] = [];
    for (const s of timer.seats) {
      const live = timer.live[s.index];
      const slot = heat?.slots.find((x) => x.nodeIndex === s.index);
      const pilotId = live?.pilot?.id || slot?.pilotId || 0;
      const pilot = pilotId ? pilotById(setup, pilotId) : undefined;
      const laps = live ? racingLaps(live) : [];
      // Practice (no heat): a seat with a frequency and laps is someone flying.
      if (!pilotId && !(race.heatId === 0 && s.frequency > 0 && laps.length)) continue;
      const lapMs = laps.map((l) => l.timeMs);
      const best = today.find((t) => t.pilotId === pilotId);
      const lb = board.find((r) => (r.node != null ? r.node === s.index : r.pilotId === pilotId));
      out.push({
        seat: s.index,
        pilotId,
        name: pilot?.callsign || live?.pilot?.callsign || `Seat ${s.index + 1}`,
        color: pilot?.color ?? '',
        lapMs,
        last: lapMs.at(-1),
        best: lapMs.length ? Math.min(...lapMs) : undefined,
        window: windowN === undefined ? undefined : bestConsecutive(lapMs, windowN),
        today: best ? (windowN === undefined ? best.fastestLapMs : best.consecutivesMs) : null,
        position: lb?.position ?? null
      });
    }
    // RotorHazard's live order when it has one, else seat order.
    return out.sort(
      (a, b) =>
        (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) ||
        a.seat - b.seat
    );
  });
  const solo = $derived(rows.length === 1 ? rows[0] : undefined);
  const SHOWN = 6;
  const recent = $derived(solo ? solo.lapMs.slice(-SHOWN) : []);
  const recentOffset = $derived(solo ? Math.max(0, solo.lapMs.length - SHOWN) : 0);

  const title = $derived.by(() => {
    // Heat and round first: the line is clipped at the end on a narrow frame.
    const parts: string[] = [];
    if (heat) parts.push(heat.displayName);
    if (heat && race.nextRound) parts.push(`Round ${race.nextRound}`);
    // Practice (no heat) names itself only once someone is flying or a race is on.
    if (!heat && race.heatId === 0 && (rows.length || status !== RACE_STATUS.READY))
      parts.push('Practice');
    if (cls) parts.push(cls.displayName);
    if (timer.event.name) parts.push(timer.event.name);
    return parts.join(' · ');
  });
</script>

<div class="overlay" data-flying={flying} data-theme={theme} aria-label="Race overlay">
  <div class="panel">
    <div class="head">
      <span class="brand">Grid<span class="fpv">FPV</span></span>
      <span class="track">
        {#if timer.connection !== 'connected'}
          reconnecting to the timer…
        {:else if title}
          {title}
        {:else}
          waiting for a race…
        {/if}
      </span>
    </div>

    <div class="clockrow">
      <span class="clock" data-phase={clock.phase}>{clock.text}</span>
      {#if elapsed}<span class="elapsed">{elapsed}</span>{/if}
      <span class="phase">{phase}</span>
    </div>

    {#if solo}
      <div class="solo" style={solo.color ? `--pilot: ${solo.color}` : ''}>
        {#if solo.color}<span class="swatch"></span>{/if}{solo.name}
      </div>
      <div class="stats">
        {#if windowN !== undefined}
          <div class="stat">
            <span class="l">Best {windowN} this race</span>
            <span class="n">{formatLapMs(solo.window?.totalMs)}</span>
          </div>
          <div class="stat">
            <span class="l">Best {windowN} today</span>
            <span class="n">{formatLapMs(solo.today)}</span>
          </div>
        {:else}
          <div class="stat">
            <span class="l">Laps</span>
            <span class="n">{solo.lapMs.length}</span>
          </div>
          <div class="stat">
            <span class="l">Best lap</span>
            <span class="n">{formatLapMs(solo.best)}</span>
          </div>
          <div class="stat">
            <span class="l">Best today</span>
            <span class="n">{formatLapMs(solo.today)}</span>
          </div>
        {/if}
      </div>
      {#if recent.length}
        <ol class="laps" aria-label="Recent laps">
          {#each recent as lap, i (recentOffset + i)}
            <li class="lap" class:lit={inWindow(recentOffset + i, solo.window)}>
              <span class="ln">L{recentOffset + i + 1}</span>
              <span class="lt">{formatLapMs(lap)}</span>
            </li>
          {/each}
        </ol>
      {/if}
    {:else if rows.length}
      <table class="field" aria-label="Pilots on the timer">
        <thead>
          <tr>
            <th class="pos"></th>
            <th class="name">Pilot</th>
            <th class="num">Laps</th>
            <th class="num">Last</th>
            <th class="num">{windowN === undefined ? 'Best' : `Best ${windowN}`}</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row, i (row.seat)}
            <tr style={row.color ? `--pilot: ${row.color}` : ''}>
              <td class="pos">{row.position ?? i + 1}</td>
              <td class="name"
                >{#if row.color}<span class="swatch"></span>{/if}{row.name}</td
              >
              <td class="num">{row.lapMs.length}</td>
              <td class="num">{formatLapMs(row.last)}</td>
              <td class="num best"
                >{windowN === undefined
                  ? formatLapMs(row.best)
                  : formatLapMs(row.window?.totalMs)}</td
              >
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="empty">No pilots on the timer yet.</p>
    {/if}
  </div>
</div>

<style>
  .overlay {
    min-height: 100vh;
    background: transparent;
    color: var(--gf-text);
    font-family: var(--gf-font-family);
    display: flex;
    align-items: flex-start;
    justify-content: flex-start;
    padding: 24px;
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 22rem;
    max-width: 34rem;
    padding: 16px 22px 18px;
    border-radius: 18px;
    background: rgba(8, 10, 14, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.14);
    backdrop-filter: blur(6px);
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
  }
  .brand {
    font-weight: 800;
    letter-spacing: -0.02em;
    font-size: var(--gf-font-size-md);
  }
  .fpv {
    color: var(--gf-brand-400);
  }
  .track {
    font-size: var(--gf-font-size-sm);
    color: var(--gf-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 26rem;
  }
  .clockrow {
    display: flex;
    align-items: baseline;
    gap: 14px;
  }
  .clock {
    font-size: 3.6rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    letter-spacing: -0.02em;
    color: #fff;
  }
  .clock[data-phase='staging'] {
    color: var(--gf-amber-400);
  }
  .clock[data-phase='overtime'] {
    color: var(--gf-red-400);
  }
  .elapsed {
    font-family: var(--gf-font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--gf-font-size-md);
    color: var(--gf-text-muted);
  }
  .phase {
    margin-left: auto;
    font-weight: 800;
    letter-spacing: 0.14em;
    font-size: var(--gf-font-size-sm);
    color: var(--gf-text-muted);
  }
  .overlay[data-flying='true'] .phase {
    color: var(--gf-brand-400);
  }
  .solo {
    font-weight: 700;
    font-size: var(--gf-font-size-lg);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--pilot, var(--gf-border));
    margin-right: 6px;
    vertical-align: middle;
  }
  .solo .swatch {
    margin-right: 0;
  }
  .stats {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    gap: 16px;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .stat .l {
    font-size: var(--gf-font-size-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--gf-text-muted);
    white-space: nowrap;
  }
  .stat .n {
    font-family: var(--gf-font-mono);
    font-size: 1.9rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
  }
  .laps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .lap {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 2px 8px;
    border-radius: 8px;
    font-family: var(--gf-font-mono);
    font-size: var(--gf-font-size-md);
    font-variant-numeric: tabular-nums;
    color: var(--gf-text-muted);
  }
  .lap.lit {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    font-weight: 700;
  }
  .field {
    border-collapse: collapse;
    width: 100%;
    font-size: var(--gf-font-size-md);
  }
  .field th {
    font-size: var(--gf-font-size-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--gf-text-muted);
    font-weight: 600;
    text-align: left;
    padding: 2px 8px;
  }
  .field td {
    padding: 3px 8px;
  }
  .field .pos {
    width: 1.5rem;
    color: var(--gf-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .field .name {
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 14rem;
  }
  .field .num {
    text-align: right;
    font-family: var(--gf-font-mono);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .field .best {
    color: #fff;
    font-weight: 700;
  }
  .empty {
    margin: 0;
    color: var(--gf-text-muted);
    font-size: var(--gf-font-size-sm);
  }

  /* Dark text on a light panel (`/grid/live/race/light`): the library's light tokens flip
     the semantic colours; only this page's own glass values need restating. */
  .overlay[data-theme='light'] .panel {
    background: rgba(255, 255, 255, 0.84);
    border-color: rgba(0, 0, 0, 0.14);
    text-shadow: none;
  }
  .overlay[data-theme='light'] .clock,
  .overlay[data-theme='light'] .field .best,
  .overlay[data-theme='light'] .lap.lit {
    color: var(--gf-text);
  }
  .overlay[data-theme='light'] .clock[data-phase='staging'] {
    color: var(--gf-amber-600, #b7791f);
  }
  .overlay[data-theme='light'] .clock[data-phase='overtime'] {
    color: var(--gf-red-600, #c53030);
  }
  .overlay[data-theme='light'] .fpv,
  .overlay[data-theme='light'][data-flying='true'] .phase {
    color: var(--gf-brand-600);
  }
  .overlay[data-theme='light'] .lap.lit {
    background: rgba(0, 0, 0, 0.08);
  }
</style>
