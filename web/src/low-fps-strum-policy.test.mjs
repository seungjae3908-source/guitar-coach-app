import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LOW_FPS_HAND_HOLD_MS,
  preserveDetectedHands,
  selectRecoveredStrumHand,
} from './low-fps-strum-policy.js';

const hand = (overrides = {}) => ({
  trackId: 1,
  handedness: 'Right',
  role: 'unknown',
  roleConfidence: 0.4,
  strumDistance: 1.1,
  fretDistance: 2.8,
  pickPoint: { x: 0.72, y: 0.54 },
  ...overrides,
});

test('prefers an explicit strum role', () => {
  const selected = selectRecoveredStrumHand({
    roles: [hand({ trackId: 1, role: 'fret' }), hand({ trackId: 2, role: 'strum', roleConfidence: 0.8 })],
  });
  assert.equal(selected.trackId, 2);
  assert.equal(selected.recoverySource, 'explicit');
  assert.equal(selected.inferred, false);
});

test('keeps the same physical hand when role classification drops', () => {
  const cached = hand({ trackId: 7, role: 'strum', handedness: 'Right' });
  const selected = selectRecoveredStrumHand({
    cached,
    roles: [
      hand({ trackId: 7, role: 'unknown', handedness: 'Right', strumDistance: 3.2 }),
      hand({ trackId: 8, role: 'fret', handedness: 'Left', strumDistance: 0.9 }),
    ],
  });
  assert.equal(selected.trackId, 7);
  assert.equal(selected.recoverySource, 'identity');
});

test('recovers the nearest hand when both roles are temporarily wrong', () => {
  const selected = selectRecoveredStrumHand({
    roles: [
      hand({ trackId: 3, role: 'fret', strumDistance: 2.4 }),
      hand({ trackId: 4, role: 'fret', strumDistance: 4.1 }),
    ],
  });
  assert.equal(selected.trackId, 3);
  assert.equal(selected.recoverySource, 'nearest-zone');
});

test('uses a real cached hand through a bounded low-fps detector gap', () => {
  const cached = hand({ trackId: 9, role: 'strum' });
  const withinHold = selectRecoveredStrumHand({
    roles: [],
    cached,
    now: 5000,
    lastSeenAt: 5000 - LOW_FPS_HAND_HOLD_MS,
  });
  assert.equal(withinHold.trackId, 9);
  assert.equal(withinHold.inferred, true);
  assert.equal(withinHold.recoverySource, 'sticky-cache');

  const expired = selectRecoveredStrumHand({
    roles: [],
    cached,
    now: 5001,
    lastSeenAt: 5000 - LOW_FPS_HAND_HOLD_MS,
  });
  assert.equal(expired, null);
});

test('preserves visible hand evidence during a short empty-frame burst', () => {
  const first = preserveDetectedHands({ current: [hand({ trackId: 11 })], now: 1000 });
  assert.equal(first.hands.length, 1);
  assert.equal(first.retained, false);

  const retained = preserveDetectedHands({
    current: [],
    cached: first.cached,
    now: 1000 + LOW_FPS_HAND_HOLD_MS - 1,
    lastSeenAt: first.lastSeenAt,
  });
  assert.equal(retained.hands.length, 1);
  assert.equal(retained.hands[0].inferred, true);
  assert.equal(retained.retained, true);

  const expired = preserveDetectedHands({
    current: [],
    cached: first.cached,
    now: 1000 + LOW_FPS_HAND_HOLD_MS + 1,
    lastSeenAt: first.lastSeenAt,
  });
  assert.deepEqual(expired.hands, []);
  assert.equal(expired.lastSeenAt, 0);
});
