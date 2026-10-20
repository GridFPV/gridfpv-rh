/**
 * IMD rating for a set of video channels — a port of IMDTabler's arithmetic, carried over from
 * GridFPV's engine (`crates/engine/src/imd.rs`, itself validated against IMDTabler's published
 * ratings). Same number RotorHazard's own IMDTabler page shows for the same channels, computed
 * in the browser so the Seats page can show it live while the channels are still being picked.
 *
 * Two-tone third-order products: for every ordered pair, `2·f_i − f_j`. A product inside the
 * receivable band that lands within RATING_DIFF_LIMIT of *any* used channel (including its own
 * parents) charges `(35 − gap)²`. The total is scaled down by the channel count "and a bit more"
 * and subtracted from 100. Higher is cleaner; bad sets go negative (all of Raceband rates −635).
 *
 * Advisory only. Nothing here blocks a write: a Raceband-only timer genuinely cannot beat the
 * numbers it gets, and the RD may have no better option.
 */
import { channelLabel, tagFor } from './channels.js';

export const RATING_MAX = 100;
/** `RATING_DIFF_LIMIT` in IMDTabler.java: at or beyond this gap a product is harmless. */
export const RATING_DIFF_LIMIT_MHZ = 35;
const MIN_PRODUCT_MHZ = 5100;
const MAX_PRODUCT_MHZ = 6099;

export type ImdProduct = {
  /** `f_i` in `2·f_i − f_j`; a channel in the set. */
  doubled: number;
  /** `f_j`; a channel in the set. */
  subtracted: number;
  /** `2·doubled − subtracted`, in MHz. Arithmetic, not a channel anyone flies. */
  product: number;
  /** The used channel the product comes closest to — whose video it breaks. */
  landsOn: number;
  /** MHz between the product and `landsOn`; 0 means dead on. Always under the limit. */
  gapMhz: number;
};

export type ImdReading = {
  rating: number;
  /** The product carrying the most penalty, or null when nothing lands within the limit. */
  worst: ImdProduct | null;
};

function inBand(product: number): boolean {
  return product >= MIN_PRODUCT_MHZ && product <= MAX_PRODUCT_MHZ;
}

/** IMDTabler's rating for a channel set. Order-independent; fewer than two channels rate 100. */
export function imdRating(freqs: readonly number[]): number {
  const n = freqs.length;
  if (n < 2) return RATING_MAX;
  let total = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const product = 2 * freqs[i] - freqs[j];
      if (!inBand(product)) continue;
      let gap = Infinity;
      for (const used of freqs) gap = Math.min(gap, Math.abs(product - used));
      if (gap < RATING_DIFF_LIMIT_MHZ) {
        const val = RATING_DIFF_LIMIT_MHZ - gap;
        total += val * val;
      }
    }
  }
  // Two successive truncating divisions, in IMDTabler's order.
  return RATING_MAX - Math.trunc(Math.trunc(total / 5) / n);
}

/**
 * The worst two-tone product: the one with the smallest gap to a used channel, ties broken by
 * the lowest doubled, subtracted, then landsOn, so the answer never depends on input order.
 */
export function worstTwoToneProduct(freqs: readonly number[]): ImdProduct | null {
  let worst: ImdProduct | null = null;
  const n = freqs.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const product = 2 * freqs[i] - freqs[j];
      if (!inBand(product)) continue;
      let gap = Infinity;
      let landsOn = 0;
      for (const used of freqs) {
        const g = Math.abs(product - used);
        if (g < gap || (g === gap && used < landsOn)) {
          gap = g;
          landsOn = used;
        }
      }
      if (gap >= RATING_DIFF_LIMIT_MHZ) continue;
      const cand: ImdProduct = {
        doubled: freqs[i],
        subtracted: freqs[j],
        product,
        landsOn,
        gapMhz: gap
      };
      if (worst === null || compare(cand, worst) < 0) worst = cand;
    }
  }
  return worst;
}

