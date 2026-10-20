"""Capture-mode recording over fake nodes, and the socket wiring around it."""

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from test_plugin import FakeRhapi  # noqa: E402

import gridfpv  # noqa: E402
from gridfpv import capture  # noqa: E402


class FakeNode:
    def __init__(self):
        self.history_times = []
        self.history_values = []
        self.crossing_flag = False
        self.pass_peak_rssi = 0
        self.enter_at_level = 70
        self.exit_at_level = 50
        self.frequency = 5658

    def sample(self, t, v):
        self.history_times.append(t)
        self.history_values.append(v)

    def prune_before(self, t):
        """RotorHazard drops samples older than 60 s while idle; emulate that."""
        while self.history_times and self.history_times[0] < t:
            self.history_times.pop(0)
            self.history_values.pop(0)


class CaptureTests(unittest.TestCase):
    def test_absorb_copies_only_new_samples_and_survives_pruning(self):
        node = FakeNode()
        for t in range(5):
            node.sample(t, 10 + t)
        cap = capture.Capture(seat=0)
        self.assertEqual(cap.absorb(node), 5)
        self.assertEqual(cap.absorb(node), 0)  # nothing new
        node.sample(5, 99)
        node.prune_before(3)  # RH pruned the old samples; we keep our copy
        self.assertEqual(cap.absorb(node), 1)
        self.assertEqual(cap.times, [0, 1, 2, 3, 4, 5])
        self.assertEqual(cap.values, [10, 11, 12, 13, 14, 99])

    def test_absorb_keeps_out_of_order_peak_and_nadir_entries_from_one_read(self):
        # One node read appends peak then nadir, each backdated: times go 9.998, 9.999,
        # 9.997, 9.998. A time-based filter would drop the nadir pair; we must keep all.
        node = FakeNode()
        cap = capture.Capture(seat=0)
        node.sample(9.998, 150)
        node.sample(9.999, 150)
        node.sample(9.997, 30)
        node.sample(9.998, 30)
        self.assertEqual(cap.absorb(node), 4)
        node.sample(10.013, 150)
        node.sample(10.012, 30)
        self.assertEqual(cap.absorb(node), 2)
        self.assertEqual(cap.values, [150, 150, 30, 30, 150, 30])

    def test_absorb_follows_an_entry_whose_time_was_extended_in_place(self):
        node = FakeNode()
        cap = capture.Capture(seat=0)
        node.sample(1.0, 40)
        node.sample(1.1, 40)
        cap.absorb(node)
        node.history_times[-1] = 1.5  # RH's _addEntry extends the repeat instead of appending
        node.sample(1.6, 90)
        self.assertEqual(cap.absorb(node), 1)
        self.assertEqual(cap.times, [1.0, 1.5, 1.6])
        self.assertEqual(cap.values, [40, 40, 90])

    def test_crossing_edges_become_enter_exit_pairs_with_peak(self):
        node = FakeNode()
        cap = capture.Capture(seat=0)
        node.sample(1.0, 20)
        cap.absorb(node)
        cap.note_crossing_flag(False, node)
        node.sample(2.0, 90)
        cap.absorb(node)
        cap.note_crossing_flag(True, node)  # rises at t=2
        node.sample(3.0, 30)
        node.pass_peak_rssi = 95
        cap.absorb(node)
        cap.note_crossing_flag(False, node)  # falls at t=3
        self.assertEqual(cap.crossings, [{"enter": 2.0, "exit": 3.0, "peak": 95}])

    def test_stop_marks_done_and_full_carries_node_thresholds(self):
        node = FakeNode()
        node.sample(0, 1)
        cap = capture.Capture(seat=2)
        cap.absorb(node)
        self.assertTrue(cap.recording)
        cap.stop()
        self.assertFalse(cap.recording)
        full = cap.full(node)
        self.assertEqual((full["seat"], full["state"], full["samples"]), (2, "done", 1))
        self.assertEqual((full["enter"], full["exit"], full["frequency"]), (70, 50, 5658))

    def test_sample_cap_stops_the_capture(self):
        node = FakeNode()
        for t in range(capture.MAX_SAMPLES + 5):
            node.sample(t, 1)
        cap = capture.Capture(seat=0)
        cap.absorb(node)
        self.assertFalse(cap.recording)


