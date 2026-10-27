<script lang="ts">
  /**
   * Teams (#9): a named list with a description and who is on each. The names are what
   * RotorHazard stores on a pilot and offers in its own dropdown (the plugin rewrites that
   * list), so there is one value and both UIs agree. Rename moves the pilots; delete
   * leaves them with no team.
   */
  import HelpLink from '../components/HelpLink.svelte';
  import { Badge, Banner, Button, Card, Dialog, Input } from '@gridfpv/components';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import { deleteTeam, rh, saveTeam, type Team, type WriteResult } from '../lib/rh.svelte.js';

  const timer = rh();
  const pilots = $derived(timer.setup.pilots);
  const members = (name: string) =>
    pilots
      .filter((p) => p.team === name)
      .sort((a, b) =>
        (a.callsign || a.name).localeCompare(b.callsign || b.name, undefined, {
          sensitivity: 'base'
        })
      );
  // Team values on pilots that are not in our list (set in RotorHazard before the list existed).
  const strays = $derived(
    [
      ...new Set(
        pilots.map((p) => p.team).filter((t) => t && !timer.teams.some((x) => x.name === t))
      )
    ].sort()
  );
  const unassigned = $derived(pilots.filter((p) => !p.team).length);

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
  let editing: Team | null = $state(null);
  let isNew = $state(false);
  let name = $state('');
  let description = $state('');
  let removing: Team | null = $state(null);

  function openNew() {
    isNew = true;
    name = '';
    description = '';
    editing = { id: '', name: '', description: '' };
  }
  function openEdit(t: Team) {
    isNew = false;
    name = t.name;
    description = t.description;
    editing = t;
  }
  function adopt(stray: string) {
    isNew = true;
    name = stray;
    description = '';
    editing = { id: '', name: stray, description: '' };
  }
  const dirty = $derived.by(() => {
    const e = editing;
    if (!e) return false;
    return isNew || name.trim() !== e.name || description.trim() !== e.description;
  });

  async function save() {
    const t = editing;
    if (!t || !name.trim() || !dirty) return;
    editing = null;
    busy = true;
    try {
      onresult(await saveTeam(isNew ? null : t.id, name.trim(), description.trim()));
    } finally {
      busy = false;
    }
  }
  async function remove(t: Team) {
    busy = true;
    try {
      onresult(await deleteTeam(t.id));
    } finally {
      busy = false;
    }
  }
</script>

{#if editing}
  <Dialog open={true} title={isNew ? 'New team' : 'Edit team'} onclose={() => (editing = null)}>
    <div class="form">
      <label class="field">
        <span>Name</span>
        <Input
          bind:value={name}
          placeholder="e.g. Red Rockets"
          maxlength="40"
          onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && save()}
        />
        {#if !isNew && name.trim() !== editing.name}
          <small class="muted">Renaming moves every pilot on {editing.name} to the new name.</small>
        {/if}
      </label>
      <label class="field">
        <span>Description</span>
        <Input
          bind:value={description}
          placeholder="Optional"
          maxlength="120"
          onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && save()}
        />
      </label>
    </div>
    {#snippet footer()}
      <Button variant="ghost" onclick={() => (editing = null)}>Cancel</Button>
      <Button variant="primary" disabled={!name.trim() || !dirty || busy} onclick={save}
        >{isNew ? 'Create' : 'Save'}</Button
      >
    {/snippet}
  </Dialog>
{/if}

{#if removing}
  <ConfirmDialog
    open={true}
    title="Delete team"
    confirmLabel="Delete"
    danger
    onconfirm={() => {
      const t = removing;
      removing = null;
      if (t) void remove(t);
    }}
    oncancel={() => (removing = null)}
  >
    Delete <strong>{removing.name}</strong>? Its {members(removing.name).length} pilot{members(
      removing.name
    ).length === 1
      ? ''
      : 's'} will have no team.
  </ConfirmDialog>
{/if}

<section class="page">
  <header class="pagehead">
    <div>
      <h1>Teams</h1>
      <HelpLink page="teams" />
      <p class="lede">
        Team names show up in RotorHazard too: its pilot page offers this list, and its results
        print the name.
        {#if unassigned}{unassigned} pilot{unassigned === 1 ? ' has' : 's have'} no team.{/if}
      </p>
    </div>
    <Button variant="primary" disabled={busy} onclick={openNew}>New team</Button>
  </header>

  {#if notice}
    <Banner tone={notice.tone} ondismiss={() => (notice = null)}>{notice.text}</Banner>
  {/if}

  {#if strays.length}
    <Banner tone="info" title="Teams on pilots but not in this list">
      {#each strays as s (s)}
        <span class="stray">
          <strong>{s}</strong> ({members(s).length})
          <Button size="sm" variant="ghost" disabled={busy} onclick={() => adopt(s)}
            >Add to list</Button
          >
        </span>
      {/each}
    </Banner>
  {/if}

  {#if timer.teams.length === 0}
    <Card elevation="xs"
      ><p class="muted">
        No teams yet. Create one, then put pilots on it from the Pilots page.
      </p></Card
    >
  {:else}
    <div class="grid">
      {#each timer.teams as t (t.id)}
        {@const who = members(t.name)}
        <Card elevation="xs">
          <div class="head">
            <div>
              <div class="name">{t.name}</div>
              {#if t.description}<div class="muted">{t.description}</div>{/if}
            </div>
            <div class="actions">
              <Button size="sm" variant="secondary" disabled={busy} onclick={() => openEdit(t)}
                >Edit</Button
              >
              <Button size="sm" variant="danger" disabled={busy} onclick={() => (removing = t)}
                >Delete</Button
              >
            </div>
          </div>
          <div class="members">
            {#if who.length === 0}
              <span class="muted">Nobody yet</span>
            {:else}
              {#each who as p (p.id)}
                <Badge tone="neutral"
                  ><span class="dot" style="background: {p.color || 'transparent'}"
                  ></span>{p.callsign || p.name}</Badge
                >
              {/each}
            {/if}
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
  .head {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: var(--gf-space-2);
    margin-bottom: var(--gf-space-2);
  }
  .name {
    font-weight: 700;
    font-size: var(--gf-font-size-lg);
  }
  .actions {
    display: flex;
    gap: var(--gf-space-2);
  }
  .members {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gf-space-1);
  }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 4px;
    margin-right: 6px;
    vertical-align: middle;
  }
  .stray {
    display: inline-flex;
    align-items: center;
    gap: var(--gf-space-2);
    margin-right: var(--gf-space-3);
  }
  .form {
    display: grid;
    gap: var(--gf-space-3);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .field span {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
</style>
