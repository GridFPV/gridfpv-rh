<script lang="ts">
  /**
   * "Add stage": a template (practice, qualifying, bracket, Chase the Ace, blank) sets
   * the name, format, rounds, ranking and how many empty heats to make; everything is
   * editable before Create. One click instead of RotorHazard's class form plus N add-heats.
   */
  import { Button, Dialog, Input, Select } from '@gridfpv/components';
  import { createStage, type WriteResult } from '../lib/rh.svelte.js';
  import {
    defaultRankLabel,
    heatsForPilots,
    STAGE_TEMPLATES,
    type StageTemplate
  } from '../lib/stages.js';
  import { WIN_CONDITION } from '../lib/setup.js';
  import { STAGE_ACE, STAGE_ACE_ROW, STAGE_ATTR } from '../lib/ace.js';
  import { ROUND_TYPE, type Setup } from '../lib/setup.js';

  let {
    setup,
    rankMethods,
    seatCount,
    onresult,
    onclose
  }: {
    setup: Setup;
    rankMethods: Array<{ name: string; label: string }>;
    seatCount: number;
    onresult: (r: WriteResult) => void;
    onclose: () => void;
  } = $props();

  let open = $state(true);
  let busy = $state(false);
  let template = $state(STAGE_TEMPLATES[1]);
  let name = $state('');
  let formatId = $state('');
  let rounds = $state('3');
  let unlimited = $state(false);
  let rank = $state('');
  let heats = $state('1');
  let grouped = $state(false);
  /** Chase the Ace: the ace has won twice, or twice in a row. */
  let aceRow = $state(false);

  const activePilots = $derived(setup.pilots.filter((p) => p.active).length);

  function pick(t: StageTemplate) {
    template = t;
    name = t.id === 'blank' ? '' : t.label;
    const f = setup.formats.find((x) => t.formatMatch.test(x.name)) ?? setup.formats[0];
    formatId = f ? String(f.id) : '';
    unlimited = t.rounds === 0;
    rounds = String(t.rounds || 3);
    // A format that already ranks by consecutive laps needs no rank method: RotorHazard's
    // default (the format's win condition) is the "fastest consecutive" ranking (#46).
    rank =
      t.id === 'qualifying' && f?.winCondition === WIN_CONDITION.FASTEST_CONSECUTIVE
        ? ''
        : rankMethods.some((m) => m.name === t.rank)
          ? t.rank
          : '';
    heats = String(t.heats === 'pilots' ? heatsForPilots(activePilots, seatCount) : t.heats);
    grouped = t.grouped;
  }
  // Seed the form from the default template once the formats are known.
  $effect(() => {
    if (!formatId && setup.formats.length) pick(template);
  });

  const valid = $derived(!!name.trim() && !!formatId);

  async function create() {
    if (!valid) return;
    busy = true;
    try {
      const r = await createStage({
        name: name.trim(),
        formatId: Number(formatId),
        rounds: unlimited ? 0 : Math.max(1, Math.floor(Number(rounds) || 1)),
        winCondition: rank,
        heats: Math.max(0, Math.floor(Number(heats) || 0)),
        roundType: grouped ? ROUND_TYPE.GROUPED : ROUND_TYPE.RACES_PER_HEAT,
        attributes:
          template.id === 'ace'
            ? { [STAGE_ATTR]: aceRow ? STAGE_ACE_ROW : STAGE_ACE }
            : template.attributes
      });
      onresult(r);
      if (r.ok) open = false;
    } finally {
      busy = false;
    }
  }
</script>

