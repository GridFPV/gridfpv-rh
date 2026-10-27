import { describe, expect, it } from 'vitest';
import {
  AUDIO_DEFAULTS,
  CueEngine,
  MIN_LOG_VOL_LIM,
  readAudioSettings,
  type Mp3Cue,
  type Tone,
  type Utterance
} from '../src/lib/cues.js';

/** A fake clock with scheduled callbacks, so a whole race runs in a test. */
class Timeline {
  t = 0;
  private pending: Array<{ at: number; fn: () => void }> = [];
  setTimeout = (fn: () => void, ms: number) => {
    this.pending.push({ at: this.t + ms, fn });
  };
  /** Advance to `to`: callbacks run at their exact time, `tick` every 100 ms as the page would. */
  advance(to: number, tick: () => void) {
    let nextTick = Math.floor(this.t / 100) * 100 + 100;
    while (this.t < to) {
      const due = this.pending.filter((p) => p.at <= to).sort((a, b) => a.at - b.at)[0];
      const next = Math.min(to, nextTick, due ? due.at : Infinity);
      this.t = next;
      if (due && due.at === next) {
        this.pending.splice(this.pending.indexOf(due), 1);
        due.fn();
      }
      if (next === nextTick) {
        tick();
        nextTick += 100;
      }
    }
  }
}

function harness(settings = AUDIO_DEFAULTS) {
  const tl = new Timeline();
  const tones: Array<Tone & { t: number }> = [];
  const said: Array<Utterance & { t: number }> = [];
  const mp3s: Array<Mp3Cue & { t: number }> = [];
  let speakingUntil = 0;
  const engine = new CueEngine(
    {
      tone: (x) => tones.push({ ...x, t: tl.t }),
      mp3: (m) => mp3s.push({ ...m, t: tl.t }),
      speak: (u) => {
        said.push({ ...u, t: tl.t });
        speakingUntil = tl.t + Math.max(250, u.text.split(' ').length * 350);
      },
      speaking: () => tl.t < speakingUntil,
      setTimeout: tl.setTimeout
    },
    () => tl.t,
    settings
  );
  // heartbeats every 500 ms drain the queue, as RotorHazard's do
  let lastBeat = 0;
  const tick = () => {
    if (tl.t - lastBeat >= 500) {
      lastBeat = tl.t;
      engine.heartbeat();
    }
    engine.tick();
  };
  return { tl, tones, said, mp3s, engine, tick };
}

const laptime = { ...AUDIO_DEFAULTS, voice_if_node_finished: 1, indicator_beep_volume: 0.5 };
const position = {
  ...laptime,
  voice_lap_time: 0,
  voice_race_leader: 1,
  beep_race_leader_lap: true,
  beep_race_winner_declared: true,
  beep_on_first_pass_button: true
};

