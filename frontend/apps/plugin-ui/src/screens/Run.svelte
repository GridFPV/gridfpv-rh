<script lang="ts">
  /**
   * Run: the race-day loop in one screen (#8). Pick the heat, Start (RotorHazard stages,
   * then starts), watch laps land per seat and the leaderboard move, Stop, Save or
   * Discard. Every control writes through RotorHazard's own socket events and reads back
   * its race status, so RotorHazard's run page would show the same thing.
   *
   * The clock runs locally against RotorHazard's monotonic clock (sampled on connect and
   * at every staging), the way RotorHazard's own page does, so both agree.
   */
  import { Badge, Banner, Button, Card, Dialog, Input, Select } from '@gridfpv/components';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import ChannelPicker from '../components/ChannelPicker.svelte';
  import { flySeat } from '../lib/racegowFlow.js';
  import RaceClock from '../components/RaceClock.svelte';
  import HeatPlanDialog from '../components/HeatPlanDialog.svelte';
  import FormatDialog from '../components/FormatDialog.svelte';
  import RaceSettingsStrip from '../components/RaceSettingsStrip.svelte';
  import { MIN_LAP_BEHAVIOR_LABELS } from '../lib/timing.js';
  import { planRows } from '../lib/heatplan.js';
  import {
    applyAudioSettings,
    audioState,
    cueManualLap,
    exportAudioSettingsFile,
    importAudioSettingsFile,
    resetAudioSettings,
    speakTest,
    startCues
  } from '../lib/audio.svelte.js';
  import AudioSettingsPanel from '../components/AudioSettingsPanel.svelte';
  import CalloutsPanel from '../components/CalloutsPanel.svelte';
  import {
    DISPLAY_KEYS,
    DISPLAY_LABELS,
    lapChips,
    readDisplayPrefs,
    saveDisplayPrefs,
    type DisplayPrefs
  } from '../lib/displayPrefs.js';
  import { seatTag } from '../lib/channels.js';
  import {
    cancelHeatPlan,
    confirmHeatPlan,
    deleteLap,
    discardLaps,
    reseedHeatPlan,
    restoreLap,
    resyncClock,
    rh,
    saveLaps,
    seedAsYouGo,
    setAutoSeed,
    setCurrentHeat,
    stageRace,
    stopRace,
    type WriteResult,
    simulateLap,
    cancelScheduledRace,
    scheduleRace,
    setRaceFormat,
    playCallout,
    saveCallouts,
    sendMessage
  } from '../lib/rh.svelte.js';
  import {
    clockView,
    countdownText,
    countedLaps,
    flownLaps,
    offSeatWarnings,
    RACE_STATUS,
    type LiveLap
  } from '../lib/race.js';
  import { go, href, link } from '../lib/router.svelte.js';
  import {
    classById,
    formatSummary,
    heatById,
    heatsInClass,
    pilotById,
    type RaceFormat
  } from '../lib/setup.js';
  import { needsSeeding, stageState, STAGE_STATE_LABELS, nextUpText } from '../lib/stages.js';
  import { aceLine, aceRule, isAceStage, stageTally } from '../lib/ace.js';

  const timer = rh();
  const setup = $derived(timer.setup);
  const race = $derived(timer.race);
  const status = $derived(race.status);

  // ---- what's loaded ----
  const heat = $derived(heatById(setup, race.heatId));
  const cls = $derived(heat && heat.classId ? classById(setup, heat.classId) : undefined);
  const format = $derived(
    cls
      ? setup.formats.find((f) => f.id === cls.formatId)
      : race.formatId != null
        ? setup.formats.find((f) => f.id === race.formatId)
        : undefined
  );
  const stages = $derived(
    [...setup.classes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id)
  );
  const unclassified = $derived(heatsInClass(setup, 0));
  /** A decided Chase the Ace is over: its heat is not offered (it stays pickable if loaded). */
  const aceDecided = (c: { id: number } & Parameters<typeof isAceStage>[0]) =>
    isAceStage(c) && !!stageTally(c as never, heatsInClass(setup, c.id), timer.results).ace;
  /**
   * Every heat of the stage, as RotorHazard's own picker lists them: a grouped stage's raced
   * heats (RotorHazard deactivates them after their round and refuses to stage an inactive
   * heat, #80) stay listed but disabled, with the reason; a decided Chase the Ace hides its
   * heats.
   */
  const stageHeats = (classId: number) =>
    heatsInClass(setup, classId).filter(
      (h) => h.id === race.heatId || !aceDecided(classById(setup, classId)!)
    );
  const aceNote = $derived.by(() => {
    if (!cls || !isAceStage(cls)) return '';
    const t = stageTally(cls, heatsInClass(setup, cls.id), timer.results);
    return t.ace
      ? `${aceLine(t, aceRule(cls))}. Another round here changes RotorHazard's ranking of the stage.`
      : '';
  });
  const roundsText = $derived.by(() => {
    if (!heat) return '';
    const r = race.nextRound || 1;
    if (!cls) return `Round ${r}`;
    if (cls.rounds > 0 && r > cls.rounds)
      return `All ${cls.rounds} round${cls.rounds === 1 ? '' : 's'} raced · a start would be round ${r}`;
    if (cls.rounds > 0) return `Round ${r} of ${cls.rounds}`;
    return `Round ${r}`;
  });
  const stageBadge = $derived(
    cls ? stageState(cls, heatsInClass(setup, cls.id), timer.results) : null
  );

  // ---- audio cues (#38): RotorHazard's tones and callouts, for as long as this page is open ----
  const audio = audioState();
  $effect(() => startCues());

  // ---- clock ----
  let now = $state(performance.now());
  $effect(() => {
    const id = window.setInterval(() => (now = performance.now()), 100);
    return () => window.clearInterval(id);
  });
  const clock = $derived(clockView(race, timer.sync.differential, now, timer.clockFrozenAt));
  const statusLabel = $derived(
    status === RACE_STATUS.STAGING
      ? 'Staging'
      : status === RACE_STATUS.RACING
        ? clock.phase === 'overtime'
          ? 'Time up'
          : 'Racing'
        : status === RACE_STATUS.DONE
          ? 'Stopped'
          : 'Ready'
  );
  const statusTone = $derived(
    status === RACE_STATUS.STAGING
      ? 'warn'
      : status === RACE_STATUS.RACING
        ? clock.phase === 'overtime'
          ? 'danger'
          : 'success'
        : status === RACE_STATUS.DONE
          ? 'info'
          : 'neutral'
  );

  // ---- controls ----
  const anyLaps = $derived(timer.live.some((s) => countedLaps(s).length > 0));
  const canPick = $derived(status === RACE_STATUS.READY);
  const canStart = $derived(
    status === RACE_STATUS.READY || (status === RACE_STATUS.DONE && !anyLaps)
  );
  const canStop = $derived(status === RACE_STATUS.STAGING || status === RACE_STATUS.RACING);
  const canSave = $derived(status === RACE_STATUS.RACING || status === RACE_STATUS.DONE);
  const canDiscard = $derived(status === RACE_STATUS.DONE);
  const canEditLaps = $derived(status === RACE_STATUS.RACING || status === RACE_STATUS.DONE);

  let notice: { tone: 'success' | 'danger'; text: string } | null = $state(null);
  let noticeTimer = 0;
  function onresult(r: WriteResult, okText = '') {
    window.clearTimeout(noticeTimer);
    if (r.ok && !okText) return void (notice = null);
    notice = r.ok
      ? { tone: 'success', text: okText }
      : { tone: 'danger', text: r.message ?? 'RotorHazard did not confirm the change.' };
    if (r.ok) noticeTimer = window.setTimeout(() => (notice = null), 4000);
  }
  let busy = $state(false);
  async function run(fn: () => Promise<WriteResult>, okText = '') {
    busy = true;
    try {
      onresult(await fn(), okText);
    } finally {
      busy = false;
    }
  }
  /** Bumped to redraw the picker when RotorHazard did not load what was picked (#69). */
  let pickKey = $state(0);
  async function onPick(e: Event) {
    const id = Number((e.currentTarget as HTMLSelectElement).value);
    busy = true;
    try {
      const r = await setCurrentHeat(id);
      if (!r.ok || !r.plan) onresult(r);
      if (!r.ok) pickKey++;
    } finally {
      busy = false;
    }
  }
  const plan = $derived(timer.heatPlan);
  async function planAction(fn: () => Promise<WriteResult>, okText = '') {
    busy = true;
    try {
      const r = await fn();
      onresult(r, okText);
    } finally {
      busy = false;
    }
  }
  function planCancel() {
    cancelHeatPlan();
    pickKey++;
  }
  let confirmDiscard = $state(false);
  function discard() {
    if (anyLaps) confirmDiscard = true;
    else void run(discardLaps);
  }

  // ---- warnings before a start (#70) ----
  const offSeat = $derived(
    heat
      ? offSeatWarnings(timer.seats, heat.slots, (id) => pilotById(setup, id)?.callsign ?? '')
      : []
  );
  const offSeatIndexes = $derived(new Set(offSeat.map((w) => w.seat)));
  /** Practice (no heat): RotorHazard never saves those laps, so Save is not offered (#50). */
  const practice = $derived(race.heatId === 0);
  // ---- RaceGOW mode (#95): one seat, picked here; the others off in the RaceGOW profile ----
  const racegow = $derived(timer.mode === 'racegow');
  const racegowSeat = $derived(
    timer.racegow.seat != null ? timer.seats.find((x) => x.index === timer.racegow.seat) : undefined
  );
  /**
   * The leaderboard is for a race, not an idle timer's seat list (#47): nothing while Ready,
   * and a seat RotorHazard lists by its frequency only once it has laps (practice).
   */
  const boardRows = $derived(
    timer.leaderboard && status !== RACE_STATUS.READY
      ? timer.leaderboard.rows.filter((r) => r.pilotId > 0 || r.laps > 0)
      : []
  );

  // ---- seats ----
  const seatRows = $derived(
    timer.seats
      .filter((s) => s.frequency > 0 || timer.live[s.index]?.pilot)
      .map((s) => {
        const live = timer.live[s.index];
        const position = timer.leaderboard?.rows.find((r) => r.node === s.index)?.position;
        const slot = heat?.slots.find((x) => x.nodeIndex === s.index);
        const pilot = slot?.pilotId ? pilotById(setup, slot.pilotId) : undefined;
        // The card counts laps as RotorHazard's leaderboard does: no hole shot, no late lap.
        const laps = live ? flownLaps(live) : [];
        const best = live?.fastestIndex != null ? live.laps[live.fastestIndex] : undefined;
        return {
          seat: s,
          tag: seatTag(s),
          callsign: pilot?.callsign ?? live?.pilot?.callsign ?? '',
          color: pilot?.color ?? '',
          live,
          laps,
          last: laps[laps.length - 1],
          best,
          crossing: s.crossing,
          finished: live?.finished ?? false,
          position: status === RACE_STATUS.READY ? undefined : position,
          off: offSeatIndexes.has(s.index)
        };
      })
  );
  const lapLabel = (l: LiveLap) =>
    l.number === 0 ? 'start' : l.number < 0 ? 'late' : `L${l.number}`;
  // RotorHazard's rule: a lap it deleted itself (late, after time ran out) can be restored;
  // a lap the director deletes is gone for good, so that one asks first.
  let lapToDelete: { seat: number; lap: LiveLap } | null = $state(null);
  function onLap(seat: number, lap: LiveLap) {
    if (!canEditLaps) return;
    if (lap.deleted) void run(() => restoreLap(seat, lap.index));
    else lapToDelete = { seat, lap };
  }

  // ---- after a save ----
  const last = $derived(timer.lastRace);
  const lastHeat = $derived(last ? heatById(setup, last.heatId) : undefined);
  /** RaceGOW: the run's track, for the card title. */
  const lastTrack = $derived(
    lastHeat ? setup.classes.find((c) => c.id === lastHeat.classId) : undefined
  );
  /** What RotorHazard loaded after that save (its heat advance), in words. */
  const nextUp = $derived(
    last ? nextUpText(setup, last.heatId, { heatId: race.heatId, nextRound: race.nextRound }) : ''
  );
  const pending = $derived(setup.heats.filter(needsSeeding).length);
  const report = $derived(timer.autoSeedReport);

  // ---- a scheduled start and the format the timer races with (RotorHazard's Run page) ----
  let scheduleM = $state('0');
  let scheduleS = $state('30');
  const scheduleLeftMs = $derived(
    timer.schedule.scheduled && timer.schedule.at != null && timer.sync.differential != null
      ? timer.schedule.at * 1000 - timer.sync.differential - now
      : null
  );
  async function schedule() {
    const m = Math.max(0, Math.floor(Number(scheduleM) || 0));
    const s = Math.max(0, Math.floor(Number(scheduleS) || 0));
    if (!m && !s) return onresult({ ok: false, message: 'Schedule: enter a time ahead.' });
    await run(() => scheduleRace(m, s), `Start scheduled in ${m}:${String(s).padStart(2, '0')}.`);
  }
  /** RotorHazard lets the format be picked on Run only when no stage fixes it. */
  const formatPickable = $derived(status === RACE_STATUS.READY && (!heat || !cls || !cls.formatId));

  // ---- race settings strip (RotorHazard's Race Management panel, read here, set elsewhere) ----
  const profileName = $derived(
    timer.profiles.list.find((p) => p.id === timer.profiles.currentId)?.name ??
      timer.profiles.name ??
      ''
  );
  const behaviorLabel = $derived(
    MIN_LAP_BEHAVIOR_LABELS[timer.timing.minLapBehavior as 0 | 1] ?? ''
  );
  let editFormat: RaceFormat | null = $state(null);
  /** RotorHazard's Audio Control panel, as a dialog from the header. */
  let soundOpen = $state(false);
  // RotorHazard's Send Message panel: a priority message to every page.
  let messageText = $state('');
  let messageInterrupt = $state(false);
  async function send() {
    const text = messageText.trim();
    if (!text) return;
    await run(() => sendMessage(text, messageInterrupt), 'Message sent to every page.');
    if (timer.message?.text === text) messageText = '';
  }
  /** RotorHazard's Display Settings (per browser, its rotorhazard.display_* keys). */
  let prefs: DisplayPrefs = $state(readDisplayPrefs(safeStorage()));
  function safeStorage(): Storage | null {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }
  function setPref(key: keyof DisplayPrefs, value: boolean) {
    prefs = { ...prefs, [key]: value };
    saveDisplayPrefs(safeStorage(), prefs);
  }

  // ---- RotorHazard's own messages ----
  const message = $derived(timer.message && now - 0 ? timer.message : null);
  let dismissedAt = $state(0);
  // RotorHazard's own page fades its message popups: a plain message goes after 8 s; an
  // interrupt stays until dismissed. Any message is about the heat it was sent during, so a
  // new heat or a new staging clears it (#71).
  $effect(() => {
    const m = message;
    if (!m || m.interrupt) return;
    const id = window.setTimeout(() => (dismissedAt = Math.max(dismissedAt, m.at)), 8000);
    return () => window.clearTimeout(id);
  });
  let messageHeat: number | undefined;
  let messageStatus: number | undefined;
  $effect(() => {
    const heatNow = race.heatId;
    const statusNow = status;
    const heatChanged = messageHeat !== undefined && heatNow !== messageHeat;
    const staged =
      messageStatus !== undefined &&
      statusNow === RACE_STATUS.STAGING &&
      messageStatus !== RACE_STATUS.STAGING;
    messageHeat = heatNow;
    messageStatus = statusNow;
    if (heatChanged || staged) dismissedAt = Date.now();
  });
