<script lang="ts">
  /**
   * The frequency profile bar: which profile is active, switch, duplicate, rename, delete.
   * In RotorHazard a profile holds every seat's channel and thresholds, so the seat cards
   * below always show the active one.
   */
  import { Button, Input, Select } from '@gridfpv/components';
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
  let name = $state('');
  let description = $state('');
  $effect(() => {
    name = profiles.name;
    description = profiles.description;
  });
  const dirty = $derived(name !== profiles.name || description !== profiles.description);

  async function run(fn: () => Promise<WriteResult>) {
    busy = true;
    try {
      onresult(await fn());
    } finally {
      busy = false;
    }
  }

  function onSwitch(e: Event) {
    const id = Number((e.currentTarget as HTMLSelectElement).value);
    if (id !== profiles.currentId) void run(() => setProfile(id));
  }

  let confirmDelete = $state(false);
</script>

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
  <label class="field grow">
    <span>Name</span>
    <Input bind:value={name} disabled={busy} placeholder="Profile name" />
  </label>
  <label class="field grow">
    <span>Description</span>
    <Input bind:value={description} disabled={busy} placeholder="Optional" />
  </label>
  <div class="actions">
    <Button
      variant="secondary"
      disabled={!dirty || busy || !name.trim()}
      onclick={() => run(() => alterProfile(name.trim(), description.trim()))}
    >
      Save
    </Button>
    <Button
      variant="secondary"
      disabled={busy}
      title="Copy the active profile and switch to it"
      onclick={() => run(addProfile)}
    >
      Duplicate
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
    min-width: 160px;
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
  .actions {
    display: flex;
    gap: var(--gf-space-2);
  }
</style>
