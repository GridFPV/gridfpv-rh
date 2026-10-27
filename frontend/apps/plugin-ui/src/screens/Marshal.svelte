<script lang="ts">
  /**
   * Marshal: fix a pilot's laps after the fact (#8). Pick a saved race (or the race just
   * stopped and not yet saved), pick the pilot, and the recorded RSSI trace comes up with
   * the enter / exit thresholds on it. Drag a threshold and the laps are recalculated the
   * way RotorHazard's marshal page does it; click a lap to delete or restore it; Save
   * writes the laps and thresholds back (resave_laps / replace_current_laps) and
   * RotorHazard rebuilds the results.
   */
  import { onMount, untrack } from 'svelte';
  import { Badge, Banner, Button, Card, Input, Select } from '@gridfpv/components';
  import RssiTrace from '../components/RssiTrace.svelte';
  import { seatTag } from '../lib/channels.js';
  import {
    loadPilotRace,
    loadRaceList,
    replaceCurrentLaps,
    requestMarshalCurrent,
    resaveLaps,
    rh,
    setLevels,
    type WriteResult,
    reassignRace
  } from '../lib/rh.svelte.js';
  import {
    lapTicks,
    MARSHAL_TYPE,
    RACE_STATUS,
    toggleLap,
    type MarshalLap,
    type MarshalRules,
    recalcRace,
    setEnterThreshold,
    setExitThreshold,
    formatLapMs,
    addManualLap,
    cleanDeletedLaps
  } from '../lib/race.js';
  import { href, link } from '../lib/router.svelte.js';
  import { heatById, pilotById, classById, ROUND_TYPE } from '../lib/setup.js';

  const timer = rh();
  const setup = $derived(timer.setup);
  const raceList = $derived(timer.marshal.raceList);
  const currentAvailable = $derived(timer.race.status === RACE_STATUS.DONE);

  // ---- picking a race ----
  /** 'current' for the stopped, unsaved race, else `${heatId}:${round}`. */
  let source = $state('');
  let who = $state(''); // pilotrace id (saved) or seat index (current)
  const picked = $derived.by(() => {
    if (source === 'current') return null;
    const [h, r] = source.split(':').map(Number);
    const heat = raceList.find((x) => x.heatId === h);
    const round = heat?.rounds.find((x) => x.round === r);
    return heat && round ? { heat, round } : null;
  });
  const currentSeats = $derived(
    timer.marshal.current?.seats.filter(
      (s) => s.trace.times.length || s.laps.length || timer.live[s.node]?.pilot
    ) ?? []
  );
  const currentHeat = $derived(
    timer.marshal.current ? heatById(setup, timer.marshal.current.heatId) : undefined
  );
  function seatPilot(node: number): string {
    const slot = currentHeat?.slots.find((s) => s.nodeIndex === node);
    const p = slot?.pilotId ? pilotById(setup, slot.pilotId) : undefined;
    return p?.callsign ?? timer.live[node]?.pilot?.callsign ?? '';
  }

  onMount(() => {
    loadRaceList();
    const q = new URLSearchParams(window.location.search);
    const h = q.get('heat');
    const r = q.get('round');
    if (h && r) source = `${h}:${r}`;
    else if (currentAvailable) source = 'current';
  });
  // Default to the latest race once the list arrives.
  $effect(() => {
    if (source || !raceList.length) return;
    if (currentAvailable) return void (source = 'current');
    const latest = raceList
      .flatMap((h) => h.rounds.map((r) => ({ h, r })))
      .sort((a, b) => b.r.startTime - a.r.startTime)[0];
    if (latest) source = `${latest.h.heatId}:${latest.r.round}`;
  });
  $effect(() => {
    if (source === 'current' && !timer.marshal.current) void requestMarshalCurrent();
  });
  // First pilot of a newly picked race.
  $effect(() => {
    if (source === 'current') {
      if (!currentSeats.some((s) => String(s.node) === who))
        who = String(currentSeats[0]?.node ?? '');
    } else if (picked) {
      if (!picked.round.pilots.some((p) => String(p.pilotraceId) === who))
        who = String(picked.round.pilots[0]?.pilotraceId ?? '');
    }
  });

  // ---- the loaded pilot race ----
  type Loaded = {
    kind: 'saved' | 'current';
    node: number;
    callsign: string;
    pilotId: number;
    trace: { times: number[]; values: number[] };
    stored: MarshalLap[];
    enter: number;
    exit: number;
    marshalType: number;
    startTime: number;
    formatId: number | null;
    raceId: number;
    pilotraceId: number;
    heatId: number;
    round: number;
  };
  let loaded: Loaded | null = $state(null);
  let loading = $state(false);
  let enter = $state(0);
  let exit = $state(0);
  let laps: MarshalLap[] = $state([]);
  let dirty = $state(false);

  // One load per (race, pilot) pick. The readback inside loadPilotRace touches store state,
  // so the work runs untracked or every answer would re-trigger the request.
  let requested = '';
  $effect(() => {
    const key = `${source}|${who}|${source === 'current' ? (timer.marshal.current ? 'y' : 'n') : ''}`;
    if (key === requested) return;
    requested = key;
    untrack(() => load());
  });
  function load() {
    if (!who) return void (loaded = null);
    if (source === 'current') {
      const seat = timer.marshal.current?.seats.find((s) => String(s.node) === who);
      const cur = timer.marshal.current;
      if (!seat || !cur) return void (loaded = null);
      const slot = currentHeat?.slots.find((s) => s.nodeIndex === seat.node);
      show({
        kind: 'current',
        node: seat.node,
        callsign: seatPilot(seat.node),
        pilotId: slot?.pilotId ?? 0,
        trace: seat.trace,
        stored: seat.laps,
        enter: seat.enter,
        exit: seat.exit,
        marshalType: seat.marshalType,
        startTime: cur.startTime,
        formatId: cur.formatId,
        raceId: 0,
        pilotraceId: 0,
        heatId: cur.heatId,
        round: 0
      });
      return;
    }
    if (!picked) return void (loaded = null);
    const id = Number(who);
    loading = true;
    void loadPilotRace(id).then((r) => {
      loading = false;
      const d = timer.marshal.details;
      if (!r.ok || !d || d.pilotraceId !== id || !picked) return;
      const pr = picked.round.pilots.find((p) => p.pilotraceId === id);
      show({
        kind: 'saved',
        node: d.node,
        callsign: d.callsign || pr?.callsign || '',
        pilotId: d.pilotId,
        trace: d.trace,
        stored: d.laps,
        enter: d.enter,
        exit: d.exit,
        marshalType: d.marshalType,
        startTime: picked.round.startTime,
        formatId: picked.round.formatId,
        raceId: picked.round.raceId,
        pilotraceId: id,
        heatId: picked.heat.heatId,
        round: picked.round.round
      });
    });
  }

  function show(l: Loaded) {
    loaded = l;
    enter = l.enter;
    exit = l.exit;
    laps = l.stored;
    dirty = false;
  }

  const format = $derived.by(() => {
    const l = loaded;
    return l?.formatId != null ? setup.formats.find((f) => f.id === l.formatId) : undefined;
  });
  const rules = $derived.by((): MarshalRules => ({
    minLapMs: timer.timing.minLapMs,
    minFirstCrossingMs: timer.timing.minFirstCrossingMs,
    minLapBehavior: timer.timing.minLapBehavior,
    unlimitedTime: format?.unlimitedTime ?? true,
    raceTimeSec: format?.raceTimeSec ?? 0
  }));
  const hasTrace = $derived.by(() => {
    const l = loaded;
    return !!l && l.marshalType === MARSHAL_TYPE.RSSI && l.trace.times.length > 1;
  });
  const ticks = $derived.by(() => {
    const l = loaded;
    return l ? lapTicks(l.stored, l.startTime) : [];
  });

  /**
   * A threshold edit finished: recalculate the laps from the trace, as RotorHazard's
   * marshal.js recalcRace does (manual and API laps survive and merge in by time); a
   * threshold never crosses the other, it drags it along (setEnter / setExit).
   */
  function recalc(e: number, x: number) {
    if (!loaded) return;
    const t = e !== enter ? setEnterThreshold(enter, exit, e) : setExitThreshold(enter, exit, x);
    enter = t.enter;
    exit = t.exit;
    // Without a recording the thresholds are still saved with the race, as on RotorHazard's
    // page; only the laps cannot be found again.
    if (hasTrace) laps = recalcRace(loaded.trace, t.enter, t.exit, loaded.startTime, rules, laps);
    dirty = true;
  }
  /** The number boxes beside the sliders: RotorHazard's EnterAt / ExitAt inputs. */
  function typed(which: 'enter' | 'exit', raw: string) {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) return;
    if (which === 'enter') recalc(n, exit);
    else recalc(enter, n);
  }
  function toggle(i: number) {
    laps = toggleLap(laps, i);
    dirty = true;
  }
  // ---- RotorHazard's other marshal controls (marshal.html) ----
  let manualLapText = $state('');
  /** "Add Lap": a lap at that many seconds since the start, source manual. */
  function addLap() {
    const s = Number(manualLapText);
    if (!loaded || !Number.isFinite(s) || s <= 0) {
      notice = { tone: 'danger', text: 'Manual lap: enter the seconds since the start, e.g. 7.5.' };
      return;
    }
    laps = addManualLap(laps, s);
    manualLapText = '';
    dirty = true;
  }
  /** "Clean Deleted Laps": deleted laps are dropped from the list, so a save forgets them. */
  function cleanLaps() {
    if (!laps.some((l) => l.deleted)) return;
    laps = cleanDeletedLaps(laps);
    dirty = true;
  }
  /** "Load from Node": the seat's current enter/exit become the marshal thresholds. */
  function loadFromSeat() {
    const seat = loaded ? timer.seats[loaded.node] : undefined;
    if (!seat || seat.enter == null || seat.exit == null) {
      notice = { tone: 'danger', text: 'This seat has no thresholds to load.' };
      return;
    }
    recalc(seat.enter, seat.exit);
    if (exit !== seat.exit) recalc(seat.enter, seat.exit);
  }
  /** "Reassign Heat": move this saved race under another heat; RotorHazard keeps the round. */
  let reassignTo = $state('');
  const reassignHeats = $derived(
    setup.heats.map((h) => {
      const c = h.classId ? classById(setup, h.classId) : undefined;
      return { h, disabled: !!c && c.roundType === ROUND_TYPE.GROUPED && !h.active };
    })
  );
  async function reassign() {
    const l = loaded;
    const heatId = Number(reassignTo);
    if (!l || l.kind !== 'saved' || !heatId || heatId === l.heatId) return;
    const r = await run(
      () => reassignRace(l.raceId, heatId),
      `Race moved to ${heatById(setup, heatId)?.displayName ?? 'the heat'}; RotorHazard rebuilt the results.`
    );
    if (r.ok) {
      source = `${heatId}:${l.round}`;
      reassignTo = '';
    }
  }
  function reset() {
    if (loaded) show(loaded);
  }

  let notice: { tone: 'success' | 'danger'; text: string } | null = $state(null);
  let busy = $state(false);
  async function run(fn: () => Promise<WriteResult>, okText: string) {
    busy = true;
    try {
      const r = await fn();
      notice = r.ok
        ? { tone: 'success', text: okText }
        : { tone: 'danger', text: r.message ?? 'RotorHazard did not confirm the change.' };
      return r;
    } finally {
      busy = false;
    }
  }
  async function save() {
    if (!loaded) return;
    const l = loaded;
    const r = await run(
      () =>
        l.kind === 'current'
          ? replaceCurrentLaps({ seat: l.node, laps, enter, exit })
          : resaveLaps({
              heatId: l.heatId,
              round: l.round,
              raceId: l.raceId,
              pilotraceId: l.pilotraceId,
              seat: l.node,
              pilotId: l.pilotId,
              callsign: l.callsign,
              laps,
              enter,
              exit
            }),
      'Laps saved; RotorHazard rebuilt the results.'
    );
    if (r.ok) {
      dirty = false;
      loaded = { ...l, stored: laps, enter, exit };
      if (l.kind === 'current') void requestMarshalCurrent();
    }
  }
  function applyToSeat() {
    if (!loaded) return;
    void run(
      () => setLevels(loaded!.node, enter, exit),
      `Seat ${loaded.node + 1} now enters at ${enter} and exits at ${exit}.`
    );
  }

  const counted = $derived(laps.filter((l) => !l.deleted));
  const seatLabel = (node: number) => {
    const t = seatTag(timer.seats[node]);
    return t ? `${t.band}${t.channel}` : `seat ${node + 1}`;
  };
