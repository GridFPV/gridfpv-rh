<script lang="ts">
  /**
   * Edit a race format: how one race is run. Grouped the way a director thinks about it —
   * the clock, how a winner is decided, the start sequence, team mode — with RotorHazard's
   * settings behind each control (RHData.alter_raceFormat). Save writes the changed fields
   * with readback; RotorHazard refuses a change while a race is running, and the readback
   * says so. With `createFrom`, the format is a draft: Save first copies that format
   * (RotorHazard's only way to add one) and then writes the name and changes onto the
   * copy; a copy that cannot be filled in is deleted again, so Cancel never leaves one.
   */
  import { untrack } from 'svelte';
  import { Button, Dialog, Input, Select } from '@gridfpv/components';
  import {
    addFormat,
    alterFormat,
    deleteFormat,
    type FormatFields,
    type WriteResult
  } from '../lib/rh.svelte.js';
  import {
    RACING_MODE,
    RACING_MODE_LABELS,
    STAGING_TONES_LABELS,
    START_BEHAVIOR_LABELS,
    WIN_CONDITION,
    WIN_CONDITION_LABELS,
    type RaceFormat
  } from '../lib/setup.js';

  let {
    open = $bindable(false),
    format,
    pointsMethods,
    title = 'Edit format',
    createFrom = null,
    onresult,
    onclose = undefined
  }: {
    open?: boolean;
    format: RaceFormat;
    pointsMethods: Array<{ name: string; label: string }>;
    title?: string;
    /** Create mode: the id of the format to copy on Save. */
    createFrom?: number | null;
    onresult: (r: WriteResult) => void;
    onclose?: () => void;
  } = $props();

  // Form state as strings (inputs), converted on save.
  let f = $state(untrack(() => fromFormat(format)));
  function fromFormat(x: RaceFormat) {
    return {
      name: x.name,
      timed: !x.unlimitedTime,
      minutes: String(Math.floor(x.raceTimeSec / 60)),
      seconds: String(x.raceTimeSec % 60),
      graceMode: x.lapGraceSec < 0 ? 'manual' : x.lapGraceSec === 0 ? 'stop' : 'finish',
      graceSec: String(x.lapGraceSec > 0 ? x.lapGraceSec : 30),
      winCondition: String(x.winCondition),
      laps: String(x.numberLapsWin),
      prestage: String(x.stagingFixedTones),
      minStaging: String(x.startDelayMin / 1000),
      randomStaging: String(x.startDelayMax / 1000),
      stagingTones: String(x.stagingDelayTones),
      startBehavior: String(x.startBehavior),
      team: String(x.teamRacingMode),
      points: x.pointsMethod ?? ''
    };
  }
  // Reset the form when the dialog opens or is pointed at another format — not on every
  // readback of the same format, or a late `format_data` would wipe what is being typed.
  let formFor = untrack(() => (open ? format.id : null));
  $effect(() => {
    const id = open ? format.id : null;
    if (id !== formFor) {
      formFor = id;
      if (id != null) f = fromFormat(format);
    }
  });

  const raceTimeSec = $derived(
    Math.max(0, Number(f.minutes) || 0) * 60 + Math.max(0, Number(f.seconds) || 0)
  );
  const needsLaps = $derived(Number(f.winCondition) === WIN_CONDITION.FIRST_TO_LAP_X);
  /** RotorHazard's lap_grace_sec: -1 stop manually, 0 stop at once, N seconds to finish the lap. */
  const grace = $derived(
    f.graceMode === 'manual'
      ? -1
      : f.graceMode === 'stop'
        ? 0
        : Math.max(1, Math.floor(Number(f.graceSec) || 0))
  );

  const fields = $derived.by((): FormatFields => {
    const out: FormatFields = {};
    const name = f.name.trim();
    if (name && name !== format.name) out.name = name;
    if (f.timed === format.unlimitedTime) out.unlimitedTime = !f.timed;
    if (f.timed && raceTimeSec !== format.raceTimeSec) out.raceTimeSec = raceTimeSec;
    if (f.timed && grace !== format.lapGraceSec) out.lapGraceSec = grace;
    const win = Number(f.winCondition);
    if (win !== format.winCondition) out.winCondition = win;
    const laps = needsLaps ? Math.max(1, Number(f.laps) || 1) : 0;
    if (laps !== format.numberLapsWin) out.numberLapsWin = laps;
    const pre = Math.max(0, Math.floor(Number(f.prestage) || 0));
    if (pre !== format.stagingFixedTones) out.stagingFixedTones = pre;
    const min = Math.round(Math.max(0, Number(f.minStaging) || 0) * 1000);
    if (min !== format.startDelayMin) out.startDelayMin = min;
    const rnd = Math.round(Math.max(0, Number(f.randomStaging) || 0) * 1000);
    if (rnd !== format.startDelayMax) out.startDelayMax = rnd;
    const tones = Number(f.stagingTones);
    if (tones !== format.stagingDelayTones) out.stagingDelayTones = tones;
    const sb = Number(f.startBehavior);
    if (sb !== format.startBehavior) out.startBehavior = sb;
    const team = Number(f.team);
    if (team !== format.teamRacingMode) out.teamRacingMode = team;
    if ((f.points || null) !== (format.pointsMethod || null)) out.pointsMethod = f.points || null;
    return out;
  });
  const dirty = $derived(Object.keys(fields).length > 0 || createFrom != null);
  const valid = $derived(!!f.name.trim() && (!f.timed || raceTimeSec > 0));

  let busy = $state(false);
  async function save() {
    if (!valid || !dirty) return;
    busy = true;
    try {
      if (createFrom != null) {
        const made = await addFormat(createFrom);
        if (!made.ok || made.id == null) {
          onresult(made);
          return;
        }
        const r = await alterFormat(made.id, { ...fields, name: f.name.trim() });
        if (!r.ok) await deleteFormat(made.id);
        onresult(r);
        if (r.ok) open = false;
        return;
      }
      const r = await alterFormat(format.id, fields);
      onresult(r);
      if (r.ok) open = false;
    } finally {
      busy = false;
    }
  }
