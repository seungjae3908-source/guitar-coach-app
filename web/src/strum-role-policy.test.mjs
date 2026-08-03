import test from 'node:test';
import assert from 'node:assert/strict';
import { STRUM_ROLE_HOLD_MS, isStrumHandRecent, selectStickyStrumHand } from './strum-role-policy.js';

test('current strum hand always wins over cached hand', () => {
  const current = { trackId: 7, handedness: 'Right' };
  const selected = selectStickyStrumHand({ current, cached: { trackId: 2 }, now: 2000, lastSeenAt: 1500 });
  assert.equal(selected, current);
});

test('cached strum hand survives brief landmark blur', () => {
  const cached = { trackId: 7, handedness: 'Right', pickPoint: { x: 0.5, y: 0.5 } };
  const selected = selectStickyStrumHand({ cached, now: 2000, lastSeenAt: 1150 });
  assert.equal(selected.trackId, 7);
  assert.equal(selected.inferred, true);
});

test('cached strum hand expires after the hold window', () => {
  const selected = selectStickyStrumHand({ cached: { trackId: 7 }, now: 2501, lastSeenAt: 1400 });
  assert.equal(selected, null);
});

test('recent hand boundary is inclusive and rejects missing timestamps', () => {
  assert.equal(isStrumHandRecent(3000, 3000 - STRUM_ROLE_HOLD_MS), true);
  assert.equal(isStrumHandRecent(3001, 3000 - STRUM_ROLE_HOLD_MS), false);
  assert.equal(isStrumHandRecent(3000, 0), false);
});
