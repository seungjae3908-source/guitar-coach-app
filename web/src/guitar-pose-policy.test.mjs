import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUndirectedAngle,
  stabilizeGuitarPose,
  undirectedAngleDifference,
} from './guitar-pose-policy.js';

function pose(angle, confidence = 0.8, full = true) {
  return {
    mode: full ? 'full' : 'soundhole-partial',
    confidence,
    soundhole: { x: 0.4, y: 0.5 },
    neck: full ? { angle } : null,
    lines: Array.from({ length: 6 }, () => ({})),
    stringBand: { angle },
    updatedAt: 1000,
  };
}

test('undirected line angles normalize consistently', () => {
  assert.equal(normalizeUndirectedAngle(120), -60);
  assert.equal(normalizeUndirectedAngle(-60), -60);
  assert.equal(undirectedAngleDifference(120, -60), 0);
});

test('small guitar angle changes are accepted immediately', () => {
  const result = stabilizeGuitarPose({ previous: pose(40), candidate: pose(48), timestamp: 1500 });
  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'continuous');
  assert.equal(result.pose.stringBand.angle, 48);
});

test('single large angle jump keeps the previous guitar axis', () => {
  const result = stabilizeGuitarPose({ previous: pose(40), candidate: pose(120), timestamp: 1500 });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'pending-change');
  assert.equal(result.pose.stringBand.angle, 40);
  assert.equal(result.pose.mode, 'tracking');
  assert.equal(result.state.pendingCount, 1);
});

test('large angle change is accepted after three consistent observations', () => {
  const previous = pose(40);
  const first = stabilizeGuitarPose({ previous, candidate: pose(120), timestamp: 1500 });
  const second = stabilizeGuitarPose({ previous: first.pose, candidate: pose(118), state: first.state, timestamp: 2000 });
  const third = stabilizeGuitarPose({ previous: second.pose, candidate: pose(121), state: second.state, timestamp: 2500 });
  assert.equal(first.accepted, false);
  assert.equal(second.accepted, false);
  assert.equal(third.accepted, true);
  assert.equal(third.reason, 'confirmed-change');
  assert.equal(third.pose.stringBand.angle, 121);
});

test('strong higher-confidence full guitar evidence can override immediately', () => {
  const result = stabilizeGuitarPose({ previous: pose(40, 0.55), candidate: pose(120, 0.9), timestamp: 1500 });
  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'strong-override');
});

test('manual soundhole correction forces the new pose', () => {
  const result = stabilizeGuitarPose({ previous: pose(40), candidate: pose(120, 0.6), force: true, timestamp: 1500 });
  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'forced');
});
