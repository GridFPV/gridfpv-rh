<script lang="ts">
  /**
   * The race overlay in replay (#96, phase 1): `/grid/live/race?heat=H&round=R[&t=ms]` draws
   * the same panel as the live overlay, but from the *saved* race — the laps as they stand
   * after marshalling — at race time `t`. Nothing here ticks: `t` moves only when the URL
   * says or `window.gridfpvReplay.seek(ms)` is called, so a headless renderer gets frame N at
   * race time N/fps, identical every run, as fast as it can screenshot.
   *
   *   window.gridfpvReplay.ready()  → Promise<ReplayInfo>  resolves once the race is loaded
   *   window.gridfpvReplay.seek(ms) → Promise<ReplayInfo>  resolves once the panel shows `ms`
   *   window.gridfpvReplay.info()   → ReplayInfo | null
   *
   * The panel root carries `data-state`: loading, ready, or missing (no such saved race).
   * A marshal while the page is open (RotorHazard's results version moves) reloads the laps.
   */
  import { tick } from 'svelte';
  import OverlayPanel from '../components/OverlayPanel.svelte';
  import { fetchPilotRace, rh } from '../lib/rh.svelte.js';
  import {
    findSavedRace,
    holeshotAt,
    lapsAt,
    lapStamps,
    rankRows,
    replayLayout,
    replayStatus,
    type ReplayInfo,
    type ReplayQuery
  } from '../lib/replay.js';
  import {
    overlayRow,
    overlayTitle,
    phaseLabel,
    runFileName,
    type OverlayTheme
  } from '../lib/overlay.js';
  import { clockView, RACE_STATUS, type MarshalLap } from '../lib/race.js';
  import { classById, heatById, pilotById, START_BEHAVIOR, WIN_CONDITION } from '../lib/setup.js';

  let { theme = 'dark', query }: { theme?: OverlayTheme; query: ReplayQuery } = $props();

  const timer = rh();
  const setup = $derived(timer.setup);
  // The URL is only the starting point; `seek` moves it.
  // svelte-ignore state_referenced_locally
  let t = $state(query.t);

  // ---- the saved race ----
  const saved = $derived(findSavedRace(timer.marshal.raceList, query));
  const heat = $derived(saved ? heatById(setup, saved.heat.heatId) : undefined);
  const cls = $derived(
    saved && (heat?.classId || saved.heat.classId)
      ? classById(setup, heat?.classId || saved.heat.classId)
      : undefined
  );
  const format = $derived(
    saved && saved.round.formatId != null
      ? setup.formats.find((f) => f.id === saved.round.formatId)
      : cls
        ? setup.formats.find((f) => f.id === cls.formatId)
        : undefined
  );
  const startBehavior = $derived(format?.startBehavior ?? START_BEHAVIOR.HOLESHOT);

  type PilotRecord = { pilotId: number; callsign: string; node: number; laps: MarshalLap[] };
  /** Each pilot's record of the race, loaded once the race is found; null until then. */
  let records: PilotRecord[] | null = $state(null);
  // Load when the race is found, and again after a marshal (the results version moves).
  let loadedKey = '';
  $effect(() => {
    if (!saved) return;
    const key = `${saved.round.raceId}:${timer.resultsVersion}`;
    if (key === loadedKey) return;
    loadedKey = key;
    void load(saved.round.pilots);
  });
  async function load(
    pilots: Array<{ pilotraceId: number; pilotId: number; callsign: string; node: number }>
  ) {
    // Every pilot's own answer, by id (RotorHazard broadcasts them all to everyone); a
    // pilot whose answer never comes is asked for once more, then left out.
    const out: PilotRecord[] = [];
    for (const p of pilots) {
      const d = (await fetchPilotRace(p.pilotraceId)) ?? (await fetchPilotRace(p.pilotraceId));
      if (!d) continue;
      out.push({ pilotId: p.pilotId, callsign: p.callsign, node: p.node, laps: d.laps });
    }
    records = out;
  }

  // Missing: the timer has sent its race list and the race is not in it. The list arrives
  // just after connecting, so give it a moment before saying so.
  let missing = $state(false);
  $effect(() => {
    if (saved || timer.connection !== 'connected') {
      missing = false;
      return;
    }
    const id = window.setTimeout(() => (missing = true), 3000);
    return () => window.clearTimeout(id);
  });
  const pageState = $derived(saved && records ? 'ready' : missing ? 'missing' : 'loading');

  // ---- the race at time t ----
  const race = $derived(saved ? replayStatus(saved, format, t, query.end, query.staging) : null);
  const clock = $derived(
    race
      ? clockView(race, 0, t, query.end)
      : { phase: 'idle' as const, text: '0:00.0', raceMs: null }
  );
  const phase = $derived(race ? phaseLabel(race.status, clock.phase) : '');
  const flying = $derived(
    !!race && (race.status === RACE_STATUS.RACING || race.status === RACE_STATUS.STAGING)
  );
  const windowN = $derived(
    format?.winCondition === WIN_CONDITION.FASTEST_CONSECUTIVE
      ? timer.timing.consecutivesBase || 3
      : undefined
  );
  const rows = $derived.by(() => {
    if (!saved || !records) return [];
    const out = [];
    for (const rec of records) {
      const pilot = rec.pilotId ? pilotById(setup, rec.pilotId) : undefined;
      const lapMs = lapsAt(rec.laps, t, startBehavior);
      // A seat with no pilot has a record too; it is someone only in practice (no heat).
      if (!rec.pilotId && !(saved.heat.heatId === 0 && lapMs.length)) continue;
      out.push(
        overlayRow(
          {
            seat: rec.node,
            pilotId: rec.pilotId,
            name: pilot?.callsign || rec.callsign || `Seat ${rec.node + 1}`,
            color: pilot?.color ?? ''
          },
          lapMs,
          windowN,
          null,
          holeshotAt(rec.laps, t, startBehavior)
        )
      );
    }
    return rankRows(out, format?.winCondition ?? WIN_CONDITION.MOST_PROGRESS);
  });
  const solo = $derived(
    replayLayout(query, rows.length) === 'solo'
      ? (rows.find((r) => query.pilotId != null && r.pilotId === query.pilotId) ?? rows[0])
      : undefined
  );
  const naming = $derived(
    saved
      ? {
          racegow: {
            on: timer.mode === 'racegow',
            template: timer.racegow.nameTemplate,
            season: timer.racegow.season
          },
          heatName: heat?.displayName ?? saved.heat.name,
          className: cls?.displayName ?? '',
          round: saved.round.round,
          eventName: timer.event.name,
          practice: saved.heat.heatId === 0
        }
      : null
  );
  const title = $derived(naming ? overlayTitle(naming) : '');
  const runName = $derived(naming ? runFileName(naming) : '');
  const notice = $derived(
    missing
      ? 'no such saved race'
      : timer.connection !== 'connected'
        ? 'reconnecting to the timer…'
        : 'loading the race…'
  );

  // ---- the renderer's handle ----
  const info = (): ReplayInfo | null =>
    saved && records
      ? {
          raceId: saved.round.raceId,
          heatId: saved.heat.heatId,
          round: saved.round.round,
          title,
          runName,
          startBehavior,
          unlimitedTime: race?.unlimitedTime ?? true,
          durationMs: race && !race.unlimitedTime ? race.raceTimeSec * 1000 : null,
          lapStamps: lapStamps(records, startBehavior),
          t,
          key: [pageState, clock.text, phase, rows.map((r) => r.lapMs.length).join(',')].join('|'),
          look: JSON.stringify(timer.overlayPlacement)
        }
      : null;
  let waiting: Array<{ resolve: (i: ReplayInfo) => void; reject: (e: Error) => void }> = [];
  $effect(() => {
    const now = info();
    if (now) {
      for (const w of waiting) w.resolve(now);
      waiting = [];
    } else if (missing) {
      for (const w of waiting) w.reject(new Error('no such saved race'));
      waiting = [];
    }
  });
  function ready(): Promise<ReplayInfo> {
    const now = info();
    if (now) return Promise.resolve(now);
    if (missing) return Promise.reject(new Error('no such saved race'));
    return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
  }
  async function seek(ms: number): Promise<ReplayInfo> {
    t = Number(ms);
    await ready();
    await tick();
    // The panel measures its head to place itself in a bottom corner (OverlayPanel): let
    // layout run and that measurement land before a renderer takes the picture.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await tick();
    return info()!;
  }
  $effect(() => {
    const api = { ready, seek, info };
    (window as unknown as { gridfpvReplay?: typeof api }).gridfpvReplay = api;
    return () => {
      delete (window as unknown as { gridfpvReplay?: typeof api }).gridfpvReplay;
    };
  });
</script>

<OverlayPanel
  {theme}
  {title}
  {notice}
  {clock}
  {phase}
  {flying}
  {rows}
  {solo}
  {windowN}
  unlimitedTime={race?.unlimitedTime ?? true}
  stage={pageState}
  placement={timer.overlayPlacement}
/>
