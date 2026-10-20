<script lang="ts">
  /**
   * Classes and heats (#9). A class groups heats and says how they are run (format,
   * rounds, ranking, advance); a heat seats pilots — directly, or from another heat's
   * result or the class ranking. Selects write on change with readback; names go
   * through Edit → dialog → Save.
   */
  import { Badge, Banner, Button, Card, Dialog, Input, Select } from '@gridfpv/components';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import SlotRow from '../components/SlotRow.svelte';
  import {
    addClass,
    addHeat,
    alterClass,
    alterHeat,
    deleteClass,
    deleteHeat,
    duplicateClass,
    duplicateHeat,
    rh,
    type WriteResult
  } from '../lib/rh.svelte.js';
  import {
    CLASS_NONE,
    HEAT_ADVANCE,
    heatsInClass,
    ROUND_TYPE,
    type Heat,
    type RaceClass
  } from '../lib/setup.js';

  const timer = rh();
  const setup = $derived(timer.setup);
  const classes = $derived(
    [...setup.classes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id)
  );
  const unclassified = $derived(heatsInClass(setup, CLASS_NONE));

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
  async function run(fn: () => Promise<WriteResult>) {
    busy = true;
    try {
      onresult(await fn());
    } finally {
      busy = false;
    }
  }

  // ---- class edit dialog ----
  let classEdit: RaceClass | null = $state(null);
  let className = $state('');
  let classDescription = $state('');
  function openClassEdit(c: RaceClass) {
    className = c.name;
    classDescription = c.description;
    classEdit = c;
  }
  async function saveClass() {
    const c = classEdit;
    if (!c || !className.trim()) return;
    classEdit = null;
    const fields: Parameters<typeof alterClass>[1] = {};
    if (className.trim() !== c.name) fields.name = className.trim();
    if (classDescription.trim() !== c.description) fields.description = classDescription.trim();
    if (Object.keys(fields).length) await run(() => alterClass(c.id, fields));
  }

  // ---- heat rename dialog ----
  let heatEdit: Heat | null = $state(null);
  let heatName = $state('');
  function openHeatEdit(h: Heat) {
    heatName = h.name;
    heatEdit = h;
  }
  async function saveHeat() {
    const h = heatEdit;
    if (!h) return;
    heatEdit = null;
    if (heatName.trim() !== h.name) await run(() => alterHeat(h.id, { name: heatName.trim() }));
  }

  let classRemove: RaceClass | null = $state(null);
  let heatRemove: Heat | null = $state(null);

  async function newClass() {
    const r = await addClass();
    onresult(r);
    const c = r.id == null ? undefined : setup.classes.find((x) => x.id === r.id);
    if (c) openClassEdit(c);
  }

  const ADVANCE = [
    { v: HEAT_ADVANCE.NONE, l: 'Stay on this heat' },
    { v: HEAT_ADVANCE.NEXT_HEAT, l: 'Next heat' },
    { v: HEAT_ADVANCE.NEXT_ROUND, l: 'Next round' }
  ];
  const ROUNDS = [
    { v: ROUND_TYPE.RACES_PER_HEAT, l: 'Races per heat' },
    { v: ROUND_TYPE.GROUPED, l: 'Grouped rounds' }
  ];
</script>

