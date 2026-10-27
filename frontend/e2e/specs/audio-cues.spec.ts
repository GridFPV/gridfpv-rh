import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '../src/fixtures.js';
import type { Rig } from '../src/rig.js';

/**
 * Audio cues (#38): QA's comparison harness, as the acceptance test. The page's Web Audio
 * and speech are stubbed into a ledger (src/audio-stub.js, from the QA worktree); one race
 * per fixture is driven through the rig exactly as when RotorHazard's own ledger was
 * recorded. RotorHazard's own Run page runs beside ours in the same browser and its live
 * ledger is the primary oracle: every cue of its must be ours (same Hz, type, duration, text;
 * timer tones within ±50 ms, queued leader/winner tones ±150 ms, speech ±200 ms), nothing
 * extra. The recorded fixture is the shape check: the clock-driven tones (staging, start,
 * final seconds, expiry) must land within ±50 ms of the recording, and everything a server
 * event causes (first-pass tones, lap callouts, leader and winner tones) must come in the
 * recording's order with the recording's content. Those event-driven cues carry the rig's
 * pass-delivery latency, the server's own processing and RotorHazard's 100 ms heartbeat
 * phase, none of which the recording can pin from one run to the next (CI run 40468033240:
 * 315 ms on a slow runner, with the live page in agreement).
 *
 * t = 0 in every ledger is RotorHazard's start tone (880 Hz, 700 ms), not the moment the
 * test process received the RACING broadcast: that receipt is late by the runner's network
 * and scheduling latency (51 ms in the same CI run), which the page's cues never see.
 */
type Cue = {
  kind: 'tone' | 'speech' | 'mp3';
  t: number;
  frequency?: number;
  type?: string;
  duration_ms?: number | null;
  gain?: number | null;
  text?: string;
  rate?: number;
  voice?: string | null;
};
type Fixture = {
  scenario: string;
  profile: string;
  settings: Record<string, unknown>;
  passes_ms: Record<string, number[]>;
  rotorhazard_cues: Cue[];
};

const STUB = fs.readFileSync(path.join(process.cwd(), 'src/audio-stub.js'), 'utf8');
const FIX = path.join(process.cwd(), 'fixtures/audio-cues');
const fixtures = fs
  .readdirSync(FIX)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8')) as Fixture);

async function formatFor(rig: Rig, scenario: string): Promise<number> {
  if (scenario === 'timed30') {
    const std = (await rig.formats()).find((f) => /2:00 Standard/.test(f.name))!;
    const before = new Set((await rig.formats()).map((f) => f.id));
    rig.emit('add_race_format', { source_format_id: std.id });
    const made = await rig.until('format copy', async () =>
      (await rig.formats()).find((f) => !before.has(f.id))
    );
    rig.emit('alter_race_format', {
      format_id: made.id,
      format_name: 'E2E 30 s',
      race_time_sec: 30,
      lap_grace_sec: 0,
      unlimited_time: 0,
      staging_fixed_tones: 3,
      start_delay_min_ms: 2000,
      start_delay_max_ms: 0,
      staging_delay_tones: 2,
      win_condition: 1
    });
    await rig.until(
      '30 s format',
      async () =>
        (
          await rig.api<{ formats: Array<{ id: number; race_time_sec: number }> }>(
            '/api/format/all'
          )
        ).formats.find((f) => f.id === made.id)?.race_time_sec === 30
    );
    return made.id;
  }
  const f = (await rig.formats()).find((x) => /First to 3/.test(x.name))!;
  rig.emit('alter_race_format', {
    format_id: f.id,
    staging_fixed_tones: 3,
    start_delay_min_ms: 2000,
    start_delay_max_ms: 0,
    staging_delay_tones: 2
  });
  await rig.until(
    'first-to-3 staging',
    async () =>
      (
        await rig.api<{ formats: Array<{ id: number; staging_fixed_tones: number }> }>(
          '/api/format/all'
        )
      ).formats.find((x) => x.id === f.id)?.staging_fixed_tones === 3
  );
  return f.id;
}

/**
 * What makes two cues the same: Hz and type for a tone; the text for speech. A lap callout
 * ("Ace, Lap 1, 6.0") matches when the pilot and the lap number are the same and the lap
 * time is within 0.1 s: RotorHazard measures the simulated laps a few hundredths differently
 * run to run, so the last digit is not ours to reproduce against a recording.
 */
