<script lang="ts">
  /** Pilots (#9): the roster, with Edit → dialog → Save, New, and Delete. */
  import { Badge, Banner, Button, Card, Dialog } from '@gridfpv/components';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import PilotDialog from '../components/PilotDialog.svelte';
  import {
    addFromRoster,
    deletePilot,
    refreshRoster,
    removeFromRoster,
    rh,
    type WriteResult
  } from '../lib/rh.svelte.js';
  import { addLabel, rosterMissing, type RosterPilot } from '../lib/roster.js';
  import type { Pilot } from '../lib/setup.js';
  import { href, link } from '../lib/router.svelte.js';

  const timer = rh();
  const setup = $derived(timer.setup);
  const pilots = $derived(
    [...setup.pilots].sort((a, b) =>
      (a.callsign || a.name).localeCompare(b.callsign || b.name, undefined, { sensitivity: 'base' })
    )
  );
  const teams = $derived(timer.teams.map((t) => t.name));

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

  // The dialog edits the live pilot record so a readback mid-edit does not stale it. A new
  // pilot is a draft (id 0) that exists nowhere until Save (#42): RotorHazard's add_pilot
  // creates a "~Callsign N" placeholder, so it runs only once there is something to save.
  $effect(() => {
    const e = editing;
    if (e && e.id !== 0 && !setup.pilots.some((p) => p.id === e.id)) editing = null;
  });
  const editingLive = $derived.by(() => {
    const e = editing;
    if (!e) return null;
    return e.id === 0 ? e : (setup.pilots.find((p) => p.id === e.id) ?? null);
  });

  function newPilot() {
    editTitle = 'New pilot';
    editing = {
      id: 0,
      callsign: '',
      name: '',
      phonetic: '',
      team: '',
      color: '',
      active: true,
      locked: false,
      attributes: {}
    };
  }

  // ---- the roster (#14): pilots kept across events, offered back with "Add from roster" ----
  const missing = $derived(rosterMissing(timer.roster));
  let rosterOpen = $state(false);
  let picked: string[] = $state([]);
  function openRoster() {
    refreshRoster();
    picked = missing.map((p) => p.id);
    rosterOpen = true;
  }
  const pickedPilots = $derived(missing.filter((p) => picked.includes(p.id)));
  async function addPicked() {
    const pilots = pickedPilots;
    if (!pilots.length) return;
    rosterOpen = false;
    busy = true;
    try {
      const r = await addFromRoster(pilots);
      onresult(r);
      if (r.ok)
        notice = {
          tone: 'success',
          text: `${pilots.length === 1 ? pilots[0].callsign + ' is' : pilots.length + ' pilots are'} in this event.`
        };
    } finally {
      busy = false;
    }
  }
  async function forget(p: RosterPilot) {
    busy = true;
    try {
      onresult(await removeFromRoster(p.id));
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
    onclose={() => (editing = null)}
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

{#if rosterOpen}
  <Dialog bind:open={rosterOpen} title="Add from roster">
    <p class="muted">
      Pilots from earlier events, kept by Grid outside RotorHazard's database. Tick who is racing
      today; everyone else stays on the roster for next time.
    </p>
    {#if missing.length === 0}
      <p class="muted">
        {timer.roster.length === 0
          ? 'The roster is empty: pilots join it as they are added here.'
          : 'Everyone on the roster is already in this event.'}
      </p>
    {:else}
      <ul class="roster" aria-label="Roster">
        {#each missing as p (p.id)}
          <li>
            <label class="check">
              <input type="checkbox" bind:group={picked} value={p.id} />
              <span class="swatch" style="background: {p.color || 'transparent'}"></span>
              <span class="call">{p.callsign}</span>
              {#if p.name && p.name !== p.callsign}<span class="muted">{p.name}</span>{/if}
              {#if p.team}<Badge tone="neutral" variant="outline">{p.team}</Badge>{/if}
              {#if p.lastSeen}<span class="muted when">last seen {p.lastSeen}</span>{/if}
            </label>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              title="Forget this pilot: drop them from the roster"
              onclick={() => forget(p)}>Forget</Button
            >
          </li>
        {/each}
      </ul>
    {/if}
    {#snippet footer()}
      <Button variant="ghost" onclick={() => (rosterOpen = false)}>Cancel</Button>
      <Button variant="primary" disabled={busy || pickedPilots.length === 0} onclick={addPicked}
        >{addLabel(pickedPilots)}</Button
      >
    {/snippet}
  </Dialog>
{/if}

<section class="page">
  <header class="pagehead">
    <div>
      <h1>Pilots</h1>
      <p class="lede">
        {pilots.length} pilot{pilots.length === 1 ? '' : 's'}. Callsign is what the announcer says.
        Teams are named on the <a href={href('teams')} onclick={link}>Teams</a> page.
        {#if missing.length}{missing.length} more on the roster.{/if}
      </p>
    </div>
    <div class="actions">
      <Button
        variant="secondary"
        disabled={busy}
        title="Pilots from earlier events, kept by Grid"
        onclick={openRoster}>Add from roster</Button
      >
      <Button variant="primary" disabled={busy} onclick={newPilot}>New pilot</Button>
    </div>
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
  .actions {
    display: flex;
    gap: var(--gf-space-2);
  }
  .roster {
    list-style: none;
    margin: var(--gf-space-2) 0 0;
    padding: 0;
    display: grid;
    gap: var(--gf-space-1);
  }
  .roster li {
    display: flex;
    align-items: center;
    gap: var(--gf-space-2);
  }
  .roster .check {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--gf-space-2);
    cursor: pointer;
  }
  .roster .call {
    font-weight: 600;
  }
  .roster .when {
    font-size: var(--gf-font-size-xs);
    margin-left: auto;
  }
</style>
