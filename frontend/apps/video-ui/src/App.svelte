<script lang="ts">
  /**
   * GridFPV Video — the helper's window (#99). A header with the profile in use, Start/Stop,
   * and the two connections; then the session (runs and log) or the profiles.
   */
  import { onMount } from 'svelte';
  import { Button, Select, StatusPill, Tabs } from '@gridfpv/components';
  import { api } from './lib/api.js';
  import { act, connect, loadProfiles, ui } from './lib/state.svelte.js';
  import Session from './screens/Session.svelte';
  import Profiles from './screens/Profiles.svelte';

  let tab = $state<'session' | 'profiles'>('session');
  let chosen = $state<string>('');

  onMount(() => {
    const off = connect();
    void loadProfiles().then(() => {
      if (!chosen)
        chosen = ui.snapshot?.running?.profile ?? ui.lastProfile ?? ui.profiles[0]?.name ?? '';
      if (!ui.profiles.length) tab = 'profiles';
    });
    return off;
  });

  const snap = $derived(ui.snapshot);
  const running = $derived(snap?.running ?? null);
  $effect(() => {
    if (running?.profile) chosen = running.profile;
  });

  const timerPill = $derived(
    !running
      ? { status: 'idle', label: 'Timer' }
      : snap!.status.timer.synced
        ? { status: 'live', label: 'Timer synced' }
        : snap!.status.timer.connected
          ? { status: 'connecting', label: 'Timer syncing' }
          : { status: 'reconnecting', label: 'Timer offline' }
  );
  const obsPill = $derived(
    !running
      ? { status: 'idle', label: 'OBS' }
      : snap!.status.obs.connected
        ? running.recordFrom === 'scene' && snap!.status.obs.sourceRecord === false
          ? { status: 'reconnecting', label: 'OBS — no Source Record plugin' }
          : { status: 'live', label: `OBS ${snap!.status.obs.version || ''}`.trim() }
        : { status: 'reconnecting', label: 'OBS offline' }
  );

  async function startStop() {
    if (running) await act(() => api.stop());
    else if (chosen) {
      const ok = await act(() => api.start(chosen));
      if (ok) tab = 'session';
    }
  }
</script>

<div class="shell">
  <header class="top">
    <div class="brand">
      <svg class="mark" viewBox="20 20 60 60" role="img" aria-label="GridFPV">
        <path
          d="M71 33 H40 Q31 33 31 42 V58 Q31 67 40 67 H60 Q69 67 69 58 V51 H53"
          fill="none"
          stroke="var(--gf-brand-500)"
          stroke-width="10"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <div>
        <div class="word">GridFPV Video</div>
        <div class="sub">{snap?.version ? `v${snap.version}` : 'helper'}</div>
      </div>
    </div>
    <div class="controls">
      <label class="pick">
        <span class="sr-only">Profile</span>
        <Select
          size="sm"
          value={chosen}
          disabled={Boolean(running) || ui.busy}
          aria-label="Profile"
          onchange={(e: Event) => (chosen = (e.currentTarget as HTMLSelectElement).value)}
        >
          {#if !ui.profiles.length}<option value="">No profile yet</option>{/if}
          {#each ui.profiles as p (p.name)}
            <option value={p.name}>{p.name}</option>
          {/each}
        </Select>
      </label>
      <Button
        size="sm"
        variant={running ? 'secondary' : 'primary'}
        disabled={ui.busy || (!running && !chosen)}
        loading={ui.busy}
        onclick={startStop}>{running ? 'Stop' : 'Start'}</Button
      >
    </div>
    <div class="pills">
      <StatusPill size="sm" status={timerPill.status} label={timerPill.label} />
      <StatusPill size="sm" status={obsPill.status} label={obsPill.label} />
      {#if ui.link !== 'live'}
        <StatusPill
          size="sm"
          status="reconnecting"
          label={ui.link === 'lost' ? 'Helper lost' : 'Connecting'}
        />
      {/if}
    </div>
  </header>

  <Tabs
    items={[
      { id: 'session', label: 'Session' },
      { id: 'profiles', label: 'Profiles' }
    ]}
    value={tab}
    ariaLabel="Pages"
    onchange={(id) => (tab = id as typeof tab)}
  />

  {#if ui.error}
    <p class="error" role="alert">{ui.error}</p>
  {/if}

  <main>
    {#if tab === 'session'}
      <Session />
    {:else}
      <Profiles bind:chosen />
    {/if}
  </main>
</div>

<style>
  .shell {
    max-width: 1120px;
    margin: 0 auto;
    padding: var(--gf-space-4) var(--gf-space-4) var(--gf-space-8);
    display: grid;
    gap: var(--gf-space-4);
  }
  .top {
    display: flex;
    align-items: center;
    gap: var(--gf-space-4);
    flex-wrap: wrap;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: var(--gf-space-2);
  }
  .mark {
    width: 40px;
    height: 40px;
  }
  .word {
    font-weight: 700;
    font-size: var(--gf-font-size-lg);
    letter-spacing: 0.02em;
  }
  .sub {
    font-size: var(--gf-font-size-xs);
    color: var(--gf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: var(--gf-space-2);
    margin-left: auto;
  }
  .pick {
    min-width: 14rem;
  }
  .pills {
    display: flex;
    gap: var(--gf-space-2);
    flex-wrap: wrap;
  }
  .error {
    margin: 0;
    color: var(--gf-danger);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
