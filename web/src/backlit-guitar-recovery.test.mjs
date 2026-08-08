import assert from 'node:assert/strict';
import test from 'node:test';
import { BacklitGuitarRecovery, estimateBacklitGuitarCandidate } from './backlit-guitar-recovery.js';

function point(x, y, visibility = 1) {
  return { x, y, z: 0, visibility, presence: visibility };
}

function makeHand(trackId, x, y, scale = 0.09, role = 'unknown') {
  const landmarks = Array.from({ length: 21 }, () => point(x, y));
  landmarks[0] = point(x, y);
  landmarks[5] = point(x - scale * 0.28, y - scale * 0.5);
  landmarks[9] = point(x, y - scale * 0.62);
  landmarks[17] = point(x + scale * 0.34, y - scale * 0.44);
  landmarks[4] = point(x - scale * 0.08, y - scale * 0.9);
  landmarks[8] = point(x + scale * 0.1, y - scale * 0.92);
  return { trackId, role, wrist: landmarks[0], landmarks };
}

function body() {
  const landmarks = Array.from({ length: 33 }, () => null);
  landmarks[11] = point(0.39, 0.28);
  landmarks[12] = point(0.61, 0.28);
  landmarks[23] = point(0.43, 0.68);
  landmarks[24] = point(0.57, 0.68);
  return landmarks;
}

function invalidStrict(timestamp) {
  return { mode: 'none', confidence: 0, guitarValidated: false, updatedAt: timestamp };
}

function train(recovery, {
  mirrored = false,
  withBody = true,
  explicitRoles = true,
  count = 6,
  start = 1000,
} = {}) {
  let output;
  for (let index = 0; index < count; index += 1) {
    const fretX = mirrored ? 0.8 : 0.2;
    const strumX = mirrored ? 0.57 : 0.63;
    output = recovery.update({
      pose: { mode: 'none', confidence: 0 },
      observedStrings: { count: 0, confidence: 0, lines: [], band: null },
      strictPose: invalidStrict(start + index * 150),
      hands: [
        makeHand(1, fretX, 0.48, 0.085, explicitRoles ? 'fret' : 'unknown'),
        makeHand(2, strumX, 0.55, 0.095, explicitRoles ? 'strum' : 'unknown'),
      ],
      bodyLandmarks: withBody ? body() : [],
      timestamp: start + index * 150,
    });
  }
  return output;
}

test('recovers a backlit guitar from sustained two-hand guitar geometry', () => {
  const recovery = new BacklitGuitarRecovery();
  const output = train(recovery);
  assert.equal(output.guitarValidated, true);
  assert.equal(output.partialValidation, true);
  assert.equal(output.recoverySource, 'two-hand-axis');
  assert.ok(output.confidence >= 0.45);
  assert.ok(output.stringBand.supportLength > 0.3);
});

test('recovers mirrored front-camera geometry', () => {
  const recovery = new BacklitGuitarRecovery();
  const output = train(recovery, { mirrored: true });
  assert.equal(output.guitarValidated, true);
  assert.equal(output.partialValidation, true);
  assert.ok(Math.abs(output.axis.tangent.x) > 0.5);
});

test('requires more sustained evidence when body landmarks are unavailable', () => {
  const recovery = new BacklitGuitarRecovery();
  let output = train(recovery, { withBody: false, explicitRoles: false, count: 6 });
  assert.equal(output.guitarValidated, false);
  output = train(recovery, { withBody: false, explicitRoles: false, count: 10, start: 2000 });
  assert.equal(output.guitarValidated, true);
});

test('does not recover from one visible hand', () => {
  const recovery = new BacklitGuitarRecovery();
  let output;
  for (let index = 0; index < 14; index += 1) {
    output = recovery.update({
      strictPose: invalidStrict(1000 + index * 150),
      hands: [makeHand(1, 0.62, 0.55)],
      bodyLandmarks: body(),
      timestamp: 1000 + index * 150,
    });
  }
  assert.equal(output.guitarValidated, false);
});

test('does not recover from hands that are too close together', () => {
  const candidate = estimateBacklitGuitarCandidate({
    pose: null,
    observedStrings: null,
    hands: [makeHand(1, 0.45, 0.52), makeHand(2, 0.58, 0.54)],
    bodyLandmarks: body(),
  });
  assert.equal(candidate, null);
});

test('does not recover from vertically stacked hands', () => {
  const candidate = estimateBacklitGuitarCandidate({
    pose: null,
    observedStrings: null,
    hands: [makeHand(1, 0.5, 0.25), makeHand(2, 0.53, 0.63)],
    bodyLandmarks: body(),
  });
  assert.equal(candidate, null);
});

test('random large axis changes never mature into a recovered guitar', () => {
  const recovery = new BacklitGuitarRecovery();
  let output;
  for (let index = 0; index < 20; index += 1) {
    const fret = index % 2 ? makeHand(1, 0.22, 0.35) : makeHand(1, 0.18, 0.62);
    const strum = index % 2 ? makeHand(2, 0.68, 0.62) : makeHand(2, 0.64, 0.39);
    output = recovery.update({
      strictPose: invalidStrict(1000 + index * 150),
      hands: [fret, strum],
      bodyLandmarks: body(),
      timestamp: 1000 + index * 150,
    });
  }
  assert.equal(output.guitarValidated, false);
});

test('strict independently validated guitar always wins', () => {
  const recovery = new BacklitGuitarRecovery();
  const strict = { mode: 'full', confidence: 0.86, guitarValidated: true, partialValidation: false };
  const output = recovery.update({
    strictPose: strict,
    hands: [makeHand(1, 0.2, 0.48), makeHand(2, 0.63, 0.55)],
    bodyLandmarks: body(),
    timestamp: 1000,
  });
  assert.equal(output, strict);
});

test('brief hand occlusion retains recovery but bounded timeout expires it', () => {
  const recovery = new BacklitGuitarRecovery({ holdMs: 900 });
  const ready = train(recovery);
  const held = recovery.update({ strictPose: invalidStrict(1900), hands: [], timestamp: 1900, previous: ready });
  assert.equal(held.guitarValidated, true);
  assert.equal(held.mode, 'tracking');
  const expired = recovery.update({ strictPose: invalidStrict(3000), hands: [], timestamp: 3000, previous: held });
  assert.equal(expired.guitarValidated, false);
});

test('synthetic string band crosses the strum contact and spans both hands', () => {
  const recovery = new BacklitGuitarRecovery();
  const output = train(recovery);
  const contact = output.soundhole;
  const projection = output.stringBand.normalX * contact.x + output.stringBand.normalY * contact.y;
  assert.ok(projection >= output.stringBand.top && projection <= output.stringBand.bottom);
  assert.ok(output.stringBand.supportLength >= 0.35);
});
