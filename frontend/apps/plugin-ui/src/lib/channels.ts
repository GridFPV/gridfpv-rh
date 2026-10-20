/**
 * The video channel table, copied from RotorHazard 4.4.0's `static/rotorhazard.js` so our
 * picker offers exactly what RotorHazard's does. A seat's frequency in RotorHazard is the
 * MHz number; band + channel are the label RotorHazard stores alongside it (they are null
 * for a custom frequency typed by hand).
 *
 * The six analog bands every racer knows come first and carry their names; the rest are
 * RotorHazard's letter keys for HD and vendor channel sets, listed under "Other" with no
 * name invented for them.
 */

export type Band = {
  key: string;
  name: string;
  channels: Array<{ key: string; channel: number; frequency: number }>;
};

const TABLE: Array<[string, string, Array<[string, number]>]> = [
  [
    'R',
    'Raceband',
    [
      ['R1', 5658],
      ['R2', 5695],
      ['R3', 5732],
      ['R4', 5769],
      ['R5', 5806],
      ['R6', 5843],
      ['R7', 5880],
      ['R8', 5917]
    ]
  ],
  [
    'F',
    'Fatshark',
    [
      ['F1', 5740],
      ['F2', 5760],
      ['F3', 5780],
      ['F4', 5800],
      ['F5', 5820],
      ['F6', 5840],
      ['F7', 5860],
      ['F8', 5880]
    ]
  ],
  [
    'E',
    'Boscam E',
    [
      ['E1', 5705],
      ['E2', 5685],
      ['E3', 5665],
      ['E4', 5645],
      ['E5', 5885],
      ['E6', 5905],
      ['E7', 5925],
      ['E8', 5945]
    ]
  ],
  [
    'B',
    'Boscam B',
    [
      ['B1', 5733],
      ['B2', 5752],
      ['B3', 5771],
      ['B4', 5790],
      ['B5', 5809],
      ['B6', 5828],
      ['B7', 5847],
      ['B8', 5866]
    ]
  ],
  [
    'A',
    'Boscam A',
    [
      ['A1', 5865],
      ['A2', 5845],
      ['A3', 5825],
      ['A4', 5805],
      ['A5', 5785],
      ['A6', 5765],
      ['A7', 5745],
      ['A8', 5725]
    ]
  ],
  [
    'L',
    'Lowband',
    [
      ['L1', 5362],
      ['L2', 5399],
      ['L3', 5436],
      ['L4', 5473],
      ['L5', 5510],
      ['L6', 5547],
      ['L7', 5584],
      ['L8', 5621]
    ]
  ],
  [
    'U',
    '',
    [
      ['U0', 5300],
      ['U1', 5325],
      ['U2', 5348],
      ['U3', 5366],
      ['U4', 5384],
      ['U5', 5402],
      ['U6', 5420],
      ['U7', 5438],
      ['U8', 5456],
      ['U9', 5985]
    ]
  ],
  [
    'D',
    '',
    [
      ['D1', 5660],
      ['D2', 5695],
      ['D3', 5735],
      ['D4', 5770],
      ['D5', 5805],
      ['D6', 5880],
      ['D7', 5914],
      ['D8', 5839]
    ]
  ],
  [
    'J',
    '',
    [
      ['J1', 5695],
      ['J2', 5770],
      ['J3', 5880]
    ]
  ],
  [
    'S',
    '',
    [
      ['S1', 5660],
      ['S2', 5695],
      ['S3', 5735],
      ['S4', 5770],
      ['S5', 5805],
      ['S6', 5839],
      ['S7', 5878],
      ['S8', 5914]
    ]
  ],
  [
    'O',
    '',
    [
      ['O1', 5669],
      ['O2', 5705],
      ['O3', 5768],
      ['O4', 5804],
      ['O5', 5839],
      ['O6', 5876],
      ['O7', 5912]
    ]
  ],
  [
    'Q',
    '',
    [
      ['Q1', 5677],
      ['Q2', 5794],
      ['Q3', 5902]
    ]
  ]
];

/** The bands shown first, in the order racers expect. */
export const COMMON_BAND_KEYS = ['R', 'F', 'E', 'B', 'A', 'L'] as const;

export const BANDS: Band[] = TABLE.map(([key, name, chans]) => ({
  key,
  name,
  channels: chans.map(([k, frequency]) => ({
    key: k,
    channel: Number(k.slice(key.length)),
    frequency
  }))
}));

/** `R1` → 5658, or null for an unknown key. */
export function frequencyFor(bandKey: string, channel: number): number | null {
  const band = BANDS.find((b) => b.key === bandKey);
  return band?.channels.find((c) => c.channel === channel)?.frequency ?? null;
}

/** Display label for what RotorHazard stores: `R1 · 5658`, or just the MHz when untagged. */
export function channelLabel(
  band: string | null | undefined,
  channel: number | null | undefined,
  frequency: number
): string {
  if (frequency === 0) return 'Off';
  if (band && channel) return `${band}${channel} · ${frequency}`;
  return `${frequency} MHz`;
}

/** Best band+channel tag for a bare frequency (first match in table order), or null. */
export function tagFor(frequency: number): { band: string; channel: number } | null {
  for (const band of BANDS) {
    const hit = band.channels.find((c) => c.frequency === frequency);
    if (hit) return { band: band.key, channel: hit.channel };
  }
  return null;
}

export const COMMON_BANDS: Band[] = COMMON_BAND_KEYS.map(
  (k) => BANDS.find((b) => b.key === k) as Band
);
export const OTHER_BANDS: Band[] = BANDS.filter(
  (b) => !(COMMON_BAND_KEYS as readonly string[]).includes(b.key)
);

/** Display name for a band: its hobby name, or just the letter for the rest. */
export function bandName(band: Band): string {
  return band.name ? `${band.key} · ${band.name}` : `Band ${band.key}`;
}

/** RotorHazard's own limits for a hand-typed frequency (settings.html: min 5000, max 6001). */
export const CUSTOM_MIN_MHZ = 5000;
export const CUSTOM_MAX_MHZ = 6000;
