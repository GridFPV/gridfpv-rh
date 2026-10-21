<script lang="ts">
  /**
   * Generate a bracket into a stage (#15): pick the source stage, how many pilots come
   * through, seats per heat and how many advance; see the whole bracket before anything
   * is written; Generate writes it heat by heat with a progress line. Nothing touches
   * RotorHazard until Generate.
   */
  import { Banner, Button, Dialog, Input, Select } from '@gridfpv/components';
  import {
    BracketError,
    describePlan,
    seedLabel,
    singleElimination,
    type BracketPlan
  } from '../lib/bracket.js';
  import {
    generateBracket,
    rh,
    type GenerateProgress,
    type WriteResult
  } from '../lib/rh.svelte.js';
  import { activeSeatIndexes } from '../lib/stages.js';
  import type { RaceClass } from '../lib/setup.js';

  let {
    stage,
    stages,
    onresult,
    onclose
  }: {
    stage: RaceClass;
    /** Stages that can be a source: earlier in the event than `stage`. */
    stages: RaceClass[];
    onresult: (r: WriteResult) => void;
    onclose: () => void;
  } = $props();

  const timer = rh();
  let open = $state(true);
  const seatIndexes = $derived(activeSeatIndexes(timer.seats));
  const sources = $derived(stages.filter((c) => c.id !== stage.id));
  const activePilots = $derived(timer.setup.pilots.filter((p) => p.active).length);
  const existing = $derived(timer.setup.heats.filter((h) => h.classId === stage.id));

  let sourceId = $state('');
  let pilots = $state('');
  let seats = $state('');
  let advance = $state('');
  $effect(() => {
    if (!sourceId && sources.length) sourceId = String(sources[0].id);
  });
  $effect(() => {
    if (!seats && seatIndexes.length) {
      seats = String(Math.min(seatIndexes.length, 4));
      advance = String(Math.max(1, Math.floor(Number(seats) / 2)));
    }
    if (!pilots && activePilots) pilots = String(activePilots);
  });

  const source = $derived(sources.find((c) => String(c.id) === sourceId) ?? null);
  const plan = $derived.by((): { plan: BracketPlan | null; error: string } => {
    try {
      return {
        plan: singleElimination({
          pilots: Number(pilots),
          seats: Number(seats),
          advance: Number(advance)
        }),
        error: ''
      };
    } catch (e) {
      return { plan: null, error: e instanceof BracketError ? e.message : String(e) };
    }
  });
  const seatsTooMany = $derived(Number(seats) > seatIndexes.length);
  const valid = $derived(!!plan.plan && !!source && !seatsTooMany);

  const heatLabel = (p: BracketPlan) => (r: number, h: number) =>
    p.rounds[r].heats[h].name ?? `${p.rounds[r].name} heat ${h + 1}`;

  let busy = $state(false);
  let progress: GenerateProgress | null = $state(null);
  async function generate() {
    if (!valid || !plan.plan || !source) return;
    busy = true;
    try {
      const r = await generateBracket(
        stage.id,
        plan.plan,
        source.id,
        seatIndexes.slice(0, Number(seats)),
        (p) => (progress = p)
      );
      onresult(r);
      if (r.ok) open = false;
    } finally {
      busy = false;
      progress = null;
    }
  }
</script>

