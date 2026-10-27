<script lang="ts">
  /**
   * The event (#16): RotorHazard's name and description, plus the details it has no field
   * for (date, venue, organizer, notes), Edit → dialog → Save. "New event" is our flow over
   * RotorHazard's reset-with-archive: archive the current database, clear races, heats and
   * classes, keep pilots unless told otherwise, and always keep formats, profiles, teams
   * and presets. Archives are RotorHazard's backup files, listed with restore and delete.
   */
  import { Badge, Banner, Button, Card, Dialog, Input, Select } from '@gridfpv/components';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import {
    archiveNow,
    deleteArchive,
    newEvent,
    restoreArchive,
    rh,
    saveEvent,
    setConsecutivesBase,
    setMinFirstCrossing,
    setMinLap,
    setMinLapBehavior,
    type WriteResult
  } from '../lib/rh.svelte.js';
  import {
    CONSECUTIVES_MAX,
    CONSECUTIVES_MIN,
    lapRulesSummary,
    MIN_LAP_BEHAVIOR,
    MIN_LAP_BEHAVIOR_LABELS,
    parseConsecutivesBase,
    parseSeconds,
    SECONDS_MAX
  } from '../lib/timing.js';

  const timer = rh();
  const ev = $derived(timer.event);
  const timing = $derived(timer.timing);
  const counts = $derived({
    pilots: timer.setup.pilots.length,
    classes: timer.setup.classes.length,
    heats: timer.setup.heats.length
  });

  let notice: { tone: 'success' | 'danger' | 'info'; text: string } | null = $state(null);
  let noticeTimer = 0;
  function onresult(r: WriteResult, okText = 'RotorHazard confirmed the change.') {
    window.clearTimeout(noticeTimer);
    notice = r.ok
      ? { tone: 'success', text: okText }
      : { tone: 'danger', text: r.message ?? 'RotorHazard did not confirm the change.' };
    if (r.ok) noticeTimer = window.setTimeout(() => (notice = null), 4000);
  }

  let busy = $state(false);
  async function run(fn: () => Promise<WriteResult>, okText?: string) {
    busy = true;
    try {
      onresult(await fn(), okText);
    } finally {
      busy = false;
    }
  }

  // ---- edit ----
  let editOpen = $state(false);
  let f = $state({ name: '', description: '', date: '', venue: '', organizer: '', notes: '' });
  function openEdit() {
    f = { ...ev };
    editOpen = true;
  }
  const dirty = $derived(
    (Object.keys(f) as Array<keyof typeof f>).some((k) => f[k].trim() !== ev[k])
  );
  async function save() {
    if (!f.name.trim() || !dirty) return;
    editOpen = false;
    const changed: Partial<typeof f> = {};
    for (const k of Object.keys(f) as Array<keyof typeof f>) {
      if (f[k].trim() !== ev[k]) changed[k] = f[k].trim();
    }
    await run(() => saveEvent(changed));
  }

  // ---- lap detection and scoring (#35): each field saves on change, with readback ----
  // The inputs are text the director is typing; they follow the timer until a change lands.
  let minLapText = $state('');
  let firstCrossingText = $state('');
  let consecText = $state('');
  let behaviorText = $state('0');
  $effect(() => {
    minLapText = String(Math.round(timing.minLapMs / 1000));
    firstCrossingText = String(Math.round(timing.minFirstCrossingMs / 1000));
    consecText = String(timing.consecutivesBase);
    behaviorText = String(timing.minLapBehavior);
  });
  async function saveSeconds(
    text: string,
    currentMs: number,
    write: (s: number) => Promise<WriteResult>,
    what: string
  ) {
    const n = parseSeconds(text);
    if (n === null) {
      onresult({ ok: false, message: `${what}: enter whole seconds from 0 to ${SECONDS_MAX}.` });
      return;
    }
    if (n * 1000 === currentMs) return;
    await run(() => write(n), `${what} set to ${n} s.`);
  }
  async function saveConsecutives() {
    const n = parseConsecutivesBase(consecText);
    if (n === null) {
      onresult({
        ok: false,
        message: `Consecutive laps base: enter a number from ${CONSECUTIVES_MIN} to ${CONSECUTIVES_MAX}.`
      });
      return;
    }
    if (n === timing.consecutivesBase) return;
    await run(() => setConsecutivesBase(n), `Results now rank the best ${n} consecutive laps.`);
  }
  async function saveBehavior() {
    const b = Number(behaviorText);
    if (b === timing.minLapBehavior) return;
    await run(() => setMinLapBehavior(b), `${MIN_LAP_BEHAVIOR_LABELS[b as 0 | 1]}.`);
  }

  // ---- new event ----
  let newOpen = $state(false);
  let newName = $state('');
  let keepPilots = $state(true);
  function openNew() {
    newName = '';
    keepPilots = true;
    newOpen = true;
  }
  async function startNew() {
    if (!newName.trim()) return;
    newOpen = false;
    await run(
      () => newEvent(newName.trim(), keepPilots),
      `New event started. The previous one is archived as "${ev.name}".`
    );
  }

  // ---- archives ----
  let restoring: string | null = $state(null);
  let deleting: string | null = $state(null);
  const archiveName = (file: string) => file.replace(/\.db$/, '');
