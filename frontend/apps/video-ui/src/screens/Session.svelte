<script lang="ts">
  /** The session: what is running, every run this session knows and where it stands, the log. */
  import { Badge, Banner, Button, Card, Collapsible } from '@gridfpv/components';
  import { api, type Run } from '../lib/api.js';
  import { act, ui } from '../lib/state.svelte.js';

  const snap = $derived(ui.snapshot);
  const running = $derived(snap?.running ?? null);
  const runs = $derived(snap?.runs ?? []);

  const TONE: Record<Run['state'], 'accent' | 'info' | 'warn' | 'neutral' | 'success'> = {
    recording: 'accent',
    tail: 'accent',
    waiting: 'warn',
    saved: 'info',
    rendering: 'info',
    rendered: 'success'
  };
  const LABEL: Record<Run['state'], string> = {
    recording: 'Recording',
    tail: 'Finishing',
    waiting: 'Waiting for the save',
    saved: 'Saved',
    rendering: 'Rendering',
    rendered: 'Rendered'
  };
  const base = (p: string | null | undefined) => (p ? p.split(/[\\/]/).pop() : '');
  const folder = (p: string) => p.replace(/[\\/][^\\/]*$/, '');
  const when = (iso: string | null | undefined) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  const title = (r: Run) =>
    r.name ?? (r.round != null ? `Heat ${r.heat_id} · Round ${r.round}` : `Heat ${r.heat_id}`);

  const logText = $derived(ui.log.map((l) => `${l.at.slice(11, 19)}  ${l.text}`).join('\n'));
  let logOpen = $state(true);
  let logEl = $state<HTMLElement>();
  $effect(() => {
    void logText;
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  });
</script>

{#if !running}
  <Banner tone="info" title="Not watching">
    Pick a profile and press Start. The helper then follows the timer: each run is recorded
    {ui.profiles.find((p) => p.name === ui.lastProfile)?.settings.recordFrom === 'scene'
      ? 'from its clean scene'
      : "by OBS's own recording"}, and the corrected overlay is rendered onto it after every save
    and marshal.
  </Banner>
{:else if snap?.notice}
  <Banner tone="warn">{snap.notice}</Banner>
{/if}

<Card title="Runs" subtitle={running ? `Profile “${running.profile}”` : undefined}>
  {#if !runs.length}
    <p class="muted">
      {running ? 'Nothing recorded yet this session. Stage a race on the timer.' : 'No session.'}
    </p>
  {:else}
    <table class="runs">
      <thead>
        <tr><th>Run</th><th>State</th><th>When</th><th>Files</th><th class="actions-h"></th></tr>
      </thead>
      <tbody>
        {#each runs as r (r.sidecar ?? `live-${r.heat_id}-${r.started_at}`)}
          <tr>
            <td>
              <div class="name">{title(r)}</div>
              {#if r.recording}<div class="muted small">{base(r.recording)}</div>{/if}
            </td>
            <td
              ><Badge tone={TONE[r.state]} dot={r.state === 'recording' || r.state === 'rendering'}
                >{LABEL[r.state]}</Badge
              ></td
            >
            <td class="muted"
              >{when(r.started_at)}{r.rendered_at ? ` · rendered ${when(r.rendered_at)}` : ''}</td
            >
            <td class="files">
              {#each r.files ?? [] as f (f)}<div class="small">{base(f)}</div>{/each}
            </td>
            <td class="actions">
              {#if r.recording}
                <Button
                  size="sm"
                  variant="ghost"
                  onclick={() => act(() => api.open(folder(r.recording!)))}>Open folder</Button
                >
              {/if}
              {#if r.sidecar && r.round != null && r.state !== 'rendering'}
                <Button size="sm" variant="ghost" onclick={() => act(() => api.render(r.sidecar!))}
                  >Render again</Button
                >
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</Card>

<Card>
  <Collapsible title="Log" bind:open={logOpen} headingLevel={2}>
    <pre class="log" bind:this={logEl}>{logText}</pre>
  </Collapsible>
</Card>

<style>
  .muted {
    color: var(--gf-text-muted);
  }
  .small {
    font-size: var(--gf-font-size-xs);
  }
  .runs {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--gf-font-size-sm);
  }
  .runs th {
    text-align: left;
    font-weight: 600;
    color: var(--gf-text-muted);
    font-size: var(--gf-font-size-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0 var(--gf-space-2) var(--gf-space-2) 0;
    border-bottom: 1px solid var(--gf-border-subtle);
  }
  .runs td {
    padding: var(--gf-space-2) var(--gf-space-2) var(--gf-space-2) 0;
    border-bottom: 1px solid var(--gf-border-subtle);
    vertical-align: top;
  }
  .name {
    font-weight: 600;
  }
  .files {
    max-width: 22rem;
    overflow-wrap: anywhere;
  }
  .actions {
    white-space: nowrap;
    text-align: right;
  }
  .log {
    margin: 0;
    max-height: 22rem;
    overflow: auto;
    font-size: var(--gf-font-size-xs);
    line-height: 1.5;
    white-space: pre-wrap;
    color: var(--gf-text-secondary);
  }
</style>
