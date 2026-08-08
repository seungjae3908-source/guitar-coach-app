import test from 'node:test';
import assert from 'node:assert/strict';

import { StrictTargetStrokeConsensus } from './strict-stroke-consensus-policy.js';

test('counts one stroke only after a verified opposite return', () => {
  const gate = new StrictTargetStrokeConsensus();
  assert.equal(gate.sample({ direction: 'down', target: 'down', timestamp: 1000 }).count, true);
  assert.equal(gate.sample({ direction: 'down', target: 'down', timestamp: 1500 }).reason, 'awaiting-verified-return');
  const returned = gate.sample({ direction: 'up', target: 'down', timestamp: 1650 });
  assert.equal(returned.reason, 'verified-return');
  assert.equal(returned.rearmed, true);
  assert.equal(gate.sample({ direction: 'down', target: 'down', timestamp: 1900 }).count, true);
});

test('rejects a rapid direction flick as a return', () => {
  const gate = new StrictTargetStrokeConsensus({ minimumReturnGapMs: 120 });
  assert.equal(gate.sample({ direction: 'up', target: 'up', timestamp: 1000 }).count, true);
  assert.equal(gate.sample({ direction: 'down', target: 'up', timestamp: 1060 }).reason, 'return-too-soon');
  assert.equal(gate.sample({ direction: 'up', target: 'up', timestamp: 1300 }).count, false);
});

test('suppresses low-level motion after a landmark event', () => {
  const gate = new StrictTargetStrokeConsensus();
  assert.equal(gate.sample({ direction: 'down', target: 'down', source: 'landmark', timestamp: 1000 }).count, true);
  gate.sample({ direction: 'up', target: 'down', source: 'landmark', timestamp: 1200 });
  const duplicate = gate.sample({ direction: 'down', target: 'down', source: 'motion', timestamp: 1300 });
  assert.equal(duplicate.count, false);
  assert.equal(duplicate.reason, 'landmark-already-covered');
});

test('allows motion fallback only as the first evidence for a stroke cycle', () => {
  const gate = new StrictTargetStrokeConsensus();
  const first = gate.sample({ direction: 'down', target: 'down', source: 'motion', timestamp: 1000 });
  assert.equal(first.count, true);
  assert.equal(first.reason, 'motion-fallback');
  assert.equal(gate.sample({ direction: 'down', target: 'down', source: 'motion', timestamp: 1600 }).reason, 'awaiting-verified-return');
});
