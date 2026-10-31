/**
 * Where the race overlay sits (#96): the corner the panel hangs from, pixels in from its
 * edges, and its size as a percentage. One placement for every page that draws the
 * overlay — the live page in OBS, the replay page, and so every render the video companion
 * makes — stored on the timer (`gridfpv_overlay`), so they all agree.
 */
export const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export type Corner = (typeof CORNERS)[number];
export const CORNER_LABELS: Record<Corner, string> = {
  'top-left': 'Top left',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right'
};

export type OverlayPlacement = { corner: Corner; x: number; y: number; scale: number };
export const DEFAULT_PLACEMENT: OverlayPlacement = { corner: 'top-left', x: 24, y: 24, scale: 100 };
export const OFFSET_MAX = 4000;
export const SCALE_MIN = 25;
export const SCALE_MAX = 300;

const intIn = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= lo && n <= hi ? n : d;
};

/** `gridfpv_overlay`, tolerant field by field. */
export function applyPlacement(raw: unknown): OverlayPlacement {
  const p = (raw ?? {}) as Record<string, unknown>;
  return {
    corner: (CORNERS as readonly string[]).includes(String(p.corner))
      ? (p.corner as Corner)
      : DEFAULT_PLACEMENT.corner,
    x: intIn(p.x, 0, OFFSET_MAX, DEFAULT_PLACEMENT.x),
    y: intIn(p.y, 0, OFFSET_MAX, DEFAULT_PLACEMENT.y),
    scale: intIn(p.scale, SCALE_MIN, SCALE_MAX, DEFAULT_PLACEMENT.scale)
  };
}

/** The panel's inline style: pinned to its corner, scaled about that corner. */
export function placementStyle(p: OverlayPlacement): string {
  const [v, h] = p.corner.split('-') as ['top' | 'bottom', 'left' | 'right'];
  return `${v}: ${p.y}px; ${h}: ${p.x}px; transform: scale(${p.scale / 100}); transform-origin: ${v} ${h};`;
}

export function samePlacement(a: OverlayPlacement, b: OverlayPlacement): boolean {
  return a.corner === b.corner && a.x === b.x && a.y === b.y && a.scale === b.scale;
}
