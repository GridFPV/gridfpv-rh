<script lang="ts">
  /**
   * Overlays (#12): where the race director finds the OBS browser-source pages. For each
   * overlay: what it shows, a contrast picker (the URL carries the choice), the URL to
   * paste into OBS with a copy button, an open link, and a live preview — the real page in
   * a frame over a dark backdrop standing in for the video, so what you see here is what
   * the stream gets.
   */
  import { Button, Card, Collapsible, Input, Select } from '@gridfpv/components';
  import {
    OVERLAY_CATALOG,
    overlayUrl,
    type OverlayName,
    type OverlayTheme
  } from '../lib/overlay.js';
  import { replayQuery } from '../lib/replay.js';
  import { rh, saveOverlayPlacement } from '../lib/rh.svelte.js';
  import {
    CORNER_LABELS,
    CORNERS,
    DEFAULT_PLACEMENT,
    OPACITY_MAX,
    OPACITY_MIN,
    SCALE_MAX,
    SCALE_MIN,
    type Corner
  } from '../lib/overlayPlacement.js';
  import { BASE } from '../lib/router.svelte.js';

  let themes = $state<Record<OverlayName, OverlayTheme>>({ race: 'dark' });
  let copied: OverlayName | null = $state(null);
  let copyFailed: OverlayName | null = $state(null);
  let copyTimer = 0;

  const urlFor = (name: OverlayName) => overlayUrl(window.location.origin, name, themes[name]);

  /**
   * The preview is the real page laid out at the stream's size — 1920×1080 for now (#97) —
   * and scaled down to fit its box, so the panel is as big against the frame as it is on
   * the stream. The box's width sets the scale.
   */
  const FRAME = { width: 1920, height: 1080 };
  let previewWidth = $state(0);
  const previewScale = $derived(previewWidth > 0 ? previewWidth / FRAME.width : 1);

  // ---- placement (#96): where the panel sits, for the live page, the replay and every render ----
  const timer = rh();
  const placement = $derived(timer.overlayPlacement);
  let placing = $state(false);
  let placeNote = $state('');
  async function place(fields: Partial<typeof placement>) {
    placing = true;
    try {
      const r = await saveOverlayPlacement(fields);
      placeNote = r.ok ? '' : (r.message ?? 'RotorHazard did not confirm the change.');
    } finally {
      placing = false;
    }
  }
  const num = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);

  // ---- replay (#96): the race overlay drawn from a saved race at a chosen moment ----
  /** Every saved race, newest first: "heat · Round N · when". */
  const savedRaces = $derived(
    timer.marshal.raceList
      .flatMap((h) => h.rounds.map((r) => ({ heat: h, round: r })))
      .sort((a, b) => b.round.startTime - a.round.startTime)
  );
  let replayPick: string = $state('');
  const replayRace = $derived(
    savedRaces.find((x) => `${x.heat.heatId}:${x.round.round}` === replayPick) ?? savedRaces[0]
  );
  let replaySeconds = $state('0');
  /** The companion's Windows zip, shipped inside the plugin (#96). */
  const downloadUrl = `${BASE}/downloads/gridfpv-video-win64.zip`;
  /** The desktop helper's installer (#99) is built per platform by GitHub Actions, so it lives on the releases page. */
  const releasesUrl = 'https://github.com/GridFPV/gridfpv-rh/releases';
  const replayUrl = $derived(
    replayRace
      ? overlayUrl(window.location.origin, 'race', themes.race) +
          replayQuery({
            heatId: replayRace.heat.heatId,
            round: replayRace.round.round,
            t: Math.round((Number(replaySeconds) || 0) * 1000)
          })
      : ''
  );

  async function copy(name: OverlayName) {
    window.clearTimeout(copyTimer);
    copied = null;
    copyFailed = null;
    try {
      await navigator.clipboard.writeText(urlFor(name));
      copied = name;
    } catch {
      // The Clipboard API needs a secure context; over plain LAN HTTP it throws. The URL
      // sits in a selectable box right there, so say so rather than fail silently.
      copyFailed = name;
    }
    copyTimer = window.setTimeout(() => ((copied = null), (copyFailed = null)), 3000);
  }
