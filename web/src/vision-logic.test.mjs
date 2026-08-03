import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DirectionalStrumTracker,
  HandRoleResolver,
  canCountStrum,
  combinedGuitarConfidence,
  detectStringBand,
  guitarPredictionScore,
} from './vision-logic.js';

test('global motion alone can never authorize a strum', () => {
  assert.equal(canCountStrum({ handConfidence: 0, guitarConfidence: 0, stringCount: 0, stringConfidence: 0 }), false);
  assert.equal(canCountStrum({ handConfidence: 0.8, guitarConfidence: 0.8, stringCount: 6, stringConfidence: 0.8, stringBand: null }), false);
});

test('guitar score accepts instrument labels and rejects unrelated labels', () => {
  assert.equal(guitarPredictionScore([{ className: 'sliding door', probability: 0.9 }]), 0);
  assert.equal(guitarPredictionScore([{ className: 'acoustic guitar', probability: 0.62 }]), 0.62);
});

test('localized strings support guitar evidence near a hand', () => {
  const band = { top: 0.44, bottom: 0.56, center: 0.5, normalX: 0, normalY: 1, tangentX: 1, tangentY: 0, supportMin: 0.12, supportMax: 0.82, supportLength: 0.7 };
  assert.equal(combinedGuitarConfidence({ stringCount: 6, stringConfidence: 0.8, handConfidence: 0, band }), 0);
  assert.ok(combinedGuitarConfidence({ stringCount: 6, stringConfidence: 0.8, handConfidence: 0.8, handPoint: { x: 0.7, y: 0.5 }, band }) > 0.65);
});

test('direction tracker counts a real crossing spread across several frames', () => {
  const tracker = new DirectionalStrumTracker({ minimumTravel: 0.04, cooldownMs: 100, maximumCrossingMs: 900 });
  const band = { top: 0.45, bottom: 0.55, center: 0.5, normalX: 0, normalY: 1 };
  assert.equal(tracker.sample({ timestamp: 0, point: { x: 0.5, y: 0.4 }, band, ready: true }), null);
  assert.equal(tracker.sample({ timestamp: 80, point: { x: 0.5, y: 0.47 }, band, ready: true }), null);
  assert.equal(tracker.sample({ timestamp: 160, point: { x: 0.5, y: 0.53 }, band, ready: true }), null);
  assert.equal(tracker.sample({ timestamp: 240, point: { x: 0.5, y: 0.61 }, band, ready: true }), 'down');
});

test('direction tracker rejects a delayed half crossing', () => {
  const tracker = new DirectionalStrumTracker({ maximumCrossingMs: 500 });
  const band = { top: 0.45, bottom: 0.55, center: 0.5, normalX: 0, normalY: 1 };
  tracker.sample({ timestamp: 0, point: { x: 0.5, y: 0.4 }, band, ready: true });
  assert.equal(tracker.sample({ timestamp: 700, point: { x: 0.5, y: 0.6 }, band, ready: true }), null);
});

function syntheticTiltedStrings(width = 320, height = 180) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 105;
    data[index + 1] = 82;
    data[index + 2] = 55;
    data[index + 3] = 255;
  }
  const angle = 14 * Math.PI / 180;
  for (let stringIndex = 0; stringIndex < 6; stringIndex += 1) {
    const baseY = 105 + stringIndex * 6;
    for (let x = 50; x <= 255; x += 1) {
      const y = Math.round(baseY + Math.tan(angle) * (x - 150));
      for (let thickness = -1; thickness <= 1; thickness += 1) {
        const targetY = y + thickness;
        if (targetY < 0 || targetY >= height) continue;
        const offset = (targetY * width + x) * 4;
        data[offset] = 238;
        data[offset + 1] = 238;
        data[offset + 2] = 230;
      }
    }
  }
  return { data };
}

test('string detector finds tilted strings below center and localizes their visible span', () => {
  const width = 320;
  const height = 180;
  const result = detectStringBand(syntheticTiltedStrings(width, height), width, height);
  assert.ok(result.count >= 4, `expected at least 4 strings, got ${result.count}`);
  assert.ok(Math.abs(result.angle) >= 7, `expected a tilted band, got ${result.angle}`);
  assert.ok(result.band.supportLength >= 0.35, `expected supported span, got ${result.band.supportLength}`);
  assert.ok(result.lines.every((line) => line.start.x > 0.02 || line.start.y > 0.02));
  assert.ok(result.lines.some((line) => line.end.x < 0.95), 'visible lines should stop before the full frame edge');
});

test('hand role resolver selects the hand that repeatedly crosses the strings', () => {
  const resolver = new HandRoleResolver();
  const band = { top: 0.45, bottom: 0.55, center: 0.5, normalX: 0, normalY: 1, tangentX: 1, tangentY: 0, supportMin: 0.1, supportMax: 0.9, supportLength: 0.8 };
  const hand = (x, y, handedness) => ({ handedness, confidence: 0.9, wrist: { x, y }, pickPoint: { x, y }, landmarks: Array.from({ length: 21 }, () => ({ x, y })) });
  resolver.update({ timestamp: 0, band, ready: true, hands: [hand(0.25, 0.5, 'Left'), hand(0.7, 0.39, 'Right')] });
  resolver.update({ timestamp: 80, band, ready: true, hands: [hand(0.26, 0.5, 'Left'), hand(0.7, 0.48, 'Right')] });
  resolver.update({ timestamp: 160, band, ready: true, hands: [hand(0.27, 0.5, 'Left'), hand(0.7, 0.61, 'Right')] });
  const result = resolver.update({ timestamp: 240, band, ready: true, hands: [hand(0.28, 0.5, 'Left'), hand(0.7, 0.62, 'Right')] });
  assert.equal(result.selectedHand?.handedness, 'Right');
  assert.equal(result.selectedId != null, true);
});
