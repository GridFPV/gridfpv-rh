<script lang="ts">
  /**
   * RaceGOW mode's Home (#95): the season, its tracks, the pilot, and the two things done
   * every session — new track, new season. Everything here is racegow's words; the flows
   * in lib/racegowFlow.ts map them onto RotorHazard's event, classes, heats and rounds.
   */
  import { Badge, Banner, Button, Card, Dialog, Input, Select } from '@gridfpv/components';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import ModeCard from '../components/ModeCard.svelte';
  import {
    rh,
    saveRaceGow,
    setCurrentHeat,
    setMinLap,
    setMinLapBehavior,
    type WriteResult
  } from '../lib/rh.svelte.js';
  import { MIN_LAP_BEHAVIOR, MIN_LAP_BEHAVIOR_LABELS, type MinLapBehavior } from '../lib/timing.js';
  import { href, link } from '../lib/router.svelte.js';
  import { archiveLabel } from '../lib/archives.js';
  import {
    currentTrack,
    nextTrackNumber,
    seasonArchives,
    renderName,
    seasonNumberOf,
    templateProblem,
    trackName,
    tracksOf
  } from '../lib/racegow.js';
  import { newSeason, newTrack, switchSeason } from '../lib/racegowFlow.js';

  const timer = rh();
  const settings = $derived(timer.racegow);
  /** The event is a season when it is named like one; until then, nudge to start one. */
  const seasonOfEvent = $derived(seasonNumberOf(timer.event.name));
  const tracks = $derived(tracksOf(timer.setup, timer.results));
  const onTimer = $derived(currentTrack(tracks, timer.current.heatId));
  const nextNumber = $derived(nextTrackNumber(timer.setup.classes));
  const past = $derived(
    seasonArchives(timer.archives).filter((a) => a.season !== (seasonOfEvent ?? settings.season))
  );

  let busy = $state(false);
  let notice: { tone: 'success' | 'danger'; text: string } | null = $state(null);
  async function run(
    fn: () => Promise<WriteResult>,
    ok: string | ((r: WriteResult) => string)
  ): Promise<WriteResult> {
    busy = true;
    notice = null;
    try {
      const r = await fn();
      notice = r.ok
        ? { tone: 'success', text: typeof ok === 'function' ? ok(r) : ok }
        : { tone: 'danger', text: r.message ?? 'RotorHazard did not confirm the change.' };
      return r;
    } finally {
      busy = false;
    }
  }

  // ---- you: the pilot's callsign follows the timer only when the timer's value changes ----
  let callsign = $state('');
  let callsignFor: string | null = null;
  $effect(() => {
    if (settings.callsign !== callsignFor) {
      callsignFor = settings.callsign;
      callsign = settings.callsign;
    }
  });
  const callsignDirty = $derived(callsign.trim() !== settings.callsign);
  function savePilot() {
    if (!callsign.trim() || !callsignDirty) return;
    void run(() => saveRaceGow({ callsign: callsign.trim() }), 'Pilot saved.');
  }

  // ---- new season ----
  let seasonOpen = $state(false);
  let seasonText = $state('');
  const seasonNumber = $derived(Number(seasonText));
  const seasonValid = $derived(Number.isInteger(seasonNumber) && seasonNumber >= 1);
  function openSeason() {
    seasonText = String(seasonOfEvent != null ? seasonOfEvent + 1 : settings.season);
    seasonOpen = true;
  }
  async function startSeason() {
    if (!seasonValid) return;
    const n = seasonNumber;
    seasonOpen = false;
    await run(
      () => newSeason(n),
      (r) =>
        `Season ${n} started. The previous event is archived as "${(r as { archive?: string }).archive ?? 'its name'}".`
    );
  }

  // ---- switch to a past season ----
  let switching: { file: string; season: number } | null = $state(null);

  // ---- names: the template follows the timer only when the timer's value changes ----
  let template = $state('');
  let templateFor: string | null = null;
  $effect(() => {
    if (settings.nameTemplate !== templateFor) {
      templateFor = settings.nameTemplate;
      template = settings.nameTemplate;
    }
  });
  const templateDirty = $derived(template.trim() !== settings.nameTemplate);
  const templateIssue = $derived(templateProblem(template));
  /** The next run's name, as the template stands: the track on the timer (or the next one). */
  const preview = $derived(
    renderName(template.trim() || settings.nameTemplate, {
      season: settings.season,
      track: onTimer?.cls.displayName ?? trackName(nextNumber),
      round: (onTimer?.runs ?? 0) + 1,
      heat: onTimer?.heat?.displayName ?? ''
    })
  );
  function saveTemplate() {
    if (templateIssue || !templateDirty) return;
    void run(() => saveRaceGow({ nameTemplate: template.trim() }), 'Names saved.');
  }

  // ---- min lap: seconds follow the timer the same way; short laps are discarded ----
  let minLapText = $state('');
  let minLapFor: number | null = null;
  $effect(() => {
    if (timer.timing.minLapMs !== minLapFor) {
      minLapFor = timer.timing.minLapMs;
      minLapText = String(Math.round(timer.timing.minLapMs / 1000));
    }
  });
  const minLapSeconds = $derived(Number(minLapText));
  const minLapValid = $derived(
    Number.isInteger(minLapSeconds) && minLapSeconds >= 0 && minLapSeconds <= 999
  );
  const minLapDirty = $derived(minLapSeconds * 1000 !== timer.timing.minLapMs);
  function saveMinLap() {
    if (!minLapValid || !minLapDirty) return;
    void run(() => setMinLap(minLapSeconds), `Minimum lap ${minLapSeconds} s.`);
  }
  const discarding = $derived(timer.timing.minLapBehavior === MIN_LAP_BEHAVIOR.DISCARD);

  function makeTrack() {
    void run(
      () => newTrack(),
      (r) => `Track ${(r as { number?: number }).number} is on the timer.`
    );
  }
