<script lang="ts">
  /**
   * Profiles: the list on the left, the chosen one's settings on the right, grouped the way
   * the helper describes them (`fields`). Save writes the file; Use starts with it.
   */
  import { Button, Card, Field, Input, Select } from '@gridfpv/components';
  import { api, type Field as FieldDef, type Settings } from '../lib/api.js';
  import { act, loadProfiles, ui } from '../lib/state.svelte.js';

  let { chosen = $bindable('') }: { chosen?: string } = $props();

  let editing = $state<string | null>(null);
  let draft = $state<Settings>({});
  let dirty = $state(false);
  let newName = $state('');
  let note = $state('');

  const groups = $derived([...new Set(ui.fields.map((f) => f.group))]);
  const running = $derived(ui.snapshot?.running ?? null);

  // Pick the first profile (or the chosen one) once the list is in.
  $effect(() => {
    if (editing == null && ui.profiles.length) select(chosen || ui.profiles[0].name);
  });

  function select(name: string) {
    const p = ui.profiles.find((x) => x.name === name);
    if (!p) return;
    editing = name;
    chosen = name;
    draft = { ...p.settings };
    dirty = false;
    note = '';
  }

  const shown = (f: FieldDef) =>
    !f.when || Object.entries(f.when).every(([k, v]) => String(valueOf(k)) === v);
  const valueOf = (key: string) => (key in draft ? draft[key] : ui.defaults[key]);

  function set(key: string, value: string | number | boolean) {
    draft = { ...draft, [key]: value };
    dirty = true;
  }
  function onInput(f: FieldDef, e: Event) {
    const el = e.currentTarget as HTMLInputElement | HTMLSelectElement;
    if (f.type === 'number') set(f.key, el.value === '' ? (f.default as number) : Number(el.value));
    else if (f.type === 'boolean') set(f.key, (el as HTMLInputElement).checked);
    else set(f.key, el.value);
  }

  /** Only what differs from the defaults is stored, so a profile reads as its choices. */
  function trimmed(): Settings {
    const out: Settings = {};
    for (const [k, v] of Object.entries(draft)) if (v !== ui.defaults[k]) out[k] = v;
    return out;
  }

  async function save() {
    if (!editing) return;
    const ok = await act(() => api.saveProfile(editing!, trimmed()));
    if (ok) {
      await loadProfiles();
      dirty = false;
      note = 'Saved.';
    }
  }
  async function create(copy: boolean) {
    const name = newName.trim();
    if (!name) return;
    const settings = copy ? trimmed() : {};
    const ok = await act(() => api.saveProfile(name, settings));
    if (ok) {
      newName = '';
      await loadProfiles();
      select(name);
    }
  }
  async function rename() {
    if (!editing) return;
    const to = window.prompt('New name for this profile', editing)?.trim();
    if (!to || to === editing) return;
    const ok = await act(() => api.renameProfile(editing!, to));
    if (ok) {
      await loadProfiles();
      select(to);
    }
  }
  async function remove() {
    if (!editing) return;
    if (!window.confirm(`Delete the profile “${editing}”?`)) return;
    const ok = await act(() => api.deleteProfile(editing!));
    if (ok) {
      editing = null;
      chosen = '';
      await loadProfiles();
    }
  }
  async function use() {
    if (!editing) return;
    if (dirty) await save();
    await act(() => api.start(editing!));
  }
</script>

