import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addSample,
  differential,
  localMs,
  raceStartInRecording,
} from "../src/clock.js";

test("the differential is the median of samples placed mid round trip, quickest kept", () => {
  let s = [];
  // Timer at 1000.000 s when local is 5000 ms, with round trips of 20 ms (+ one slow outlier).
  s = addSample(s, 1000.0, 4990, 5010); // mid 5000 → diff 995000
  s = addSample(s, 1000.1, 5090, 5110); // mid 5100 → 995000
  s = addSample(s, 1000.3, 5000, 5600); // slow: mid 5300 → 995000 anyway, but response 600
  assert.equal(differential(s), 995000);
  for (let i = 0; i < 12; i++)
    s = addSample(s, 1001 + i * 0.1, 6000 + i * 100 - 5, 6000 + i * 100 + 5);
  assert.equal(s.length, 10);
  assert.ok(
    s.every((x) => x.response === 10),
    "the slow samples were dropped",
  );
  assert.equal(differential([]), null);
});

test("a timer stamp becomes local time, and the start sits in the recording by elapsed time", () => {
  const diff = 995000;
  // Race started at timer 1002.5 s → local 7500 ms.
  const startLocal = localMs(1002.5, diff);
  assert.equal(startLocal, 7500);
  // At local 9500 the race is 2 s old and the recording 6.2 s long: the start is 4.2 s into the file.
  assert.equal(raceStartInRecording(6200, 9500, startLocal), 4200);
  // Recording started 1 s after the start signal.
  assert.equal(raceStartInRecording(1000, 9500, startLocal), -1000);
});