function compare(a: ImdProduct, b: ImdProduct): number {
  return (
    a.gapMhz - b.gapMhz ||
    a.doubled - b.doubled ||
    a.subtracted - b.subtracted ||
    a.landsOn - b.landsOn
  );
}

export function imdReading(freqs: readonly number[]): ImdReading {
  return { rating: imdRating(freqs), worst: worstTwoToneProduct(freqs) };
}

/** Smallest spacing between any two channels, or null below two channels. */
export function minChannelSeparation(freqs: readonly number[]): number | null {
  if (freqs.length < 2) return null;
  const s = [...freqs].sort((a, b) => a - b);
  let min = Infinity;
  for (let i = 1; i < s.length; i++) min = Math.min(min, s[i] - s[i - 1]);
  return min;
}

/** `IMD 29`, with a real minus sign for a negative rating. */
export function imdRatingLabel(reading: ImdReading): string {
  const n = reading.rating;
  return `IMD ${n < 0 ? `−${Math.abs(n)}` : n}`;
}

const name = (mhz: number) => {
  const tag = tagFor(mhz);
  return channelLabel(tag?.band, tag?.channel, mhz);
};

/** The worst offender as a sentence, or the honest "clean" line when there is none. */
export function imdOffenderMessage(reading: ImdReading): string {
  const w = reading.worst;
  if (!w) return `nothing mixes within ${RATING_DIFF_LIMIT_MHZ} MHz of a channel in use`;
  const where =
    w.gapMhz === 0 ? `lands on ${name(w.landsOn)}` : `${w.gapMhz} MHz off ${name(w.landsOn)}`;
  return `2 × ${name(w.doubled)} − ${name(w.subtracted)} = ${w.product} MHz — ${where}`;
}

/**
 * Green / amber / red floors per pilot count, carried over from GridFPV (#474 there). The
 * achievable ceiling collapses with pilot count — 100 at four, 67 at six, −203 at eight from the
 * full catalog — so a flat band would call every big heat dirty. Green is "as clean as the
 * hobby's recommended set for this many pilots"; amber is "about what one badly-placed channel
 * costs"; red is "worse than any single channel explains, the set is wrong".
 */
export const IMD_BANDS: readonly { pilots: number; green: number; amber: number }[] = [
  { pilots: 2, green: 90, amber: 40 },
  { pilots: 3, green: 90, amber: 40 },
  { pilots: 4, green: 90, amber: 35 },
  { pilots: 5, green: 90, amber: 30 },
  { pilots: 6, green: 55, amber: -30 },
  { pilots: 7, green: -25, amber: -100 },
  { pilots: 8, green: -215, amber: -265 }
];

function bandFor(pilots: number) {
  const first = IMD_BANDS[0];
  const last = IMD_BANDS[IMD_BANDS.length - 1];
  return IMD_BANDS.find((b) => b.pilots === pilots) ?? (pilots < first.pilots ? first : last);
}

export function imdTone(reading: ImdReading, pilots: number): 'success' | 'warn' | 'danger' {
  const band = bandFor(pilots);
  if (reading.rating >= band.green) return 'success';
  return reading.rating >= band.amber ? 'warn' : 'danger';
}

export function imdToneHint(reading: ImdReading, pilots: number): string {
  const band = bandFor(pilots);
  const seats = `${pilots} channel${pilots === 1 ? '' : 's'} flying at once`;
  if (reading.rating >= band.green) {
    return `Guidance only: for ${seats}, this is as clean as the sets the hobby recommends.`;
  }
  if (reading.rating >= band.amber) {
    return `Guidance only: for ${seats}, cleaner sets exist — about what one badly-placed channel costs. The worst offender says which.`;
  }
  return `Guidance only: for ${seats}, this rates well below what is achievable, more than one wrong channel would explain. Start with the worst offender.`;
}
