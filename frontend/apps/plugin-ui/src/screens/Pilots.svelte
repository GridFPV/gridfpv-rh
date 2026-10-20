<script lang="ts">
  /** Pilots (#9): the roster, with Edit → dialog → Save, New, and Delete. */
  import { Badge, Banner, Button, Card } from '@gridfpv/components';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import PilotDialog from '../components/PilotDialog.svelte';
  import { addPilot, deletePilot, rh, type WriteResult } from '../lib/rh.svelte.js';
  import { teamsInUse, type Pilot } from '../lib/setup.js';

  const timer = rh();
  const setup = $derived(timer.setup);
  const pilots = $derived(
    [...setup.pilots].sort((a, b) =>
      (a.callsign || a.name).localeCompare(b.callsign || b.name, undefined, { sensitivity: 'base' })
    )
  );
  const teams = $derived(teamsInUse(setup));

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
  let editing: Pilot | null = $state(null);
  let editTitle = $state('Edit pilot');
  let removing: Pilot | null = $state(null);

  // The dialog edits the live pilot record so a readback mid-edit does not stale it.
  $effect(() => {
    if (editing && !setup.pilots.some((p) => p.id === editing!.id)) editing = null;
  });
  const editingLive = $derived(
    editing ? (setup.pilots.find((p) => p.id === editing!.id) ?? null) : null
  );

  async function newPilot() {
    busy = true;
    try {
      const r = await addPilot();
      if (!r.ok || r.id == null) {
        onresult(r);
        return;
      }
      editTitle = 'New pilot';
      editing = setup.pilots.find((p) => p.id === r.id) ?? null;
    } finally {
      busy = false;
    }
  }

  async function remove(p: Pilot) {
    busy = true;
    try {
      onresult(await deletePilot(p.id));
    } finally {
      busy = false;
    }
  }
</script>

{#if editingLive}
  <PilotDialog
    open={true}
    pilot={editingLive}
    attributeTypes={setup.pilotAttributes}
    {teams}
    title={editTitle}
    {onresult}
  />
{/if}

{#if removing}
  <ConfirmDialog
    open={true}
    title="Delete pilot"
    confirmLabel="Delete"
    danger
    onconfirm={() => {
      const p = removing;
      removing = null;
      if (p) void remove(p);
    }}
    oncancel={() => (removing = null)}
  >
    Delete <strong>{removing.callsign || removing.name || 'this pilot'}</strong>? They are unseated
    from every heat. Pilots who already flew a saved race cannot be deleted.
  </ConfirmDialog>
{/if}

<section class="page">
  <header class="pagehead">
    <div>
      <h1>Pilots</h1>
      <p class="lede">
        {pilots.length} pilot{pilots.length === 1 ? '' : 's'}. Callsign is what the announcer says;
        team is optional.
      </p>
    </div>
    <Button variant="primary" disabled={busy} onclick={newPilot}>New pilot</Button>
  </header>

  {#if notice}
    <Banner tone={notice.tone} ondismiss={() => (notice = null)}>{notice.text}</Banner>
  {/if}

  {#if pilots.length === 0}
    <Card elevation="xs"><p class="muted">No pilots yet. Add one to start building heats.</p></Card>
  {:else}
    <div class="list">
      {#each pilots as p (p.id)}
        <Card elevation="xs" pad={false}>
          <div class="row">
            <span class="swatch" style="background: {p.color || 'transparent'}"></span>
            <div class="who">
              <span class="callsign">{p.callsign || '(no callsign)'}</span>
              {#if p.name}<span class="name">{p.name}</span>{/if}
            </div>
            <div class="meta">
              {#if p.team}<Badge tone="info">Team {p.team}</Badge>{/if}
              {#if p.locked}<Badge tone="neutral" variant="outline">raced</Badge>{/if}
              {#each setup.pilotAttributes as t (t.name)}
                {#if p.attributes[t.name]}<span class="attr">{t.label}: {p.attributes[t.name]}</span
                  >{/if}
              {/each}
            </div>
            <div class="actions">
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onclick={() => {
                  editTitle = 'Edit pilot';
                  editing = p;
                }}>Edit</Button
              >
              <Button
                size="sm"
                variant="danger"
                disabled={busy || p.locked}
                title={p.locked ? 'In a saved race' : undefined}
                onclick={() => (removing = p)}>Delete</Button
              >
            </div>
          </div>
        </Card>
      {/each}
    </div>
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
  .list {
    display: grid;
    gap: var(--gf-space-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--gf-space-3);
    padding: var(--gf-space-2) var(--gf-space-3);
  }
  .swatch {
    width: 12px;
    height: 32px;
    border-radius: 6px;
    flex: none;
  }
  .who {
    display: flex;
    flex-direction: column;
    min-width: 160px;
  }
  .callsign {
    font-weight: 700;
  }
  .name {
    color: var(--gf-text-muted);
    font-size: var(--gf-font-size-sm);
  }
  .meta {
    display: flex;
    gap: var(--gf-space-2);
    align-items: center;
    flex-wrap: wrap;
    flex: 1;
  }
  .attr {
    color: var(--gf-text-muted);
    font-size: var(--gf-font-size-sm);
  }
  .actions {
    display: flex;
    gap: var(--gf-space-2);
  }
</style>