</script>

<Dialog bind:open={editOpen} title="Edit event">
  <div class="form">
    <label class="field"><span>Name</span><Input bind:value={f.name} maxlength="80" /></label>
    <label class="field"
      ><span>Description</span><Input
        bind:value={f.description}
        placeholder="Optional"
        maxlength="300"
      /></label
    >
    <div class="row">
      <label class="field"><span>Date</span><Input type="date" bind:value={f.date} /></label>
      <label class="field grow"
        ><span>Venue</span><Input
          bind:value={f.venue}
          placeholder="Optional"
          maxlength="120"
        /></label
      >
    </div>
    <label class="field"
      ><span>Organizer</span><Input
        bind:value={f.organizer}
        placeholder="Optional"
        maxlength="80"
      /></label
    >
    <label class="field">
      <span>Notes</span>
      <textarea
        bind:value={f.notes}
        rows="4"
        maxlength="2000"
        placeholder="Anything the day needs: schedule, rules, frequencies…"
      ></textarea>
    </label>
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (editOpen = false)}>Cancel</Button>
    <Button variant="primary" disabled={!f.name.trim() || !dirty || busy} onclick={save}
      >Save</Button
    >
  {/snippet}
</Dialog>

<Dialog bind:open={newOpen} title="New event">
  <div class="form">
    <p class="muted">
      The current event, <strong>{ev.name}</strong>, is archived first. Races, heats and classes are
      cleared. Formats, frequency profiles, teams and presets always stay.
    </p>
    <label class="field">
      <span>Name</span>
      <Input
        bind:value={newName}
        placeholder="e.g. 2026-11-01 Club Night"
        maxlength="80"
        onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && startNew()}
      />
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={keepPilots} />
      <span>Keep the {counts.pilots} pilot{counts.pilots === 1 ? '' : 's'} (recommended)</span>
    </label>
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (newOpen = false)}>Cancel</Button>
    <Button variant="primary" disabled={!newName.trim() || busy} onclick={startNew}
      >Archive and start</Button
    >
  {/snippet}
</Dialog>

