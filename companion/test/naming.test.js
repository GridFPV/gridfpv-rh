import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { firstLapCountsOf, outputsFor, renderStem, runNameOf } from '../src/render.js';

test('a render is named after its clean recording, so a round recorded twice keeps its " (2)"; else after the run', () => {
  const name = 'Spring Cup Open Heat 2 Round 3';
  assert.equal(renderStem({ recording: `/rec/${name} - Clean.mkv` }, name), name);
  assert.equal(renderStem({ recording: `/rec/${name} - Clean (2).mkv` }, name), `${name} (2)`);
  assert.equal(renderStem({ recording: '/rec/clean heat 2 2026-11-01 15-01-16.mp4' }, name), name);
  assert.equal(renderStem({}, name), name);
  const out = outputsFor({ composite: true, overlayOnly: 'vp9' }, '/out', `${name} (2)`);
  assert.deepEqual(out, {
    composite: path.join('/out', `${name} (2) - Overlay.mp4`),
    overlay: path.join('/out', `${name} (2) - Overlay alpha.webm`)
  });
});

test("the run's name prefers the page's file name over its title; the first-lap flag follows the start behaviour", () => {
  const data = { heat_id: 2, round: 3, name: 'kept' };
  assert.equal(
    runNameOf({ runName: 'E C H Round 3', title: 'H · Round 3' }, data),
    'E C H Round 3'
  );
  assert.equal(runNameOf({ title: 'H · Round 3' }, data), 'H · Round 3');
  assert.equal(runNameOf({}, data), 'kept');
  assert.equal(runNameOf({}, { heat_id: 2, round: 3 }), 'heat 2 round 3');
  assert.equal(firstLapCountsOf({ startBehavior: 1 }), true);
  assert.equal(firstLapCountsOf({ startBehavior: 0 }), false);
  assert.equal(firstLapCountsOf({}), null);
});
