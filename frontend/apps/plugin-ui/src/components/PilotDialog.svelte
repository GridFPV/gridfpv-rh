<script lang="ts">
  /**
   * Edit a pilot, or create one from a draft (id 0): callsign, name, phonetic, team, colour,
   * and any attributes plugins registered (MultiGP id, …). Save writes each changed field
   * with readback; nothing writes until Save — for a draft, Save is what asks RotorHazard
   * for the record (add_pilot) and fills it in, and a fill that fails deletes it again.
   */
  import { Button, Dialog, Input, Select } from '@gridfpv/components';
  import {
    addPilot,
    alterPilot,
    deletePilot,
    setPilotAttribute,
    type WriteResult
  } from '../lib/rh.svelte.js';
  import type { AttributeType, Pilot } from '../lib/setup.js';

  let {
    open = $bindable(false),
    pilot,
    attributeTypes,
    teams,
    title = 'Edit pilot',
    onresult,
    onclose = undefined
  }: {
    open?: boolean;
    pilot: Pilot;
    attributeTypes: AttributeType[];
    /** Team names to offer (the plugin's list); a value in use but not listed stays pickable. */
    teams: string[];
    title?: string;
    onresult: (r: WriteResult) => void;
    /** Fires whenever the dialog closes (Save, Cancel, ×, Esc, backdrop). */
    onclose?: () => void;
  } = $props();

  let callsign = $state('');
  let name = $state('');
  let phonetic = $state('');
  let team = $state('');
  let color = $state('#ffffff');
  // Seeded for every attribute type up front (and again when the dialog opens): Svelte 5
  // refuses to bind an undefined value to an input that has a fallback.
  let attrs: Record<string, string> = $state(seed());
  function seed(): Record<string, string> {
    const a: Record<string, string> = {};
    for (const t of attributeTypes) a[t.name] = String(pilot.attributes[t.name] ?? '');
    return a;
  }
  let busy = $state(false);

  // Reset the form when the dialog opens or is pointed at another pilot — not on every
  // readback (pilot_data re-sends the attribute types), or what is being typed is wiped.
  let formFor: number | null = null;
  $effect(() => {
    const id = open ? pilot.id : null;
    if (id === formFor) return;
    formFor = id;
    if (id == null) return;
    callsign = pilot.callsign;
    name = pilot.name;
    phonetic = pilot.phonetic;
    team = pilot.team;
    color = pilot.color || '#ffffff';
    attrs = seed();
  });

  const dirty = $derived(
    callsign.trim() !== pilot.callsign ||
      name.trim() !== pilot.name ||
      phonetic.trim() !== pilot.phonetic ||
      team.trim() !== pilot.team ||
      color.toLowerCase() !== (pilot.color || '#ffffff').toLowerCase() ||
      attributeTypes.some((t) => (attrs[t.name] ?? '') !== String(pilot.attributes[t.name] ?? ''))
  );

  const isDraft = $derived(pilot.id === 0);

  async function save() {
    if (!callsign.trim() || !dirty) return;
    busy = true;
    try {
      let id = pilot.id;
      const fields: Parameters<typeof alterPilot>[1] = {};
      // What was typed, taken now: a readback during the awaits below must not change it.
      const typed = {
        callsign: callsign.trim(),
        name: name.trim(),
        phonetic: phonetic.trim(),
        team: team.trim(),
        color
      };
      const typedAttrs = { ...attrs };
      if (isDraft) {
        const made = await addPilot();
        if (!made.ok || made.id == null) {
          onresult(made);
          return;
        }
        id = made.id;
        // RotorHazard's placeholder is "~Callsign N" / "~Pilot N Name": every field is ours.
        fields.callsign = typed.callsign;
        fields.name = typed.name || typed.callsign;
        if (typed.phonetic) fields.phonetic = typed.phonetic;
        if (typed.team) fields.team = typed.team;
        // RotorHazard picks a colour for a new pilot; only a colour the director chose is sent.
        if (typed.color.toLowerCase() !== '#ffffff') fields.color = typed.color;
      } else {
        if (callsign.trim() !== pilot.callsign) fields.callsign = callsign.trim();
        if (name.trim() !== pilot.name) fields.name = name.trim();
        if (phonetic.trim() !== pilot.phonetic) fields.phonetic = phonetic.trim();
        if (team.trim() !== pilot.team) fields.team = team.trim();
        if (color.toLowerCase() !== (pilot.color || '').toLowerCase()) fields.color = color;
      }
      const fail = async (r: WriteResult) => {
        // A draft that RotorHazard would not fill in must not stay as a placeholder.
        if (isDraft) await deletePilot(id);
        onresult(r);
      };
      if (Object.keys(fields).length) {
        const r = await alterPilot(id, fields);
        if (!r.ok) return fail(r);
      }
      for (const t of attributeTypes) {
        const v = typedAttrs[t.name] ?? '';
        if (v !== String(pilot.attributes[t.name] ?? '')) {
          const r = await setPilotAttribute(id, t.name, v);
          if (!r.ok) return fail(r);
        }
      }
      onresult({ ok: true });
      open = false;
    } finally {
      busy = false;
    }
  }
