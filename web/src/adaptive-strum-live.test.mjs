import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AdaptiveLiveStrumEngine,
  deriveAdaptiveStringBand,
  estimateAdaptiveContactPoint,
  selectAdaptiveStrumHand,
} from './adaptive-strum-live.js';

const pose = {
  confidence: 0.9,
  guitarValidated: true,
  axis: { tangent: { x: 1, y: 0 }, normal: { x: 0, y: 1 } },
  body: { center: { x: 0.55, y: 0.55 }, radiusAlong: 0.36, radiusAcross: 0.25 },
  soundhole: { x: 0.56, y: 0.55, radius: 0.08, confidence: 0.9 },
  stringBand: {
    top: 0.2,
    bottom: 0.24,
    center: 0.22,
    tangentX: 1,
    tangentY: 0,
    normalX: 0,
    normalY: 1,
    angle: 0,
    supportMin: 0.1,
    supportMax: 0.9,
    supportLength: 0.8,
  },
};

function hand(trackId, role, x, y) {
  const landmarks = Array.from({ length: 21 }, () => ({ x, y }));
  landmarks[0] = { x, y: y + 0.15 };
  landmarks[4] = { x: x - 0.015, y };
  landmarks[8] = { x: x + 0.015, y };
  landmarks[5] = { x: x - 0.03, y: y + 0.08 };
  landmarks[17] = { x: x + 0.05, y: y + 0.1 };
  return {
    trackId,
    role,
    roleConfidence: role === 'strum' ? 0.7 : 0.5,
    landmarks,
    strumDistance: role === 'strum' ? 0.4 : 2,
    fretDistance: role === 'fret' ? 0.4 : 2,
  };
}

test('misaligned shoulder band is replaced by soundhole-centered fallback', () => {
  const result = deriveAdaptiveStringBand(pose);
  assert.equal(result.valid, true);
  assert.equal(result.source, 'soundhole-fallback');
  assert.ok(Math.abs(result.band.center - 0.55) < 0.001);
});

test('soundhole outside body cannot validate a false guitar band', () => {
  const result = deriveAdaptiveStringBand({
    ...pose,
    soundhole: { x: 0.2, y: 0.1, radius: 0.08, confidence: 0.9 },
    stringBand: null,
  });
  assert.equal(result.valid, false);
});

test('thumb-index contact is used', () => {
  const contact = estimateAdaptiveContactPoint(hand(1, 'unknown', 0.5, 0.5).landmarks);
  assert.ok(contact);
  assert.equal(contact.source, 'thumb-index-contact');
  assert.ok(contact.quality > 0.5);
});

test('geometric selector chooses unknown soundhole hand over fret hand', () => {
  const band = deriveAdaptiveStringBand(pose).band;
  const chosen = selectAdaptiveStrumHand({
    roles: [hand(1, 'fret', 0.25, 0.55), hand(2, 'unknown', 0.57, 0.48)],
    band,
    soundhole: pose.soundhole,
  });
  assert.equal(chosen.trackId, 2);
});

test('live engine counts a complete down stroke in auto mode', () => {
  const engine = new AdaptiveLiveStrumEngine();
  const events = [];
  [0.46, 0.46, 0.5, 0.55, 0.6, 0.62, 0.62].forEach((y, index) => {
    const result = engine.update({
      timestamp: index * 56,
      roles: [hand(2, 'unknown', 0.57, y)],
      pose,
    });
    if (result.event) events.push(result.event);
  });
  assert.deepEqual(events, ['down']);
});

test('live engine rejects a fret hand far from the string area', () => {
  const engine = new AdaptiveLiveStrumEngine();
  const events = [];
  [0.46, 0.46, 0.5, 0.56, 0.62, 0.62].forEach((y, index) => {
    const result = engine.update({
      timestamp: index * 56,
      roles: [hand(1, 'fret', 0.22, y)],
      pose,
    });
    if (result.event) events.push(result.event);
  });
  assert.deepEqual(events, []);
});