</script>

<section class="page">
  {#if !audio.unlocked}
    <Banner tone="info"
      >Click anywhere once to enable sound: staging tones, start, lap callouts.
      <button type="button" class="linkish">Enable sound</button></Banner
    >
  {/if}
  <p class="soundrow">
    <button type="button" class="linkish" onclick={() => (soundOpen = true)}>Sound settings…</button
    >
  </p>
  <form
    class="message"
    aria-label="Send message"
    onsubmit={(e) => {
      e.preventDefault();
      void send();
    }}
  >
    <Input
      size="sm"
      maxlength={256}
      placeholder="Message to every page, RotorHazard's included"
      aria-label="Message to every page"
      bind:value={messageText}
      disabled={busy}
    />
    <label class="check"
      ><input type="checkbox" bind:checked={messageInterrupt} disabled={busy} /> Pop-up alert</label
    >
    <Button size="sm" variant="secondary" type="submit" disabled={busy || !messageText.trim()}
      >Send message</Button
    >
  </form>
  {#if offSeat.length && status === RACE_STATUS.READY}
    <Banner tone="warn">
      {#each offSeat as w (w.seat)}<span class="offline">{w.text}</span>{/each}
    </Banner>
  {/if}
  {#if notice}
    <Banner tone={notice.tone === 'danger' ? 'danger' : 'success'} ondismiss={() => (notice = null)}
      >{notice.text}</Banner
    >
  {/if}
  {#if message && message.at > dismissedAt}
    <Banner tone={message.interrupt ? 'warn' : 'info'} ondismiss={() => (dismissedAt = Date.now())}
      >{message.text}</Banner
    >
  {/if}

  {#if racegow}
    <Card
      title="Seat"
      subtitle="One seat for racegow. Picking it turns every other seat off in the RaceGOW profile; the club profile is untouched."
    >
      <div class="racegowseat">
        <label class="field">
          <span>Seat</span>
          <Select
            size="sm"
            value={timer.racegow.seat == null ? '' : String(timer.racegow.seat)}
            disabled={busy || status !== RACE_STATUS.READY}
            aria-label="Seat"
            onchange={(e: Event) =>
              run(
                () => flySeat(Number((e.currentTarget as HTMLSelectElement).value)),
                'Seat set; the other seats are off in the RaceGOW profile.'
              )}
          >
            <option value="" disabled>Pick a seat</option>
            {#each timer.seats as s (s.index)}
              <option value={String(s.index)}>Seat {s.index + 1}</option>
            {/each}
          </Select>
        </label>
        {#if racegowSeat}
          <div class="field">
            <span>Channel</span>
            <ChannelPicker seat={racegowSeat} onresult={(r) => onresult(r, 'Channel set.')} />
          </div>
          <a class="tune" href={href(`seats/${racegowSeat.index}`)} onclick={link}>Tune this seat</a
          >
        {/if}
        <span class="muted profilenote" role="status">
          {timer.profiles.name.trim().toLowerCase() === 'racegow'
            ? 'RaceGOW profile active.'
            : 'The RaceGOW profile is made when you pick a seat.'}
        </span>
      </div>
    </Card>
  {/if}

  <Card>
    <div class="head">
      <div class="pick">
        <span class="label">On the timer</span>
        {#key pickKey}
          <Select value={String(race.heatId)} disabled={!canPick || busy} onchange={onPick}>
            <option value="0">Practice — no heat</option>
            {#each stages as c (c.id)}
              {@const hs = stageHeats(c.id)}
              {#if hs.length}
                <optgroup label={c.displayName}>
                  {#each hs as h (h.id)}<option value={String(h.id)} disabled={!h.active}
                      >{h.displayName}{h.active
                        ? ''
                        : ' — raced; RotorHazard keeps grouped heats inactive, re-fly it as a new round from the Stages board'}</option
                    >{/each}
                </optgroup>
              {/if}
            {/each}
            {#if unclassified.length}
              <optgroup label="No stage">
                {#each unclassified as h (h.id)}<option value={String(h.id)}>{h.displayName}</option
                  >{/each}
              </optgroup>
            {/if}
          </Select>
        {/key}
        <div class="sub">
          {#if heat}
            {roundsText}
            {#if cls}· {cls.displayName}{/if}
            {#if stageBadge}<Badge tone="neutral">{STAGE_STATE_LABELS[stageBadge]}</Badge>{/if}
            {#if aceNote}<span class="acenote" role="note">{aceNote}</span>{/if}
          {:else}
            Practice: whoever is on a seat. RotorHazard does not save practice laps; Stop, then
            Discard, clears them.
          {/if}
          {#if formatPickable}
            · <Select
              value={String(race.formatId ?? '')}
              size="sm"
              disabled={busy}
              aria-label="Race format"
              onchange={(e: Event) =>
                run(
                  () => setRaceFormat(Number((e.currentTarget as HTMLSelectElement).value)),
                  'Format set.'
                )}
            >
              {#each setup.formats as f (f.id)}<option value={String(f.id)}>{f.name}</option>{/each}
            </Select>
          {:else if format}· {format.name}, {formatSummary(format)}{/if}
        </div>
        <RaceSettingsStrip
          {profileName}
          minLapS={timer.timing.minLapMs / 1000}
          {behaviorLabel}
          {format}
          onEditFormat={() => (editFormat = format ?? null)}
        />
      </div>

      <div class="clock">
        <RaceClock
          {race}
          differential={timer.sync.differential}
          {now}
          frozenAt={timer.clockFrozenAt}
          size="xl"
        />
        <div class="state">
          <Badge tone={statusTone}>{statusLabel}</Badge>
          {#if clock.phase === 'unsynced' && status !== RACE_STATUS.READY}
            <button type="button" class="linkish" onclick={resyncClock}>sync clock</button>
          {/if}
        </div>
      </div>

      <div class="controls">
        <Button
          variant="primary"
          size="lg"
          disabled={!canStart || busy}
          onclick={() => run(stageRace)}>Start</Button
        >
        <Button variant="danger" size="lg" disabled={!canStop || busy} onclick={() => run(stopRace)}
          >Stop</Button
        >
        <Button
          variant="secondary"
          size="lg"
          disabled={!canSave || busy || practice}
          title={practice ? 'Practice laps are never saved by RotorHazard' : undefined}
          onclick={() => run(saveLaps, 'Race saved.')}>Save</Button
        >
        <Button variant="ghost" size="lg" disabled={!canDiscard || busy} onclick={discard}
          >Discard</Button
        >
        {#if scheduleLeftMs != null}
          <span class="scheduled" role="status">Starts in {countdownText(scheduleLeftMs)}</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onclick={() => run(cancelScheduledRace, 'Scheduled start cancelled.')}
            >Cancel start</Button
          >
        {:else}
          <form
            class="schedule"
            onsubmit={(e) => {
              e.preventDefault();
              void schedule();
            }}
          >
            <Input
              type="number"
              size="sm"
              min="0"
              max="999"
              aria-label="Minutes"
              bind:value={scheduleM}
              disabled={busy || status !== RACE_STATUS.READY}
            />:<Input
              type="number"
              size="sm"
              min="0"
              max="59"
              aria-label="Seconds"
              bind:value={scheduleS}
              disabled={busy || status !== RACE_STATUS.READY}
            />
            <Button
              size="sm"
              variant="ghost"
              type="submit"
              disabled={busy || status !== RACE_STATUS.READY}
              title="RotorHazard starts the race itself when the time is up">Schedule start</Button
            >
          </form>
        {/if}
      </div>
    </div>
  </Card>

  <div class="seats">
    {#each seatRows as row (row.seat.index)}
      <div class="seat" class:crossing={row.crossing} class:finished={row.finished}>
        <div class="seathead">
          <span class="chan" data-band={row.tag?.band ?? ''}
            >{row.tag ? `${row.tag.band}${row.tag.channel}` : `Seat ${row.seat.index + 1}`}</span
          >
          <span class="who" style={row.color ? `--pilot: ${row.color}` : ''}>
            {#if row.callsign}<span class="swatch"></span>{row.callsign}{:else}<span class="muted"
                >empty</span
              >{/if}
          </span>
          {#if row.crossing}<span class="cross" role="status">crossing</span>{/if}
          {#if row.finished}<span class="fin" role="status">finished</span>{/if}
          {#if !prefs.hide_graphs}<span class="rssi" title="RSSI">{row.seat.rssi || ''}</span>{/if}
          <a
            class="tune"
            href={href(`seats/${row.seat.index}`)}
            onclick={link}
            title="Tune this seat">tune</a
          >
          <Button
            size="sm"
            variant="ghost"
            disabled={status !== RACE_STATUS.RACING || busy}
            title="Manual lap: register a pass on this seat now, as RotorHazard's + Lap does"
            aria-label="Manual lap for seat {row.seat.index + 1}"
            onclick={() => {
              cueManualLap(row.seat.index);
              void run(() => simulateLap(row.seat.index));
            }}>+ Lap</Button
          >
        </div>
        {#if row.off}
          <p class="offseat" role="alert">
            No frequency on this seat: {row.callsign} will not be timed.
          </p>
        {/if}
        <div class="stats">
          <div class="stat big pos" title="Position">
            <span class="n">{row.position ? `P${row.position}` : '—'}</span><span class="l"
              >pos</span
            >
          </div>
          <div class="stat big laps" title="Laps">
            <span class="n">{row.laps.length}</span><span class="l">laps</span>
          </div>
          <div class="stat last" title="Last lap">
            <span class="n">{row.last ? row.last.formatted : '—'}</span><span class="l">last</span>
          </div>
          <div class="stat best" title="Best lap">
            <span class="n">{row.best ? row.best.formatted : '—'}</span><span class="l">best</span>
          </div>
        </div>
        {#if row.live?.laps.length}
          <div class="laps">
            {#each lapChips(row.live.laps, prefs) as chip (chip.lap.index)}
              {@const lap = chip.lap}
              <button
                type="button"
                class="lap"
                class:deleted={lap.deleted}
                class:best={row.live.fastestIndex === lap.index}
                disabled={!canEditLaps || busy}
                title={lap.deleted ? 'Deleted — click to restore' : 'Click to delete this lap'}
                onclick={() => onLap(row.seat.index, lap)}
                ><span class="ln">{lapLabel(lap)}</span
                >{lap.formatted}{#each chip.extra as x (x)}<span class="extra">{x}</span
                  >{/each}</button
              >
            {/each}
          </div>
        {/if}
      </div>
    {/each}
    {#if seatRows.length === 0}
      <p class="muted">No seat has a frequency. Set channels on the Seats page.</p>
    {/if}
  </div>

  <!-- Mounted only while open: a closed dialog's selects would otherwise stay in the DOM, and a
       label wrapping a select takes its option texts as its name ("Race clock Never …"),
       colliding with other controls' names on the page. -->
  {#if soundOpen}
    <Dialog bind:open={soundOpen} title="Sound settings" size="wide">
      <section class="prefs" aria-label="Display settings">
        <h3>Display</h3>
        <div class="checks">
          {#each DISPLAY_KEYS as key (key)}
            <label class="check" data-key={key}>
              <input
                type="checkbox"
                checked={prefs[key]}
                onchange={(e) => setPref(key, (e.currentTarget as HTMLInputElement).checked)}
              />
              {DISPLAY_LABELS[key]}
            </label>
          {/each}
        </div>
        <p class="muted">
          Per browser, as on RotorHazard's Run page: what each lap chip shows and in which order,
          and whether the RSSI readout is shown. Lap numbers are always on the chips here.
        </p>
      </section>
      <section class="prefs" aria-label="Callouts settings">
        <h3>Callouts</h3>
        <CalloutsPanel
          callouts={timer.callouts}
          onsave={(list) => run(() => saveCallouts(list), 'Callouts saved on the timer.')}
          onplay={(text) => run(() => playCallout(text), `Spoken: ${text}`)}
        />
      </section>
      <AudioSettingsPanel
        settings={audio.settings}
        voices={audio.voices}
        languages={timer.languages}
        onchange={applyAudioSettings}
        ontest={speakTest}
        onexport={exportAudioSettingsFile}
        onimport={(file) => {
          void importAudioSettingsFile(file).then((r) =>
            onresult(r.ok ? { ok: true } : { ok: false, message: r.message }, r.message)
          );
        }}
        ondefaults={() => {
          resetAudioSettings();
          onresult({ ok: true }, 'Audio settings back to RotorHazard defaults.');
        }}
      />
    </Dialog>
  {/if}

  {#if editFormat}
    <FormatDialog
      open={true}
      format={editFormat}
      pointsMethods={timer.pointsMethods}
      onresult={(r) => onresult(r, 'Format saved.')}
      onclose={() => (editFormat = null)}
    />
  {/if}

  {#if timer.leaderboard && boardRows.length}
    <Card title="Leaderboard" subtitle={timer.leaderboard.statusMsg || undefined}>
      {@render board(boardRows, timer.leaderboard.primary)}
    </Card>
  {/if}

  {#if last && status === RACE_STATUS.READY}
    <Card
      title={racegow
        ? `Last run: ${lastTrack?.displayName ?? lastHeat?.displayName ?? last.name}`
        : `Last race: ${lastHeat?.displayName ?? last.name}`}
      subtitle={racegow ? `Run ${last.round}` : `Round ${last.round}`}
    >
      {@render board(last.rows, last.primary)}
      {#if !racegow}<p class="nextup" role="status">{nextUp}</p>{/if}
      <div class="after">
        {#if racegow}
          <!-- Racegow tracks are small: nearly every run gets its laps checked (#95). -->
          <Button
            variant="primary"
            onclick={() => go(`marshal?heat=${last.heatId}&round=${last.round}`)}
            >Fix the laps</Button
          >
        {:else}
          <a href={href(`marshal?heat=${last.heatId}&round=${last.round}`)} onclick={link}
            >Marshal this race</a
          >
          <a href={href('stages')} onclick={link}>Stages board</a>
        {/if}
        {#if !racegow}
          <label class="check"
            ><input
              type="checkbox"
              checked={timer.autoSeed}
              onchange={(e) => setAutoSeed((e.currentTarget as HTMLInputElement).checked)}
            /> Seed as you go</label
          >
        {/if}
        {#if pending}
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onclick={() => run(() => seedAsYouGo().then(() => ({ ok: true })))}
            >Seed now ({pending})</Button
          >
        {/if}
        {#if timer.autoSeeding}
          <span class="muted">Seeding…</span>
        {:else if report && report.at >= (timer.lastSaved?.at ?? 0)}
          <span class="muted">
            {#if report.confirmed.length}Seeded {report.confirmed.join(', ')}.{/if}
            {#if report.waiting}{report.waiting} seat{report.waiting === 1 ? '' : 's'} still waiting on
              results.{/if}
            {#if !report.confirmed.length && !report.waiting}Nothing to seed.{/if}
          </span>
        {/if}
      </div>
    </Card>
  {/if}
</section>

{#snippet board(
  rows: Array<{
    position: number | null;
    callsign: string;
    laps: number;
    totalTime: string;
    fastestLap: string;
    lastLap: string;
    consecutives: string;
    node: number | null;
  }>,
  primary: string
)}
  <table class="lb">
    <thead>
      <tr>
        <th>#</th><th>Pilot</th><th>Laps</th>
        <th class:primary={primary === 'by_race_time'}>Time</th>
        <th class:primary={primary === 'by_fastest_lap'}>Fastest</th>
        <th>Last</th>
        <th class:primary={primary === 'by_consecutives'}>Consec.</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as r (r.callsign + ':' + r.node)}
        <tr>
          <td class="pos">{r.position ?? '—'}</td>
          <td>{r.callsign}</td>
          <td>{r.laps}</td>
          <td>{r.totalTime || '—'}</td>
          <td>{r.fastestLap || '—'}</td>
          <td>{r.lastLap || '—'}</td>
          <td>{r.consecutives || '—'}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/snippet}

{#if plan}
  <HeatPlanDialog
    {plan}
    rows={planRows(plan, setup)}
    {busy}
    onconfirm={() =>
      planAction(() => confirmHeatPlan(plan.heatId), `${plan.name} is loaded on the timer.`)}
    onreseed={() => planAction(() => reseedHeatPlan(plan.heatId))}
    oncancel={planCancel}
  />
{/if}

{#if lapToDelete}
  {@const d = lapToDelete}
  <ConfirmDialog
    open={true}
    title="Delete this lap?"
    confirmLabel="Delete lap"
    danger
    onconfirm={() => {
      // Take the seat and lap first: `d` reads lapToDelete, which is nulled to close (#49).
      const { seat, lap } = d;
      lapToDelete = null;
      void run(() => deleteLap(seat, lap.index));
    }}
    oncancel={() => (lapToDelete = null)}
  >
    Delete {lapLabel(d.lap)} ({d.lap.formatted}) for seat {d.seat + 1}? RotorHazard removes it for
    good; the laps after it are renumbered and retimed. To fix a race more carefully, save it and
    use Marshal.
  </ConfirmDialog>
{/if}

<ConfirmDialog
  bind:open={confirmDiscard}
  title="Discard this race?"
  confirmLabel="Discard"
  danger
  onconfirm={() => {
    confirmDiscard = false;
    void run(discardLaps);
  }}
>
  The laps from this race will be thrown away and nothing saved. The heat stays loaded to race
  again.
</ConfirmDialog>

<style>
  .offline {
    display: block;
  }
  .schedule {
    display: flex;
    align-items: center;
    gap: var(--gf-space-1);
    flex-basis: 100%;
  }
  .schedule :global(.gf-input) {
    width: 4.5rem;
  }
  .scheduled {
    flex-basis: 100%;
    font-weight: 600;
  }
  .prefs {
    margin-bottom: var(--gf-space-3);
  }
  .prefs h3 {
    margin: 0 0 var(--gf-space-2);
    font-size: var(--gf-font-size-sm);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--gf-text-muted);
  }
  .checks {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: var(--gf-space-1) var(--gf-space-3);
  }
  .check {
    display: flex;
    gap: var(--gf-space-1);
    align-items: center;
  }
  .lap .extra {
    margin-left: var(--gf-space-1);
    color: var(--gf-text-muted);
    font-size: var(--gf-font-size-xs);
  }
  .message {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gf-space-1) var(--gf-space-2);
    align-items: center;
    margin-bottom: var(--gf-space-2);
  }
  .message :global(.gf-input) {
    flex: 1 1 16rem;
  }
  .soundrow {
    margin: 0;
    font-size: var(--gf-font-size-sm);
  }
  .racegowseat {
    display: flex;
    gap: var(--gf-space-3);
    align-items: end;
    flex-wrap: wrap;
  }
  .racegowseat .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 140px;
  }
  .racegowseat .field > span {
    font-size: var(--gf-font-size-sm);
    color: var(--gf-text-muted);
  }
  .profilenote {
    font-size: var(--gf-font-size-sm);
  }
  .tune {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
  }
  .cross,
  .fin {
    font-size: var(--gf-font-size-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0 var(--gf-space-1);
    border-radius: var(--gf-radius-sm, 4px);
    background: var(--gf-warning-500, #d29922);
    color: var(--gf-bg, #000);
  }
  .fin {
    background: var(--gf-success-500, #2ea043);
  }
  .nextup {
    margin: var(--gf-space-2) 0 0;
    font-weight: 600;
  }
  .offseat {
    margin: 0 0 var(--gf-space-1);
    color: var(--gf-warning-500, #d29922);
    font-size: var(--gf-font-size-sm);
  }
  .acenote {
    display: block;
    color: var(--gf-warning-500, #d29922);
  }
  .page {
    display: grid;
    gap: var(--gf-space-3);
  }
  .head {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) auto auto;
    gap: var(--gf-space-4);
    align-items: center;
  }
  @media (max-width: 860px) {
    .head {
      grid-template-columns: 1fr;
    }
  }
  .pick {
    display: grid;
    gap: 4px;
  }
  .label {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .sub {
    color: var(--gf-text-muted);
    font-size: var(--gf-font-size-sm);
    display: flex;
    gap: var(--gf-space-1);
    align-items: center;
    flex-wrap: wrap;
  }
  .clock {
    text-align: center;
    min-width: 200px;
  }
  .state {
    margin-top: var(--gf-space-1);
    display: flex;
    gap: var(--gf-space-2);
    justify-content: center;
    align-items: center;
  }
  .linkish {
    background: none;
    border: 0;
    color: var(--gf-brand-500);
    cursor: pointer;
    font: inherit;
    font-size: var(--gf-font-size-sm);
    padding: 0;
  }
  .controls {
    display: flex;
    gap: var(--gf-space-2);
    flex-wrap: wrap;
  }
  .seats {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: var(--gf-space-2);
  }
  .seat {
    background: var(--gf-surface);
    border: 1px solid var(--gf-border);
    border-radius: var(--gf-radius-md);
    padding: var(--gf-space-2) var(--gf-space-3);
    display: grid;
    gap: var(--gf-space-2);
    transition: box-shadow 0.15s;
  }
  .seat.crossing {
    box-shadow: 0 0 0 2px var(--gf-green-400);
  }
  .seat.finished {
    opacity: 0.75;
  }
  .seathead {
    display: flex;
    gap: var(--gf-space-2);
    align-items: baseline;
  }
  .chan {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    min-width: 2.2em;
  }
  .chan[data-band='R'] {
    color: var(--gf-red-400);
  }
  .chan[data-band='F'] {
    color: var(--gf-amber-400);
  }
  .chan[data-band='E'] {
    color: var(--gf-green-400);
  }
  .chan[data-band='B'] {
    color: var(--gf-blue-400);
  }
  .chan[data-band='A'] {
    color: var(--gf-violet-400);
  }
  .chan[data-band='L'] {
    color: var(--gf-cyan-400);
  }
  .who {
    flex: 1;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--pilot, var(--gf-border));
    flex: none;
  }
  .rssi {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .stats {
    display: grid;
    grid-template-columns: auto 1fr 1fr;
    gap: var(--gf-space-3);
    align-items: end;
  }
  .stat {
    display: grid;
    line-height: 1.1;
  }
  .stat .n {
    font-size: var(--gf-font-size-lg);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .stat.big .n {
    font-size: 34px;
    font-weight: 700;
  }
  .stat .l {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .laps {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .lap {
    font: inherit;
    font-size: var(--gf-font-size-xs);
    font-variant-numeric: tabular-nums;
    color: var(--gf-text);
    background: var(--gf-surface-sunken);
    border: 1px solid var(--gf-border);
    border-radius: var(--gf-radius-sm);
    padding: 1px 6px;
    cursor: pointer;
    display: inline-flex;
    gap: 5px;
  }
  .lap:disabled {
    cursor: default;
  }
  .lap .ln {
    color: var(--gf-text-muted);
  }
  .lap.best {
    border-color: var(--gf-green-400);
  }
  .lap.deleted {
    text-decoration: line-through;
    opacity: 0.55;
  }
  .lb {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  .lb th,
  .lb td {
    text-align: left;
    padding: 4px var(--gf-space-2);
    border-bottom: 1px solid var(--gf-border);
  }
  .lb th {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
  }
  .lb th.primary {
    color: var(--gf-text);
  }
  .lb .pos {
    font-weight: 700;
    width: 2em;
  }
  .after {
    display: flex;
    gap: var(--gf-space-3);
    align-items: center;
    flex-wrap: wrap;
    margin-top: var(--gf-space-2);
    font-size: var(--gf-font-size-sm);
  }
  .check {
    display: flex;
    align-items: center;
    gap: var(--gf-space-1);
  }
  .muted {
    color: var(--gf-text-muted);
  }
</style>