</script>

<Dialog bind:open {title} {onclose}>
  <div class="form">
    <label class="field">
      <span>Callsign</span>
      <Input bind:value={callsign} placeholder="What the announcer says" maxlength="80" />
    </label>
    <label class="field">
      <span>Name</span>
      <Input bind:value={name} placeholder="Optional" maxlength="80" />
    </label>
    <label class="field">
      <span>Phonetic</span>
      <Input
        bind:value={phonetic}
        placeholder="How to pronounce the callsign (optional)"
        maxlength="80"
      />
    </label>
    <div class="row">
      <label class="field grow">
        <span>Team</span>
        <Select bind:value={team}>
          <option value="">— no team —</option>
          {#each teams as t (t)}<option value={t}>{t}</option>{/each}
          {#if team && !teams.includes(team)}<option value={team}
              >{team} (not in the team list)</option
            >{/if}
        </Select>
      </label>
      <label class="field colour">
        <span>Colour</span>
        <input type="color" bind:value={color} />
      </label>
    </div>
    {#each attributeTypes as t (t.name)}
      <label class="field">
        <span>{t.label}</span>
        {#if t.field_type === 'select' && t.options}
          <Select
            value={attrs[t.name] ?? ''}
            onchange={(e: Event) => (attrs[t.name] = (e.currentTarget as HTMLSelectElement).value)}
          >
            <option value="">—</option>
            {#each t.options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
          </Select>
        {:else if t.field_type === 'checkbox'}
          <input
            type="checkbox"
            checked={attrs[t.name] === '1' || attrs[t.name] === 'true'}
            onchange={(e) =>
              (attrs[t.name] = (e.currentTarget as HTMLInputElement).checked ? '1' : '0')}
          />
        {:else}
          <Input
            value={attrs[t.name] ?? ''}
            placeholder={t.placeholder ?? ''}
            oninput={(e: Event) => (attrs[t.name] = (e.currentTarget as HTMLInputElement).value)}
          />
        {/if}
        {#if t.desc}<small class="muted">{t.desc}</small>{/if}
      </label>
    {/each}
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" disabled={!callsign.trim() || !dirty || busy} onclick={save}
      >Save</Button
    >
  {/snippet}
</Dialog>

<style>
  .form {
    display: grid;
    gap: var(--gf-space-3);
  }
  .row {
    display: flex;
    gap: var(--gf-space-3);
    align-items: end;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
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
  .colour input {
    width: 48px;
    height: 36px;
    padding: 0;
    border: 1px solid var(--gf-border);
    border-radius: var(--gf-radius-md);
    background: transparent;
  }
  .muted {
    color: var(--gf-text-muted);
  }
</style>