{#if restoring}
  <ConfirmDialog
    open={true}
    title="Restore archive"
    confirmLabel="Restore"
    danger
    onconfirm={() => {
      const f2 = restoring;
      restoring = null;
      if (f2) void run(() => restoreArchive(f2), 'Archive restored.');
    }}
    oncancel={() => (restoring = null)}
  >
    Replace everything with <strong>{archiveName(restoring)}</strong>? The current event is not
    archived first — use "Archive now" before this if you want to keep it.
  </ConfirmDialog>
{/if}
{#if deleting}
  <ConfirmDialog
    open={true}
    title="Delete archive"
    confirmLabel="Delete"
    danger
    onconfirm={() => {
      const f2 = deleting;
      deleting = null;
      if (f2) void run(() => deleteArchive(f2), 'Archive deleted.');
    }}
    oncancel={() => (deleting = null)}
  >
    Delete the archive <strong>{archiveName(deleting)}</strong>? This cannot be undone.
  </ConfirmDialog>
{/if}

<section class="page">
  <header class="pagehead">
    <div>
      <h1>{ev.name || 'Event'}</h1>
      {#if ev.description}<p class="lede">{ev.description}</p>{/if}
    </div>
    <div class="actions">
      <Button variant="secondary" disabled={busy} onclick={openEdit}>Edit</Button>
      <Button variant="primary" disabled={busy} onclick={openNew}>New event</Button>
    </div>
  </header>

  {#if notice}
    <Banner tone={notice.tone} ondismiss={() => (notice = null)}>{notice.text}</Banner>
  {/if}

  <div class="grid">
    <Card title="Details">
      <dl class="facts">
        <dt>Date</dt>
        <dd>{ev.date || '—'}</dd>
        <dt>Venue</dt>
        <dd>{ev.venue || '—'}</dd>
        <dt>Organizer</dt>
        <dd>{ev.organizer || '—'}</dd>
      </dl>
      {#if ev.notes}<p class="notes">{ev.notes}</p>{/if}
    </Card>

    <Card title="In this event">
      <dl class="facts">
        <dt>Pilots</dt>
        <dd>{counts.pilots}</dd>
        <dt>Classes</dt>
        <dd>{counts.classes}</dd>
        <dt>Heats</dt>
        <dd>{counts.heats}</dd>
      </dl>
      <p class="muted">
        Formats, frequency profiles, teams and presets live outside the event and carry over.
      </p>
    </Card>

    <Card
      title="Scoring"
      subtitle="Formats that rank by fastest consecutive laps score each pilot's best run of this many laps in a row."
    >
      <div class="options">
        <label class="field">
          <span>Consecutive laps base</span>
          <Input
            type="number"
            inputmode="numeric"
            min={CONSECUTIVES_MIN}
            max={CONSECUTIVES_MAX}
            bind:value={consecText}
            disabled={busy}
            onchange={saveConsecutives}
          />
        </label>
      </div>
    </Card>

    <Card
      title="Lap detection"
      subtitle={lapRulesSummary(timing) || 'Every crossing counts as a lap.'}
    >
      <div class="options">
        <label class="field">
          <span>Minimum lap time (s)</span>
          <Input
            type="number"
            inputmode="numeric"
            min="0"
            max={SECONDS_MAX}
            bind:value={minLapText}
            disabled={busy}
            onchange={() => saveSeconds(minLapText, timing.minLapMs, setMinLap, 'Minimum lap time')}
          />
        </label>
        <label class="field">
          <span>Short laps</span>
          <Select bind:value={behaviorText} disabled={busy} onchange={saveBehavior}>
            <option value={String(MIN_LAP_BEHAVIOR.HIGHLIGHT)}
              >{MIN_LAP_BEHAVIOR_LABELS[MIN_LAP_BEHAVIOR.HIGHLIGHT]}</option
            >
            <option value={String(MIN_LAP_BEHAVIOR.DISCARD)}
              >{MIN_LAP_BEHAVIOR_LABELS[MIN_LAP_BEHAVIOR.DISCARD]}</option
            >
          </Select>
        </label>
        <label class="field">
          <span>Ignore crossings before (s)</span>
          <Input
            type="number"
            inputmode="numeric"
            min="0"
            max={SECONDS_MAX}
            bind:value={firstCrossingText}
            disabled={busy}
            onchange={() =>
              saveSeconds(
                firstCrossingText,
                timing.minFirstCrossingMs,
                setMinFirstCrossing,
                'Ignore crossings before'
              )}
          />
        </label>
      </div>
      <p class="muted">
        Highlighted short laps stay in the results for the marshal to judge; discarded ones are
        dropped as they happen. Both apply from the next race.
      </p>
    </Card>
  </div>

  <Card
    title="Archives"
    subtitle="RotorHazard's database backups. A new event archives the old one automatically."
  >
    {#snippet actions()}
      <Button
        size="sm"
        variant="secondary"
        disabled={busy}
        onclick={() => run(archiveNow, 'Archived.')}>Archive now</Button
      >
    {/snippet}
    {#if timer.archives.length === 0}
      <p class="muted">No archives yet.</p>
    {:else}
      <ul class="archives">
        {#each timer.archives as file (file)}
          <li>
            <span class="name">{archiveName(file)}</span>
            {#if file.startsWith(ev.name)}<Badge tone="info">this event</Badge>{/if}
            <span class="spacer"></span>
            <Button size="sm" variant="ghost" disabled={busy} onclick={() => (restoring = file)}
              >Restore</Button
            >
            <Button size="sm" variant="ghost" disabled={busy} onclick={() => (deleting = file)}
              >Delete</Button
            >
          </li>
        {/each}
      </ul>
    {/if}
  </Card>
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
  .actions {
    display: flex;
    gap: var(--gf-space-2);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--gf-space-3);
  }
  @media (max-width: 720px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--gf-space-1) var(--gf-space-4);
    margin: 0 0 var(--gf-space-2);
  }
  dt {
    color: var(--gf-text-muted);
  }
  dd {
    margin: 0;
  }
  .notes {
    white-space: pre-wrap;
    margin: var(--gf-space-2) 0 0;
  }
  .form {
    display: grid;
    gap: var(--gf-space-3);
  }
  .options {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: var(--gf-space-3);
    margin-bottom: var(--gf-space-2);
  }
  .row {
    display: flex;
    gap: var(--gf-space-3);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .field.grow {
    flex: 1;
  }
  .field span {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  textarea {
    font: inherit;
    color: var(--gf-text);
    background: var(--gf-surface-sunken);
    border: 1px solid var(--gf-border);
    border-radius: var(--gf-radius-md);
    padding: var(--gf-space-2);
    resize: vertical;
  }
  .check {
    display: flex;
    align-items: center;
    gap: var(--gf-space-2);
  }
  .archives {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--gf-space-1);
  }
  .archives li {
    display: flex;
    align-items: center;
    gap: var(--gf-space-2);
  }
  .archives .name {
    font-variant-numeric: tabular-nums;
  }
  .spacer {
    flex: 1;
  }
</style>
