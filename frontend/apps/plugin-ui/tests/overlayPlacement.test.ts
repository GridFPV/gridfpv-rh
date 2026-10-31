import { describe, expect, it } from 'vitest';
import {
  applyPlacement,
  DEFAULT_PLACEMENT,
  placementStyle,
  samePlacement
} from '../src/lib/overlayPlacement.js';

describe('overlay placement', () => {
  it("reads the timer's record field by field, falling back where a value is off", () => {
    expect(applyPlacement(null)).toEqual(DEFAULT_PLACEMENT);
    expect(applyPlacement({ corner: 'bottom-right', x: '40', y: 30.4, scale: 150 })).toEqual({
      corner: 'bottom-right',
      x: 40,
      y: 30,
      scale: 150
    });
    expect(applyPlacement({ corner: 'middle', x: -1, y: 'far', scale: 400 })).toEqual(
      DEFAULT_PLACEMENT
    );
  });
  it('pins the panel to its corner and scales about it', () => {
    expect(placementStyle(DEFAULT_PLACEMENT)).toBe(
      'top: 24px; left: 24px; transform: scale(1); transform-origin: top left;'
    );
    expect(placementStyle({ corner: 'bottom-right', x: 40, y: 30, scale: 150 })).toBe(
      'bottom: 30px; right: 40px; transform: scale(1.5); transform-origin: bottom right;'
    );
  });
  it("in a bottom corner, once laps hang below the head, pins the head's top so the laps grow down", () => {
    const p = { corner: 'bottom-right' as const, x: 40, y: 30, scale: 150 };
    // The head is 200 px tall unscaled, 300 px drawn: its top sits at 100vh - 30 - 300.
    expect(placementStyle(p, { headPx: 200, hangs: true })).toBe(
      'top: calc(100vh - 30px - 300px); right: 40px; transform: scale(1.5); transform-origin: top right;'
    );
    // Not measured yet, or nothing hanging: pinned by the bottom edge, the same place.
    expect(placementStyle(p, { headPx: 0, hangs: true })).toContain('bottom: 30px');
    expect(placementStyle(p, { headPx: 200, hangs: false })).toContain('bottom: 30px');
    // A top corner grows down by itself.
    expect(placementStyle({ ...p, corner: 'top-left' }, { headPx: 200, hangs: true })).toBe(
      'top: 30px; left: 40px; transform: scale(1.5); transform-origin: top left;'
    );
  });
  it('compares placements', () => {
    expect(samePlacement(DEFAULT_PLACEMENT, applyPlacement({}))).toBe(true);
    expect(samePlacement(DEFAULT_PLACEMENT, { ...DEFAULT_PLACEMENT, x: 25 })).toBe(false);
  });
});