<Dialog bind:open title="Add stage" {onclose} size="wide">
  <div class="form">
    <div class="templates">
      {#each STAGE_TEMPLATES as t (t.id)}
        <button
          type="button"
          class="template"
          class:selected={template.id === t.id}
          onclick={() => pick(t)}
        >
          <strong>{t.label}</strong>
          <span>{t.description}</span>
        </button>
      {/each}
    </div>

    {#if template.id === 'ace'}
      <div class="field" role="radiogroup" aria-label="The ace is">
        <span>The ace is</span>
        <label class="radio"
          ><input type="radio" bind:group={aceRow} value={false} /> the first pilot to win two rounds</label
        >
        <label class="radio"
          ><input type="radio" bind:group={aceRow} value={true} /> the first pilot to win two rounds in
          a row</label
        >
      </div>
    {/if}

    <div class="row">
      <label class="field grow"
        ><span>Name</span><Input
          bind:value={name}
          maxlength="80"
          onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && create()}
        /></label
      >
      <label class="field grow">
        <span>Format</span>
        <Select bind:value={formatId}>
          {#each setup.formats as f (f.id)}<option value={String(f.id)}>{f.name}</option>{/each}
        </Select>
      </label>
    </div>
    <div class="row">
      <div class="field">
        <span>Rounds</span>
        <div class="roundsrow">
          <Input
            type="number"
            bind:value={rounds}
            min="1"
            max="99"
            placeholder="∞"
            disabled={unlimited}
            aria-label="Rounds"
          />
          <label class="check"><input type="checkbox" bind:checked={unlimited} /> No limit</label>
        </div>
      </div>
      <label class="field grow">
        <span>Ranked by</span>
        <Select bind:value={rank}>
          <option value=""
            >{defaultRankLabel(setup.formats.find((x) => String(x.id) === formatId))}</option
          >
          {#each rankMethods as m (m.name)}<option value={m.name}>{m.label}</option>{/each}
        </Select>
      </label>
      <label class="field narrow"
        ><span>Heats</span><Input type="number" bind:value={heats} min="0" max="64" /></label
      >
    </div>
    <div class="field">
      <span>Rounds are</span>
      <div class="row">
        <label class="radio"
          ><input type="radio" bind:group={grouped} value={false} /> Races per heat — each heat flies
          every round (qualifying, practice)</label
        >
        <label class="radio"
          ><input type="radio" bind:group={grouped} value={true} /> Grouped rounds — after a heat flies,
          RotorHazard re-creates it for the next round with a fresh lineup (ZippyQ)</label
        >
      </div>
      <small class="muted"
        >Set once: RotorHazard rebuilds a stage's heats when this changes. Brackets are races per
        heat, one round; Generate bracket… sets that itself.</small
      >
    </div>
    <small class="muted">
      {activePilots} active pilot{activePilots === 1 ? '' : 's'} and
      {seatCount} seats: {heatsForPilots(activePilots, seatCount)} heat{heatsForPilots(
        activePilots,
        seatCount
      ) === 1
        ? ''
        : 's'} seat everyone. Heats are created empty; seat pilots from the board.
    </small>
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" disabled={!valid || busy} onclick={create}>Create</Button>
  {/snippet}
</Dialog>

<style>
  .form {
    display: grid;
    gap: var(--gf-space-3);
  }
  .templates {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: var(--gf-space-2);
  }
  .template {
    display: grid;
    gap: 2px;
    text-align: left;
    font: inherit;
    color: var(--gf-text);
    background: var(--gf-surface-sunken);
    border: 1px solid var(--gf-border);
    border-radius: var(--gf-radius-md);
    padding: var(--gf-space-2);
    cursor: pointer;
  }
  .template span {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
  }
  .template.selected {
    border-color: var(--gf-brand-500);
    box-shadow: 0 0 0 1px var(--gf-brand-500);
  }
  .row {
    display: flex;
    gap: var(--gf-space-3);
    align-items: end;
    flex-wrap: wrap;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .field.grow {
    flex: 1;
    min-width: 180px;
  }
  .field.narrow {
    width: 100px;
  }
  .field > span {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .muted {
    color: var(--gf-text-muted);
  }
  .roundsrow {
    display: flex;
    align-items: center;
    gap: var(--gf-space-2);
  }
  .roundsrow :global(.gf-input) {
    width: 80px;
  }
  .check,
  .radio {
    display: flex;
    align-items: center;
    gap: var(--gf-space-1);
  }
  .check {
    white-space: nowrap;
  }
  .radio {
    align-items: start;
  }
  .radio input {
    margin-top: 4px;
  }
</style>
