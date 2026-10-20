<script lang="ts">
  /**
   * The frequency profile bar. In RotorHazard a profile holds every seat's channel and
   * thresholds, and every one of those writes lands in the active profile the moment it is
   * made. The bar itself is read-only: the active profile's name in the dropdown and its
   * description beside it. Renaming goes through Edit → a dialog → Save, so a stray keystroke
   * can't rename a profile. New copies the active profile (RotorHazard's only way to make one)
   * under a name you give it.
   */
  import { Button, Dialog, Input, Select } from '@gridfpv/components';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import {
    addProfile,
    alterProfile,
    deleteProfile,
    setProfile,
    type WriteResult
  } from '../lib/rh.svelte.js';
  import type { Profiles } from '../lib/seats.js';

  let { profiles, onresult }: { profiles: Profiles; onresult: (r: WriteResult) => void } = $props();

  let busy = $state(false);

  async function run(fn: () => Promise<WriteResult>) {
    busy = true;
    try {
      const r = await fn();
      onresult(r);
      return r;
    } finally {
      busy = false;
    }
  }

  function onSwitch(e: Event) {
    const id = Number((e.currentTarget as HTMLSelectElement).value);
    if (id !== profiles.currentId) void run(() => setProfile(id));
  }

  // ---- edit (name / description) ----
  let editOpen = $state(false);
  let editName = $state('');
  let editDescription = $state('');
  function openEdit() {
    editName = profiles.name;
    editDescription = profiles.description;
    editOpen = true;
  }
  const editDirty = $derived(
    editName.trim() !== profiles.name || editDescription.trim() !== profiles.description
  );
  async function saveEdit() {
    const n = editName.trim();
    if (!n || !editDirty) return;
    editOpen = false;
    await run(() => alterProfile(n, editDescription.trim()));
  }

  // ---- new profile ----
  let newOpen = $state(false);
  let newName = $state('');
  async function createProfile() {
    const n = newName.trim();
    if (!n) return;
    newOpen = false;
    // RotorHazard's add_profile copies the active profile and switches to the copy; the
    // rename then lands on the copy.
    const added = await run(addProfile);
    if (added.ok) await run(() => alterProfile(n, ''));
  }

  let confirmDelete = $state(false);
</script>

<Dialog bind:open={editOpen} title="Edit profile">
  <div class="form">
    <label class="field">
      <span>Name</span>
      <Input
        bind:value={editName}
        placeholder="Profile name"
        maxlength="60"
        onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && saveEdit()}
      />
    </label>
    <label class="field">
      <span>Description</span>
      <Input
        bind:value={editDescription}
        placeholder="Optional"
        onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && saveEdit()}
      />
    </label>
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (editOpen = false)}>Cancel</Button>
    <Button variant="primary" disabled={!editName.trim() || !editDirty || busy} onclick={saveEdit}>
      Save
    </Button>
  {/snippet}
</Dialog>

<Dialog bind:open={newOpen} title="New profile">
  <p class="muted">
    Starts as a copy of <strong>{profiles.name}</strong> — same channels, same tuning — under the new
    name.
  </p>
  <label class="field">
    <span>Name</span>
    <Input
      bind:value={newName}
      placeholder="e.g. Outdoor, Indoor whoop"
      maxlength="60"
      disabled={busy}
      onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && createProfile()}
    />
  </label>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (newOpen = false)}>Cancel</Button>
    <Button variant="primary" disabled={!newName.trim() || busy} onclick={createProfile}>
      Create
    </Button>
  {/snippet}
</Dialog>

<ConfirmDialog
  bind:open={confirmDelete}
  title="Delete profile"
  confirmLabel="Delete"
  danger
  onconfirm={() => run(deleteProfile)}
>
  Delete the profile <strong>{profiles.name}</strong>? Every seat falls back to the first profile's
  channels and thresholds.
</ConfirmDialog>

<div class="bar">
  <label class="field">
    <span>Profile</span>
    <Select value={profiles.currentId ?? ''} disabled={busy} onchange={onSwitch}>
      {#each profiles.list as p (p.id)}
        <option value={p.id}>{p.name}</option>
      {/each}
    </Select>
  </label>
  <p class="description" class:empty={!profiles.description}>
    {profiles.description || 'No description'}
  </p>
  <div class="actions">
    <Button variant="secondary" disabled={busy} onclick={openEdit}>Edit</Button>
    <Button
      variant="secondary"
      disabled={busy}
      onclick={() => {
        newName = '';
        newOpen = true;
      }}
    >
      New
    </Button>
    <Button
      variant="danger"
      disabled={busy || profiles.list.length <= 1}
      onclick={() => (confirmDelete = true)}
    >
      Delete
    </Button>
  </div>
</div>

<style>
  .bar {
    display: flex;
    gap: var(--gf-space-3);
    align-items: end;
    flex-wrap: wrap;
    padding: var(--gf-space-3);
    background: var(--gf-surface);
    border: 1px solid var(--gf-border);
    border-radius: var(--gf-radius-md);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 200px;
  }
  .field span {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .description {
    flex: 1;
    min-width: 160px;
    margin: 0;
    align-self: center;
    color: var(--gf-text);
  }
  .description.empty {
    color: var(--gf-text-muted);
    font-style: italic;
  }
  .actions {
    display: flex;
    gap: var(--gf-space-2);
  }
  .form {
    display: grid;
    gap: var(--gf-space-3);
  }
  .muted {
    color: var(--gf-text-muted);
    margin: 0 0 var(--gf-space-3);
  }
</style>
