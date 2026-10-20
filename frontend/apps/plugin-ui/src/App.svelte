<script lang="ts">
  /**
   * Phase 0 shell: proves the SPA serves from inside RotorHazard and talks to the plugin
   * over socket.io. Screens come in later phases; this stays the app frame.
   */
  import { onMount } from 'svelte';
  import { Badge, Card, StatusPill } from '@gridfpv/components';
  import { connect, rh } from './lib/rh.svelte.js';

  let { autoconnect = true }: { autoconnect?: boolean } = $props();

  const state = rh();

  onMount(() => {
    if (autoconnect) connect();
  });

  const pillStatus = $derived(
    state.connection === 'connected'
      ? 'live'
      : state.connection === 'connecting'
        ? 'connecting'
        : 'reconnecting'
  );
  const pillLabel = $derived(
    state.connection === 'connected'
      ? 'Connected'
      : state.connection === 'connecting'
        ? 'Connecting'
        : 'Disconnected'
  );
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
        <div class="word">GridFPV</div>
        <div class="sub">for RotorHazard</div>
      </div>
    </div>
    <StatusPill status={pillStatus} label={pillLabel} />
  </header>

  <main>
    <Card title="Timer" subtitle="What the plugin reports about this RotorHazard">
      {#if state.hello}
        <dl class="facts">
          <dt>RotorHazard</dt>
          <dd>{state.hello.rh_version ?? 'unknown'}</dd>
          <dt>Plugin API</dt>
          <dd>{state.hello.rhapi_version}</dd>
          <dt>GridFPV plugin</dt>
          <dd>{state.hello.plugin_version}</dd>
          <dt>Seats</dt>
          <dd>{state.hello.seat_count}</dd>
          <dt>Home page</dt>
          <dd>
            {#if state.hello.redirect_home}
              <Badge tone="accent">opens GridFPV</Badge>
            {:else}
              <Badge tone="neutral">RotorHazard's own</Badge>
            {/if}
          </dd>
        </dl>
      {:else if state.connection === 'connected'}
        <p class="muted">Connected. Waiting for the plugin to answer…</p>
      {:else}
        <p class="muted">Connecting to the timer…</p>
      {/if}
    </Card>

    <Card title="What's here" elevation="xs">
      <p>
        This is the Phase 0 shell. Tuning and Marshal screens land next; until then RotorHazard's
        own pages are at <a href="/">/</a>.
      </p>
    </Card>
  </main>
</div>

<style>
  .shell {
    max-width: 960px;
    margin: 0 auto;
    padding: var(--gf-space-4) var(--gf-space-4) var(--gf-space-8);
    display: grid;
    gap: var(--gf-space-4);
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gf-space-3);
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
  main {
    display: grid;
    gap: var(--gf-space-3);
  }
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--gf-space-1) var(--gf-space-4);
    margin: 0;
  }
  dt {
    color: var(--gf-text-muted);
  }
  dd {
    margin: 0;
  }
  .muted {
    color: var(--gf-text-muted);
    margin: 0;
  }
</style>
