<script lang="ts">
  /** The app frame: brand, nav, connection pill, and the route switch. */
  import { onMount } from 'svelte';
  import { StatusPill } from '@gridfpv/components';
  import { connect, rh } from './lib/rh.svelte.js';
  import { href, link, route } from './lib/router.svelte.js';
  import Home from './screens/Home.svelte';
  import Event from './screens/Event.svelte';
  import Seats from './screens/Seats.svelte';
  import Pilots from './screens/Pilots.svelte';
  import Stages from './screens/Stages.svelte';
  import Teams from './screens/Teams.svelte';
  import Formats from './screens/Formats.svelte';
  import Run from './screens/Run.svelte';
  import Marshal from './screens/Marshal.svelte';

  let { autoconnect = true }: { autoconnect?: boolean } = $props();

  const timer = rh();

  onMount(() => {
    if (autoconnect) connect();
  });

  const pillStatus = $derived(
    timer.connection === 'connected'
      ? 'live'
      : timer.connection === 'connecting'
        ? 'connecting'
        : 'reconnecting'
  );
  const pillLabel = $derived(
    timer.connection === 'connected'
      ? 'Connected'
      : timer.connection === 'connecting'
        ? 'Connecting'
        : 'Disconnected'
  );

  const current = $derived(route());
  const tuneMatch = $derived(/^seats\/(\d+)$/.exec(current));
  const NAV = [
    { path: '', label: 'Home' },
    { path: 'event', label: 'Event' },
    { path: 'seats', label: 'Seats' },
    { path: 'pilots', label: 'Pilots' },
    { path: 'teams', label: 'Teams' },
    { path: 'stages', label: 'Stages' },
    { path: 'formats', label: 'Formats' },
    { path: 'run', label: 'Run' },
    { path: 'marshal', label: 'Marshal' }
  ];
  const active = (path: string) =>
    path === '' ? current === '' : current === path || current.startsWith(path + '/');
</script>

<div class="shell">
  <header class="top">
    <a class="brand" href={href('')} onclick={link}>
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
    </a>
    <nav>
      {#each NAV as item (item.path)}
        <a href={href(item.path)} onclick={link} class:active={active(item.path)}>{item.label}</a>
      {/each}
    </nav>
    <StatusPill status={pillStatus} label={pillLabel} />
  </header>

  <main>
    {#if current === ''}
      <Home />
    {:else if current === 'event'}
      <Event />
    {:else if current === 'seats' || tuneMatch}
      <Seats />
    {:else if current === 'pilots'}
      <Pilots />
    {:else if current === 'stages' || current === 'heats'}
      <Stages />
    {:else if current === 'teams'}
      <Teams />
    {:else if current === 'formats'}
      <Formats />
    {:else if current === 'run'}
      <Run />
    {:else if current === 'marshal'}
      <Marshal />
    {:else}
      <p class="muted">
        Nothing at <code>/grid/{current}</code>. <a href={href('')} onclick={link}>Home</a>.
      </p>
    {/if}
  </main>
</div>

<style>
  .shell {
    max-width: 1200px;
    margin: 0 auto;
    padding: var(--gf-space-4) var(--gf-space-4) var(--gf-space-8);
    display: grid;
    gap: var(--gf-space-4);
  }
  .top {
    display: flex;
    align-items: center;
    gap: var(--gf-space-4);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: var(--gf-space-2);
    text-decoration: none;
    color: inherit;
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
  nav {
    display: flex;
    gap: var(--gf-space-1);
    margin-right: auto;
  }
  nav a {
    padding: var(--gf-space-1) var(--gf-space-3);
    border-radius: var(--gf-radius-md);
    text-decoration: none;
    color: var(--gf-text-muted);
  }
  nav a.active {
    color: var(--gf-text);
    background: var(--gf-surface);
  }
  .muted {
    color: var(--gf-text-muted);
  }
</style>