</script>

<section class="page">
  {#if notice}
    <Banner tone={notice.tone} ondismiss={() => (notice = null)}>{notice.text}</Banner>
  {/if}
  <Card>
    <div class="pickrow">
      <label class="field grow">
        <span>Race</span>
        <Select bind:value={source} disabled={busy}>
          {#if currentAvailable}<option value="current">Stopped race, not saved yet</option>{/if}
          {#each raceList as h (h.heatId)}
            <optgroup label={h.name}>
              {#each h.rounds as r (r.round)}
                <option value="{h.heatId}:{r.round}"
                  >Round {r.round} · {r.startTimeFormatted}</option
                >
              {/each}
            </optgroup>
          {/each}
        </Select>
      </label>
      <label class="field grow">
        <span>Pilot</span>
        <Select bind:value={who} disabled={busy}>
          {#if source === 'current'}
            {#each currentSeats as s (s.node)}
              <option value={String(s.node)}
                >{seatPilot(s.node) || 'empty'} · {seatLabel(s.node)}</option
              >
            {/each}
          {:else if picked}
            {#each picked.round.pilots as p (p.pilotraceId)}
              <option value={String(p.pilotraceId)}
                >{p.callsign || 'unknown'} · {seatLabel(p.node)}</option
              >
            {/each}
          {/if}
        </Select>
      </label>
      {#if !raceList.length && !currentAvailable}
        <span class="muted"
          >No saved races yet. Race first on <a href={href('run')} onclick={link}>Run</a>.</span
        >
      {/if}
    </div>
  </Card>

  {#if loaded}
    <Card
      title={loaded.callsign || 'Unknown pilot'}
      subtitle={loaded.kind === 'current'
        ? `${currentHeat?.displayName ?? 'Practice'} · stopped race, not saved yet`
        : `${picked?.heat.name ?? ''} · round ${loaded.round} · ${picked?.round.startTimeFormatted ?? ''}`}
    >
      {#if hasTrace}
        <RssiTrace trace={loaded.trace} bind:enter bind:exit firmware={ticks} oncommit={recalc} />
        <p class="hint muted">
          Drag the enter and exit lines to re-run the lap detection over the recorded signal; ticks
          along the top are the passes the timer recorded. Click a lap below to delete or restore
          it.
        </p>
      {:else}
        <p class="muted">
          No signal recording for this seat{loaded.marshalType !== MARSHAL_TYPE.RSSI
            ? ' (this timer reports passes only)'
            : ''}; laps can be deleted and restored, not recalculated.
        </p>
      {/if}

      <table class="laps">
        <thead>
          <tr><th>#</th><th>Lap</th><th>At</th><th>Peak</th><th>From</th><th></th></tr>
        </thead>
        <tbody>
          {#each laps as l, i (i)}
            {@const n = laps.slice(0, i + 1).filter((x) => !x.deleted).length - (l.deleted ? 0 : 1)}
            <tr
              class:deleted={l.deleted}
              onclick={() => toggle(i)}
              title={l.deleted ? 'Click to restore' : 'Click to delete'}
            >
              <td>{l.deleted ? '—' : n === 0 ? 'start' : n}</td>
              <td class="t">{l.deleted ? '—' : formatLapMs(l.timeMs)}</td>
              <td class="t">{formatLapMs(l.stampMs)}</td>
              <td>{l.peakRssi ?? ''}</td>
              <td class="muted"
                >{['timer', 'manual', 'recalc', 'auto', 'api'][l.source] ?? l.source}</td
              >
              <td class="muted">{l.deleted ? 'deleted' : ''}</td>
            </tr>
          {/each}
          {#if !laps.length}
            <tr><td colspan="6" class="muted">No laps.</td></tr>
          {/if}
        </tbody>
      </table>

      <div class="tools">
        <label class="tool"
          >Manual lap (s)
          <Input
            type="number"
            size="sm"
            min="0"
            step="0.001"
            placeholder="7.500"
            aria-label="Manual lap time"
            bind:value={manualLapText}
            disabled={busy}
          /></label
        >
        <Button size="sm" variant="secondary" disabled={busy || !manualLapText} onclick={addLap}
          >Add lap</Button
        >
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || !laps.some((l) => l.deleted)}
          title="Drop the deleted laps from the list, so a save forgets them"
          onclick={cleanLaps}>Clean deleted laps</Button
        >
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          title="Use the seat's current enter/exit as the marshal thresholds"
          onclick={loadFromSeat}>Load from seat</Button
        >
        {#if loaded.kind === 'saved'}
          <label class="tool"
            >Move to heat
            <Select bind:value={reassignTo} size="sm" disabled={busy} aria-label="Move to heat">
              <option value="">— pick a heat —</option>
              {#each reassignHeats as { h, disabled } (h.id)}
                {#if h.id !== loaded.heatId}
                  <option value={String(h.id)} {disabled}>{h.displayName}</option>
                {/if}
              {/each}
            </Select></label
          >
          <Button size="sm" variant="secondary" disabled={busy || !reassignTo} onclick={reassign}
            >Reassign</Button
          >
        {/if}
      </div>
      <div class="foot">
        <span class="muted thresholds"
          >{counted.length} lap{counted.length === 1 ? '' : 's'} counted ·
          <label
            >enter <Input
              type="number"
              size="sm"
              min="0"
              max="255"
              value={String(enter)}
              disabled={busy}
              aria-label="Enter at"
              onchange={(ev: Event) => typed('enter', (ev.currentTarget as HTMLInputElement).value)}
            /></label
          >
          <label
            >exit <Input
              type="number"
              size="sm"
              min="0"
              max="255"
              value={String(exit)}
              disabled={busy}
              aria-label="Exit at"
              onchange={(ev: Event) => typed('exit', (ev.currentTarget as HTMLInputElement).value)}
            /></label
          >
          {#if loaded.enter !== enter || loaded.exit !== exit}<Badge tone="warn"
              >thresholds changed</Badge
            >{/if}</span
        >
        <span class="grow"></span>
        <Button variant="ghost" disabled={!dirty || busy} onclick={reset}>Reset</Button>
        <Button
          variant="secondary"
          disabled={busy || (loaded.enter === enter && loaded.exit === exit)}
          onclick={applyToSeat}>Use these thresholds on the seat</Button
        >
        <Button variant="primary" disabled={!dirty || busy} onclick={save}>Save laps</Button>
      </div>
    </Card>
  {:else if loading}
    <p class="muted">Loading…</p>
  {/if}
</section>

<style>
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gf-space-2);
    align-items: end;
    margin: var(--gf-space-2) 0;
  }
  .tool {
    display: inline-flex;
    flex-direction: column;
    gap: var(--gf-space-1);
    font-size: var(--gf-font-size-sm);
    color: var(--gf-text-muted);
  }
  .thresholds label {
    display: inline-flex;
    align-items: center;
    gap: var(--gf-space-1);
  }
  .thresholds :global(.gf-input) {
    width: 4.5rem;
  }
  .page {
    display: grid;
    gap: var(--gf-space-3);
  }
  .pickrow {
    display: flex;
    gap: var(--gf-space-3);
    align-items: end;
    flex-wrap: wrap;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .field.grow {
    flex: 1;
    min-width: 220px;
  }
  .field > span {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .hint {
    font-size: var(--gf-font-size-sm);
    margin: var(--gf-space-2) 0 0;
  }
  .laps {
    width: 100%;
    border-collapse: collapse;
    margin-top: var(--gf-space-3);
    font-variant-numeric: tabular-nums;
  }
  .laps th,
  .laps td {
    text-align: left;
    padding: 4px var(--gf-space-2);
    border-bottom: 1px solid var(--gf-border);
  }
  .laps th {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
  }
  .laps tbody tr {
    cursor: pointer;
  }
  .laps tbody tr:hover {
    background: var(--gf-surface-sunken);
  }
  .laps tr.deleted td {
    text-decoration: line-through;
    opacity: 0.55;
  }
  .laps .t {
    font-weight: 600;
  }
  .foot {
    display: flex;
    gap: var(--gf-space-2);
    align-items: center;
    margin-top: var(--gf-space-3);
    flex-wrap: wrap;
    font-size: var(--gf-font-size-sm);
  }
  .grow {
    flex: 1;
  }
  .muted {
    color: var(--gf-text-muted);
  }
</style>
