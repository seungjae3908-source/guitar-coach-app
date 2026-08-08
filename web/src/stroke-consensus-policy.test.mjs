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

test('counts compact return strokes when the opposite crossing rearms the gate', () => {
  const gate = new TargetStrokeConsensus();
  assert.equal(gate.sample({ direction: 'down', target: 'down', source: 'landmark', timestamp: 1000 }).count, true);
  assert.equal(gate.sample({ direction: 'up', target: 'down', source: 'landmark', timestamp: 1080 }).reason, 'recovery');
  assert.equal(gate.sample({ direction: 'down', target: 'down', source: 'landmark', timestamp: 1160 }).count, true);
  assert.equal(gate.sample({ direction: 'up', target: 'down', source: 'landmark', timestamp: 1240 }).reason, 'recovery');
  assert.equal(gate.sample({ direction: 'down', target: 'down', source: 'landmark', timestamp: 1320 }).count, true);
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

test('segment tracker recognizes a natural wrist stroke without leaving the string band', () => {
  const tracker = new SegmentDirectionalTracker({
    cooldownMs: 0,
    minimumCenterTravel: 0.012,
  });
  assert.equal(tracker.sample({ point: point(-0.024), band, timestamp: 0 }), null);
  assert.equal(tracker.sample({ point: point(-0.004), band, timestamp: 90 }), null);
  assert.equal(tracker.sample({ point: point(0.022), band, timestamp: 180 }), 'down');
  assert.equal(tracker.sample({ point: point(0.003), band, timestamp: 270 }), null);
  assert.equal(tracker.sample({ point: point(-0.023), band, timestamp: 360 }), 'up');
});

test('segment tracker catches a compact low-fps center crossing', () => {
  const tracker = new SegmentDirectionalTracker({
    cooldownMs: 0,
    minimumCenterTravel: 0.012,
  });
  assert.equal(tracker.sample({ point: point(-0.02), band, timestamp: 0 }), null);
  assert.equal(tracker.sample({ point: point(0.02), band, timestamp: 120 }), 'down');
});

test('runtime compact tracker recognizes a six-pixel wrist crossing without accepting rest jitter', () => {
  const tracker = new SegmentDirectionalTracker({
    cooldownMs: 0,
    minimumTravel: 0.012,
    partialTravel: 0.006,
    minimumCenterTravel: 0.0065,
    centerDeadZoneRatio: 0.02,
    minimumCenterDeadZone: 0.0022,
    maximumCenterDeadZone: 0.0042,
  });
  for (const [timestamp, y] of [[0, -0.0025], [40, 0.0018], [80, -0.0017], [120, 0.0024]]) {
    assert.equal(tracker.sample({ point: point(y), band, timestamp }), null);
  }
  assert.equal(tracker.sample({ point: point(-0.0075), band, timestamp: 180 }), null);
  assert.equal(tracker.sample({ point: point(0.0075), band, timestamp: 236 }), 'down');
  assert.equal(tracker.sample({ point: point(-0.0075), band, timestamp: 292 }), 'up');
});

test('segment tracker keeps screen-down direction when the guitar axis reverses', () => {
  const tracker = new SegmentDirectionalTracker({ cooldownMs: 0 });
  const forwardBand = {
    top: 0.28,
    bottom: 0.32,
    normalX: 0,
    normalY: 1,
  };
  const reversedBand = {
    top: -0.32,
    bottom: -0.28,
    normalX: 0,
    normalY: -1,
  };

  assert.equal(tracker.sample({ point: point(0.29), band: forwardBand, timestamp: 0 }), null);
  assert.equal(tracker.sample({ point: point(0.31), band: reversedBand, timestamp: 100 }), 'down');
  assert.equal(tracker.sample({ point: point(0.29), band: forwardBand, timestamp: 220 }), 'up');
});

test('segment tracker reports the same directions with an already reversed normal', () => {
  const tracker = new SegmentDirectionalTracker({ cooldownMs: 0 });
  const reversedBand = {
    top: -0.12,
    bottom: 0.12,
    normalX: 0,
    normalY: -1,
  };

  assert.equal(tracker.sample({ point: point(-0.02), band: reversedBand, timestamp: 0 }), null);
  assert.equal(tracker.sample({ point: point(0.02), band: reversedBand, timestamp: 100 }), 'down');
  assert.equal(tracker.sample({ point: point(-0.02), band: reversedBand, timestamp: 220 }), 'up');
});

test('segment tracker infers a low-fps crossing when the first sample lands inside the band', () => {
  const tracker = new SegmentDirectionalTracker({ cooldownMs: 0, partialTravel: 0.01 });
  assert.equal(tracker.sample({ point: point(0), band, timestamp: 0 }), null);
  assert.equal(tracker.sample({ point: point(0.18), band, timestamp: 90 }), 'down');

  tracker.reset();
  assert.equal(tracker.sample({ point: point(0), band, timestamp: 0 }), null);
  assert.equal(tracker.sample({ point: point(-0.18), band, timestamp: 90 }), 'up');
});

test('segment tracker rejects small jitter around the string center', () => {
  const tracker = new SegmentDirectionalTracker({ cooldownMs: 0 });
  for (const [timestamp, y] of [[0, -0.003], [80, 0.002], [160, -0.002], [240, 0.003]]) {
    assert.equal(tracker.sample({ point: point(y), band, timestamp }), null);
  }
});

test('segment tracker rejects one-sided movement that never crosses the center', () => {
  const tracker = new SegmentDirectionalTracker({ cooldownMs: 0 });
  for (const [timestamp, y] of [[0, -0.045], [80, -0.03], [160, -0.018], [240, -0.012]]) {
    assert.equal(tracker.sample({ point: point(y), band, timestamp }), null);
  }
});

test('segment tracker resets after a long detector gap', () => {
  const tracker = new SegmentDirectionalTracker({ cooldownMs: 0, maximumSampleGapMs: 300 });
  assert.equal(tracker.sample({ point: point(-0.02), band, timestamp: 0 }), null);
  assert.equal(tracker.sample({ point: point(0.02), band, timestamp: 500 }), null);
});
