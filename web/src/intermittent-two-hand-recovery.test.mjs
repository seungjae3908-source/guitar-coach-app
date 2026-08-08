import assert from 'node:assert/strict';
import test from 'node:test';
import { BacklitGuitarRecovery } from './backlit-guitar-recovery.js';

function point(x, y, visibility = 1) {
  return { x, y, z: 0, visibility, presence: visibility };
}

function makeHand(trackId, x, y, scale = 0.09) {
  const landmarks = Array.from({ length: 21 }, () => point(x, y));
  landmarks[0] = point(x, y);
  landmarks[5] = point(x - scale * 0.28, y - scale * 0.5);
  landmarks[9] = point(x, y - scale * 0.62);
  landmarks[17] = point(x + scale * 0.34, y - scale * 0.44);
  landmarks[4] = point(x - scale * 0.08, y - scale * 0.9);
  landmarks[8] = point(x + scale * 0.1, y - scale * 0.92);
  return { trackId, role: 'unknown', wrist: landmarks[0], landmarks };
}

function invalidStrict(timestamp) {
  return { mode: 'none', confidence: 0, guitarValidated: false, updatedAt: timestamp };
}

function coherentHands() {
  return [makeHand(1, 0.2, 0.48, 0.085), makeHand(2, 0.63, 0.55, 0.095)];
}

test('seven coherent two-hand samples can mature despite alternating blurred frames', () => {
  const recovery = new BacklitGuitarRecovery({ candidateGapMs: 850 });
  let output = invalidStrict(0);
  let timestamp = 1000;
  for (let sample = 0; sample < 7; sample += 1) {
    output = recovery.update({
      pose: { mode: 'none', confidence: 0 },
      observedStrings: { count: 0, confidence: 0, lines: [], band: null },
      strictPose: invalidStrict(timestamp),
      hands: coherentHands(),
      bodyLandmarks: [],
      timestamp,
    });
    if (sample < 6) {
      timestamp += 110;
      output = recovery.update({
        strictPose: invalidStrict(timestamp),
        hands: [],
        bodyLandmarks: [],
        timestamp,
      });
    }
    timestamp += 110;
  }
  assert.equal(output.guitarValidated, true);
  assert.equal(output.partialValidation, true);
  assert.equal(output.recoverySource, 'two-hand-axis');
});

test('a real detector gap resets intermittent two-hand accumulation', () => {
  const recovery = new BacklitGuitarRecovery({ candidateGapMs: 850 });
  let timestamp = 1000;
  for (let sample = 0; sample < 4; sample += 1) {
    recovery.update({ strictPose: invalidStrict(timestamp), hands: coherentHands(), bodyLandmarks: [], timestamp });
    timestamp += 120;
  }

  timestamp += 1000;
  recovery.update({ strictPose: invalidStrict(timestamp), hands: [], bodyLandmarks: [], timestamp });

  let output;
  for (let sample = 0; sample < 6; sample += 1) {
    timestamp += 120;
    output = recovery.update({ strictPose: invalidStrict(timestamp), hands: coherentHands(), bodyLandmarks: [], timestamp });
  }
  assert.equal(output.guitarValidated, false);
});