describe('CueEngine: the timed 30 s race of the reference ledger (laptime profile)', () => {
  it('plays the staging and start tones, the callouts, 10 seconds, the final beeps and the winner', () => {
    const h = harness(laptime);
    // RotorHazard's reference: staging 4 s (3 prestage tones + 2 s), a tone each second, so
    // staging_tones = 4. Staging at 1 s on the page clock, start at 5 s (differential 0).
    h.engine.stageReady(
      {
        pi_staging_at_s: 1,
        pi_starts_at_s: 5,
        staging_tones: 4,
        unlimited_time: 0,
        race_time_sec: 30
      },
      0
    );
    h.tl.advance(5_000, h.tick);
    expect(h.tones.map((x) => [x.t, x.frequency, x.durationMs])).toEqual([
      [1_000, 440, 100],
      [2_000, 440, 100],
      [3_000, 440, 100],
      [4_000, 440, 100],
      [5_000, 880, 700]
    ]);
    // Laps land (phonetic_data ~80 ms after the pass): Ace at 8 s, Bee at 9.5 s, Ace 14, Bee 17, Ace 20.
    const race0 = 5_000;
    const laps: Array<[number, string, number, string]> = [
      [8_080, 'Ace', 1, '6.0'],
      [9_580, 'Bee', 1, '7.0'],
      [14_080, 'Ace', 2, '5.9'],
      [17_080, 'Bee', 2, '7.4'],
      [20_080, 'Ace', 3, '6.0']
    ];
    for (const [at, who, lap, time] of laps) {
      h.tl.advance(race0 + at, h.tick);
      h.engine.phoneticData({
        callsign: who,
        lap,
        phonetic: time,
        raw_time: 6000,
        leader_flag: who === 'Ace'
      });
    }
    h.tl.advance(race0 + 30_200, h.tick);
    h.engine.phoneticText({ text: 'Winner is Ace', domain: 'race_winner', winner_flag: true });
    h.tl.advance(race0 + 32_000, h.tick);
    const say: Array<[number, string]> = h.said.map((u) => [u.t - race0, u.text]);
    expect(say.map((x) => x[1])).toEqual([
      'Ace, Lap 1, 6.0',
      'Bee, Lap 1, 7.0',
      'Ace, Lap 2, 5.9',
      'Bee, Lap 2, 7.4',
      '10 Seconds',
      'Ace, Lap 3, 6.0',
      'Winner is Ace'
    ]);
    // Each callout starts on a heartbeat after its event, once the previous one has finished
    // (this harness drains every 500 ms with 350 ms per word; the e2e harness measures the real
    // cadence against RotorHazard's own page).
    for (const [t, text] of say) {
      const ev = laps.find((l) => text.startsWith(l[1]) && text.includes(`Lap ${l[2]}`))?.[0];
      if (ev != null) {
        expect((t as number) - ev).toBeGreaterThanOrEqual(0);
        expect((t as number) - ev).toBeLessThan(2000);
      }
    }
    expect(say.find((x) => x[1] === '10 Seconds')![0]).toBeGreaterThanOrEqual(20_000);
    expect(
      h.tones.filter((x) => x.t > race0).map((x) => [x.t - race0, x.frequency, x.durationMs])
    ).toEqual([
      [25_000, 440, 100],
      [26_000, 440, 100],
      [27_000, 440, 100],
      [28_000, 440, 100],
      [29_000, 440, 100],
      [30_000, 880, 700]
    ]);
    expect(h.said.every((u) => u.rate === 1.25 && u.pitch === 1 && u.volume === 1)).toBe(true);
  });
});

describe('CueEngine: the position profile adds first-pass tones, the leader cue and the winner beeps', () => {
  it('matches the reference shape', () => {
    const h = harness(position);
    h.engine.stageReady(
      {
        pi_staging_at_s: 1,
        pi_starts_at_s: 5,
        staging_tones: 4,
        unlimited_time: 0,
        race_time_sec: 30
      },
      0
    );
    const race0 = 5_000;
    h.tl.advance(race0 + 2_000, h.tick);
    h.engine.firstPassRegistered({ node_index: 1 });
    h.tl.advance(race0 + 8_080, h.tick);
    h.engine.phoneticData({
      callsign: 'Ace',
      lap: 1,
      phonetic: '6.0',
      raw_time: 6000,
      leader_flag: true
    });
    h.tl.advance(race0 + 12_000, h.tick);
    const after = h.tones
      .filter((x) => x.t > race0)
      .map((x) => [x.t - race0, x.frequency, x.type, x.durationMs]);
    expect(after.slice(0, 2)).toEqual([
      [2_000, 466.2, 'sawtooth', 35],
      [2_070, 466.2, 'sawtooth', 35]
    ]);
    // Leader tone then "Ace, Lap 1" (no lap time), then "Ace is leading" 1 s after the event.
    const leader = after.find((x) => x[1] === 1200)!;
    expect(leader[2]).toBe('square');
    expect(h.said.map((u) => u.text)).toEqual(['Ace, Lap 1', 'Ace is leading']);
    expect(h.said[1].t - (race0 + 8_080)).toBeGreaterThanOrEqual(1000);
    h.engine.phoneticText({ text: 'Winner is Ace', domain: 'race_winner', winner_flag: true });
    h.tl.advance(race0 + 14_000, h.tick);
    const winnerBeeps = h.tones
      .filter((x) => x.t > race0 + 12_000 && x.type === 'square')
      .map((x) => [x.frequency, x.durationMs]);
    expect(winnerBeeps).toEqual([
      [1200, 50],
      [1800, 75],
      [1200, 50],
      [1800, 75],
      [1200, 50],
      [1800, 100]
    ]);
    expect(h.said.map((u) => u.text).at(-1)).toBe('Winner is Ace');
  });
});

