"""Capture-mode tuning: record one seat's RSSI outside a race.

Two streams, because they answer different questions:

- **Samples** — ``node.current_rssi`` read on every tick (20 Hz). This is the level the node
  reports, the same thing RotorHazard's own tuning page plots from the heartbeat, and it is
  what the trace draws: a steady line.
- **History** — RotorHazard's dense history (``node.history_values``), which on real
  hardware is the peak and the nadir of each ~100 ms node read, backdated by the node's own
  offsets. It zigzags between extremes, so it is wrong to draw as "the signal", but it is
  what the Marshal page recalculates laps from and it catches a peak that falls between two
  samples — so detection runs on samples and history merged.

RotorHazard keeps that history as a rolling window while no race is running
(``BaseHardwareInterface.process_history`` prunes to the last 60 s), and the node's
``crossing_flag`` still flips as the firmware sees passes. A capture runs for as long as the
director wants, so they can fly a handful of passes, stop, and tune enter/exit on the
recording the way Marshal works on a saved race.

One capture at a time per server. Everything here is plain data in; the socket wiring is
in ``__init__``. Times are RotorHazard's monotonic seconds, as the node reports them.
"""

import logging
from time import monotonic

logger = logging.getLogger(__name__)

#: How often the recorder samples current RSSI, copies new history and checks the crossing
#: flag. Real nodes are read at 10 Hz (RHInterface UPDATE_SLEEP); 20 Hz avoids aliasing that.
TICK_SECONDS = 0.05
#: How often a progress chunk is broadcast while recording.
CHUNK_SECONDS = 1.0
#: Guard against a forgotten capture eating memory: ~67 Hz × 10 min.
MAX_SAMPLES = 67 * 600
#: How much of RotorHazard's existing window a new capture starts with, so the trace shows
#: the current level without 60 s of pre-roll squashing the passes to the right edge.
SEED_SECONDS = 3.0


class Capture:
    """The in-memory recording for one seat."""

    def __init__(self, seat: int):
        self.seat = seat
        self.started_at = monotonic()
        self.stopped_at = None
        #: History extrema, as RotorHazard reports them (see module docstring).
        self.times = []
        self.values = []
        #: Current-RSSI samples, one per tick: the drawn trace.
        self.sample_times = []
        self.sample_values = []
        #: Firmware-detected crossings: dicts with enter / exit (None while open) / peak.
        self.crossings = []
        self._last_time = None
        self._was_crossing = False
        self._chunk_from = 0
        self._sample_chunk_from = 0

    @property
    def recording(self) -> bool:
        return self.stopped_at is None

    def absorb(self, node) -> int:
        """Copy the history entries RotorHazard appended since our last look.

        RotorHazard's list is append-only at the back (pruned from the front while idle,
        and the last entry's time may be pushed later in place when a value repeats), but
        it is **not** time-ordered: one node read appends its peak and its nadir, each
        backdated by the node's own offsets, so a time-based "newer than what we have"
        filter silently drops half the signal. Instead we find the last entry we copied
        (by value and time) and take everything after it.
        """
        times = list(node.history_times or [])
        values = list(node.history_values or [])
        n = min(len(times), len(values))
        start = self._resume_index(times, values, n)
        added = 0
        for i in range(start, n):
            self.times.append(times[i])
            self.values.append(values[i])
            self._last_time = times[i]
            added += 1
        self._check_cap()
        return added

    def sample(self, node) -> None:
        """Record the node's current RSSI now (the drawn trace)."""
        value = getattr(node, "current_rssi", None)
        if value is None:
            return
        self.sample_times.append(monotonic())
        self.sample_values.append(int(value))
        self._check_cap()

    def _check_cap(self) -> None:
        if len(self.times) + len(self.sample_times) > MAX_SAMPLES and self.stopped_at is None:
            logger.warning("gridfpv capture: seat %d hit %d samples, stopping", self.seat, MAX_SAMPLES)
            self.stopped_at = monotonic()

    def _resume_index(self, times, values, n) -> int:
        """Index in RotorHazard's list of the first entry we have not copied yet."""
        if not self.times:
            return 0
        last_t, last_v = self.times[-1], self.values[-1]
        # Exact anchor, newest first (the list is short and the anchor is near the end).
        for j in range(n - 1, -1, -1):
            if values[j] == last_v and abs(times[j] - last_t) < 1e-9:
                return j + 1
        # RotorHazard extends the last entry's time in place when a value repeats; our
        # copy then holds the old time. Match on value where the time moved later.
        for j in range(n - 1, 0, -1):
            if values[j] == last_v and values[j - 1] == last_v and times[j] > last_t:
                self.times[-1] = times[j]
                self._last_time = times[j]
                return j + 1
        # Anchor pruned away (we were not looking for over a minute): take what is newer.
        return next((i for i in range(n) if times[i] > last_t), n)

    def note_crossing_flag(self, crossing: bool, node) -> None:
        """Record firmware crossing edges (enter when the flag rises, exit when it falls)."""
        if crossing and not self._was_crossing:
            self.crossings.append({"enter": self._last_time, "exit": None, "peak": None})
        elif not crossing and self._was_crossing and self.crossings:
            last = self.crossings[-1]
            if last["exit"] is None:
                last["exit"] = self._last_time
                last["peak"] = getattr(node, "pass_peak_rssi", None)
        self._was_crossing = crossing

    def trim_to_last(self, seconds: float) -> None:
        """Drop history older than the newest entry minus ``seconds`` (the capture's lead-in)."""
        if not self.times:
            return
        cutoff = self.times[-1] - seconds
        keep = 0
        while keep < len(self.times) and self.times[keep] < cutoff:
            keep += 1
        if keep:
            del self.times[:keep]
            del self.values[:keep]
            self._chunk_from = max(0, self._chunk_from - keep)

    def stop(self) -> None:
        if self.stopped_at is None:
            self.stopped_at = monotonic()

    def chunk(self) -> dict:
        """Everything since the last chunk, for live progress while recording."""
        start = self._chunk_from
        self._chunk_from = len(self.times)
        sstart = self._sample_chunk_from
        self._sample_chunk_from = len(self.sample_times)
        return {
            "seat": self.seat,
            "times": self.times[start:],
            "values": self.values[start:],
            "sample_times": self.sample_times[sstart:],
            "sample_values": self.sample_values[sstart:],
            "samples": len(self.sample_times),
            "seconds": round(monotonic() - self.started_at, 1),
        }

    def summary(self) -> dict:
        return {
            "seat": self.seat,
            "state": "recording" if self.recording else "done",
            "samples": len(self.sample_times),
            "seconds": round((self.stopped_at or monotonic()) - self.started_at, 1),
        }

    def full(self, node=None) -> dict:
        out = {
            **self.summary(),
            "times": self.times,
            "values": self.values,
            "sample_times": self.sample_times,
            "sample_values": self.sample_values,
            "crossings": self.crossings,
        }
        if node is not None:
            out["enter"] = getattr(node, "enter_at_level", None)
            out["exit"] = getattr(node, "exit_at_level", None)
            out["frequency"] = getattr(node, "frequency", None)
        return out