const LAP = /^(.*), Lap (\d+), (\d+\.\d)$/;
function sameSpeech(a: Cue, b: Cue): boolean {
  const ta = a.text ?? '';
  const tb = b.text ?? '';
  if (ta === tb) return true;
  const ma = LAP.exec(ta);
  const mb = LAP.exec(tb);
  if (!ma || !mb) return false;
  return (
    ma[1] === mb[1] && ma[2] === mb[2] && Math.abs(Number(ma[3]) - Number(mb[3])) <= 0.1 + 1e-9
  );
}
const same = (a: Cue, b: Cue) =>
  a.kind === b.kind &&
  (a.kind === 'tone'
    ? a.frequency === b.frequency && a.type === b.type
    : a.kind === 'speech'
      ? sameSpeech(a, b)
      : true);
const fmt = (c: Cue) =>
  c.kind === 'tone'
    ? `${String(c.t).padStart(6)} tone ${c.frequency} Hz ${c.type} ${c.duration_ms ?? '?'} ms g=${c.gain}`
    : `${String(c.t).padStart(6)} say "${c.text}" r=${c.rate}`;

/** RotorHazard's start (and expiry) tone: the clock's 880 Hz, 700 ms triangle. */
const isStartTone = (c: Cue) =>
  c.kind === 'tone' && c.frequency === 880 && c.type === 'triangle' && (c.duration_ms ?? 0) >= 600;
/** Clock-driven: the 440 Hz staging/final-second ticks and the 880 Hz start/expiry tone. */
const clockDriven = (c: Cue) =>
  c.kind === 'tone' && c.type === 'triangle' && (c.frequency === 440 || c.frequency === 880);
/** Re-zero a ledger on its first start tone (falls back to the given zero when there is none). */
function anchored(cues: Cue[], fallback: number): Cue[] {
  const start = [...cues].sort((a, b) => a.t - b.t).find(isStartTone);
  const zero = start ? start.t : fallback;
  return cues.map((c) => ({ ...c, t: Math.round(c.t - zero) }));
}