<div class="cols">
  <Card title="Profiles">
    <ul class="list">
      {#each ui.profiles as p (p.name)}
        <li>
          <button
            type="button"
            class="item"
            class:active={p.name === editing}
            onclick={() => select(p.name)}
          >
            {p.name}
            {#if running?.profile === p.name}<span class="muted small"> · running</span>{/if}
          </button>
        </li>
      {/each}
      {#if !ui.profiles.length}<li class="muted">None yet — make one below.</li>{/if}
    </ul>
    <form
      class="new"
      onsubmit={(e) => {
        e.preventDefault();
        void create(false);
      }}
    >
      <Input
        size="sm"
        value={newName}
        placeholder="New profile name"
        aria-label="New profile name"
        oninput={(e: Event) => (newName = (e.currentTarget as HTMLInputElement).value)}
      />
      <Button size="sm" type="submit" disabled={!newName.trim() || ui.busy}>Add</Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={!newName.trim() || !editing || ui.busy}
        title="A new profile with the settings on the right"
        onclick={() => create(true)}>Duplicate</Button
      >
    </form>
  </Card>

  {#if editing}
    <Card title={editing} subtitle={dirty ? 'Unsaved changes' : note}>
      {#snippet actions()}
        <Button size="sm" variant="ghost" onclick={rename} disabled={ui.busy}>Rename</Button>
        <Button
          size="sm"
          variant="danger"
          onclick={remove}
          disabled={ui.busy || running?.profile === editing}>Delete</Button
        >
      {/snippet}
      <form
        class="form"
        onsubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {#each groups as g (g)}
          <fieldset>
            <legend>{g}</legend>
            {#each ui.fields.filter((f) => f.group === g && shown(f)) as f (f.key)}
              {#if f.type === 'boolean'}
                <label class="check">
                  <input
                    type="checkbox"
                    checked={Boolean(valueOf(f.key))}
                    onchange={(e) => onInput(f, e)}
                  />
                  <span>{f.label}</span>
                  {#if f.help}<span class="muted small">{f.help}</span>{/if}
                </label>
              {:else}
                <Field label={f.label} hint={f.help}>
                  {#if f.type === 'select'}
                    <Select
                      value={String(valueOf(f.key) ?? '')}
                      aria-label={f.label}
                      onchange={(e: Event) => onInput(f, e)}
                    >
                      {#each f.options ?? [] as o (o.value)}
                        <option value={o.value}>{o.label}</option>
                      {/each}
                    </Select>
                  {:else}
                    <Input
                      type={f.type === 'number'
                        ? 'number'
                        : f.type === 'password'
                          ? 'password'
                          : 'text'}
                      value={String(valueOf(f.key) ?? '')}
                      min={f.min}
                      max={f.max}
                      aria-label={f.label}
                      autocomplete={f.type === 'password' ? 'off' : undefined}
                      onchange={(e: Event) => onInput(f, e)}
                    />
                  {/if}
                </Field>
              {/if}
            {/each}
          </fieldset>
        {/each}
        <div class="buttons">
          <Button type="submit" disabled={!dirty || ui.busy} loading={ui.busy}>Save</Button>
          <Button
            variant="secondary"
            disabled={ui.busy || running?.profile === editing}
            onclick={use}>{dirty ? 'Save and use' : 'Use this profile'}</Button
          >
        </div>
      </form>
    </Card>
  {/if}
</div>

<style>
  .cols {
    display: grid;
    grid-template-columns: minmax(14rem, 18rem) 1fr;
    gap: var(--gf-space-4);
    align-items: start;
  }
  @media (max-width: 48rem) {
    .cols {
      grid-template-columns: 1fr;
    }
  }
  .list {
    list-style: none;
    margin: 0 0 var(--gf-space-3);
    padding: 0;
    display: grid;
    gap: var(--gf-space-1);
  }
  .item {
    width: 100%;
    text-align: left;
    appearance: none;
    border: 1px solid transparent;
    background: none;
    color: inherit;
    font: inherit;
    padding: var(--gf-space-2) var(--gf-space-3);
    border-radius: var(--gf-radius-md);
    cursor: pointer;
  }
  .item:hover {
    background: var(--gf-surface-alt);
  }
  .item.active {
    background: var(--gf-surface);
    border-color: var(--gf-border);
  }
  .new {
    display: flex;
    gap: var(--gf-space-2);
    align-items: center;
    flex-wrap: wrap;
  }
  .form {
    display: grid;
    gap: var(--gf-space-4);
  }
  fieldset {
    border: 1px solid var(--gf-border);
    border-radius: var(--gf-radius-sm);
    padding: var(--gf-space-2) var(--gf-space-3) var(--gf-space-3);
    display: grid;
    gap: var(--gf-space-3);
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  }
  legend {
    font-size: var(--gf-font-size-sm);
    color: var(--gf-text-muted);
    padding: 0 var(--gf-space-1);
  }
  .check {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0 var(--gf-space-2);
    align-items: center;
    font-size: var(--gf-font-size-sm);
  }
  .check .small {
    grid-column: 2;
  }
  .buttons {
    display: flex;
    gap: var(--gf-space-2);
  }
  .muted {
    color: var(--gf-text-muted);
  }
  .small {
    font-size: var(--gf-font-size-xs);
  }
</style>