describe('CueEngine rules', () => {
  it('skips laps under the minimum lap time and finished pilots unless asked, and honours the domain', () => {
    const h = harness({ ...laptime, voice_if_node_finished: 0, voice_race_winner: 0 });
    h.engine.minLapS = 5;
    h.engine.phoneticData({ callsign: 'Ace', lap: 1, phonetic: '3.0', raw_time: 3000 });
    h.engine.phoneticData({
      callsign: 'Ace',
      lap: 2,
      phonetic: '6.0',
      raw_time: 6000,
      node_finished: true
    });
    h.engine.phoneticText({ text: 'Winner is Ace', domain: 'race_winner', winner_flag: true });
    h.tl.advance(2_000, h.tick);
    expect(h.said).toEqual([]);
  });
  it('is silent when the volumes are off, and the count-up race has no 10-second callout', () => {
    const h = harness({ ...laptime, tone_volume: 0, voice_volume: 0 });
    h.engine.stageReady(
      {
        pi_staging_at_s: 0,
        pi_starts_at_s: 2,
        staging_tones: 2,
        unlimited_time: 1,
        race_time_sec: 0
      },
      0
    );
    h.engine.phoneticData({ callsign: 'Ace', lap: 1, phonetic: '6.0', raw_time: 6000 });
    h.tl.advance(40_000, h.tick);
    expect(h.tones).toEqual([]);
    expect(h.said).toEqual([]);
  });
  it("treats RotorHazard's slider floor as silence: 0.010000000000000004 plays nothing, 0.011 plays (#74)", () => {
    expect(MIN_LOG_VOL_LIM).toBe(0.01 + 0.01 / 1000);
    const floor = 0.010000000000000004; // what rotorhazard.js stores at the slider's minimum
    const quiet = harness({ ...position, tone_volume: floor, indicator_beep_volume: floor });
    quiet.engine.beep(100, 440, floor, 'triangle');
    quiet.engine.firstPassRegistered({ node_index: 1 });
    quiet.tl.advance(500, quiet.tick);
    expect(quiet.tones).toEqual([]);
    const low = harness({ ...position, tone_volume: 0.011 });
    low.engine.beep(100, 440, 0.011, 'triangle');
    expect(low.tones).toHaveLength(1);
  });
  it('plays RotorHazard\'s MP3 files instead of synthetic tones when "Use MP3 tones" is set (#75)', () => {
    const h = harness({ ...position, use_mp3_tones: true });
    h.engine.stageReady(
      {
        pi_staging_at_s: 1,
        pi_starts_at_s: 4,
        staging_tones: 2,
        unlimited_time: 0,
        race_time_sec: 12
      },
      0
    );
    h.engine.firstPassRegistered({ node_index: 1 });
    h.engine.phoneticData({
      callsign: 'Ace',
      lap: 1,
      phonetic: '4.0',
      raw_time: 4000,
      leader_flag: true
    });
    h.engine.phoneticText({ text: 'Winner is Ace', domain: 'race_winner', winner_flag: true });
    h.tl.advance(16_000, h.tick);
    expect(h.tones).toEqual([]);
    const files = h.mp3s.map((m) => `${m.t} ${m.file} ${m.volume}`);
    // staging tones at 1 s and 2 s, the buzzer at the start (4 s) and the expiry (16 s), the
    // final seconds 11–15 s; the first pass, leader and winner at the indicator volume.
    expect(files).toEqual([
      '0 beep 0.5',
      '500 leader 0.5',
      '1000 stage 1',
      '2000 stage 1',
      '2500 winner 0.5',
      '4000 buzzer 1',
      '11000 stage 1',
      '12000 stage 1',
      '13000 stage 1',
      '14000 stage 1',
      '15000 stage 1',
      '16000 buzzer 1'
    ]);
    expect(h.mp3s.filter((m) => m.file === 'leader')).toHaveLength(1);
    expect(h.mp3s.filter((m) => m.file === 'winner')).toHaveLength(1);
    expect(h.mp3s.filter((m) => m.file === 'stage')).toHaveLength(7);
    expect(h.mp3s.filter((m) => m.file === 'buzzer')).toHaveLength(2);
  });
  it('resumes a running race from the first race_status, once the clock sync arrives, without replaying the start (#73)', () => {
    const h = harness(laptime);
    // The page loaded 4 s into a 12 s race that started at pi 100 s: on our clock the start
    // was at −4 000, so the differential (pi ms − page ms) is 104 000, learnt 600 ms after load.
    h.engine.raceStatus(
      {
        race_status: 1,
        pi_staging_at_s: 97,
        pi_starts_at_s: 100,
        staging_tones: 0,
        unlimited_time: 0,
        race_time_sec: 12
      },
      null
    );
    h.tl.advance(600, h.tick);
    expect(h.tones).toEqual([]);
    h.engine.resync(104_000);
    // A later sample moves the differential by 3 ms: nothing fires twice.
    h.tl.advance(2_000, h.tick);
    h.engine.resync(104_003);
    // A second race_status (RotorHazard re-broadcasts them) does not kick off again.
    h.engine.raceStatus(
      {
        race_status: 1,
        pi_staging_at_s: 97,
        pi_starts_at_s: 100,
        staging_tones: 0,
        unlimited_time: 0,
        race_time_sec: 12
      },
      104_003
    );
    h.tl.advance(10_000, h.tick);
    const beeps = h.tones.map((t) => `${t.t} ${t.frequency}`);
    // remaining 5..1 s at page 3 000..7 000 ms, expiry at 8 000; no start tone, no staging,
    // and no "10 Seconds": that tenth passed before the page loaded.
    expect(beeps).toEqual(['3000 440', '4000 440', '5000 440', '6000 440', '7000 440', '8000 880']);
    expect(h.said.map((u) => u.text)).toEqual([]);
  });
  it("fires a due tenth before stopping, so the expiry tone survives RotorHazard's stop arriving on the boundary (#38)", () => {
    const h = harness(laptime);
    h.engine.stageReady(
      {
        pi_staging_at_s: 0,
        pi_starts_at_s: 2,
        staging_tones: 0,
        unlimited_time: 0,
        race_time_sec: 12
      },
      0
    );
    h.tl.advance(13_950, h.tick); // the last tick ran at 13 900: tenth 119 (0.1 s left)
    h.tl.t = 14_001; // the server's stop_timer lands 1 ms after the expiry boundary
    h.engine.stop();
    expect(h.tones.filter((t) => t.frequency === 880).map((t) => t.t)).toEqual([2000, 14_001]);
    h.tl.advance(16_000, h.tick);
    expect(h.tones.filter((t) => t.frequency === 880)).toHaveLength(2);
    expect(h.engine.msToNextTenth()).toBeNull();
  });
  it('beeps the node tone on a manual lap only when "beep on manual lap" is set', () => {
    const quiet = harness(laptime);
    quiet.engine.manualLap(1);
    expect(quiet.tones).toEqual([]);
    const loud = harness({ ...laptime, beep_manual_lap_button: true });
    loud.engine.manualLap(1);
    expect(loud.tones.map((t) => [t.frequency, t.type, t.durationMs])).toEqual([
      [466.2, 'sawtooth', 35]
    ]);
    const mp3 = harness({ ...laptime, beep_manual_lap_button: true, use_mp3_tones: true });
    mp3.engine.manualLap(1);
    expect(mp3.mp3s.map((m) => m.file)).toEqual(['beep']);
  });
  it('stops on a Ready race_status and does not kick off from a later running one (#73)', () => {
    const h = harness(laptime);
    h.engine.raceStatus({ race_status: 0 }, 0);
    h.engine.raceStatus(
      {
        race_status: 1,
        pi_staging_at_s: 0,
        pi_starts_at_s: 1,
        staging_tones: 0,
        unlimited_time: 0,
        race_time_sec: 5
      },
      0
    );
    h.tl.advance(7_000, h.tick);
    expect(h.tones).toEqual([]);
  });
  it('reads RotorHazard settings from localStorage with its JSON values and defaults', () => {
    const store = new Map<string, string>([
      ['rotorhazard.voice_rate', '1.5'],
      ['rotorhazard.beep_race_leader_lap', 'true'],
      ['rotorhazard.voice_language', '"Fake English"'],
      ['rotorhazard.voice_lap_time', '0']
    ]);
    const s = readAudioSettings({ getItem: (k) => store.get(k) ?? null });
    expect(s.voice_rate).toBe(1.5);
    expect(s.beep_race_leader_lap).toBe(true);
    expect(s.voice_language).toBe('Fake English');
    expect(s.voice_lap_time).toBe(0);
    expect(s.tone_volume).toBe(1);
  });
});
