<script lang="ts">
  /**
   * The stages board (#15, #9). A stage is a RotorHazard class seen the way a race director
   * plans the day: practice, qualifying, brackets, Chase the Ace. Each stage card is a grid —
   * one row per heat with its lineup, one column per round, a cell per race — with the
   * class settings above it (selects write on change with readback). Click a heat row to
   * seat it. "Add stage" creates a class and its heats from a template in one step.
   */
  import HelpLink from '../components/HelpLink.svelte';
  import { Badge, Banner, Button, Card, Dialog, Input, Select } from '@gridfpv/components';
  import AddStageDialog from '../components/AddStageDialog.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import GenerateDialog from '../components/GenerateDialog.svelte';
  import HeatDialog from '../components/HeatDialog.svelte';
  import RaceDialog from '../components/RaceDialog.svelte';
  import {
    addHeat,
    alterClass,
    alterHeat,
    deleteRace,
    deleteStage,
    duplicateClass,
    forgetDeletedRace,
    restoreRace,
    rh,
    seedHeat,
    setCurrentHeat,
    unseedHeat,
    type WriteResult
  } from '../lib/rh.svelte.js';
  import { raceFor, racesFor, winnerOf } from '../lib/results.js';
  import { aceLine, aceRule, isAceStage, stageTally } from '../lib/ace.js';
  import { defaultRankLabel } from '../lib/stages.js';
  import {
    deletedLabel,
    deletedNotice,
    deletedRacesFor,
    restoreBlocker,
    type DeletedRace
  } from '../lib/rounds.js';
  import { seatTag } from '../lib/channels.js';
  import {
    CLASS_NONE,
    HEAT_ADVANCE,
    heatsInClass,
    ROUND_TYPE,
    type Heat,
    type RaceClass
  } from '../lib/setup.js';
  import {
    boardLayout,
    bracketRounds,
    heatShortName,
    isBracketStage,
    isSeededHeat,
    needsSeeding,
    nextRound,
    roundColumns,
    roundLabel,
    roundsOf,
    seatChips,
    STAGE_STATE_LABELS,
    stageState,
    standingsLine,
    type StageState
  } from '../lib/stages.js';

  const timer = rh();
  const setup = $derived(timer.setup);
  const results = $derived(timer.results);
  /** The one race that is actually next: RotorHazard's loaded heat, at that heat's next round. */
  /**
   * The loaded heat at the round it will race. A grouped-rounds heat belongs to one round
   * section and RotorHazard counts its next round by the stage, so the loaded heat is next
   * wherever it sits (#58).
   */
  const isUpNext = (heatId: number, round: number, grouped = false) =>
    timer.current.heatId === heatId && (grouped || round === (timer.current.nextRound ?? round));
  const stages = $derived(
    [...setup.classes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id)
  );
  const unclassified = $derived(heatsInClass(setup, CLASS_NONE));
  const seatCount = $derived(timer.hello?.seat_count ?? timer.seats.length);

  let notice: { tone: 'success' | 'danger'; text: string } | null = $state(null);
  let noticeTimer = 0;
  function onresult(r: WriteResult, okText = 'RotorHazard confirmed the change.', holdMs = 2500) {
    window.clearTimeout(noticeTimer);
    notice = r.ok
      ? { tone: 'success', text: okText }
      : { tone: 'danger', text: r.message ?? 'RotorHazard did not confirm the change.' };
    if (r.ok) noticeTimer = window.setTimeout(() => (notice = null), holdMs);
  }

  let busy = $state(false);
  async function run(fn: () => Promise<WriteResult>, okText?: string, holdMs?: number) {
    busy = true;
    try {
      onresult(await fn(), okText, holdMs);
    } finally {
      busy = false;
    }
  }

  /** Raced classes whose settings the director unlocked (RotorHazard's own page does the same). */
  let unlockedClasses: number[] = $state([]);
  let unlockingClass: RaceClass | null = $state(null);
  const classLocked = (c: RaceClass) => c.locked && !unlockedClasses.includes(c.id);

  // ---- rounds (#36): re-run, delete with a kept copy, restore ----
  async function rerun(heatId: number) {
    raceOpen = null;
    const h = setup.heats.find((x) => x.id === heatId);
    await run(() => setCurrentHeat(heatId), `${h?.displayName ?? 'Heat'} is loaded on the timer.`);
  }
  async function removeRace(heatId: number, round: number) {
    raceOpen = null;
    busy = true;
    try {
      const r = await deleteRace(heatId, round);
      onresult(r, deletedNotice(r.backup), 8000);
    } finally {
      busy = false;
    }
  }
  const restoreRaceOf = (d: DeletedRace) =>
    run(() => restoreRace(d), `Round ${d.round} is back in the results.`);
  const forgetRace = (d: DeletedRace) => run(() => forgetDeletedRace(d), 'Copy discarded.');

  // ---- dialogs ----
  let adding = $state(false);
  let generating: RaceClass | null = $state(null);
  const generatingLive = $derived(
    generating ? (setup.classes.find((c) => c.id === generating!.id) ?? null) : null
  );
  let heatOpen: number | null = $state(null);
  /** A raced round opened from its board cell. */
  let raceOpen: { heatId: number; round: number } | null = $state(null);
  const raceLive = $derived.by(() => {
    const o = raceOpen;
    return o ? (raceFor(results, o.heatId, o.round) ?? null) : null;
  });
  const heatLive = $derived(
    heatOpen == null ? null : (setup.heats.find((h) => h.id === heatOpen) ?? null)
  );

  let classEdit: RaceClass | null = $state(null);
  let className = $state('');
  let classDescription = $state('');
  function openClassEdit(c: RaceClass) {
    className = c.name;
    classDescription = c.description;
    classEdit = c;
  }
  async function saveClass() {
    const c = classEdit;
    if (!c || !className.trim()) return;
    classEdit = null;
    const fields: Parameters<typeof alterClass>[1] = {};
    if (className.trim() !== c.name) fields.name = className.trim();
    if (classDescription.trim() !== c.description) fields.description = classDescription.trim();
    if (Object.keys(fields).length) await run(() => alterClass(c.id, fields));
  }
  let classRemove: RaceClass | null = $state(null);

  const ADVANCE = [
    { v: HEAT_ADVANCE.NONE, l: 'Stay on this heat' },
    { v: HEAT_ADVANCE.NEXT_HEAT, l: 'Next heat' },
    { v: HEAT_ADVANCE.NEXT_ROUND, l: 'Next round' }
  ];
  const ROUNDS = [
    { v: ROUND_TYPE.RACES_PER_HEAT, l: 'Races per heat' },
    { v: ROUND_TYPE.GROUPED, l: 'Grouped rounds' }
  ];
  const STATE_TONE: Record<StageState, 'neutral' | 'info' | 'success' | 'warn' | 'accent'> = {
    empty: 'neutral',
    plan: 'warn',
    seeded: 'info',
    ready: 'success',
    running: 'accent',
    done: 'neutral'
  };
  const columns = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  /** The chip's lead: the seat's channel tag (R1, F4), a bare MHz, or Off; the seat number if unknown. */
  function seatChan(seat: number): { text: string; band: string } {
    const s = timer.seats[seat - 1];
    if (!s) return { text: String(seat), band: '' };
    if (!s.frequency) return { text: 'Off', band: 'off' };
    const t = seatTag(s);
    return t
      ? { text: `${t.band}${t.channel}`, band: t.band }
      : { text: String(s.frequency), band: '' };
  }

  /** Seed every unconfirmed seeded heat of a stage; report how many seats are still waiting. */
  async function seedStage(heats: Heat[]) {
    const todo = heats.filter(needsSeeding);
    busy = true;
    try {
      let waiting = 0;
      let confirmed = 0;
      for (const h of todo) {
        const r = await seedHeat(h.id);
        if (!r.ok) return onresult(r);
        if (r.waiting) waiting += r.waiting;
        else confirmed++;
      }
      onresult({ ok: true });
      if (waiting) window.clearTimeout(noticeTimer);
      if (waiting)
        notice = {
          tone: 'success',
          text: `${confirmed} heat${confirmed === 1 ? '' : 's'} seeded and confirmed; ${waiting} seat${waiting === 1 ? '' : 's'} still waiting on results. Run Seed now again when they are in.`
        };
    } finally {
      busy = false;
    }
  }
  async function unseedStage(heats: Heat[]) {
    busy = true;
    try {
      for (const h of heats.filter((x) => isSeededHeat(x) && !x.locked && x.status !== 0)) {
        const r = await unseedHeat(h.id);
        if (!r.ok) return onresult(r);
      }
      onresult({ ok: true });
    } finally {
      busy = false;
    }
  }