/** Match ours against the reference: every reference cue found within tolerance, nothing left over. */
function compare(reference: Cue[], ours: Cue[]): string[] {
  const problems: string[] = [];
  const used = new Set<number>();
  for (const ref of reference) {
    // Clock-driven and first-pass tones must land within ±50 ms. The leader and winner tones
    // (1200/1800 Hz square) are played by RotorHazard from its speech queue, on the first
    // heartbeat after the previous callout has ended, so their time carries one heartbeat of
    // phase (100 ms) in RotorHazard's own page from run to run; they get ±150 ms. Speech ±200 ms.
    const queued =
      ref.kind === 'tone' &&
      ref.type === 'square' &&
      (ref.frequency === 1200 || ref.frequency === 1800);
    const tol = ref.kind === 'tone' ? (queued ? 150 : 50) : 200;
    let best = -1;
    let bestD = Infinity;
    ours.forEach((c, i) => {
      if (used.has(i) || !same(c, ref)) return;
      const d = Math.abs(c.t - ref.t);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0 || bestD > tol) {
      problems.push(
        `missing within ±${tol} ms: ${fmt(ref)}${best >= 0 ? ` (nearest ${ours[best].t})` : ''}`
      );
      continue;
    }
    used.add(best);
    const c = ours[best];
    if (ref.kind === 'tone' && Math.abs((c.duration_ms ?? 0) - (ref.duration_ms ?? 0)) > 50)
      problems.push(`duration off: ${fmt(ref)} vs ${fmt(c)}`);
  }
  ours.forEach((c, i) => {
    if (!used.has(i)) problems.push(`extra: ${fmt(c)}`);
  });
  return problems;
}

/**
 * Match ours against the recording: clock-driven tones by time (±50 ms), every other cue by
 * order and content, in one sequence.
 */
function compareRecording(reference: Cue[], ours: Cue[]): string[] {
  const problems = compare(reference.filter(clockDriven), ours.filter(clockDriven));
  const byTime = (a: Cue, b: Cue) => a.t - b.t;
  const refSeq = reference.filter((c) => !clockDriven(c)).sort(byTime);
  const ourSeq = ours.filter((c) => !clockDriven(c)).sort(byTime);
  for (let i = 0; i < Math.max(refSeq.length, ourSeq.length); i++) {
    const ref = refSeq[i];
    const c = ourSeq[i];
    if (ref && c && same(ref, c)) {
      if (ref.kind === 'tone' && Math.abs((c.duration_ms ?? 0) - (ref.duration_ms ?? 0)) > 50)
        problems.push(`duration off: ${fmt(ref)} vs ${fmt(c)}`);
      continue;
    }
    problems.push(
      `sequence ${i + 1}: recording ${ref ? fmt(ref) : '(nothing)'}, ours ${c ? fmt(c) : '(nothing)'}`
    );
  }
  return problems;
}

for (const fx of fixtures) {
  test(`audio cues match RotorHazard's ledger: ${fx.scenario} / ${fx.profile}`, async ({
    browser,
    rig,
    rh
  }) => {
    test.setTimeout(150_000);
    const ace = await rig.addPilot({ callsign: 'Ace' });
    const bee = await rig.addPilot({ callsign: 'Bee' });
    const fmtId = await formatFor(rig, fx.scenario);
    const cls = await rig.addClass({ name: 'E2E Cues', formatId: fmtId, rounds: 3 });
    const heat = await rig.addHeat({ name: 'Cue heat', classId: cls, pilots: [null, ace, bee] });
    await rig.setMinLap(1);
    await rig.setHeat(heat);

    const open = async (url: string) => {
      const ctx = await browser.newContext({
        httpCredentials: { username: 'admin', password: 'rotorhazard' }
      });
      await ctx.addInitScript(STUB);
      await ctx.addInitScript((s: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(s))
          localStorage.setItem('rotorhazard.' + k, JSON.stringify(v));
      }, fx.settings);
      const page = await ctx.newPage();
      await page.goto(url);
      await page.waitForTimeout(3500); // pi_time samples
      return { ctx, page };
    };
    const theirs = await open(rig.url + '/run');
    const ours = await open(rig.url + '/grid/run');
    // The first click unlocks audio on both pages, as a director's would.
    await theirs.page.mouse.click(5, 5);
    await ours.page.mouse.click(5, 5);
    await expect(ours.page.getByText('Click anywhere once to enable sound')).toHaveCount(0);

    // t = 0 is the rig's race_status RACING broadcast, as in the reference.
    const racing = new Promise<number>((resolve) => {
      const onStatus = (msg: { race_status: number }) => {
        if (msg.race_status === 1) resolve(Date.now());
        else void rig.next<{ race_status: number }>('race_status', 60_000).then(onStatus);
      };
      void rig.next<{ race_status: number }>('race_status', 60_000).then(onStatus);
    });
    rig.emit('stage_race');
    const t0 = await racing;
    await rig.fly(fx.passes_ms);
    const runFor = fx.scenario === 'timed30' ? 34_000 : 22_000;
    await new Promise((r) => setTimeout(r, Math.max(0, runFor - (Date.now() - t0))));
    if (fx.scenario === 'timed30')
      await rig.until('expired', async () => (await rig.status()).race_status === 2, 20_000);
    else await rig.stop();
    await new Promise((r) => setTimeout(r, 2500)); // let the speech queues drain
    const ledger = async (page: typeof ours.page) =>
      (await page.evaluate(() => (window as unknown as { __cues: Cue[] }).__cues)) ?? [];
    const rawOurs = await ledger(ours.page);
    const rawTheirs = await ledger(theirs.page);
    await rig.discard();
    await theirs.ctx.close();
    await ours.ctx.close();

    // Both pages' ledgers share one clock; zero both on RotorHazard's own start tone.
    const start = [...rawTheirs].sort((a, b) => a.t - b.t).find(isStartTone);
    const zero = start ? start.t : t0;
    const rezero = (cues: Cue[]) => cues.map((c) => ({ ...c, t: Math.round(c.t - zero) }));
    const oursCues = rezero(rawOurs);
    const theirsCues = rezero(rawTheirs);
    const recording = anchored(fx.rotorhazard_cues, 0);

    const problems = compareRecording(recording, oursCues);
    // RotorHazard agrees, live: its own page made the same cues in this run (same tolerance).
    const live = compare(theirsCues, oursCues);
    console.log(
      `[${fx.scenario}/${fx.profile}] ours ${oursCues.length} cues, RotorHazard live ${theirsCues.length}, fixture ${fx.rotorhazard_cues.length}` +
        (problems.length ? '\nvs fixture:\n' + problems.join('\n') : '\nvs fixture: match') +
        (live.length
          ? '\nvs live RotorHazard:\n' + live.join('\n')
          : '\nvs live RotorHazard: match')
    );
    expect(problems).toEqual([]);
    expect(live).toEqual([]);
    void rh;
  });
}
