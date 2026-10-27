<script lang="ts">
  /**
   * RotorHazard's Callouts panel (run.html): a list of lines the director can have spoken
   * on every connected page (play_callout_text → phonetic_text), kept on the timer
   * (save_callouts / the `callouts` event). Pure: shows `callouts`, reports the edited list
   * through `onsave` and a play request through `onplay`.
   */
  import { Button, Input } from '@gridfpv/components';

  let {
    callouts,
    onsave,
    onplay
  }: {
    callouts: string[];
    onsave: (list: string[]) => void;
    onplay: (text: string) => void;
  } = $props();

  // Edited lines, following RotorHazard's list when it changes without wiping typing.
  let lines: string[] = $state([]);
  let seen = '';
  $effect(() => {
    const key = JSON.stringify(callouts);
    if (key !== seen) {
      seen = key;
      lines = [...callouts];
    }
  });
  /** RotorHazard keeps the non-empty lines, trimmed, in order. */
  const cleaned = () => lines.map((l) => l.trim()).filter(Boolean);
</script>

<div class="callouts" aria-label="Callouts">
  <ol class="list">
    {#each lines as line, i (i)}
      <li>
        <Input
          size="sm"
          value={line}
          aria-label="Callout {i + 1}"
          placeholder="Text to speak, e.g. Pilots to the line"
          oninput={(e: Event) => (lines[i] = (e.currentTarget as HTMLInputElement).value)}
          onchange={() => onsave(cleaned())}
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={!line.trim()}
          title="Speak this on every page"
          aria-label="Play callout {i + 1}"
          onclick={() => onplay(line.trim())}>▶</Button
        >
        <Button
          size="sm"
          variant="ghost"
          aria-label="Delete callout {i + 1}"
          onclick={() => {
            lines = lines.filter((_, j) => j !== i);
            onsave(cleaned());
          }}>×</Button
        >
      </li>
    {/each}
  </ol>
  <Button size="sm" variant="ghost" onclick={() => (lines = [...lines, ''])}>Add callout</Button>
  <p class="muted">
    A callout is spoken on every connected page, RotorHazard's included. The list is kept on the
    timer.
  </p>
</div>

<style>
  .list {
    list-style: decimal;
    margin: 0 0 var(--gf-space-2);
    padding-left: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: var(--gf-space-1);
  }
  li {
    display: flex;
    gap: var(--gf-space-1);
    align-items: center;
  }
  li :global(.gf-input) {
    flex: 1;
  }
  .muted {
    margin: var(--gf-space-2) 0 0;
    font-size: var(--gf-font-size-sm);
    color: var(--gf-text-muted);
  }
</style>
