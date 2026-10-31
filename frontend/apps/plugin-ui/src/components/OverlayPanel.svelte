<script lang="ts">
  /**
   * The race overlay's panel (#12, #96): a glass sheet over the video with the title line,
   * the clock and phase, and the pilots — one pilot gets the long form (recent laps with the
   * best run of laps in a row lit up), several get a table. Pure presentation: the live page
   * (`RaceOverlay`) feeds it from the timer, the replay page (`ReplayOverlay`) from a saved
   * race at a chosen moment, and the panel cannot tell which.
   *
   * `theme` is the panel's contrast for the footage it sits over: light text on dark glass
   * (default, reads over most DVR) or dark text on a light panel for a bright room camera.
   */
  import { formatClockMs, type ClockView } from '../lib/race.js';
  import { formatLapMs, inWindow, type OverlayRow, type OverlayTheme } from '../lib/overlay.js';
  import {
    DEFAULT_PLACEMENT,
    placementStyle,
    type OverlayPlacement
  } from '../lib/overlayPlacement.js';

  let {
    theme = 'dark',
    title,
    notice,
    clock,
    phase,
    flying,
    rows,
    solo,
    windowN,
    unlimitedTime,
    stage,
    placement = DEFAULT_PLACEMENT
  }: {
    theme?: OverlayTheme;
    /** The title line; empty shows `notice` instead. */
    title: string;
    /** What the title line says with no title: reconnecting, waiting for a race, loading … */
    notice: string;
    clock: ClockView;
    /** The word in the corner (LIVE, STAGING, FINISHED …). */
    phase: string;
    flying: boolean;
    /** Every pilot on the panel, in display order. */
    rows: OverlayRow[];
    /** The pilot drawn in the long form; undefined draws the table. */
    solo: OverlayRow | undefined;
    /** Laps in a row the format scores, when it does. */
    windowN: number | undefined;
    unlimitedTime: boolean;
    /** The page's state, for a renderer to read off the root (`data-state`): live, loading, ready, missing. */
    stage?: string;
    /** Where the panel sits (#96): corner, offsets and size, from the timer. */
    placement?: OverlayPlacement;
  } = $props();

  // Flag the document while mounted: app.css makes the page see-through.
  $effect(() => {
    document.documentElement.dataset.overlay = 'race';
    return () => {
      delete document.documentElement.dataset.overlay;
    };
  });

  /**
   * Optional branding: the plugin serves `branding/left.png` and `branding/right.png` when
   * it ships them (the RaceGOW overlay build does); each image hides itself if it is missing.
   */
  const BRANDING = `${import.meta.env.BASE_URL}branding/`;
  let logoLeft = $state(true);
  let logoRight = $state(true);

  /** Elapsed time, shown small under a countdown so a clip always carries a running clock. */
  const elapsed = $derived(
    !unlimitedTime && clock.raceMs != null && clock.raceMs >= 0 ? formatClockMs(clock.raceMs) : ''
  );
  const SHOWN = 6;
  const recent = $derived(solo ? solo.lapMs.slice(-SHOWN) : []);
  /** The head's unscaled height, for a bottom corner: the laps hang below it (see placementStyle). */
  let headPx = $state(0);
  const recentOffset = $derived(solo ? Math.max(0, solo.lapMs.length - SHOWN) : 0);
</script>

<div
  class="overlay"
  data-flying={flying}
  data-theme={theme}
  data-state={stage}
  aria-label="Race overlay"
>
  <div
    class="panel"
    style={placementStyle(placement, { headPx, hangs: recent.length > 0 })}
    data-corner={placement.corner}
  >
    <div class="headblock" bind:clientHeight={headPx}>
      <div class="head">
        {#if logoLeft}
          <img class="logo" src="{BRANDING}left.png" alt="" onerror={() => (logoLeft = false)} />
        {:else}
          <span class="brand">Grid<span class="fpv">FPV</span></span>
        {/if}
        <span class="track">
          {#if title}
            {title}
          {:else}
            {notice}
          {/if}
        </span>
        {#if logoRight}
          <img
            class="logo right"
            src="{BRANDING}right.png"
            alt=""
            onerror={() => (logoRight = false)}
          />
        {/if}
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
              <span class="l">Laps</span>
              <span class="n">{solo.lapMs.length}</span>
            </div>
            <div class="stat">
              <span class="l">Best {windowN} this race</span>
              <span class="n">{formatLapMs(solo.window?.totalMs)}</span>
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
          {/if}
        </div>
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
    {#if solo && recent.length}
      <ol class="laps" aria-label="Recent laps">
        {#each recent as lap, i (recentOffset + i)}
          <li class="lap" class:lit={inWindow(recentOffset + i, solo.window)}>
            <span class="ln">L{recentOffset + i + 1}</span>
            <span class="lt">{formatLapMs(lap)}</span>
          </li>
        {/each}
      </ol>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: relative;
    min-height: 100vh;
    background: transparent;
    color: var(--gf-text);
    font-family: var(--gf-font-family);
  }
  /* Pinned to a corner and scaled about it by the placement (inline style). */
  .panel {
    position: absolute;
    display: flex;
    flex-direction: column;
    min-width: 22rem;
    max-width: 34rem;
    border-radius: 18px;
    background: rgba(8, 10, 14, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.14);
    backdrop-filter: blur(6px);
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  }
  /* The head is what the placement puts in the corner; the laps hang below it. */
  .headblock {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 22px 18px;
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
  .logo {
    height: 44px;
    width: auto;
    flex: none;
  }
  .logo.right {
    margin-left: auto;
    /* The ReconFPV crosshair is black on transparent; its own grey (#4F4F4F, from the
       ReconFPV EdgeTX theme) behind it keeps it visible on the dark panel. */
    background: #4f4f4f;
    border-radius: 50%;
    padding: 2px;
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
    margin: -8px 0 0;
    padding: 0 22px 18px;
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
