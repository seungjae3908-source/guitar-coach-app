import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SegmentDirectionalTracker,
  TargetStrokeConsensus,
} from './stroke-consensus-policy.js';

const band = {
  top: -0.12,
  bottom: 0.12,
  normalX: 0,
  normalY: 1,
};

function point(y) {
  return { x: 0.5, y };
}

test('counts one target stroke and treats the opposite crossing as recovery', () => {
  const gate = new TargetStrokeConsensus();
  assert.equal(gate.sample({ direction: 'down', target: 'down', source: 'landmark', timestamp: 1000 }).count, true);
  const recovery = gate.sample({ direction: 'up', target: 'down', source: 'landmark', timestamp: 1250 });
  assert.equal(recovery.count, false);
  assert.equal(recovery.reason, 'recovery');
  assert.equal(recovery.rearmed, true);
  assert.equal(gate.sample({ direction: 'down', target: 'down', source: 'landmark', timestamp: 1500 }).count, true);
});

test('suppresses landmark and motion duplicates from the same physical stroke', () => {
  const gate = new TargetStrokeConsensus();
  assert.equal(gate.sample({ direction: 'down', target: 'down', source: 'landmark', timestamp: 1000 }).count, true);
  const motionDuplicate = gate.sample({ direction: 'down', target: 'down', source: 'motion', timestamp: 1110 });
  assert.equal(motionDuplicate.count, false);
  assert.equal(motionDuplicate.reason, 'same-stroke-duplicate');
});

test('uses motion only when a landmark did not already cover the stroke', () => {
  const gate = new TargetStrokeConsensus();
  const motion = gate.sample({ direction: 'down', target: 'down', source: 'motion', timestamp: 1000 });
  assert.equal(motion.count, true);
  assert.equal(motion.reason, 'motion-fallback');

  gate.sample({ direction: 'up', target: 'down', source: 'motion', timestamp: 1280 });
  gate.sample({ direction: 'down', target: 'down', source: 'landmark', timestamp: 1600 });
  gate.sample({ direction: 'up', target: 'down', source: 'landmark', timestamp: 1840 });
  const covered = gate.sample({ direction: 'down', target: 'down', source: 'motion', timestamp: 1880 });
  assert.equal(covered.count, false);
  assert.equal(covered.reason, 'landmark-already-covered');
});

test('rearms after a bounded timeout when the return crossing is missed', () => {
  const gate = new TargetStrokeConsensus({ rearmTimeoutMs: 600 });
  assert.equal(gate.sample({ direction: 'up', target: 'up', timestamp: 1000 }).count, true);
  assert.equal(gate.sample({ direction: 'up', target: 'up', timestamp: 1400 }).count, false);
  assert.equal(gate.sample({ direction: 'up', target: 'up', timestamp: 1650 }).count, true);
});

test('segment tracker catches a full down and up crossing', () => {
  const tracker = new SegmentDirectionalTracker({ cooldownMs: 0 });
  assert.equal(tracker.sample({ point: point(-0.2), band, timestamp: 0 }), null);
  assert.equal(tracker.sample({ point: point(0.2), band, timestamp: 100 }), 'down');
  assert.equal(tracker.sample({ point: point(-0.2), band, timestamp: 220 }), 'up');
});

test('segment tracker infers a low-fps crossing when the first sample lands inside the band', () => {
  const tracker = new SegmentDirectionalTracker({ cooldownMs: 0, partialTravel: 0.01 });
  assert.equal(tracker.sample({ point: point(0), band, timestamp: 0 }), null);
  assert.equal(tracker.sample({ point: point(0.18), band, timestamp: 90 }), 'down');

  tracker.reset();
  assert.equal(tracker.sample({ point: point(0), band, timestamp: 0 }), null);
  assert.equal(tracker.sample({ point: point(-0.18), band, timestamp: 90 }), 'up');
});

test('segment tracker rejects small jitter inside the string band', () => {
  const tracker = new SegmentDirectionalTracker({ cooldownMs: 0, partialTravel: 0.02 });
  assert.equal(tracker.sample({ point: point(-0.01), band, timestamp: 0 }), null);
  assert.equal(tracker.sample({ point: point(0.005), band, timestamp: 80 }), null);
  assert.equal(tracker.sample({ point: point(-0.004), band, timestamp: 160 }), null);
});

test('segment tracker resets after a long detector gap', () => {
  const tracker = new SegmentDirectionalTracker({ cooldownMs: 0, maximumSampleGapMs: 300 });
  assert.equal(tracker.sample({ point: point(-0.2), band, timestamp: 0 }), null);
  assert.equal(tracker.sample({ point: point(0.2), band, timestamp: 500 }), null);
});
