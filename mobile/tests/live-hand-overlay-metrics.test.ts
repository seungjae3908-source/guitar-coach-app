import { strict as assert } from 'node:assert';

import { LiveHandOverlayMotionTracker } from '../services/live-hand-overlay-metrics';

const tracker = new LiveHandOverlayMotionTracker();

assert.equal(tracker.process({
  capturedAt: 0,
  wrist: null,
  activePoint: null,
  palmSize: 0,
}), null);

tracker.reset();
tracker.process({
  capturedAt: 1_000,
  wrist: { x: 0.4, y: 0.5 },
  activePoint: { x: 0.4, y: 0.35 },
  palmSize: 0.1,
});
const downward = tracker.process({
  capturedAt: 1_140,
  wrist: { x: 0.4, y: 0.5 },
  activePoint: { x: 0.4, y: 0.43 },
  palmSize: 0.1,
});
assert.ok(downward);
assert.equal(downward.active, true);
assert.ok(downward.angleDegrees != null && downward.angleDegrees > 80 && downward.angleDegrees < 100);
assert.ok(downward.radiusPalmWidths != null && downward.radiusPalmWidths > 0.65 && downward.radiusPalmWidths < 0.75);
assert.ok(downward.travelPalmWidths > 0.75);

tracker.reset();
tracker.process({
  capturedAt: 2_000,
  wrist: { x: 0.5, y: 0.6 },
  activePoint: { x: 0.5, y: 0.4 },
  palmSize: 0.1,
});
const jitter = tracker.process({
  capturedAt: 2_150,
  wrist: { x: 0.5, y: 0.6 },
  activePoint: { x: 0.502, y: 0.401 },
  palmSize: 0.1,
});
assert.ok(jitter);
assert.equal(jitter.active, false);
assert.ok(jitter.travelPalmWidths < 0.03);

tracker.reset();
tracker.process({
  capturedAt: 3_000,
  wrist: { x: 0.3, y: 0.6 },
  activePoint: { x: 0.3, y: 0.4 },
  palmSize: 0.1,
});
const rightward = tracker.process({
  capturedAt: 3_130,
  wrist: { x: 0.3, y: 0.6 },
  activePoint: { x: 0.4, y: 0.4 },
  palmSize: 0.1,
});
assert.ok(rightward);
assert.equal(rightward.active, true);
assert.ok(rightward.angleDegrees != null && Math.abs(rightward.angleDegrees) < 5);

console.log('live hand overlay metric quality gate: 4 checks passed');
