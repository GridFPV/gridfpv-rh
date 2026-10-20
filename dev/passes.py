"""Inject gate passes into a mock seat on the dev rig (`make rig-passes`).

Runs inside the container (RotorHazard's python-socketio is there) and talks to Grid's
mock plugin, which appends a smooth RSSI bell to the node's dense history. With BOUNCY=1
each pass is three quick bells with shallow dips between them — the "5–6 crossings per
gate pass" shape the tuning screen exists to fix.

    python3 passes.py <seat> <count> <bouncy>
"""

import random
import sys
import time

import socketio

seat = int(sys.argv[1]) if len(sys.argv) > 1 else 0
count = int(sys.argv[2]) if len(sys.argv) > 2 else 4
bouncy = (sys.argv[3] if len(sys.argv) > 3 else "0") not in ("0", "", "false")

sio = socketio.Client()
acks = []
sio.on("gridfpv_mock_ack", acks.append)
sio.connect("http://localhost:5000", wait_timeout=10)


def bell(peak, width, sample_ms=15.0, baseline=70):
    sio.emit(
        "gridfpv_mock_pass",
        {"node": seat, "peak": peak, "baseline": baseline, "width": width, "sample_ms": sample_ms},
    )


for i in range(count):
    peak = random.randint(125, 165)
    if bouncy:
        # Three narrow bells back to back; the dips between them sit around peak-35, so an
        # exit level above that splits one pass into three.
        for j in range(3):
            bell(peak - random.randint(0, 12), width=14)
            time.sleep(0.21)
    else:
        bell(peak, width=40)  # ~600 ms wide at 15 ms per sample
    print(f"pass {i + 1}/{count}: peak {peak}{' (bouncy)' if bouncy else ''}")
    time.sleep(1.5)

time.sleep(0.5)
sio.disconnect()
print(f"done: {count} pass(es) on seat {seat + 1}; mock acks: {len(acks)}")
