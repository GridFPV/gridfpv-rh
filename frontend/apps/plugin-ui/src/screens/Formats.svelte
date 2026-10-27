<script lang="ts">
  /**
   * Race formats (#17): how one race is run. One card per format saying what it does in
   * words, Edit → dialog → Save, New (RotorHazard creates a format by copying one), Delete.
   * Formats persist across events; a class points at one.
   */
  import { Badge, Banner, Button, Card } from '@gridfpv/components';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import FormatDialog from '../components/FormatDialog.svelte';
  import { addFormat, alterFormat, deleteFormat, rh, type WriteResult } from '../lib/rh.svelte.js';
  import {
    formatSummary,
    graceSummary,
    stagingSummary,
    WIN_CONDITION,
    type RaceFormat
  } from '../lib/setup.js';
  import { consecutivesPhrase } from '../lib/timing.js';

  const timer = rh();
  const formats = $derived([...timer.setup.formats].sort((a, b) => a.id - b.id));
  const usedBy = (id: number) => timer.setup.classes.filter((c) => c.formatId === id);

  let notice: { tone: 'success' | 'danger'; text: string } | null = $state(null);
  let noticeTimer = 0;
  function onresult(r: WriteResult) {
    window.clearTimeout(noticeTimer);
    notice = r.ok
      ? { tone: 'success', text: 'RotorHazard confirmed the change.' }
      : { tone: 'danger', text: r.message ?? 'RotorHazard did not confirm the change.' };
    if (r.ok) noticeTimer = window.setTimeout(() => (notice = null), 2500);
  }

  let busy = $state(false);
  let editing: RaceFormat | null = $state(null);
  let editTitle = $state('Edit format');
  let removing: RaceFormat | null = $state(null);
  const editingLive = $derived(
    editing ? (timer.setup.formats.find((f) => f.id === editing!.id) ?? null) : null
  );
  $effect(() => {
    if (editing && !timer.setup.formats.some((f) => f.id === editing!.id)) editing = null;
  });

  /** New = copy the chosen format (RotorHazard's only way), name it, open it for editing. */
  async function newFrom(source: RaceFormat) {
    busy = true;
    try {
      const r = await addFormat(source.id);
      if (!r.ok || r.id == null) {
        onresult(r);
        return;
      }
      const named = await alterFormat(r.id, { name: `${source.name} (copy)` });
      if (!named.ok) onresult(named);
      editTitle = 'New format';
      editing = timer.setup.formats.find((f) => f.id === r.id) ?? null;
    } finally {
      busy = false;
    }
  }

  async function remove(f: RaceFormat) {
    busy = true;
    try {
      onresult(await deleteFormat(f.id));
    } finally {
      busy = false;
    }
  }
</script>

{#if editingLive}
  <FormatDialog
    open={true}
    format={editingLive}
    pointsMethods={timer.pointsMethods}
    title={editTitle}
    {onresult}
    onclose={() => (editing = null)}
  />
{/if}

{#if removing}
  <ConfirmDialog
    open={true}
    title="Delete format"
    confirmLabel="Delete"
    danger
    onconfirm={() => {
      const f = removing;
      removing = null;
      if (f) void remove(f);
    }}
    oncancel={() => (removing = null)}
  >
    Delete <strong>{removing.name}</strong>? {#if usedBy(removing.id).length}It is used by {usedBy(
        removing.id
      )
        .map((c) => c.displayName)
        .join(', ')}, which will need a new format.{/if}
    A format with saved races cannot be deleted.
  </ConfirmDialog>
{/if}

<section class="page">
  <header class="pagehead">
    <div>
      <h1>Race formats</h1>
      <p class="lede">
        How one race is run: the clock, how the winner is decided, the start sequence. A class
        points at a format; formats carry over between events.
      </p>
    </div>
    <Button
      variant="primary"
      disabled={busy || formats.length === 0}
      onclick={() => newFrom(formats[0])}>New format</Button
    >
  </header>

  {#if notice}
    <Banner tone={notice.tone} ondismiss={() => (notice = null)}>{notice.text}</Banner>
  {/if}

  <div class="grid">
    {#each formats as f (f.id)}
      {@const classes = usedBy(f.id)}
      <Card elevation="xs">
        <div class="head">
          <div class="name">{f.name}</div>
          <div class="badges">
            {#if classes.length}<Badge tone="info"
                >{classes.length} class{classes.length === 1 ? '' : 'es'}</Badge
              >{/if}
            {#if f.locked}<Badge tone="neutral" variant="outline">raced</Badge>{/if}
          </div>
        </div>
        <p class="summary">
          {formatSummary(f)}{#if f.winCondition === WIN_CONDITION.FASTEST_CONSECUTIVE}<span
              class="muted"
              title="The event's consecutive laps base; set it on the Event page"
            >
              ({consecutivesPhrase(timer.timing.consecutivesBase)})</span
            >{/if}{#if graceSummary(f)}<span class="muted">, {graceSummary(f)}</span>{/if}
        </p>
        <p class="muted">{stagingSummary(f)}</p>
        <div class="actions">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onclick={() => {
              editTitle = 'Edit format';
              editing = f;
            }}>Edit</Button
          >
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            title="Copy this format"
            onclick={() => newFrom(f)}>Duplicate</Button
          >
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || f.locked}
            onclick={() => (removing = f)}>Delete</Button
          >
        </div>
      </Card>
    {/each}
  </div>
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
  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--gf-space-3);
  }
  @media (max-width: 1100px) {
    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 720px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: var(--gf-space-2);
  }
  .name {
    font-weight: 700;
    font-size: var(--gf-font-size-lg);
  }
  .badges {
    display: flex;
    gap: var(--gf-space-1);
  }
  .summary {
    margin: var(--gf-space-1) 0 0;
  }
  .muted {
    font-size: var(--gf-font-size-sm);
  }
  .actions {
    display: flex;
    gap: var(--gf-space-2);
    margin-top: var(--gf-space-2);
  }
</style>
