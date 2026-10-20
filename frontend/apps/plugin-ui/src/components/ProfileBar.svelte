<script lang="ts">
  /**
   * The frequency profile bar. In RotorHazard a profile holds every seat's channel and
   * thresholds, and every one of those writes lands in the active profile the moment it is
   * made — nothing on this page is ever "unsaved". So there is no Save button: the name and
   * description write when you leave the field, and the indicator shows the last confirmed
   * write. New copies the active profile (RotorHazard's only way to make one) under a name
   * you give it.
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
  let name = $state('');
  let description = $state('');
  $effect(() => {
    name = profiles.name;
    description = profiles.description;
  });

  let saved: 'idle' | 'saving' | 'saved' | 'failed' = $state('idle');
  let savedTimer = 0;

  async function run(fn: () => Promise<WriteResult>) {
    busy = true;
    saved = 'saving';
    try {
      const r = await fn();
      onresult(r);
      saved = r.ok ? 'saved' : 'failed';
      window.clearTimeout(savedTimer);
      if (r.ok) savedTimer = window.setTimeout(() => (saved = 'idle'), 3000);
      return r;
    } finally {
      busy = false;
    }
  }

  function onSwitch(e: Event) {
    const id = Number((e.currentTarget as HTMLSelectElement).value);
    if (id !== profiles.currentId) void run(() => setProfile(id));
  }

  /** Name / description write when the field is left, if they changed. */
  function commitText() {
    const n = name.trim();
    const d = description.trim();
    if (!n) {
      name = profiles.name;
      return;
    }
    if (n === profiles.name && d === profiles.description) return;
    void run(() => alterProfile(n, d));
  }
  const blurOnEnter = (e: KeyboardEvent) => {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
  };

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
  <label class="field grow">
    <span>Name</span>
    <Input
      bind:value={name}
      disabled={busy}
      placeholder="Profile name"
      onblur={commitText}
      onkeydown={blurOnEnter}
    />
  </label>
  <label class="field grow">
    <span>Description</span>
    <Input
      bind:value={description}
      disabled={busy}
      placeholder="Optional"
      onblur={commitText}
      onkeydown={blurOnEnter}
    />
  </label>
  <span class="saved" data-state={saved}>
    {#if saved === 'saving'}Saving…{:else if saved === 'saved'}Saved{:else if saved === 'failed'}Not
      saved{/if}
  </span>
  <div class="actions">
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
  .saved {
    min-width: 5.5em;
    align-self: center;
    font-size: var(--gf-font-size-sm);
    color: var(--gf-text-muted);
  }
  .saved[data-state='saved'] {
    color: var(--gf-success);
  }
  .saved[data-state='failed'] {
    color: var(--gf-danger);
  }
  .actions {
    display: flex;
    gap: var(--gf-space-2);
  }
  .muted {
    color: var(--gf-text-muted);
    margin: 0 0 var(--gf-space-3);
  }
</style>