<Dialog bind:open title="Generate bracket: {stage.displayName}" {onclose} size="wide">
  <div class="form">
    <div class="row">
      <label class="field grow">
        <span>Seed from</span>
        <Select bind:value={sourceId} disabled={busy}>
          {#each sources as c (c.id)}<option value={String(c.id)}>{c.displayName}</option>{/each}
        </Select>
      </label>
      <label class="field narrow"
        ><span>Pilots</span><Input
          type="number"
          bind:value={pilots}
          min="2"
          max="256"
          disabled={busy}
        /></label
      >
      <label class="field narrow"
        ><span>Per heat</span><Input
          type="number"
          bind:value={seats}
          min="2"
          max={String(seatIndexes.length || 8)}
          disabled={busy}
        /></label
      >
      <label class="field narrow"
        ><span>Advance</span><Input
          type="number"
          bind:value={advance}
          min="1"
          max="7"
          disabled={busy}
        /></label
      >
    </div>
    <small class="muted">
      Single elimination: the top {advance || '…'} of each heat go on, until one heat is left. The first
      round takes the top {pilots || '…'} of {source?.displayName ?? 'the source stage'}
      by its ranking, snake-seeded; later rounds take places from earlier heats. Seats are the
      {seatIndexes.length} with a frequency on the Seats page.
    </small>

    {#if sources.length === 0}
      <Banner tone="warn">There is no earlier stage to seed from. Add qualifying first.</Banner>
    {:else if seatsTooMany}
      <Banner tone="warn"
        >Only {seatIndexes.length} seat{seatIndexes.length === 1 ? ' has' : 's have'} a frequency.</Banner
      >
    {:else if plan.error}
      <Banner tone="warn">{plan.error}</Banner>
    {/if}

    {#if plan.plan && source}
      {@const p = plan.plan}
      {@const label = heatLabel(p)}
      <div class="preview">
        <div class="shape">{describePlan(p)}</div>
        {#each p.rounds as round, r (r)}
          <div class="round">
            <div class="roundname">Round {r + 1} · {round.name}</div>
            <div class="heats">
              {#each round.heats as h, k (k)}
                <div class="heat">
                  <div class="heatname">{h.name ?? `Heat ${k + 1}`}</div>
                  <ol>
                    {#each h.seeds as seed, i (i)}
                      <li class:empty={!seed}>
                        {seed ? seedLabel(seed, source.displayName, label) : '—'}
                      </li>
                    {/each}
                  </ol>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    {#if existing.length}
      <Banner tone="info"
        >The stage's {existing.length} existing heat{existing.length === 1 ? '' : 's'} will be replaced.</Banner
      >
    {/if}
    {#if progress}
      <div class="progress">
        <div class="bar" style="width: {Math.round((100 * progress.done) / progress.total)}%"></div>
        <span>{progress.what} · {progress.done}/{progress.total}</span>
      </div>
    {/if}
  </div>
  {#snippet footer()}
    <Button variant="ghost" disabled={busy} onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" disabled={!valid || busy} onclick={generate}
      >{busy ? 'Generating…' : 'Generate'}</Button
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
    width: 96px;
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
  .preview {
    display: grid;
    gap: var(--gf-space-3);
    padding: var(--gf-space-3);
    background: var(--gf-surface-sunken);
    border-radius: var(--gf-radius-md);
    max-height: 50vh;
    overflow: auto;
  }
  .shape {
    font-weight: 600;
  }
  .roundname {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: var(--gf-space-1);
  }
  .heats {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: var(--gf-space-2);
  }
  .heat {
    background: var(--gf-surface);
    border: 1px solid var(--gf-border);
    border-radius: var(--gf-radius-md);
    padding: var(--gf-space-2);
  }
  .heatname {
    font-weight: 600;
    margin-bottom: 4px;
  }
  ol {
    margin: 0;
    padding-left: 1.4em;
    font-size: var(--gf-font-size-sm);
  }
  li.empty {
    color: var(--gf-text-muted);
  }
  .progress {
    position: relative;
    height: 28px;
    border-radius: var(--gf-radius-md);
    background: var(--gf-surface-sunken);
    overflow: hidden;
    display: flex;
    align-items: center;
    padding: 0 var(--gf-space-2);
    font-size: var(--gf-font-size-sm);
  }
  .progress .bar {
    position: absolute;
    inset: 0 auto 0 0;
    background: color-mix(in srgb, var(--gf-brand-500) 25%, transparent);
    transition: width 0.2s;
  }
  .progress span {
    position: relative;
  }
</style>