class RecorderTests(unittest.TestCase):
    def setUp(self):
        self.nodes = [FakeNode(), FakeNode()]
        self.chunks = []
        self.done = []
        self.rec = capture.Recorder(
            seats_fn=lambda: self.nodes,
            on_chunk=self.chunks.append,
            on_done=self.done.append,
        )

    def test_start_seeds_the_tail_of_existing_history_and_rejects_bad_seats(self):
        self.nodes[1].sample(0.5, 7)  # older than SEED_SECONDS before the newest: dropped
        self.nodes[1].sample(10.0, 41)
        self.nodes[1].sample(10.5, 42)
        summary = self.rec.start(1)
        self.assertEqual(summary["state"], "recording")
        self.assertEqual(self.rec.capture.values, [41, 42])
        with self.assertRaises(ValueError):
            self.rec.start(7)

    def test_tick_absorbs_and_stop_broadcasts_the_full_trace(self):
        self.rec.start(0)
        self.nodes[0].sample(1.0, 80)
        self.nodes[0].crossing_flag = True
        self.rec.tick()
        self.nodes[0].sample(2.0, 20)
        self.nodes[0].crossing_flag = False
        self.nodes[0].pass_peak_rssi = 80
        self.rec.tick()
        summary = self.rec.stop()
        self.assertEqual(summary["state"], "done")
        (full,) = self.done
        self.assertEqual(full["values"], [80, 20])
        self.assertEqual(full["crossings"], [{"enter": 1.0, "exit": 2.0, "peak": 80}])
        self.assertEqual(full["enter"], 70)
        self.rec.tick()  # idle: no error, nothing more broadcast
        self.assertEqual(len(self.done), 1)

    def test_chunks_are_sent_about_once_a_second(self):
        self.rec.start(0)
        self.rec._last_chunk_at -= capture.CHUNK_SECONDS + 1  # pretend a second passed
        self.nodes[0].sample(1.0, 5)
        self.rec.tick()
        (chunk,) = self.chunks
        self.assertEqual((chunk["seat"], chunk["values"]), (0, [5]))
        self.rec.tick()  # too soon for another
        self.assertEqual(len(self.chunks), 1)


class SocketWiringTests(unittest.TestCase):
    def test_capture_events_round_trip_through_the_fake_rhapi(self):
        rhapi = FakeRhapi(seats=2)
        node = FakeNode()
        node.sample(0.0, 11)
        rhapi.interface.seats = [FakeNode(), node]
        gridfpv.initialize(rhapi, static_dir="/nonexistent", start_loop=False)
        self.assertIn(gridfpv.EVT_CAPTURE_START, rhapi.listeners)

        rhapi.listeners[gridfpv.EVT_CAPTURE_START]({"seat": 1})
        event, payload = rhapi.ui.socket_broadcast.call_args_list[-1][0]
        self.assertEqual(event, gridfpv.EVT_CAPTURE)
        self.assertEqual((payload["seat"], payload["state"]), (1, "recording"))

        rhapi.listeners[gridfpv.EVT_HELLO]({})
        hello = rhapi.sent[-1][1]
        self.assertEqual(hello["capture"]["state"], "recording")

        rhapi.listeners[gridfpv.EVT_CAPTURE_STOP]({})
        event, payload = rhapi.ui.socket_broadcast.call_args_list[-1][0]
        self.assertEqual(event, gridfpv.EVT_CAPTURE)
        self.assertEqual((payload["state"], payload["values"]), ("done", [11]))

        rhapi.listeners[gridfpv.EVT_CAPTURE_GET]({})
        self.assertEqual(rhapi.sent[-1][1]["state"], "done")

    def test_bad_seat_alerts_instead_of_raising(self):
        rhapi = FakeRhapi(seats=1)
        gridfpv.initialize(rhapi, static_dir="/nonexistent", start_loop=False)
        rhapi.listeners[gridfpv.EVT_CAPTURE_START]({"seat": 9})
        rhapi.ui.message_alert.assert_called_once()


if __name__ == "__main__":
    unittest.main()
