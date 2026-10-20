"""Generate mock_data_1.csv: a realistic emulated signal for RotorHazard's mock node 1.

RotorHazard's MockInterface (MOCK_NODE_SIGNAL=1) reads one CSV row per update tick and
feeds it through the real lap pipeline. Columns, from `MockInterface.update()` 4.4.0:

    0 unused, 1 lap_id, 2 ms_val, 3 rssi, 4 node_peak_rssi, 5 pass_peak_rssi, 6 loop_time,
    7 cross_flag (T/F), 8 pass_nadir_rssi, 9 node_nadir_rssi,
    10 pn.peakRssi, 11 pn.peakFirstTime, 12 pn.peakLastTime,
    13 pn.nadirRssi, 14 pn.nadirFirstTime, 15 pn.nadirLastTime

The peak/nadir columns are what become the node's dense history (PeakNadirHistory.addTo):
we report every sample as a peak with equal first/last times (1 ms ago) and no nadir, so
the history is simply the signal, one entry per tick.

The signal: a noisy baseline with a gate pass every few seconds. Clean passes are smooth
bells; every third pass is "bouncy" — three narrow bells with dips between them, the shape
that produces 5–6 crossings per real pass at RotorHazard's default enter 90 / exit 80.

    python3 gen_mock_data.py > mock_data_1.csv
"""

import math
import random

random.seed(7)

TICK_MS = 15
SECONDS = 40
ROWS = SECONDS * 1000 // TICK_MS
BASELINE = 34
ENTER, EXIT = 90, 80  # RotorHazard's mock defaults; only used to set the crossing flag


def bell(t, center, width, peak):
    """Raised-cosine bump of `width` seconds centred on `center`, 0 outside."""
    x = (t - center) / width
    if abs(x) > 0.5:
        return 0.0
    return (peak - BASELINE) * (0.5 + 0.5 * math.cos(2 * math.pi * x))


passes = []  # (center_s, kind, peak)
t = 3.5
k = 0
while t < SECONDS - 2:
    passes.append((t, "bouncy" if k % 3 == 2 else "clean", random.randint(135, 165)))
    t += random.uniform(4.5, 6.5)
    k += 1


def signal(t):
    v = BASELINE + random.uniform(-2, 2)
    for center, kind, peak in passes:
        if kind == "clean":
            v += bell(t, center, 0.7, peak)
        else:
            for j, off in enumerate((-0.26, 0.0, 0.26)):
                v += bell(t, center + off, 0.22, peak - 6 * j)
    return max(1, min(255, int(round(v))))


lap_id = 0
pass_peak = 0
crossing = False
rows = []
for i in range(ROWS):
    t = i * TICK_MS / 1000.0
    rssi = signal(t)
    if not crossing and rssi > ENTER:
        crossing = True
        pass_peak = rssi
    elif crossing:
        pass_peak = max(pass_peak, rssi)
        if rssi < EXIT:
            crossing = False
            lap_id += 1
    rows.append(
        ",".join(
            str(x)
            for x in (
                0,
                lap_id,
                i * TICK_MS,
                rssi,
                170,  # node peak
                pass_peak,
                10,  # loop time
                "T" if crossing else "F",
                20,  # pass nadir
                20,  # node nadir
                rssi,
                1,
                1,  # one history entry per tick, 1 ms ago
                0,
                0,
                0,  # no nadir entry
            )
        )
    )

print("\n".join(rows))
