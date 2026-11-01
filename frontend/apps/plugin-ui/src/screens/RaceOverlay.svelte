<script lang="ts">
  /**
   * The race overlay: the OBS browser source at `/grid/live/race` (#12). It follows the timer:
   * the race clock and phase, the event, stage and heat, and a row per pilot on the timer with
   * their laps. One pilot gets the long form — recent laps with the best run of laps in a row
   * lit up — which is the RaceGOW shape: a timer in the video, fastest three in a row. Public,
   * read-only; it controls nothing. `OverlayPanel` draws it; `ReplayOverlay` is the same panel
   * fed from a saved race (#96).
   */
  import OverlayPanel from '../components/OverlayPanel.svelte';
  import { rh } from '../lib/rh.svelte.js';
  import {
    liveHoleshotMs,
    overlayRow,
    overlayTitle,
    phaseLabel,
    racingLaps,
    type OverlayRow,
    type OverlayTheme
  } from '../lib/overlay.js';
  import { clockView, RACE_STATUS } from '../lib/race.js';
  import { classById, heatById, pilotById, WIN_CONDITION } from '../lib/setup.js';

  let { theme = 'dark' }: { theme?: OverlayTheme } = $props();

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

  // ---- what the format scores ----
  /** Laps in a row to score, when the format ranks by them; else undefined. */
  const windowN = $derived(
    format?.winCondition === WIN_CONDITION.FASTEST_CONSECUTIVE
      ? timer.leaderboard?.consecutivesCount || 3
      : undefined
  );

  // ---- the pilots on the timer ----
  const rows = $derived.by((): OverlayRow[] => {
    const board = timer.leaderboard?.heatId === race.heatId ? timer.leaderboard.rows : [];
    const out: OverlayRow[] = [];
    for (const s of timer.seats) {
      const live = timer.live[s.index];
      const slot = heat?.slots.find((x) => x.nodeIndex === s.index);
      const pilotId = live?.pilot?.id || slot?.pilotId || 0;
      const pilot = pilotId ? pilotById(setup, pilotId) : undefined;
      const laps = live ? racingLaps(live) : [];
      // Practice (no heat): a seat with a frequency and laps is someone flying.
      if (!pilotId && !(race.heatId === 0 && s.frequency > 0 && laps.length)) continue;
      const lb = board.find((r) => (r.node != null ? r.node === s.index : r.pilotId === pilotId));
      out.push(
        overlayRow(
          {
            seat: s.index,
            pilotId,
            name: pilot?.callsign || live?.pilot?.callsign || `Seat ${s.index + 1}`,
            color: pilot?.color ?? ''
          },
          laps.map((l) => l.timeMs),
          windowN,
          lb?.position ?? null,
          live ? liveHoleshotMs(live) : undefined
        )
      );
    }
    // RotorHazard's live order when it has one, else seat order.
    return out.sort(
      (a, b) =>
        (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) ||
        a.seat - b.seat
    );
  });
  const solo = $derived(rows.length === 1 ? rows[0] : undefined);

  const title = $derived(
    overlayTitle({
      racegow: {
        on: timer.mode === 'racegow',
        template: timer.racegow.nameTemplate,
        season: timer.racegow.season
      },
      heatName: heat?.displayName ?? '',
      className: cls?.displayName ?? '',
      round: race.nextRound,
      eventName: timer.event.name,
      practice: race.heatId === 0 && (rows.length > 0 || status !== RACE_STATUS.READY)
    })
  );
  const notice = $derived(
    timer.connection !== 'connected' ? 'reconnecting to the timer…' : 'waiting for a race…'
  );
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
  unlimitedTime={race.unlimitedTime}
  stage="live"
  placement={timer.overlayPlacement}
/>
