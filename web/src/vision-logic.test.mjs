import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DirectionalStrumTracker,
  canCountStrum,
  combinedGuitarConfidence,
  detectStringBand,
  guitarPredictionScore,
  projectPointToBand,
} from './vision-logic.js';

test('global motion alone can never authorize a strum', () => {
  assert.equal(canCountStrum({ handConfidence: 0, guitarConfidence: 0, stringCount: 0, stringConfidence: 0 }), false);
  assert.equal(canCountStrum({ handConfidence: 0.8, guitarConfidence: 0.8, stringCount: 3, stringConfidence: 0.8 }), false);
  assert.equal(canCountStrum({ handConfidence: 0.8, guitarConfidence: 0.8, stringCount: 6, stringConfidence: 0.8 }), true);
});

test('guitar score accepts instrument labels and rejects unrelated labels', () => {
  assert.equal(guitarPredictionScore([{ className: 'tabby cat', probability: 0.9 }]), 0);
  assert.equal(guitarPredictionScore([{ className: 'acoustic guitar', probability: 0.62 }]), 0.62);
});

test('parallel strings support guitar evidence near the playing hand', () => {
  const band = { top: 0.45, bottom: 0.55, center: 0.5, normalX: 0, normalY: 1 };
  assert.equal(combinedGuitarConfidence({ stringCount: 6, stringConfidence: 0.8, handConfidence: 0, handPoint: { x: 0.5, y: 0.5 }, band }), 0);
  assert.ok(combinedGuitarConfidence({ stringCount: 6, stringConfidence: 0.8, handConfidence: 0.8, handPoint: { x: 0.5, y: 0.5 }, band }) > 0.6);
});

test('direction tracker counts a real crossing spread across several frames', () => {
  const tracker = new DirectionalStrumTracker({ minimumTravel: 0.05, cooldownMs: 100 });
  const band = { top: 0.45, bottom: 0.55, center: 0.5, normalX: 0, normalY: 1 };

  assert.equal(tracker.sample({ timestamp: 0, point: { x: 0.5, y: 0.4 }, band, ready: true }), null);
  assert.equal(tracker.sample({ timestamp: 80, point: { x: 0.5, y: 0.48 }, band, ready: true }), null);
  assert.equal(tracker.sample({ timestamp: 160, point: { x: 0.5, y: 0.52 }, band, ready: true }), null);
  assert.equal(tracker.sample({ timestamp: 240, point: { x: 0.5, y: 0.6 }, band, ready: true }), 'down');
  assert.equal(tracker.sample({ timestamp: 360, point: { x: 0.5, y: 0.52 }, band, ready: true }), null);
  assert.equal(tracker.sample({ timestamp: 440, point: { x: 0.5, y: 0.47 }, band, ready: true }), null);
  assert.equal(tracker.sample({ timestamp: 520, point: { x: 0.5, y: 0.4 }, band, ready: true }), 'up');
});

test('direction tracker projects movement across an angled string band', () => {
  const angle = -21 * Math.PI / 180;
  const band = {
    top: 0.46,
    bottom: 0.54,
    center: 0.5,
    normalX: -Math.sin(angle),
    normalY: Math.cos(angle),
  };
  const tracker = new DirectionalStrumTracker({ minimumTravel: 0.05, cooldownMs: 100 });
  const pointAtProjection = (projection) => {
    const base = { x: 0.5, y: 0.5 };
    const baseProjection = projectPointToBand(base, band);
    const delta = projection - baseProjection;
    return { x: base.x + band.normalX * delta, y: base.y + band.normalY * delta };
  };

  tracker.sample({ timestamp: 0, point: pointAtProjection(0.4), band, ready: true });
  tracker.sample({ timestamp: 100, point: pointAtProjection(0.5), band, ready: true });
  assert.equal(tracker.sample({ timestamp: 200, point: pointAtProjection(0.6), band, ready: true }), 'down');
});

test('direction tracker resets when recognition evidence is lost', () => {
  const tracker = new DirectionalStrumTracker({ minimumTravel: 0.05, cooldownMs: 100 });
  const band = { top: 0.45, bottom: 0.55, center: 0.5, normalX: 0, normalY: 1 };
  tracker.sample({ timestamp: 0, point: { x: 0.5, y: 0.4 }, band, ready: true });
  tracker.sample({ timestamp: 100, point: { x: 0.5, y: 0.5 }, band, ready: false });
  assert.equal(tracker.sample({ timestamp: 200, point: { x: 0.5, y: 0.6 }, band, ready: true }), null);
});

function angledStringImage(width, height, angleDegrees) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 35;
    data[index + 1] = 35;
    data[index + 2] = 35;
    data[index + 3] = 255;
  }
  const angle = angleDegrees * Math.PI / 180;
  const normalX = -Math.sin(angle);
  const normalY = Math.cos(angle);
  const center = normalX * 0.5 + normalY * 0.58;
  const offsets = [-0.055, -0.033, -0.011, 0.011, 0.033, 0.055];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const projection = normalX * (x / (width - 1)) + normalY * (y / (height - 1));
      if (!offsets.some((offset) => Math.abs(projection - (center + offset)) < 0.0045)) continue;
      const index = (y * width + x) * 4;
      data[index] = 225;
      data[index + 1] = 225;
      data[index + 2] = 225;
    }
  }
  return { data };
}

test('string detector finds a guitar below center at a tilted angle', () => {
  const width = 240;
  const height = 160;
  const result = detectStringBand(angledStringImage(width, height, -21), width, height);
  assert.ok(result.count >= 4, `expected at least 4 strings, got ${result.count}`);
  assert.ok(result.confidence >= 0.32, `expected useful confidence, got ${result.confidence}`);
  assert.ok(Math.abs(result.angle + 21) <= 14, `expected a tilted band, got ${result.angle}`);
  assert.ok(result.lines.length >= 4);
});