</script>

<Dialog bind:open {title} {onclose} size="wide">
  <div class="form">
    <label class="field">
      <span>Name</span>
      <Input bind:value={f.name} maxlength="80" />
    </label>

    <fieldset>
      <legend>Clock</legend>
      <div class="row">
        <label class="radio"
          ><input type="radio" bind:group={f.timed} value={true} /> Fixed time, counting down</label
        >
        <label class="radio"
          ><input type="radio" bind:group={f.timed} value={false} /> No time limit, counting up</label
        >
      </div>
      {#if f.timed}
        <div class="row">
          <label class="field narrow"
            ><span>Minutes</span><Input
              type="number"
              bind:value={f.minutes}
              min="0"
              max="60"
            /></label
          >
          <label class="field narrow"
            ><span>Seconds</span><Input
              type="number"
              bind:value={f.seconds}
              min="0"
              max="59"
            /></label
          >
        </div>
        <div class="grace">
          <span class="label">Grace window, when time runs out</span>
          <label class="radio"
            ><input type="radio" bind:group={f.graceMode} value="stop" /> Stop at once</label
          >
          <label class="radio">
            <input type="radio" bind:group={f.graceMode} value="finish" /> Finish the lap, up to
            <span class="secs"
              ><Input
                type="number"
                bind:value={f.graceSec}
                min="1"
                max="600"
                disabled={f.graceMode !== 'finish'}
              /></span
            >
            s
          </label>
          <label class="radio"
            ><input type="radio" bind:group={f.graceMode} value="manual" /> Keep running until stopped
            manually</label
          >
        </div>
      {/if}
    </fieldset>

    <fieldset>
      <legend>Winner</legend>
      <div class="row">
        <label class="field grow">
          <span>Decided by</span>
          <Select bind:value={f.winCondition}>
            {#each Object.entries(WIN_CONDITION_LABELS) as [v, l] (v)}<option value={v}>{l}</option
              >{/each}
          </Select>
        </label>
        {#if needsLaps}
          <label class="field narrow"
            ><span>Laps</span><Input type="number" bind:value={f.laps} min="1" max="99" /></label
          >
        {/if}
      </div>
      <div class="row">
        <label class="field grow">
          <span>Racing mode</span>
          <Select bind:value={f.team}>
            {#each Object.entries(RACING_MODE_LABELS) as [v, l] (v)}<option value={v}>{l}</option
              >{/each}
          </Select>
        </label>
        <label class="field grow">
          <span>Points</span>
          <Select bind:value={f.points}>
            <option value="">None</option>
            {#each pointsMethods as m (m.name)}<option value={m.name}>{m.label}</option>{/each}
          </Select>
        </label>
      </div>
      {#if Number(f.team) === RACING_MODE.TEAM}
        <small class="muted"
          >Team racing scores by the pilots' teams (set on the Pilots page).</small
        >
      {/if}
    </fieldset>

    <fieldset>
      <legend>Start</legend>
      <div class="row">
        <label class="field narrow"
          ><span>Prestage tones</span><Input
            type="number"
            bind:value={f.prestage}
            min="0"
            max="10"
          /></label
        >
        <label class="field narrow"
          ><span>Min staging (s)</span><Input
            type="number"
            bind:value={f.minStaging}
            min="0"
            max="30"
            step="0.1"
          /></label
        >
        <label class="field narrow"
          ><span>+ random up to (s)</span><Input
            type="number"
            bind:value={f.randomStaging}
            min="0"
            max="30"
            step="0.1"
          /></label
        >
        <label class="field grow">
          <span>Tones while staging</span>
          <Select bind:value={f.stagingTones}>
            {#each Object.entries(STAGING_TONES_LABELS) as [v, l] (v)}<option value={v}>{l}</option
              >{/each}
          </Select>
        </label>
      </div>
      <label class="field">
        <span>First gate pass</span>
        <Select bind:value={f.startBehavior}>
          {#each Object.entries(START_BEHAVIOR_LABELS) as [v, l] (v)}<option value={v}>{l}</option
            >{/each}
        </Select>
      </label>
      <small class="muted">
        One prestage tone sounds per second; then the staging wait, which hides the countdown when a
        random part is set, so pilots can't anticipate the start.
      </small>
    </fieldset>
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" disabled={!valid || !dirty || busy} onclick={save}>Save</Button>
  {/snippet}
</Dialog>

<style>
  .form {
    display: grid;
    gap: var(--gf-space-3);
  }
  fieldset {
    border: 1px solid var(--gf-border);
    border-radius: var(--gf-radius-md);
    padding: var(--gf-space-2) var(--gf-space-3) var(--gf-space-3);
    display: grid;
    gap: var(--gf-space-2);
    margin: 0;
  }
  legend {
    padding: 0 var(--gf-space-1);
    color: var(--gf-text-muted);
    font-size: var(--gf-font-size-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
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
    min-width: 200px;
  }
  .field.narrow {
    width: 120px;
  }
  .field > span {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .radio {
    display: flex;
    align-items: center;
    gap: var(--gf-space-1);
  }
  .grace {
    display: grid;
    gap: var(--gf-space-1);
  }
  .grace .label {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .secs :global(.gf-input) {
    width: 72px;
  }
  .muted {
    color: var(--gf-text-muted);
  }
</style>
