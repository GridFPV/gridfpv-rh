<script lang="ts">
  /**
   * Profiles: the list on the left, the chosen one's settings on the right, grouped the way
   * the helper describes them (`fields`). A new profile starts with the connections alone;
   * the helper tries them, and the rest of the form offers what OBS has — its scenes, the
   * Source Record filters on the chosen scene — instead of asking for it typed. Paths get a
   * picker. Save writes the file; Use starts with it.
   */
  import { Badge, Button, Card, Field, Input, Select } from '@gridfpv/components';
  import { api, type Field as FieldDef, type Probe, type Settings } from '../lib/api.js';
  import { act, loadProfiles, ui } from '../lib/state.svelte.js';
  import PathField from '../components/PathField.svelte';

  let { chosen = $bindable('') }: { chosen?: string } = $props();

  let editing = $state<string | null>(null);
  let draft = $state<Settings>({});
  let dirty = $state(false);
  let note = $state('');
  let probe = $state<Probe | null>(null);
  let probing = $state(false);

  // A new profile: name + the connections, tried, then the rest.
  let creating = $state(false);
  let newName = $state('');
  let step = $state<1 | 2>(1);

  const groups = $derived([...new Set(ui.fields.map((f) => f.group))]);
  const running = $derived(ui.snapshot?.running ?? null);
  const stepOne = $derived(ui.fields.filter((f) => f.step === 1));
  const scenes = $derived(probe?.obs.scenes ?? null);
  const sceneFilters = $derived(
    scenes?.find((s) => s.name === String(valueOf('scene')))?.sourceRecordFilters ?? null
  );

  // Pick the first profile (or the chosen one) once the list is in.
  $effect(() => {
    if (!creating && editing == null && ui.profiles.length) select(chosen || ui.profiles[0].name);
  });

  function select(name: string) {
    const p = ui.profiles.find((x) => x.name === name);
    if (!p) return;
    creating = false;
    editing = name;
    chosen = name;
    draft = { ...p.settings };
    dirty = false;
    note = '';
    probe = null;
  }

  function startCreating(copy: boolean) {
    creating = true;
    editing = null;
    step = 1;
    newName = '';
    draft = copy ? { ...draft } : {};
    dirty = false;
    note = '';
    probe = null;
  }

  const shown = (f: FieldDef) =>
    (!f.when || Object.entries(f.when).every(([k, v]) => String(valueOf(k)) === v)) &&
    // A field that only matters sometimes: with several Source Record filters on the scene,
    // or when it already holds a value.
    (!f.advanced ||
      (f.choices === 'filters' ? (sceneFilters?.length ?? 0) > 1 : false) ||
      Boolean(valueOf(f.key)));
  function valueOf(key: string) {
    return key in draft ? draft[key] : ui.defaults[key];
  }

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

  async function tryConnections() {
    probing = true;
    ui.error = null;
    try {
      probe = await api.probe(trimmed());
      // What OBS has, offered: the first scene with a Source Record filter is the likely one.
      if (probe.obs.ok && !valueOf('scene') && probe.obs.scenes?.length) {
        const withFilter = probe.obs.scenes.find((s) => s.sourceRecordFilters.length);
        if (withFilter) draft = { ...draft, scene: withFilter.name };
      }
    } catch (e) {
      ui.error = e instanceof Error ? e.message : String(e);
    } finally {
      probing = false;
    }
  }

  async function save() {
    const name = creating ? newName.trim() : editing;
    if (!name) return;
    const ok = await act(() => api.saveProfile(name, trimmed()));
    if (ok) {
      await loadProfiles();
      const wasCreating = creating;
      creating = false;
      select(name);
      note = wasCreating ? 'Profile made.' : 'Saved.';
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

  const SOURCE_RECORD_URL = 'https://github.com/exeldro/obs-source-record/releases';
  /** Connected to OBS, the profile records from a scene, and the plugin is not there: amber. */
  const needsPlugin = (p: Probe) =>
    p.obs.ok && valueOf('recordFrom') === 'scene' && !p.obs.sourceRecord;
  const connectionWords = (p: Probe) => ({
    timer: p.timer.ok
      ? p.timer.synced
        ? `Timer connected and synced${p.timer.heats ? `, ${p.timer.heats} heat${p.timer.heats === 1 ? '' : 's'} with saved races` : ''}`
        : 'Timer connected, clock not synced yet'
      : `Timer: ${p.timer.error ?? 'no answer'}`,
    obs: p.obs.ok
      ? `OBS ${p.obs.version ?? ''} connected${p.obs.sourceRecord ? ', Source Record present' : ', no Source Record plugin'}`
      : `OBS: ${p.obs.error ?? 'no answer'}`
  });
</script>

{#snippet fieldInput(f: FieldDef)}
  {#if f.type === 'boolean'}
    <label class="check">
      <input type="checkbox" checked={Boolean(valueOf(f.key))} onchange={(e) => onInput(f, e)} />
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
      {:else if f.choices === 'scenes' && scenes?.length}
        <Select
          value={String(valueOf(f.key) ?? '')}
          aria-label={f.label}
          onchange={(e: Event) => onInput(f, e)}
        >
          <option value="">— choose a scene —</option>
          {#each scenes as s (s.name)}
            <option value={s.name}
              >{s.name}{s.sourceRecordFilters.length
                ? ` (Source Record: ${s.sourceRecordFilters.join(', ')})`
                : ''}</option
            >
          {/each}
          {#if valueOf(f.key) && !scenes.some((s) => s.name === valueOf(f.key))}
            <option value={String(valueOf(f.key))}>{valueOf(f.key)} (not in OBS now)</option>
          {/if}
        </Select>
      {:else if f.choices === 'filters' && sceneFilters?.length}
        <Select
          value={String(valueOf(f.key) ?? '')}
          aria-label={f.label}
          onchange={(e: Event) => onInput(f, e)}
        >
          <option value="">the first one</option>
          {#each sceneFilters as name (name)}
            <option value={name}>{name}</option>
          {/each}
        </Select>
      {:else if f.kind}
        <PathField
          value={String(valueOf(f.key) ?? '')}
          kind={f.kind}
          label={f.label}
          onpick={(p) => set(f.key, p)}
        />
      {:else}
        <Input
          type={f.type === 'number' ? 'number' : f.type === 'password' ? 'password' : 'text'}
          value={String(valueOf(f.key) ?? '')}
          min={f.min}
          max={f.max}
          aria-label={f.label}
          autocomplete={f.type === 'password' ? 'off' : undefined}
          onchange={(e: Event) => onInput(f, e)}
        />
      {/if}
    </Field>
    {#if f.link}
      <a class="fieldlink small" href={f.link.href} target="_blank" rel="noopener">{f.link.label}</a
      >
    {/if}
  {/if}
{/snippet}

{#snippet connections(p: Probe)}
  {@const w = connectionWords(p)}
  <ul class="probe" aria-label="Connections">
    <li><Badge tone={p.timer.ok ? 'success' : 'danger'} dot>{w.timer}</Badge></li>
    <li>
      <Badge tone={p.obs.ok ? (needsPlugin(p) ? 'warn' : 'success') : 'danger'} dot>{w.obs}</Badge>
    </li>
    {#if needsPlugin(p)}
      <li class="muted small">
        Recording from a scene needs the Source Record plugin in OBS —
        <a href={SOURCE_RECORD_URL} target="_blank" rel="noopener">get it from its releases page</a
        >, restart OBS and try again, or record from OBS's own recording.
      </li>
    {/if}
  </ul>
{/snippet}

<div class="cols">
  <Card title="Profiles">
    <ul class="list">
      {#each ui.profiles as p (p.name)}
        <li>
          <button
            type="button"
            class="item"
            class:active={p.name === editing && !creating}
            onclick={() => select(p.name)}
          >
            {p.name}
            {#if running?.profile === p.name}<span class="muted small"> · running</span>{/if}
          </button>
        </li>
      {/each}
      {#if !ui.profiles.length}<li class="muted">None yet.</li>{/if}
    </ul>
    <div class="new">
      <Button size="sm" disabled={ui.busy || creating} onclick={() => startCreating(false)}
        >New profile</Button
      >
      <Button
        size="sm"
        variant="ghost"
        disabled={!editing || creating || ui.busy}
        title="A new profile starting from the settings on the right"
        onclick={() => startCreating(true)}>Duplicate</Button
      >
    </div>
  </Card>

  {#if creating}
    <Card
      title="New profile"
      subtitle={step === 1
        ? 'Step 1 of 2 — the timer and OBS'
        : 'Step 2 of 2 — recording and renders'}
    >
      <form
        class="form"
        onsubmit={(e) => {
          e.preventDefault();
          if (step === 1) void tryConnections();
          else void save();
        }}
      >
        {#if step === 1}
          <fieldset>
            <legend>Name</legend>
            <Field
              label="Profile name"
              hint="An event, a venue, a machine — whatever you switch between"
            >
              <Input
                value={newName}
                aria-label="Profile name"
                oninput={(e: Event) => (newName = (e.currentTarget as HTMLInputElement).value)}
              />
            </Field>
          </fieldset>
          {#each ['Timer', 'OBS'] as g (g)}
            <fieldset>
              <legend>{g}</legend>
              {#each stepOne.filter((f) => f.group === g) as f (f.key)}
                {@render fieldInput(f)}
              {/each}
            </fieldset>
          {/each}
          {#if probe}{@render connections(probe)}{/if}
          <div class="buttons">
            <Button type="submit" disabled={probing || !newName.trim()} loading={probing}
              >{probe ? 'Try again' : 'Connect'}</Button
            >
            <Button
              variant={probe?.timer.ok && probe?.obs.ok ? 'primary' : 'secondary'}
              disabled={!probe || probing}
              onclick={() => (step = 2)}
              >{probe && !(probe.timer.ok && probe.obs.ok) ? 'Continue anyway' : 'Continue'}</Button
            >
            <Button variant="ghost" onclick={() => (creating = false)}>Cancel</Button>
          </div>
        {:else}
          {#if probe}{@render connections(probe)}{/if}
          {#each groups.filter((g) => g !== 'Timer' && g !== 'OBS') as g (g)}
            <fieldset>
              <legend>{g}</legend>
              {#each ui.fields.filter((f) => f.group === g && !f.step && shown(f)) as f (f.key)}
                {@render fieldInput(f)}
              {/each}
            </fieldset>
          {/each}
          <div class="buttons">
            <Button variant="ghost" onclick={() => (step = 1)}>Back</Button>
            <Button type="submit" disabled={ui.busy} loading={ui.busy}>Save profile</Button>
            <Button variant="ghost" onclick={() => (creating = false)}>Cancel</Button>
          </div>
        {/if}
      </form>
    </Card>
  {:else if editing}
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
              {@render fieldInput(f)}
            {/each}
            {#if g === 'OBS'}
              <div class="tryrow">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={probing}
                  loading={probing}
                  onclick={tryConnections}>Try the connections</Button
                >
                <span class="muted small"
                  >Checks the timer and OBS with the settings above, and offers OBS's scenes below.</span
                >
              </div>
              {#if probe}{@render connections(probe)}{/if}
            {/if}
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
  .tryrow {
    grid-column: 1 / -1;
    display: flex;
    gap: var(--gf-space-3);
    align-items: center;
    flex-wrap: wrap;
  }
  .probe {
    grid-column: 1 / -1;
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--gf-space-1);
  }
  .buttons {
    display: flex;
    gap: var(--gf-space-2);
    flex-wrap: wrap;
  }
  .muted {
    color: var(--gf-text-muted);
  }
  .fieldlink {
    display: block;
    margin-top: calc(-1 * var(--gf-space-2));
  }
  .small {
    font-size: var(--gf-font-size-xs);
  }
</style>