</script>

<section class="page">
  <p class="intro">
    Overlays are pages you put on top of your video in OBS. Each one follows whatever is on the
    timer right now and only reads: closing OBS never touches a race. In OBS add a
    <strong>Browser</strong> source, paste the URL, and set its width and height to your video's. The
    background is see-through, and the page needs no login, so the URL works from any computer on the
    timer's network — at home or on the field hotspot.
  </p>

  {#each OVERLAY_CATALOG as info (info.name)}
    {@const url = urlFor(info.name)}
    <Card title={info.title}>
      <div class="overlay">
        <div class="controls">
          <p class="muted">{info.description}</p>
          <div class="pick" role="radiogroup" aria-label="{info.title} colors">
            <button
              type="button"
              class="opt"
              role="radio"
              aria-checked={themes[info.name] === 'dark'}
              onclick={() => (themes[info.name] = 'dark')}>Light text on dark</button
            >
            <button
              type="button"
              class="opt"
              role="radio"
              aria-checked={themes[info.name] === 'light'}
              onclick={() => (themes[info.name] = 'light')}>Dark text on light</button
            >
          </div>
          {#if info.name === 'race'}
            <fieldset class="placement" aria-label="Placement">
              <legend>Placement — the same on the stream, in the replay and in every render</legend>
              <div class="pick" role="radiogroup" aria-label="Corner">
                {#each CORNERS as c (c)}
                  <button
                    type="button"
                    class="opt"
                    role="radio"
                    aria-checked={placement.corner === c}
                    disabled={placing}
                    onclick={() => place({ corner: c as Corner })}>{CORNER_LABELS[c]}</button
                  >
                {/each}
              </div>
              <div class="placerow">
                <label class="field">
                  <span>In from the side (px)</span>
                  <Input
                    type="number"
                    min="0"
                    max="4000"
                    value={String(placement.x)}
                    aria-label="In from the side"
                    disabled={placing}
                    onchange={(e: Event) => place({ x: num(e) })}
                  />
                </label>
                <label class="field">
                  <span>In from the top or bottom (px)</span>
                  <Input
                    type="number"
                    min="0"
                    max="4000"
                    value={String(placement.y)}
                    aria-label="In from the top or bottom"
                    disabled={placing}
                    onchange={(e: Event) => place({ y: num(e) })}
                  />
                </label>
                <label class="field">
                  <span>Size (%)</span>
                  <Input
                    type="number"
                    min={String(SCALE_MIN)}
                    max={String(SCALE_MAX)}
                    step="5"
                    value={String(placement.scale)}
                    aria-label="Size"
                    disabled={placing}
                    onchange={(e: Event) => place({ scale: num(e) })}
                  />
                </label>
                <input
                  class="slider"
                  type="range"
                  min={SCALE_MIN}
                  max={SCALE_MAX}
                  step="5"
                  value={placement.scale}
                  aria-label="Size slider"
                  disabled={placing}
                  onchange={(e: Event) => place({ scale: num(e) })}
                />
              </div>
              <div class="placerow">
                <label class="field">
                  <span>Background (%)</span>
                  <Input
                    type="number"
                    min={String(OPACITY_MIN)}
                    max={String(OPACITY_MAX)}
                    step="5"
                    value={String(placement.opacity)}
                    aria-label="Background"
                    disabled={placing}
                    onchange={(e: Event) => place({ opacity: num(e) })}
                  />
                </label>
                <input
                  class="slider"
                  type="range"
                  min={OPACITY_MIN}
                  max={OPACITY_MAX}
                  step="5"
                  value={placement.opacity}
                  aria-label="Background slider"
                  disabled={placing}
                  onchange={(e: Event) => place({ opacity: num(e) })}
                />
                <button
                  type="button"
                  class="linkish"
                  disabled={placing}
                  onclick={() => place({ ...DEFAULT_PLACEMENT })}>Reset</button
                >
              </div>
              {#if placeNote}<p class="muted" role="alert">{placeNote}</p>{/if}
            </fieldset>
          {/if}
          <code class="url" aria-label="{info.title} URL">{url}</code>
          <div class="actions">
            <Button size="sm" variant="secondary" onclick={() => copy(info.name)}>Copy URL</Button>
            <a class="open" href={url} target="_blank" rel="noopener">Open in a new tab</a>
            {#if copied === info.name}<span class="muted">Copied.</span>{/if}
            {#if copyFailed === info.name}<span class="muted"
                >Couldn't copy here — select the URL and copy it.</span
              >{/if}
          </div>
        </div>
        <div class="previewcol">
          <div class="preview" aria-label="{info.title} preview" bind:clientWidth={previewWidth}>
            <iframe
              class="frame"
              title="{info.title} preview"
              src={url}
              tabindex="-1"
              style="width: {FRAME.width}px; height: {FRAME.height}px; transform: scale({previewScale});"
            ></iframe>
          </div>
          <p class="muted framenote">Shown at {FRAME.width}×{FRAME.height}, scaled to fit.</p>
        </div>
      </div>
    </Card>
  {/each}

  <Card>
    <Collapsible title="Replay" open={false} headingLevel={2} id="overlays-replay">
      <div class="controls">
        <p class="muted">
          The race overlay drawn from a <strong>saved</strong> race — the laps as they stand after
          marshalling — at a moment you choose, instead of from the timer. It is the page the video
          re-render (#96) screenshots frame by frame, and a way to check a frame by eye: the URL
          opens on race time <code>t</code> (milliseconds from the start signal; negative is
          staging), and
          <code>end</code> is where the clock freezes. The colors follow the race overlay's choice above.
        </p>
        {#if savedRaces.length === 0}
          <p class="muted">No saved races yet.</p>
        {:else if replayRace}
          <div class="replayrow">
            <label class="field">
              <span>Saved race</span>
              <Select
                size="sm"
                aria-label="Saved race"
                value={`${replayRace.heat.heatId}:${replayRace.round.round}`}
                onchange={(e: Event) => (replayPick = (e.currentTarget as HTMLSelectElement).value)}
              >
                {#each savedRaces as x (`${x.heat.heatId}:${x.round.round}`)}
                  <option value={`${x.heat.heatId}:${x.round.round}`}
                    >{x.heat.name} · Round {x.round.round} · {x.round.startTimeFormatted}</option
                  >
                {/each}
              </Select>
            </label>
            <label class="field">
              <span>Seconds into the race</span>
              <Input
                type="number"
                step="0.1"
                bind:value={replaySeconds}
                aria-label="Seconds into the race"
              />
            </label>
          </div>
          <code class="url" aria-label="Replay URL">{replayUrl}</code>
          <div class="actions">
            <a class="open" href={replayUrl} target="_blank" rel="noopener">Open in a new tab</a>
          </div>
        {/if}
      </div>
    </Collapsible>
  </Card>

  <Card>
    <Collapsible title="Video companion" open={false} headingLevel={2} id="overlays-companion">
      <div class="controls">
        <p class="muted">
          The program for the <strong>OBS machine</strong> that records each run clean, and puts the corrected
          overlay on the recording after every save and marshal — the finished file just appears. It carries
          everything it needs; ffmpeg is fetched once on first run. Two forms of the same program:
        </p>
        <div class="actions">
          <a class="download" href={releasesUrl} target="_blank" rel="noopener"
            >GridFPV Video for Windows (installer, from the releases page)</a
          >
          <a class="download" href={downloadUrl} download
            >Console companion (zip, inside this plugin)</a
          >
          <span class="muted">gridfpv-video {timer.hello?.plugin_version ?? ''}</span>
        </div>
        <ol class="steps">
          <li>
            <strong>The window</strong> (GridFPV Video): install it, make a profile — the timer's
            address is
            <code>{window.location.origin}</code> — with the RotorHazard login and the OBS password, choose
            what records each run (OBS's own recording, or a clean scene through the Source Record filter
            while OBS streams and records the whole day), press Start. Profiles are kept per event.
          </li>
          <li>
            <strong>The console zip</strong>: unzip anywhere, e.g. <code>C:\gridfpv-video</code>;
            double-click <code>gridfpv-video.cmd</code> and answer three questions, or run
            <code>gridfpv-video.cmd ui</code> for the same window in your browser.
          </li>
          <li>
            Either way, in OBS: Tools → WebSocket Server Settings → enable the server and set a
            password. Record the clean capture (no overlay in the recorded scene).
          </li>
        </ol>
      </div>
    </Collapsible>
  </Card>
</section>

<style>
  .page {
    display: grid;
    gap: var(--gf-space-3);
  }
  .intro {
    margin: 0;
    color: var(--gf-text-muted);
    max-width: 60rem;
  }
  .muted {
    margin: 0;
    color: var(--gf-text-muted);
    font-size: var(--gf-font-size-sm);
  }
  .overlay {
    display: grid;
    grid-template-columns: minmax(18rem, 1fr) minmax(20rem, 1.4fr);
    gap: var(--gf-space-5);
    align-items: start;
  }
  @media (max-width: 70rem) {
    .overlay {
      grid-template-columns: 1fr;
    }
  }
  .controls {
    display: flex;
    flex-direction: column;
    gap: var(--gf-space-3);
  }
  .download {
    font-weight: 600;
  }
  .steps {
    margin: 0;
    padding-left: 1.25rem;
    color: var(--gf-text-muted);
    font-size: var(--gf-font-size-sm);
    display: grid;
    gap: var(--gf-space-1);
  }
  .placement {
    border: 1px solid var(--gf-border);
    border-radius: var(--gf-radius-sm);
    padding: var(--gf-space-2) var(--gf-space-3) var(--gf-space-3);
    display: grid;
    gap: var(--gf-space-2);
  }
  .placement legend {
    font-size: var(--gf-font-size-sm);
    color: var(--gf-text-muted);
    padding: 0 var(--gf-space-1);
  }
  .placerow {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gf-space-3);
    align-items: end;
  }
  .placerow .field {
    min-width: 9rem;
  }
  .slider {
    flex: 1 1 10rem;
    align-self: center;
  }
  .linkish {
    appearance: none;
    border: 0;
    background: none;
    padding: 0;
    color: var(--gf-brand-500);
    font: inherit;
    font-size: var(--gf-font-size-sm);
    cursor: pointer;
    text-decoration: underline;
  }
  .replayrow {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gf-space-3);
    align-items: end;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--gf-space-1);
    font-size: var(--gf-font-size-sm);
    color: var(--gf-text-muted);
    min-width: 12rem;
  }
  .pick {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--gf-radius-sm);
    border: 1px solid var(--gf-border);
    background: var(--gf-surface-sunken);
    align-self: flex-start;
  }
  .opt {
    appearance: none;
    border: 0;
    border-radius: calc(var(--gf-radius-sm) - 2px);
    padding: var(--gf-space-1) var(--gf-space-3);
    background: transparent;
    color: var(--gf-text-muted);
    font: inherit;
    font-size: var(--gf-font-size-sm);
    cursor: pointer;
  }
  .opt[aria-checked='true'] {
    background: var(--gf-elevated, var(--gf-surface));
    color: var(--gf-text);
    font-weight: 600;
  }
  .url {
    display: block;
    width: 100%;
    padding: var(--gf-space-3);
    border-radius: var(--gf-radius-sm);
    border: 1px solid var(--gf-border);
    background: var(--gf-surface-sunken);
    color: var(--gf-text);
    font-family: var(--gf-font-mono);
    font-size: var(--gf-font-size-xs);
    line-height: 1.5;
    user-select: all;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--gf-space-3);
    flex-wrap: wrap;
  }
  .open {
    color: var(--gf-accent);
    font-size: var(--gf-font-size-sm);
  }
  .preview {
    position: relative;
    aspect-ratio: 16 / 9;
    border-radius: var(--gf-radius-md);
    border: 1px solid var(--gf-border);
    background: linear-gradient(135deg, #1f2a3a 0%, #0b0f16 60%, #233047 100%);
    overflow: hidden;
  }
  .previewcol {
    display: grid;
    gap: var(--gf-space-1);
  }
  .framenote {
    font-size: var(--gf-font-size-xs);
  }
  /* Laid out at the stream's size and scaled about the top-left corner (inline style). */
  .frame {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
    border: 0;
    background: transparent;
    pointer-events: none;
  }
</style>