</script>

{#if generatingLive}
  <GenerateDialog
    stage={generatingLive}
    stages={stages.filter((c) => c.id !== generatingLive!.id)}
    {onresult}
    onclose={() => (generating = null)}
  />
{/if}

{#if adding}
  <AddStageDialog
    {setup}
    rankMethods={timer.rankMethods}
    {seatCount}
    {onresult}
    onclose={() => (adding = false)}
  />
{/if}

{#if heatLive}
  <HeatDialog heat={heatLive} {setup} {onresult} onclose={() => (heatOpen = null)} />
{/if}

{#if raceLive}
  <RaceDialog
    race={raceLive}
    heatName={setup.heats.find((h) => h.id === raceLive!.heatId)?.displayName ?? 'Heat'}
    {busy}
    onclose={() => (raceOpen = null)}
    onrerun={() => rerun(raceLive!.heatId)}
    ondelete={() => removeRace(raceLive!.heatId, raceLive!.round)}
  />
{/if}

{#if classEdit}
  <Dialog open={true} title="Edit stage" onclose={() => (classEdit = null)}>
    <div class="form">
      <label class="field"
        ><span>Name</span><Input
          bind:value={className}
          maxlength="80"
          onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && saveClass()}
        /></label
      >
      <label class="field"
        ><span>Description</span><Input
          bind:value={classDescription}
          placeholder="Optional"
          maxlength="200"
        /></label
      >
    </div>
    {#snippet footer()}
      <Button variant="ghost" onclick={() => (classEdit = null)}>Cancel</Button>
      <Button variant="primary" disabled={!className.trim() || busy} onclick={saveClass}
        >Save</Button
      >
    {/snippet}
  </Dialog>
{/if}

{#if unlockingClass}
  <ConfirmDialog
    open={true}
    title="Unlock stage"
    confirmLabel="Unlock"
    danger
    onconfirm={() => {
      const c = unlockingClass;
      unlockingClass = null;
      if (c) unlockedClasses = [...unlockedClasses, c.id];
    }}
    oncancel={() => (unlockingClass = null)}
  >
    <strong>{unlockingClass.displayName}</strong> has saved races. Changing its format changes how those
    results are ranked, as RotorHazard warns on its own page. Unlock anyway?
  </ConfirmDialog>
{/if}

{#if classRemove}
  <ConfirmDialog
    open={true}
    title="Delete stage"
    confirmLabel="Delete"
    danger
    onconfirm={() => {
      const c = classRemove;
      classRemove = null;
      if (c) void run(() => deleteStage(c.id));
    }}
    oncancel={() => (classRemove = null)}
  >
    Delete <strong>{classRemove.displayName}</strong> and its {heatsInClass(setup, classRemove.id)
      .length} heat{heatsInClass(setup, classRemove.id).length === 1 ? '' : 's'}? A stage with saved
    races cannot be deleted.
  </ConfirmDialog>
{/if}

{#snippet roundCell(h: Heat, r: number, next: number | null, label: boolean, grouped = false)}
  {@const race = raceFor(results, h.id, r)}
  {#if race}
    {@const w = winnerOf(race)}
    <button
      type="button"
      class="cell done"
      title="Round {r}, raced {race.startTime} — click for the result"
      onclick={(e) => {
        e.stopPropagation();
        raceOpen = { heatId: h.id, round: r };
      }}
      >{#if label}<span class="rn">R{r}</span>{/if}{w?.callsign ?? '✓'}</button
    >
  {:else if r === next && isUpNext(h.id, r, grouped)}
    <span class="cell next" title="Loaded on the timer"
      >{#if label}<span class="rn">R{r}</span>{/if}next</span
    >
  {:else if r === next}
    <button
      type="button"
      class="cell open"
      title="This heat's next round — click to load it on the timer"
      aria-label="Load {h.displayName} for round {r}"
      onclick={(e) => {
        e.stopPropagation();
        void rerun(h.id);
      }}
      >{#if label}R{r}{:else}·{/if}</button
    >
  {:else}
    <span class="cell todo"></span>
  {/if}
{/snippet}

{#snippet sectionedBoard(rounds: Heat[][])}
  <div class="grouped">
    {#each rounds as round, r (r)}
      <div class="roundsection">
        <div class="roundhead">
          <span>Round {r + 1}</span>
          {#if roundLabel(round)}<span class="muted">· {roundLabel(round)}</span>{/if}
        </div>
        {#if round.length === 0}
          <p class="muted empty">No heats in this round yet.</p>
        {:else}
          <div class="boardwrap">
            <table class="board">
              <tbody>
                {#each round as h (h.id)}
                  {@const race = racesFor(results, h.id)[0]}
                  {@const next = race ? null : 1}
                  <tr class="heat" onclick={() => (heatOpen = h.id)}>
                    <td class="heatcol">
                      <strong>{heatShortName(h)}</strong>
                      {#if h.locked}<span class="tag">raced</span>{/if}
                    </td>
                    <td class="lineup">
                      <div class="chips">
                        {#each seatChips(setup, h) as chip (chip.seat)}
                          {@const chan = seatChan(chip.seat)}
                          <span class="chip {chip.kind}" title={chip.title}
                            ><span class="n" data-band={chan.band}>{chan.text}</span
                            >{chip.text}</span
                          >
                        {/each}
                      </div>
                    </td>
                    <td class="round">{@render roundCell(h, 1, next, false, true)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/snippet}

{#snippet board(c: RaceClass | null, heats: Heat[])}
  {@const rounds = c ? roundColumns(c, heats, results) : 1}
  {@const layout = boardLayout(rounds, !!c && c.rounds === 0)}
  <div class="boardwrap">
    <table class="board" class:strip={layout === 'strip'}>
      <thead>
        <tr>
          <th class="heatcol">Heat</th>
          <th class="lineup">{layout === 'strip' ? 'Lineup and rounds' : 'Lineup'}</th>
          {#if layout === 'grid'}
            {#each columns(rounds) as r (r)}<th class="round">R{r}</th>{/each}
          {/if}
        </tr>
      </thead>
      <tbody>
        {#each heats as h (h.id)}
          {@const next = c ? nextRound(c, h, results, heats) : null}
          {@const raced = racesFor(results, h.id).length}
          <tr class="heat" onclick={() => (heatOpen = h.id)}>
            <td class="heatcol">
              <strong>{h.displayName}</strong>
              {#if h.locked}<span class="tag">raced</span>{/if}
            </td>
            <td class="lineup">
              <div class="chips">
                {#each seatChips(setup, h) as chip (chip.seat)}
                  {@const chan = seatChan(chip.seat)}
                  <span class="chip {chip.kind}" title={chip.title}
                    ><span class="n" data-band={chan.band}>{chan.text}</span>{chip.text}</span
                  >
                {/each}
              </div>
              {#if layout === 'strip'}
                <div class="roundstrip">
                  {#each columns(next ?? raced) as r (r)}
                    {@render roundCell(h, r, next, true)}
                  {/each}
                  {#if c && c.rounds > 0 && next != null && c.rounds - next > 0}
                    <span class="togo">{c.rounds - next} more</span>
                  {:else if c && c.rounds === 0}
                    <span class="togo">no limit</span>
                  {/if}
                </div>
              {/if}
            </td>
            {#if layout === 'grid'}
              {#each columns(rounds) as r (r)}
                <td class="round">{@render roundCell(h, r, next, false)}</td>
              {/each}
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/snippet}

<section class="page">
  <header class="pagehead">
    <div>
      <h1>Stages</h1>
      <HelpLink page="stages" />
      <p class="lede">
        The day in order: each stage runs its heats for a number of rounds. Click a heat to seat it.
      </p>
    </div>
    <Button variant="primary" disabled={busy} onclick={() => (adding = true)}>Add stage</Button>
  </header>

  {#if notice}
    <Banner tone={notice.tone} ondismiss={() => (notice = null)}>{notice.text}</Banner>
  {/if}

  {#each stages as c (c.id)}
    {@const heats = heatsInClass(setup, c.id)}
    {@const st = stageState(c, heats, results)}
    <Card>
      <div class="classhead">
        <div class="title">
          <h2>{c.displayName}</h2>
          <Badge tone={STATE_TONE[st]} variant={st === 'done' ? 'outline' : 'solid'}
            >{STAGE_STATE_LABELS[st]}</Badge
          >
          {#if c.description}<span class="muted">{c.description}</span>{/if}
        </div>
        <div class="actions">
          <Button size="sm" variant="secondary" disabled={busy} onclick={() => openClassEdit(c)}
            >Edit</Button
          >
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onclick={() => run(() => duplicateClass(c.id))}>Duplicate</Button
          >
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || c.locked}
            onclick={() => (classRemove = c)}>Delete</Button
          >
          {#if classLocked(c)}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              title="This stage has saved races; its format is locked"
              onclick={() => (unlockingClass = c)}>Unlock…</Button
            >
          {/if}
        </div>
      </div>
      <div class="settings">
        <label class="field">
          <span>Format</span>
          <Select
            value={String(c.formatId)}
            size="sm"
            disabled={busy || classLocked(c)}
            onchange={(e: Event) =>
              run(() =>
                alterClass(c.id, { formatId: Number((e.currentTarget as HTMLSelectElement).value) })
              )}
          >
            <option value="0">— none —</option>
            {#each setup.formats as f (f.id)}<option value={String(f.id)}>{f.name}</option>{/each}
          </Select>
        </label>
        <div class="field rounds">
          <span>Rounds</span>
          <div class="roundsrow">
            <Input
              type="number"
              size="sm"
              value={c.rounds > 0 ? String(c.rounds) : ''}
              placeholder="∞"
              min="1"
              max="99"
              disabled={busy || c.rounds === 0}
              aria-label="Rounds"
              onchange={(e: Event) =>
                run(() =>
                  alterClass(c.id, {
                    rounds: Math.max(1, Number((e.currentTarget as HTMLInputElement).value) || 1)
                  })
                )}
            />
            <label class="check">
              <input
                type="checkbox"
                checked={c.rounds === 0}
                disabled={busy}
                onchange={(e: Event) =>
                  run(() =>
                    alterClass(c.id, {
                      rounds: (e.currentTarget as HTMLInputElement).checked ? 0 : 3
                    })
                  )}
              />
              No limit
            </label>
          </div>
        </div>
        <label class="field">
          <span>Ranked by</span>
          <Select
            value={c.winCondition}
            size="sm"
            disabled={busy}
            onchange={(e: Event) =>
              run(() =>
                alterClass(c.id, { winCondition: (e.currentTarget as HTMLSelectElement).value })
              )}
          >
            <option value=""
              >{defaultRankLabel(setup.formats.find((f) => f.id === c.formatId))}</option
            >
            {#each timer.rankMethods as m (m.name)}<option value={m.name}>{m.label}</option>{/each}
          </Select>
          {#if c.winCondition === 'Cumulative_Points' && !setup.formats.find((f) => f.id === c.formatId)?.pointsMethod}
            <small class="hint" role="note"
              >Cumulative points add up only when the stage's format has a points method (Formats
              page); this one has none, so everyone scores 0.</small
            >
          {/if}
        </label>
        <label class="field">
          <span>After a race</span>
          <Select
            value={String(c.heatAdvanceType)}
            size="sm"
            disabled={busy}
            onchange={(e: Event) =>
              run(() =>
                alterClass(c.id, {
                  heatAdvanceType: Number((e.currentTarget as HTMLSelectElement).value)
                })
              )}
          >
            {#each ADVANCE as a (a.v)}<option value={String(a.v)}>{a.l}</option>{/each}
          </Select>
        </label>
        <div class="field">
          <span>Rounds are</span>
          <span class="static" title="Set when the stage was created">
            {ROUNDS.find((r) => r.v === c.roundType)?.l ?? '—'}
          </span>
        </div>
      </div>

      {#if isAceStage(c) && heats.length}
        {@const tally = stageTally(c, heats, results)}
        <p class="standings ace" class:decided={!!tally.ace} aria-label="Chase the Ace">
          <span class="label">Chase the Ace</span>
          {aceLine(tally, aceRule(c))}
        </p>
      {/if}
      {#if standingsLine(results.ranking[c.id])}
        <p class="standings">
          <span class="label">Standings</span>
          {standingsLine(results.ranking[c.id])}
        </p>
      {/if}
      {#if heats.length && c.roundType === ROUND_TYPE.GROUPED}
        {@render sectionedBoard(roundsOf(heats))}
      {:else if heats.length && isBracketStage(c, heats)}
        {@render sectionedBoard(bracketRounds(heats))}
      {:else if heats.length}
        {@render board(c, heats)}
      {:else}
        <p class="muted empty">No heats yet.</p>
      {/if}
      {@const deleted = deletedRacesFor(
        timer.deletedRaces,
        heats.map((h) => h.id)
      )}
      {#if deleted.length}
        <div class="deleted" aria-label="Deleted races">
          <span class="label">Deleted races</span>
          <ul>
            {#each deleted as d (d.id)}
              {@const blocker = restoreBlocker(d, results, setup)}
              <li>
                <span>{deletedLabel(d, setup)}</span>
                {#if d.deletedAt}<span class="muted">deleted {d.deletedAt}</span>{/if}
                <span class="spacer"></span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || !!blocker}
                  title={blocker
                    ? `Cannot restore: ${blocker}`
                    : 'Put this race back in the results'}
                  onclick={() => restoreRaceOf(d)}>Restore</Button
                >
                {#if !timer.deletedRacesNative}
                  <Button size="sm" variant="ghost" disabled={busy} onclick={() => forgetRace(d)}
                    >Discard copy</Button
                  >
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
      <div class="foot">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onclick={() => run(() => addHeat(c.id))}>Add heat</Button
        >
        {#if !heats.some((h) => h.locked)}
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || stages.length < 2}
            title={stages.length < 2
              ? 'Add a stage to seed from first'
              : 'Build a single-elimination bracket seeded from another stage'}
            onclick={() => (generating = c)}>Generate bracket…</Button
          >
        {/if}
        {#if heats.some(needsSeeding)}
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            title="Fill seeded seats from results and confirm the lineups"
            onclick={() => seedStage(heats)}>Seed now</Button
          >
        {/if}
        {#if heats.some((h) => isSeededHeat(h) && !h.locked && h.status !== 0)}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            title="Drop the confirmed lineups; seed again later"
            onclick={() => unseedStage(heats)}>Reset seeding</Button
          >
        {/if}
      </div>
    </Card>
  {/each}

  {#if stages.length === 0}
    <Card>
      <p class="muted">
        No stages yet. Add one to start building the day: practice, qualifying, a bracket, Chase the
        Ace.
      </p>
    </Card>
  {/if}

  {#if unclassified.length}
    <Card
      title="Heats outside any stage"
      subtitle="RotorHazard runs these as one-offs. Move them into a stage, or leave them for practice."
    >
      {@render board(null, unclassified)}
      <div class="foot">
        {#if stages.length}
          {#each unclassified as h (h.id)}
            <Select
              value=""
              size="sm"
              disabled={busy}
              onchange={(e: Event) => {
                const id = Number((e.currentTarget as HTMLSelectElement).value);
                if (id) void run(() => alterHeat(h.id, { classId: id }));
              }}
            >
              <option value="">Move {h.displayName} to…</option>
              {#each stages as c (c.id)}<option value={String(c.id)}>{c.displayName}</option>{/each}
            </Select>
          {/each}
        {/if}
        <Button size="sm" variant="ghost" disabled={busy} onclick={() => run(() => addHeat(0))}
          >Add one-off heat</Button
        >
      </div>
    </Card>
  {/if}
</section>

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
  .classhead {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--gf-space-3);
    flex-wrap: wrap;
  }
  .title {
    display: flex;
    align-items: center;
    gap: var(--gf-space-2);
    flex-wrap: wrap;
  }
  .title h2 {
    margin: 0;
    font-size: var(--gf-font-size-lg);
  }
  .actions {
    display: flex;
    gap: var(--gf-space-2);
  }
  .settings {
    display: flex;
    gap: var(--gf-space-3);
    align-items: end;
    flex-wrap: wrap;
    margin: var(--gf-space-2) 0 var(--gf-space-3);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 160px;
  }
  .field.narrow {
    min-width: 0;
    width: 84px;
  }
  .field.rounds {
    min-width: 0;
  }
  .static {
    display: flex;
    align-items: center;
    height: 32px;
    color: var(--gf-text);
    font-size: var(--gf-font-size-sm) !important;
    text-transform: none !important;
    letter-spacing: 0 !important;
  }
  .roundsrow {
    display: flex;
    align-items: center;
    gap: var(--gf-space-2);
  }
  .roundsrow :global(.gf-input) {
    width: 64px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: var(--gf-space-1);
    white-space: nowrap;
    font-size: var(--gf-font-size-sm);
  }
  .field span {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .form {
    display: grid;
    gap: var(--gf-space-3);
  }
  .empty {
    padding: var(--gf-space-2) 0;
  }
  .foot {
    display: flex;
    gap: var(--gf-space-2);
    flex-wrap: wrap;
    margin-top: var(--gf-space-2);
  }
  .deleted {
    margin-top: var(--gf-space-3);
    font-size: var(--gf-font-size-sm);
  }
  .deleted .label {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .deleted ul {
    list-style: none;
    margin: var(--gf-space-1) 0 0;
    padding: 0;
    display: grid;
    gap: var(--gf-space-1);
  }
  .deleted li {
    display: flex;
    align-items: center;
    gap: var(--gf-space-2);
    flex-wrap: wrap;
  }
  .deleted .spacer {
    flex: 1;
  }

  /* the board */
  .boardwrap {
    overflow-x: auto;
    border: 1px solid var(--gf-border);
    border-radius: var(--gf-radius-md);
  }
  .board {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--gf-font-size-sm);
  }
  .board th {
    text-align: left;
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 500;
    padding: var(--gf-space-1) var(--gf-space-2);
    background: var(--gf-surface-sunken);
    border-bottom: 1px solid var(--gf-border);
  }
  .board td {
    padding: var(--gf-space-2);
    border-bottom: 1px solid var(--gf-border);
    vertical-align: middle;
  }
  .board tr:last-child td {
    border-bottom: 0;
  }
  tr.heat {
    cursor: pointer;
  }
  tr.heat:hover td {
    background: color-mix(in srgb, var(--gf-surface-sunken) 60%, transparent);
  }
  .heatcol {
    white-space: nowrap;
    width: 1%;
  }
  .tag {
    margin-left: var(--gf-space-1);
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .round {
    width: 1%;
    white-space: nowrap;
    text-align: center;
  }
  th.round {
    text-align: center;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gf-space-1);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px 2px 4px;
    border-radius: 999px;
    border: 1px solid var(--gf-border);
    background: var(--gf-surface-sunken);
    white-space: nowrap;
  }
  .chip .n {
    display: inline-grid;
    place-items: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--gf-surface);
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    font-variant-numeric: tabular-nums;
  }
  /* Band colours, the same on every screen: R red, F amber, E green, B blue, A violet, L cyan. */
  .chip .n[data-band='R'] {
    color: var(--gf-red-400);
    background: color-mix(in srgb, var(--gf-red-400) 18%, transparent);
  }
  .chip .n[data-band='F'] {
    color: var(--gf-amber-400);
    background: color-mix(in srgb, var(--gf-amber-400) 18%, transparent);
  }
  .chip .n[data-band='E'] {
    color: var(--gf-green-400);
    background: color-mix(in srgb, var(--gf-green-400) 18%, transparent);
  }
  .chip .n[data-band='B'] {
    color: var(--gf-blue-400);
    background: color-mix(in srgb, var(--gf-blue-400) 18%, transparent);
  }
  .chip .n[data-band='A'] {
    color: var(--gf-violet-400);
    background: color-mix(in srgb, var(--gf-violet-400) 18%, transparent);
  }
  .chip .n[data-band='L'] {
    color: var(--gf-cyan-400);
    background: color-mix(in srgb, var(--gf-cyan-400) 18%, transparent);
  }
  .chip.empty .n {
    opacity: 0.7;
  }
  .chip.empty {
    color: var(--gf-text-muted);
    border-style: dashed;
    background: transparent;
  }
  .chip.seed {
    border-color: var(--gf-brand-500);
  }
  .chip.projected {
    border-color: var(--gf-brand-500);
    border-style: dashed;
  }
  .chip.pending {
    color: var(--gf-text-muted);
    border-style: dashed;
    font-style: italic;
  }
  .cell {
    display: inline-block;
    min-width: 5.5em;
    padding: 2px 8px;
    border-radius: var(--gf-radius-sm);
    font-size: var(--gf-font-size-xs);
  }
  button.cell {
    font: inherit;
    font-size: var(--gf-font-size-xs);
    border: 0;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }
  .cell.done {
    background: color-mix(in srgb, var(--gf-brand-500) 18%, transparent);
    color: var(--gf-text);
  }
  .cell.next {
    border: 1px dashed var(--gf-border);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .cell.open {
    min-width: 0;
    color: var(--gf-text-muted);
    border: 1px dashed var(--gf-border);
    padding: 2px 8px;
  }
  .hint {
    color: var(--gf-warning-500, #d29922);
    font-size: var(--gf-font-size-xs);
    text-transform: none;
    letter-spacing: 0;
  }
  .standings.ace.decided {
    color: var(--gf-brand-500);
    font-weight: 600;
  }
  .standings {
    margin: 0 0 var(--gf-space-2);
    font-size: var(--gf-font-size-sm);
  }
  .standings .label {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-right: var(--gf-space-2);
  }
  .roundstrip {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gf-space-1);
    margin-top: var(--gf-space-2);
    align-items: center;
  }
  .roundstrip .cell {
    min-width: 0;
  }
  .roundstrip .cell.todo {
    display: none;
  }
  .rn {
    color: var(--gf-text-muted);
    margin-right: 6px;
    font-variant-numeric: tabular-nums;
  }
  .togo {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    margin-left: var(--gf-space-1);
  }
  .grouped {
    display: grid;
    gap: var(--gf-space-3);
  }
  .roundhead {
    display: flex;
    gap: var(--gf-space-2);
    align-items: baseline;
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: var(--gf-space-1);
  }
  .roundhead .muted {
    text-transform: none;
    letter-spacing: 0;
  }
  .cell.todo {
    min-width: 0;
    width: 8px;
    height: 8px;
    padding: 0;
    border-radius: 50%;
    background: var(--gf-border);
  }
</style>
