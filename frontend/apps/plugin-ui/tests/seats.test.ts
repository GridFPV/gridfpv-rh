import { describe, expect, it } from 'vitest';
import {
  applyCrossingChange,
  applyFrequencyData,
  applyHeartbeat,
  applyLevels,
  applyNodeData,
  applyNodeTuning,
  emptySeat,
  ensureSeats,
  raceLockReason,
  seatStatus
} from '../src/lib/seats.js';
import { RACE_STATUS } from '../src/lib/race.js';

describe('seat reducers', () => {
  it('grows the seat list to fit whatever RotorHazard sends, never shrinks it', () => {
    const three = ensureSeats([], 3);
    expect(three.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(ensureSeats(three, 2)).toBe(three);
  });

  it('frequency_data sets the profile channel per seat', () => {
    const seats = applyFrequencyData(
      [],
      [
        { band: 'R', channel: 1, frequency: 5658 },
        { band: null, channel: null, frequency: 0 }
      ]
    );
    expect(seats[0]).toMatchObject({ band: 'R', channel: 1, frequency: 5658 });
    expect(seats[1]).toMatchObject({ band: null, channel: null, frequency: 0 });
  });

  it('levels, heartbeat and node_data each touch only their fields', () => {
    let seats = applyFrequencyData([], [{ band: 'R', channel: 1, frequency: 5658 }]);
    seats = applyLevels(seats, { enter_at_levels: [70], exit_at_levels: [50] });
    seats = applyHeartbeat(seats, { current_rssi: [33], frequency: [5658], crossing_flag: [true] });
    seats = applyNodeData(seats, {
      node_peak_rssi: [95],
      node_nadir_rssi: [10],
      pass_peak_rssi: [90],
      pass_nadir_rssi: [20]
    });
    expect(seats[0]).toMatchObject({
      band: 'R',
      enter: 70,
      exit: 50,
      rssi: 33,
      nodeFrequency: 5658,
      crossing: true,
      peak: 95,
      nadir: 10,
      passPeak: 90,
      passNadir: 20
    });
  });

  it('node_crossing_change flips one seat and ignores out-of-range indexes', () => {
    const seats = ensureSeats([], 2);
    const on = applyCrossingChange(seats, { node_index: 1, crossing_flag: true });
    expect(on[1].crossing).toBe(true);
    expect(on[0].crossing).toBe(false);
    expect(applyCrossingChange(seats, { node_index: 5, crossing_flag: true })).toBe(seats);
  });

  it('node_tuning becomes the profile list and the active one', () => {
    const p = applyNodeTuning({
      profile_ids: [1, 2],
      profile_names: ['Default', 'Outdoor'],
      current_profile: 2,
      profile_name: 'Outdoor',
      profile_description: null
    });
    expect(p.list).toEqual([
      { id: 1, name: 'Default' },
      { id: 2, name: 'Outdoor' }
    ]);
    expect(p.currentId).toBe(2);
    expect(p.description).toBe('');
  });

  it('derives a status pill from channel, thresholds and the crossing flag', () => {
    const s = emptySeat(0);
    expect(seatStatus(s)).toBe('off');
    expect(seatStatus({ ...s, frequency: 5658 })).toBe('untuned');
    expect(seatStatus({ ...s, frequency: 5658, enter: 50, exit: 60 })).toBe('untuned');
    expect(seatStatus({ ...s, frequency: 5658, enter: 70, exit: 50 })).toBe('idle');
    expect(seatStatus({ ...s, frequency: 5658, enter: 70, exit: 50, crossing: true })).toBe(
      'crossing'
    );
  });
});

describe('seatTag / seatLabel', () => {
  it('infers the band tag for a bare frequency RotorHazard stores without one', async () => {
    const { seatLabel, seatTag } = await import('../src/lib/channels.js');
    expect(seatTag({ band: null, channel: null, frequency: 5658 })).toEqual({
      band: 'R',
      channel: 1
    });
    expect(seatLabel({ band: null, channel: null, frequency: 5658 })).toBe('R1 · 5658');
    expect(seatLabel({ band: 'F', channel: 2, frequency: 5760 })).toBe('F2 · 5760');
    expect(seatLabel({ band: null, channel: null, frequency: 5661 })).toBe('5661 MHz');
    expect(seatLabel({ band: null, channel: null, frequency: 0 })).toBe('Off');
  });
});

describe('raceLockReason (#87)', () => {
  it('locks channel and profile writes only while a race is staged or running', () => {
    expect(raceLockReason(RACE_STATUS.READY)).toBeNull();
    expect(raceLockReason(RACE_STATUS.DONE)).toBeNull();
    expect(raceLockReason(RACE_STATUS.STAGING)).toMatch(/^Not written: a race is staged\./);
    expect(raceLockReason(RACE_STATUS.RACING)).toMatch(/^Not written: a race is running\./);
  });
  it('says what is still allowed', () => {
    for (const st of [RACE_STATUS.STAGING, RACE_STATUS.RACING])
      expect(raceLockReason(st)).toMatch(/Thresholds still write live\.$/);
  });
});