class Recorder:
    """Drives one Capture from a periodic tick. The caller owns the timer (a gevent
    greenlet in RotorHazard, a plain loop in tests) and the broadcast."""

    def __init__(self, seats_fn, on_chunk, on_done):
        self._seats = seats_fn
        self._on_chunk = on_chunk
        self._on_done = on_done
        self.capture = None
        self._last_chunk_at = 0.0

    def start(self, seat: int) -> dict:
        seats = self._seats() or []
        if seat < 0 or seat >= len(seats):
            raise ValueError(f"seat {seat} out of range (0..{len(seats) - 1})")
        if self.capture is not None and self.capture.recording:
            self.capture.stop()
        self.capture = Capture(seat)
        self._last_chunk_at = monotonic()
        node = seats[seat]
        # Seed with the tail of what RotorHazard already holds so the trace is not empty
        # while the pilot is still walking to the line.
        self.capture.absorb(node)
        self.capture.trim_to_last(SEED_SECONDS)
        self.capture.sample(node)
        self.capture.note_crossing_flag(bool(getattr(node, "crossing_flag", False)), node)
        return self.capture.summary()

    def stop(self) -> dict | None:
        if self.capture is None:
            return None
        if self.capture.recording:
            node = self._node()
            if node is not None:
                self.capture.absorb(node)
                self.capture.sample(node)
            self.capture.stop()
            self._on_done(self.capture.full(node))
        return self.capture.summary()

    def tick(self) -> None:
        cap = self.capture
        if cap is None or not cap.recording:
            return
        node = self._node()
        if node is None:
            cap.stop()
            self._on_done(cap.full())
            return
        cap.sample(node)
        cap.absorb(node)
        cap.note_crossing_flag(bool(getattr(node, "crossing_flag", False)), node)
        if not cap.recording:  # hit the sample cap
            self._on_done(cap.full(node))
            return
        now = monotonic()
        if now - self._last_chunk_at >= CHUNK_SECONDS:
            self._last_chunk_at = now
            self._on_chunk(cap.chunk())

    def current(self) -> dict | None:
        if self.capture is None:
            return None
        return self.capture.full(self._node())

    def _node(self):
        seats = self._seats() or []
        if self.capture is None or self.capture.seat >= len(seats):
            return None
        return seats[self.capture.seat]