{#if classEdit}
  <Dialog open={true} title="Edit class" onclose={() => (classEdit = null)}>
    <div class="form">
      <label class="field"
        ><span>Name</span><Input
          bind:value={className}
          maxlength="80"
          onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && saveClass()}
        /></label
      >
      <label class="field"
        ><span>Description</span><Input
          bind:value={classDescription}
          placeholder="Optional"
          maxlength="200"
        /></label
      >
    </div>
    {#snippet footer()}
      <Button variant="ghost" onclick={() => (classEdit = null)}>Cancel</Button>
      <Button variant="primary" disabled={!className.trim() || busy} onclick={saveClass}
        >Save</Button
      >
    {/snippet}
  </Dialog>
{/if}

{#if heatEdit}
  <Dialog open={true} title="Rename heat" onclose={() => (heatEdit = null)}>
    <label class="field">
      <span>Name</span>
      <Input
        bind:value={heatName}
        placeholder={heatEdit.autoName}
        maxlength="80"
        onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && saveHeat()}
      />
      <small class="muted"
        >Leave empty to use RotorHazard's automatic name ({heatEdit.autoName}).</small
      >
    </label>
    {#snippet footer()}
      <Button variant="ghost" onclick={() => (heatEdit = null)}>Cancel</Button>
      <Button variant="primary" disabled={busy} onclick={saveHeat}>Save</Button>
    {/snippet}
  </Dialog>
{/if}

{#if classRemove}
  <ConfirmDialog
    open={true}
    title="Delete class"
    confirmLabel="Delete"
    danger
    onconfirm={() => {
      const c = classRemove;
      classRemove = null;
      if (c) void run(() => deleteClass(c.id));
    }}
    oncancel={() => (classRemove = null)}
  >
    Delete <strong>{classRemove.displayName}</strong>? Its heats become unclassified. A class with
    saved races cannot be deleted.
  </ConfirmDialog>
{/if}
{#if heatRemove}
  <ConfirmDialog
    open={true}
    title="Delete heat"
    confirmLabel="Delete"
    danger
    onconfirm={() => {
      const h = heatRemove;
      heatRemove = null;
      if (h) void run(() => deleteHeat(h.id));
    }}
    oncancel={() => (heatRemove = null)}
  >
    Delete <strong>{heatRemove.displayName}</strong>? A heat with saved races cannot be deleted.
  </ConfirmDialog>
{/if}

<section class="page">
  <header class="pagehead">
    <div>
      <h1>Classes & heats</h1>
      <p class="lede">
        A class says how its heats are run; a heat says who flies together and on which seat.
      </p>
    </div>
    <Button variant="primary" disabled={busy} onclick={newClass}>New class</Button>
  </header>

  {#if notice}
    <Banner tone={notice.tone} ondismiss={() => (notice = null)}>{notice.text}</Banner>
  {/if}

  {#each classes as c (c.id)}
    {@const heats = heatsInClass(setup, c.id)}
    <Card>
      <div class="classhead">
        <div class="title">
          <h2>{c.displayName}</h2>
          {#if c.description}<span class="muted">{c.description}</span>{/if}
          {#if c.locked}<Badge tone="neutral" variant="outline">raced</Badge>{/if}
        </div>
        <div class="actions">
          <Button size="sm" variant="secondary" disabled={busy} onclick={() => openClassEdit(c)}
            >Edit</Button
          >
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onclick={() => run(() => duplicateClass(c.id))}>Duplicate</Button
          >
          <Button
            size="sm"
            variant="danger"
            disabled={busy || c.locked}
            onclick={() => (classRemove = c)}>Delete</Button
          >
        </div>
      </div>
      <div class="settings">
        <label class="field">
          <span>Format</span>
          <Select
            value={String(c.formatId)}
            size="sm"
            disabled={busy || c.locked}
            onchange={(e: Event) =>
              run(() =>
                alterClass(c.id, { formatId: Number((e.currentTarget as HTMLSelectElement).value) })
              )}
          >
            <option value="0">— none —</option>
            {#each setup.formats as f (f.id)}<option value={String(f.id)}>{f.name}</option>{/each}
          </Select>
        </label>
        <label class="field narrow">
          <span>Rounds</span>
          <Input
            type="number"
            size="sm"
            value={String(c.rounds)}
            min="0"
            max="99"
            disabled={busy || c.locked}
            onchange={(e: Event) =>
              run(() =>
                alterClass(c.id, {
                  rounds: Math.max(0, Number((e.currentTarget as HTMLInputElement).value) || 0)
                })
              )}
          />
        </label>
        <label class="field">
          <span>Ranking</span>
          <Select
            value={c.winCondition}
            size="sm"
            disabled={busy}
            onchange={(e: Event) =>
              run(() =>
                alterClass(c.id, { winCondition: (e.currentTarget as HTMLSelectElement).value })
              )}
          >
            <option value="">— none —</option>
            {#each timer.rankMethods as m (m.name)}<option value={m.name}>{m.label}</option>{/each}
          </Select>
        </label>
        <label class="field">
          <span>After a race</span>
          <Select
            value={String(c.heatAdvanceType)}
            size="sm"
            disabled={busy}
            onchange={(e: Event) =>
              run(() =>
                alterClass(c.id, {
                  heatAdvanceType: Number((e.currentTarget as HTMLSelectElement).value)
                })
              )}
          >
            {#each ADVANCE as a (a.v)}<option value={String(a.v)}>{a.l}</option>{/each}
          </Select>
        </label>
        <label class="field">
          <span>Rounds are</span>
          <Select
            value={String(c.roundType)}
            size="sm"
            disabled={busy}
            onchange={(e: Event) =>
              run(() =>
                alterClass(c.id, {
                  roundType: Number((e.currentTarget as HTMLSelectElement).value)
                })
              )}
          >
            {#each ROUNDS as r (r.v)}<option value={String(r.v)}>{r.l}</option>{/each}
          </Select>
        </label>
      </div>

      <div class="heats">
        {#each heats as h (h.id)}
          <div class="heat">
            <div class="heathead">
              <strong>{h.displayName}</strong>
              {#if h.dynamic}<Badge tone="info">seeded</Badge>{/if}
              {#if h.locked}<Badge tone="neutral" variant="outline">raced</Badge>{/if}
              <span class="spacer"></span>
              <Button size="sm" variant="ghost" disabled={busy} onclick={() => openHeatEdit(h)}
                >Rename</Button
              >
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onclick={() => run(() => duplicateHeat(h.id))}>Duplicate</Button
              >
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || h.locked}
                onclick={() => (heatRemove = h)}>Delete</Button
              >
            </div>
            <div class="slots">
              {#each h.slots as s (s.id)}
                <SlotRow heat={h} slot={s} {setup} {onresult} />
              {/each}
            </div>
          </div>
        {/each}
        <div>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onclick={() => run(() => addHeat(c.id))}>Add heat to {c.displayName}</Button
          >
        </div>
      </div>
    </Card>
  {/each}

  {#if unclassified.length || classes.length === 0}
    <Card
      title="Unclassified heats"
      subtitle="Heats not in any class; RotorHazard runs them as one-offs"
    >
      <div class="heats">
        {#each unclassified as h (h.id)}
          <div class="heat">
            <div class="heathead">
              <strong>{h.displayName}</strong>
              {#if h.locked}<Badge tone="neutral" variant="outline">raced</Badge>{/if}
              <span class="spacer"></span>
              <Button size="sm" variant="ghost" disabled={busy} onclick={() => openHeatEdit(h)}
                >Rename</Button
              >
              {#if classes.length}
                <Select
                  value=""
                  size="sm"
                  disabled={busy}
                  onchange={(e: Event) => {
                    const id = Number((e.currentTarget as HTMLSelectElement).value);
                    if (id) void run(() => alterHeat(h.id, { classId: id }));
                  }}
                >
                  <option value="">Move to class…</option>
                  {#each classes as c (c.id)}<option value={String(c.id)}>{c.displayName}</option
                    >{/each}
                </Select>
              {/if}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || h.locked}
                onclick={() => (heatRemove = h)}>Delete</Button
              >
            </div>
            <div class="slots">
              {#each h.slots as s (s.id)}
                <SlotRow heat={h} slot={s} {setup} {onresult} />
              {/each}
            </div>
          </div>
        {/each}
        <div>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onclick={() => run(() => addHeat(0))}>Add unclassified heat</Button
          >
        </div>
      </div>
    </Card>
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
  .classhead {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--gf-space-3);
    flex-wrap: wrap;
  }
  .title {
    display: flex;
    align-items: baseline;
    gap: var(--gf-space-2);
    flex-wrap: wrap;
  }
  .title h2 {
    margin: 0;
    font-size: var(--gf-font-size-lg);
  }
  .actions {
    display: flex;
    gap: var(--gf-space-2);
  }
  .settings {
    display: flex;
    gap: var(--gf-space-3);
    align-items: end;
    flex-wrap: wrap;
    margin: var(--gf-space-3) 0;
    padding-bottom: var(--gf-space-3);
    border-bottom: 1px solid var(--gf-border);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 160px;
  }
  .field.narrow {
    min-width: 0;
    width: 84px;
  }
  .field span {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .form {
    display: grid;
    gap: var(--gf-space-3);
  }
  .heats {
    display: grid;
    gap: var(--gf-space-3);
  }
  .heat {
    display: grid;
    gap: var(--gf-space-2);
    padding: var(--gf-space-2) var(--gf-space-3);
    background: var(--gf-surface-sunken);
    border-radius: var(--gf-radius-md);
  }
  .heathead {
    display: flex;
    align-items: center;
    gap: var(--gf-space-2);
    flex-wrap: wrap;
  }
  .spacer {
    flex: 1;
  }
  .slots {
    display: grid;
    gap: var(--gf-space-1);
  }
</style>