</script>

<section class="page">
  <header class="pagehead">
    <div>
      <h1>{seasonOfEvent != null ? `Season ${seasonOfEvent}` : 'RaceGOW'}</h1>
      <p class="lede">
        {#if seasonOfEvent != null}
          {timer.event.name} · {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
        {:else}
          This event is “{timer.event.name || 'unnamed'}”, not a season yet. Start one to work in
          racegow's words; names will carry season {settings.season} until then.
        {/if}
      </p>
    </div>
    <Button variant="secondary" disabled={busy} onclick={openSeason}>New season…</Button>
  </header>

  {#if notice}
    <Banner tone={notice.tone} ondismiss={() => (notice = null)}>{notice.text}</Banner>
  {/if}

  <Card
    title="Tracks"
    subtitle="Every session is a new track: one layout, flown as many runs as you like. A new track is loaded on the timer at once."
  >
    <div class="trackhead">
      <Button
        variant="primary"
        disabled={busy || timer.connection !== 'connected'}
        onclick={makeTrack}>New track · Track {nextNumber}</Button
      >
    </div>
    {#if tracks.length === 0}
      <p class="muted">No tracks yet this season.</p>
    {:else}
      <ul class="tracks" aria-label="Tracks">
        {#each tracks as t (t.cls.id)}
          <li class:current={t === onTimer}>
            <strong>{t.cls.displayName}</strong>
            <span class="muted">{t.runs} {t.runs === 1 ? 'run' : 'runs'}</span>
            <span class="spacer"></span>
            {#if t.heat && t.heat.id === timer.current.heatId}
              <Badge tone="accent">on the timer</Badge>
            {:else if t.heat}
              {@const heatId = t.heat.id}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onclick={() =>
                  run(() => setCurrentHeat(heatId), `${t.cls.displayName} is on the timer.`)}
                >Load</Button
              >
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </Card>

  <Card title="You" subtitle="One pilot, one seat. The seat's channel and tuning are on Run.">
    <div class="you">
      <label class="field grow">
        <span>Callsign</span>
        <Input
          bind:value={callsign}
          placeholder="Who is flying"
          onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && savePilot()}
        />
      </label>
      <label class="field">
        <span>Seat</span>
        <Select
          value={settings.seat == null ? '' : String(settings.seat)}
          disabled={busy}
          onchange={(e: Event) =>
            run(
              () => saveRaceGow({ seat: Number((e.currentTarget as HTMLSelectElement).value) }),
              'Seat saved.'
            )}
        >
          <option value="" disabled>Pick a seat</option>
          {#each timer.seats as s (s.index)}
            <option value={String(s.index)}
              >Seat {s.index + 1}{s.frequency > 0 ? ` · ${s.frequency}` : ' · off'}</option
            >
          {/each}
        </Select>
      </label>
      <Button
        variant="secondary"
        disabled={busy || !callsignDirty || !callsign.trim()}
        onclick={savePilot}>Save pilot</Button
      >
    </div>
  </Card>

  <Card
    title="Names and laps"
    subtitle="What a run is called — on the overlay, in Results, and on its recording — and the shortest lap that counts."
  >
    <div class="you">
      <label class="field grow">
        <span>Run name template</span>
        <Input
          bind:value={template}
          placeholder={settings.nameTemplate}
          onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && saveTemplate()}
        />
      </label>
      <Button
        variant="secondary"
        disabled={busy || !templateDirty || !!templateIssue}
        onclick={saveTemplate}>Save names</Button
      >
    </div>
    {#if templateIssue}
      <p class="problem" role="alert">{templateIssue}</p>
    {:else}
      <p class="muted">
        Next run: <strong aria-label="Name preview">{preview}</strong> · tokens: {'{season}'},
        {'{track}'}, {'{round}'}, {'{heat}'}
      </p>
    {/if}
    <div class="you minlap">
      <label class="field">
        <span>Minimum lap (seconds)</span>
        <Input
          type="number"
          min="0"
          max="999"
          bind:value={minLapText}
          onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && saveMinLap()}
        />
      </label>
      <Button
        variant="secondary"
        disabled={busy || !minLapValid || !minLapDirty}
        onclick={saveMinLap}>Save minimum lap</Button
      >
      <span class="muted" role="status">
        {#if discarding}
          Shorter laps are discarded as they land — nothing for Marshal to clean.
        {:else}
          Shorter laps are only highlighted ({MIN_LAP_BEHAVIOR_LABELS[
            timer.timing.minLapBehavior as MinLapBehavior
          ]}); a new track switches this to discard.
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onclick={() =>
              run(() => setMinLapBehavior(MIN_LAP_BEHAVIOR.DISCARD), 'Short laps are discarded.')}
            >Discard now</Button
          >
        {/if}
      </span>
    </div>
  </Card>

  <Card
    title="Past seasons"
    subtitle="Archived on this timer. Switching puts a past season back on the timer; this one is archived first."
  >
    {#if past.length === 0}
      <p class="muted">No past seasons archived on this timer.</p>
    {:else}
      <ul class="seasons" aria-label="Past seasons">
        {#each past as a (a.file)}
          <li>
            <strong>Season {a.season}</strong>
            <span class="muted">{archiveLabel(a.file)}</span>
            <span class="spacer"></span>
            <Button size="sm" variant="ghost" disabled={busy} onclick={() => (switching = a)}
              >Switch…</Button
            >
          </li>
        {/each}
      </ul>
    {/if}
  </Card>

  <Card title="Next" elevation="xs">
    <p>
      <a href={href('run')} onclick={link}>Run</a> — start a run on the track that is on the timer.
      <a href={href('marshal')} onclick={link}>Marshal</a> — fix the laps after.
      <a href={href('results')} onclick={link}>Results</a> — the track's best and every run.
      <a href={href('seats')} onclick={link}>Seats</a> — tune the seat.
    </p>
  </Card>

  <ModeCard />
</section>

<Dialog bind:open={seasonOpen} title="New season" onclose={() => (seasonOpen = false)}>
  <p class="muted">
    Archives “{timer.event.name || 'this event'}” and starts the new season clean. Pilots stay;
    tracks and runs belong to the archived season.
  </p>
  <label class="field">
    <span>Season number</span>
    <Input type="number" min="1" bind:value={seasonText} />
  </label>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (seasonOpen = false)}>Cancel</Button>
    <Button variant="primary" disabled={busy || !seasonValid} onclick={startSeason}
      >Start season</Button
    >
  {/snippet}
</Dialog>

{#if switching}
  <ConfirmDialog
    open={true}
    title="Switch season"
    confirmLabel="Switch"
    danger
    onconfirm={() => {
      const a = switching;
      switching = null;
      if (a) void run(() => switchSeason(a.file), `Season ${a.season} is back on the timer.`);
    }}
    oncancel={() => (switching = null)}
  >
    Replace everything on the timer with <strong>Season {switching.season}</strong>
    ({archiveLabel(switching.file)})? This season is archived first, so it can come back the same
    way.
  </ConfirmDialog>
{/if}

<style>
  .page {
    display: grid;
    gap: var(--gf-space-3);
  }
  .pagehead {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: var(--gf-space-3);
    flex-wrap: wrap;
  }
  .pagehead h1 {
    margin: 0 0 var(--gf-space-1);
    font-size: var(--gf-font-size-xl);
  }
  .lede,
  .muted {
    margin: 0;
    color: var(--gf-text-muted);
  }
  p {
    margin: 0;
  }
  .trackhead {
    margin-bottom: var(--gf-space-3);
  }
  .tracks,
  .seasons {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--gf-space-1);
  }
  .tracks li,
  .seasons li {
    display: flex;
    align-items: center;
    gap: var(--gf-space-3);
    padding: var(--gf-space-2) var(--gf-space-3);
    border: 1px solid var(--gf-border);
    border-radius: var(--gf-radius-md);
  }
  .tracks li.current {
    border-color: var(--gf-brand-500);
  }
  .spacer {
    flex: 1;
  }
  .you {
    display: flex;
    gap: var(--gf-space-3);
    align-items: end;
    flex-wrap: wrap;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 160px;
  }
  .field.grow {
    flex: 1;
  }
  .field > span {
    font-size: var(--gf-font-size-sm);
    color: var(--gf-text-muted);
  }
  .minlap {
    margin-top: var(--gf-space-3);
  }
  .problem {
    margin: var(--gf-space-1) 0 0;
    color: var(--gf-danger-600, #c0392b);
    font-size: var(--gf-font-size-sm);
  }
</style>
