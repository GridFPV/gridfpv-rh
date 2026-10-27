<script lang="ts">
  /**
   * RotorHazard's Heat Plan step (#69): a seeded heat is shown as RotorHazard would seat it,
   * with Cancel / Reseed / Confirm, before it is loaded on the timer.
   */
  import { Badge, Button, Dialog } from '@gridfpv/components';
  import type { HeatPlan, PlanRow } from '../lib/heatplan.js';

  let {
    plan,
    rows,
    busy = false,
    onconfirm,
    onreseed,
    oncancel
  }: {
    plan: HeatPlan;
    rows: PlanRow[];
    busy?: boolean;
    onconfirm: () => void;
    onreseed: () => void;
    oncancel: () => void;
  } = $props();
  let open = $state(true);
  const waiting = $derived(rows.filter((r) => r.waiting).length);
</script>

<Dialog bind:open title="Heat plan: {plan.name}" onclose={oncancel}>
  <p class="muted">
    RotorHazard seats this heat from results. Confirm to lock the lineup in and load it on the
    timer; Reseed to compute it again from the latest results.
  </p>
  {#if !plan.ok}
    <p class="warn" role="alert">
      RotorHazard could not compute this plan: a seat seeds from results that do not exist.
    </p>
  {:else if waiting}
    <p class="warn" role="alert">
      {waiting} seat{waiting === 1 ? '' : 's'} still wait{waiting === 1 ? 's' : ''} on results; they stay
      empty if confirmed now.
    </p>
  {/if}
  <table class="plan" aria-label="Heat plan">
    <tbody>
      {#each rows as r (r.seat)}
        <tr class:waiting={r.waiting}>
          <td class="seat">{r.seat}</td>
          <td class="who">{r.who}</td>
          <td class="from muted">{r.from}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#snippet footer()}
    <Button variant="ghost" disabled={busy} onclick={oncancel}>Cancel</Button>
    <Button variant="secondary" disabled={busy} onclick={onreseed}>Reseed</Button>
    <Button variant="primary" disabled={busy || !plan.ok} onclick={onconfirm}>Confirm</Button>
  {/snippet}
  {#if plan.unassigned}<Badge tone="warn">{plan.unassigned} unassigned</Badge>{/if}
</Dialog>

<style>
  .muted {
    color: var(--gf-text-muted);
    margin: 0 0 var(--gf-space-2);
  }
  .warn {
    margin: 0 0 var(--gf-space-2);
    color: var(--gf-warning-500, #d29922);
  }
  .plan {
    width: 100%;
    border-collapse: collapse;
  }
  .plan td {
    padding: 4px var(--gf-space-2);
    border-bottom: 1px solid var(--gf-border);
  }
  .plan .seat {
    white-space: nowrap;
    color: var(--gf-text-muted);
  }
  .plan .who {
    font-weight: 600;
  }
  .plan tr.waiting .who {
    font-weight: 400;
    font-style: italic;
    color: var(--gf-text-muted);
  }
</style>
