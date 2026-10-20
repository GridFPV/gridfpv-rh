import { describe, expect, it } from 'vitest';
import {
  imdOffenderMessage,
  imdRating,
  imdRatingLabel,
  imdReading,
  imdTone,
  minChannelSeparation,
  worstTwoToneProduct
} from '../src/lib/imd.js';

const RACEBAND = [5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917];

describe('imdRating', () => {
  it('reproduces IMDTabler’s published ratings for the hobby’s reference sets', () => {
    // The validation table carried over from GridFPV's engine port. Do not adjust an
    // expectation to match the code.
    expect(imdRating([5658, 5732, 5843, 5917])).toBe(100); // Racebnd4
    expect(imdRating([5645, 5685, 5760, 5905, 5945])).toBe(98); // ET6minus1
    expect(imdRating([5645, 5685, 5760, 5805, 5905, 5945])).toBe(67); // ETBest6 (MultiGP)
    expect(imdRating([5658, 5695, 5760, 5800, 5880, 5917])).toBe(29); // IMD6C (RotorHazard)
    expect(imdRating(RACEBAND)).toBe(-635);
  });

  it('is order-independent and rates fewer than two channels at the ceiling', () => {
    expect(imdRating([5917, 5658])).toBe(imdRating([5658, 5917]));
    expect(imdRating([])).toBe(100);
    expect(imdRating([5800])).toBe(100);
  });
});

describe('worstTwoToneProduct', () => {
  it('names the product with the smallest gap, and nothing when the set is clean', () => {
    expect(worstTwoToneProduct([5658, 5917])).toBeNull();
    const w = worstTwoToneProduct(RACEBAND);
    expect(w).not.toBeNull();
    expect(w?.gapMhz).toBe(0); // Raceband is evenly spaced: products land dead on neighbours
    expect(2 * (w?.doubled ?? 0) - (w?.subtracted ?? 0)).toBe(w?.product);
  });

  it('is deterministic regardless of input order', () => {
    const a = worstTwoToneProduct([5658, 5695, 5760, 5800, 5880, 5917]);
    const b = worstTwoToneProduct([5917, 5880, 5800, 5760, 5695, 5658]);
    expect(a).toEqual(b);
  });
});

describe('reading, labels and tone', () => {
  it('labels the rating with a real minus sign', () => {
    expect(imdRatingLabel(imdReading([5658, 5732, 5843, 5917]))).toBe('IMD 100');
    expect(imdRatingLabel(imdReading(RACEBAND))).toBe('IMD −635');
  });

  it('writes the offender with channel names, and says clean when there is none', () => {
    expect(imdOffenderMessage(imdReading([5658, 5917]))).toBe(
      'nothing mixes within 35 MHz of a channel in use'
    );
    const msg = imdOffenderMessage(imdReading(RACEBAND));
    expect(msg).toMatch(/^2 × R\d · \d{4} − R\d · \d{4} = \d{4} MHz — lands on R\d · \d{4}$/);
  });

  it('colours by what is achievable at the pilot count', () => {
    expect(imdTone({ rating: 100, worst: null }, 4)).toBe('success');
    expect(imdTone({ rating: 67, worst: null }, 6)).toBe('success'); // MultiGP's set
    expect(imdTone({ rating: 29, worst: null }, 6)).toBe('warn'); // RotorHazard's IMD6C
    expect(imdTone({ rating: -145, worst: null }, 4)).toBe('danger');
    expect(imdTone({ rating: -203, worst: null }, 8)).toBe('success'); // best possible 8-set
    expect(imdTone({ rating: -635, worst: null }, 8)).toBe('danger');
  });

  it('reports minimum channel separation', () => {
    expect(minChannelSeparation(RACEBAND)).toBe(37);
    expect(minChannelSeparation([5917, 5658, 5673])).toBe(15);
    expect(minChannelSeparation([5800])).toBeNull();
  });
});
