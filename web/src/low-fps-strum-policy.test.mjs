import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LOW_FPS_HAND_HOLD_MS,
  STRUM_EVENT_HOLD_MS,
  chooseDistinctFretHand,
  isCountableStrumHand,
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

test('prefers a verified explicit strum role', () => {
  const selected = selectRecoveredStrumHand({
    roles: [
      hand({ trackId: 1, role: 'fret', strumDistance: 0.8, fretDistance: 0.5 }),
      hand({ trackId: 2, role: 'strum', roleConfidence: 0.8, strumDistance: 0.7, fretDistance: 2.1 }),
    ],
  });
  assert.equal(selected.trackId, 2);
  assert.equal(selected.recoverySource, 'explicit');
  assert.equal(isCountableStrumHand(selected), true);
});

test('keeps the same verified physical hand only when it stays near the strum zone', () => {
  const cached = hand({ trackId: 7, role: 'strum', handedness: 'Right' });
  const selected = selectRecoveredStrumHand({
    cached,
    roles: [
      hand({ trackId: 7, role: 'unknown', handedness: 'Right', strumDistance: 1.2, fretDistance: 2.1 }),
      hand({ trackId: 8, role: 'fret', handedness: 'Left', strumDistance: 0.9, fretDistance: 0.5 }),
    ],
  });
  assert.equal(selected.trackId, 7);
  assert.equal(selected.recoverySource, 'identity');
  assert.equal(isCountableStrumHand(selected), true);
});

test('does not relabel a fret hand as strum just because it is the only visible hand', () => {
  const selected = selectRecoveredStrumHand({
    roles: [hand({ trackId: 3, role: 'fret', strumDistance: 1.0, fretDistance: 0.4 })],
  });
  assert.equal(selected, null);
});

test('rejects a same-identity hand that moved away from the strum zone', () => {
  const cached = hand({ trackId: 7, role: 'strum' });
  const selected = selectRecoveredStrumHand({
    cached,
    roles: [hand({ trackId: 7, role: 'unknown', strumDistance: 2.2, fretDistance: 2.4 })],
  });
  assert.equal(selected, null);
});

test('cached strum hand may be displayed briefly but cannot emit a stroke', () => {
  const cached = hand({ trackId: 9, role: 'strum' });
  const withinHold = selectRecoveredStrumHand({
    roles: [],
    cached,
    now: 5000,
    lastSeenAt: 5000 - STRUM_EVENT_HOLD_MS,
  });
  assert.equal(withinHold.trackId, 9);
  assert.equal(withinHold.inferred, true);
  assert.equal(withinHold.recoverySource, 'sticky-cache');
  assert.equal(isCountableStrumHand(withinHold), false);

  const expired = selectRecoveredStrumHand({
    roles: [],
    cached,
    now: 5001,
    lastSeenAt: 5000 - STRUM_EVENT_HOLD_MS,
  });
  assert.equal(expired, null);
});

test('one track can never be reported as both strum and fret', () => {
  const strum = hand({ trackId: 4, role: 'strum' });
  const fret = chooseDistinctFretHand([
    hand({ trackId: 4, role: 'fret', roleConfidence: 0.9 }),
    hand({ trackId: 5, role: 'fret', roleConfidence: 0.6 }),
  ], strum);
  assert.equal(fret.trackId, 5);
});

test('preserves visible hand evidence only during a short detector gap', () => {
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
