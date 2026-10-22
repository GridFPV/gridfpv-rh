<script lang="ts">
  /** The public landing: what the plugin reports about this timer, and where to go. */
  import { Badge, Card } from '@gridfpv/components';
  import { rh } from '../lib/rh.svelte.js';
  import { href, link } from '../lib/router.svelte.js';

  const timer = rh();
</script>

<section class="page">
  <Card title="Timer" subtitle="What the plugin reports about this RotorHazard">
    {#if timer.hello}
      <dl class="facts">
        <dt>RotorHazard</dt>
        <dd>{timer.hello.rh_version ?? 'unknown'}</dd>
        <dt>Plugin API</dt>
        <dd>{timer.hello.rhapi_version}</dd>
        <dt>GridFPV plugin</dt>
        <dd>{timer.hello.plugin_version}</dd>
        <dt>Seats</dt>
        <dd>{timer.hello.seat_count}</dd>
        <dt>Home page</dt>
        <dd>
          {#if timer.hello.redirect_home}
            <Badge tone="accent">opens GridFPV</Badge>
          {:else}
            <Badge tone="neutral">RotorHazard's own</Badge>
          {/if}
        </dd>
      </dl>
    {:else if timer.connection === 'connected'}
      <p class="muted">Connected. Waiting for the plugin to answer…</p>
    {:else}
      <p class="muted">Connecting to the timer…</p>
    {/if}
  </Card>

  <Card title="Race director" elevation="xs">
    <p>
      <a href={href('event')} onclick={link}>Event</a> — the event's details, new event, archives.
      <a href={href('seats')} onclick={link}>Seats</a> — channels, profiles and tuning.
      <a href={href('pilots')} onclick={link}>Pilots</a> — the roster.
      <a href={href('teams')} onclick={link}>Teams</a> — named teams, shown in RotorHazard too.
      <a href={href('stages')} onclick={link}>Stages</a> — the day's stages, heats and rounds.
      <a href={href('formats')} onclick={link}>Formats</a> — how a race is run.
      <a href={href('run')} onclick={link}>Run</a> — race day: start, stop, save, seed as you go.
      <a href={href('marshal')} onclick={link}>Marshal</a> — fix laps on the signal trace. These
      need the RotorHazard login. RotorHazard's own pages are still at <a href="/">/</a>.
    </p>
  </Card>
</section>

<style>
  .page {
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
  p {
    margin: 0;
  }
</style>
