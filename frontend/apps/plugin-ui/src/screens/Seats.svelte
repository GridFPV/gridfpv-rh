<script lang="ts">
  /** The Seats page: profile bar on top, one card per seat (#7). */
  import HelpLink from '../components/HelpLink.svelte';
  import { Banner, Dialog } from '@gridfpv/components';
  import ChannelGrid from '../components/ChannelGrid.svelte';
  import ProfileBar from '../components/ProfileBar.svelte';
  import SeatCard from '../components/SeatCard.svelte';
  import TuningPanel from '../components/TuningPanel.svelte';
  import SeatTune from './SeatTune.svelte';
  import { refreshLevels, rh, type WriteResult } from '../lib/rh.svelte.js';
  import { go, route } from '../lib/router.svelte.js';
  import { raceLockReason } from '../lib/seats.js';

  const timer = rh();
  // While a race is staged or running, channel and profile writes are refused (#87); the
  // store refuses them too, this just says so up front.
  const lockReason = $derived(raceLockReason(timer.race.status));
  // RotorHazard's set_enter_at_level / set_exit_at_level broadcast nothing, so a pair changed
  // from its own Settings page (or any other client) is only seen by asking; while this page is
  // open, ask every few seconds (#90). RotorHazard's own page has the same blind spot.
  $effect(() => {
    const id = window.setInterval(() => void refreshLevels(), 5000);
    return () => window.clearInterval(id);
  });
  // A seat's lowering note lasts until its first pass (RotorHazard restores the node then).
  const loweredFor = (index: number) => {
    const plan = timer.lowered;
    const l = plan?.seats[index];
    if (!plan || !l || timer.live[index]?.laps.length) return null;
    return { ...l, duration: plan.duration };
  };

  // /grid/seats/N opens the tuning modal over this page, so the link survives a refresh
  // and closing it is just navigating back to /grid/seats.
  const tuneSeat = $derived.by(() => {
    const m = /^seats\/(\d+)$/.exec(route());
    return m ? Number(m[1]) : null;
  });

  let notice: { tone: 'success' | 'danger'; text: string } | null = $state(null);
  let noticeTimer = 0;

  function onresult(r: WriteResult) {
    window.clearTimeout(noticeTimer);
    notice = r.ok
      ? { tone: 'success', text: 'RotorHazard confirmed the change.' }
      : { tone: 'danger', text: r.message ?? 'RotorHazard did not confirm the change.' };
    if (r.ok) noticeTimer = window.setTimeout(() => (notice = null), 2500);
  }
</script>

<section class="page">
  <header class="pagehead">
    <div class="titleline">
      <h1>Seats</h1>
      <HelpLink page="seats" />
    </div>
    <p class="lede">
      Channels and thresholds for every seat in the active profile. Changes write straight to
      RotorHazard and are confirmed by reading them back.
    </p>
  </header>

  {#if lockReason}
    <Banner tone="warn">
      A race is {timer.race.status === 3 ? 'staged' : 'running'}: channel and profile changes are
      refused until it stops, so RotorHazard does not retune a seat mid-race. Enter and exit
      thresholds still write live.
    </Banner>
  {/if}

  <ProfileBar profiles={timer.profiles} {lockReason} {onresult} />

  <TuningPanel tuning={timer.tuning} {onresult} />

  {#if timer.seats.length}
    <ChannelGrid seats={timer.seats} {onresult} />
  {/if}

  {#if notice}
    <Banner tone={notice.tone} ondismiss={() => (notice = null)}>{notice.text}</Banner>
  {/if}

  {#if timer.seats.length === 0}
    <p class="muted">Waiting for RotorHazard to report its seats…</p>
  {:else}
    <div class="grid">
      {#each timer.seats as seat (seat.index)}
        <SeatCard
          {seat}
          raceOn={lockReason != null}
          adaptive={timer.tuning.calibrationMode === 1}
          lowered={loweredFor(seat.index)}
          {onresult}
        />
      {/each}
    </div>
  {/if}

  {#if tuneSeat != null}
    <Dialog open={true} size="wide" title="Seat {tuneSeat + 1}" onclose={() => go('seats')}>
      <SeatTune seatIndex={tuneSeat} />
    </Dialog>
  {/if}
</section>

<style>
  .page {
    display: grid;
    gap: var(--gf-space-3);
  }
  .pagehead h1 {
    margin: 0 0 var(--gf-space-1);
    font-size: var(--gf-font-size-xl);
  }
  .lede,
  .muted {
    margin: 0;
    color: var(--gf-text-muted);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--gf-space-3);
  }
  @media (max-width: 720px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
