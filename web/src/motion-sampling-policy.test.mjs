import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HAND_SAMPLE_INTERVAL_MS,
  MOTION_SAMPLE_INTERVAL_MS,
  POSE_SAMPLE_INTERVAL_MS,
  LOCAL_MOTION_ANCHOR_RADIUS,
  motionConfidenceThreshold,
  isLocalMotionReady,
} from './motion-sampling-policy.js';

test('motion sampling runs faster than expensive hand and pose analysis', () => {
  assert.ok(MOTION_SAMPLE_INTERVAL_MS < HAND_SAMPLE_INTERVAL_MS);
  assert.ok(HAND_SAMPLE_INTERVAL_MS < POSE_SAMPLE_INTERVAL_MS);
  assert.ok(MOTION_SAMPLE_INTERVAL_MS <= 34);
  assert.ok(HAND_SAMPLE_INTERVAL_MS >= 150);
});

test('anchored local motion accepts the observed three-percent signal', () => {
  assert.equal(motionConfidenceThreshold({ x: 0.5, y: 0.5 }), 0.025);
  assert.equal(isLocalMotionReady({ confidence: 0.03, handRecent: true, anchorPoint: { x: 0.5, y: 0.5 } }), true);
});

test('the same weak motion is rejected without a recent hand anchor', () => {
  assert.equal(isLocalMotionReady({ confidence: 0.03, handRecent: true, anchorPoint: null }), false);
  assert.equal(isLocalMotionReady({ confidence: 0.5, handRecent: false, anchorPoint: { x: 0.5, y: 0.5 } }), false);
});

test('anchor radius stays local to the strum-hand neighborhood', () => {
  assert.ok(LOCAL_MOTION_ANCHOR_RADIUS >= 0.18);
  assert.ok(LOCAL_MOTION_ANCHOR_RADIUS <= 0.28);
});
