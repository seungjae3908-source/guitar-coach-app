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

test('three-percent regional motion is rejected even with an anchor', () => {
  assert.equal(motionConfidenceThreshold({ x: 0.5, y: 0.5 }), 0.11);
  assert.equal(isLocalMotionReady({ confidence: 0.03, handRecent: true, anchorPoint: { x: 0.5, y: 0.5 } }), false);
  assert.equal(isLocalMotionReady({ confidence: 0.12, handRecent: true, anchorPoint: { x: 0.5, y: 0.5 } }), true);
});

test('unanchored motion requires stronger evidence and a recent verified hand', () => {
  assert.equal(motionConfidenceThreshold(null), 0.18);
  assert.equal(isLocalMotionReady({ confidence: 0.17, handRecent: true, anchorPoint: null }), false);
  assert.equal(isLocalMotionReady({ confidence: 0.19, handRecent: true, anchorPoint: null }), true);
  assert.equal(isLocalMotionReady({ confidence: 0.5, handRecent: false, anchorPoint: { x: 0.5, y: 0.5 } }), false);
});

test('anchor radius stays tightly local to the strum-hand neighborhood', () => {
  assert.ok(LOCAL_MOTION_ANCHOR_RADIUS >= 0.16);
  assert.ok(LOCAL_MOTION_ANCHOR_RADIUS <= 0.2);
});
