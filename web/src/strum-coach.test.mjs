import assert from 'node:assert/strict';
import test from 'node:test';

import {
  StrictDirectionalStrumTracker,
  StringBandStabilizer,
  StrumGuideCalibrator,
  buildStrumGuide,
  estimateStrumContactPoint,
  evaluateStrumGuidePoint,
} from './strum-coach.js';

const band = {
  top: 0.46,
  bottom: 0.54,
  center: 0.5,
  normalX: 0,
  normalY: 1,
  tangentX: 1,
  tangentY: 0,
  angle: 0,
  supportMin: 0.2,
  supportMax: 0.8,
  supportLength: 0.6,
  stable: true,
  stability: 1,
};

const point = (x, y, extra = {}) => ({
  x,
  y,
  quality: 0.9,
  stable: true,
  filterConfidence: 0.9,
  ...extra,
});

function sampleDown(tracker, guide, offset = 0) {
  return [
    tracker.sample({ timestamp: offset + 0, point: point(0.5, 0.4), band, guide, ready: true }),
    tracker.sample({ timestamp: offset + 40, point: point(0.5, 0.4), band, guide, ready: true }),
    tracker.sample({ timestamp: offset + 80, point: point(0.5, 0.45), band, guide, ready: true }),
    tracker.sample({ timestamp: offset + 120, point: point(0.5, 0.48), band, guide, ready: true }),
    tracker.sample({ timestamp: offset + 160, point: point(0.5, 0.52), band, guide, ready: true }),
    tracker.sample({ timestamp: offset + 200, point: point(0.5, 0.57), band, guide, ready: true }),
    tracker.sample({ timestamp: offset + 240, point: point(0.5, 0.59), band, guide, ready: true }),
    tracker.sample({ timestamp: offset + 280, point: point(0.5, 0.59), band, guide, ready: true }),
  ];
}

function stringResult(overrides = {}) {
  const { band: bandOverrides = {}, ...rest } = overrides;
  const nextBand = { ...band, ...bandOverrides };
  return {
    count: 6,
    confidence: 0.72,
    rows: [],
    lines: [],
    angle: nextBand.angle,
    ...rest,
    band: nextBand,
  };
}

test('contact point follows the thumb-index grip and reports geometry quality', () => {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.9, y: 0.9, z: 0 }));
  landmarks[0] = { x: 0.5, y: 0.8, z: 0 };
  landmarks[3] = { x: 0.39, y: 0.53, z: -0.01 };
  landmarks[4] = { x: 0.4, y: 0.5, z: -0.02 };
  landmarks[5] = { x: 0.5, y: 0.62, z: 0 };
  landmarks[7] = { x: 0.58, y: 0.36, z: -0.03 };
  landmarks[8] = { x: 0.6, y: 0.3, z: -0.04 };
  landmarks[17] = { x: 0.7, y: 0.67, z: 0 };
  const contact = estimateStrumContactPoint(landmarks);
  assert.match(contact.source, /^thumb-index/);
  assert.ok(contact.x > 0.49 && contact.x < 0.52);
  assert.ok(contact.y > 0.38 && contact.y < 0.41);
  assert.ok(contact.quality >= 0.7);
  assert.ok(Number.isFinite(contact.pinchRatio));
});

test('calibrated guide is narrow and detects lateral escape', () => {
  const guide = buildStrumGuide(band, 0.5);
  assert.equal(guide.ready, true);
  assert.equal(guide.calibrated, true);
  assert.equal(guide.polygon.length, 4);
  assert.ok(guide.halfWidth < 0.1);
  assert.equal(evaluateStrumGuidePoint(point(0.5, 0.5), band, guide).inside, true);
  const escaped = evaluateStrumGuidePoint(point(0.72, 0.5), band, guide);
  assert.equal(escaped.inside, false);
  assert.equal(escaped.lateralInside, false);
});

test('guide calibration stores a support-relative anchor across camera movement', () => {
  const calibrator = new StrumGuideCalibrator();
  const first = calibrator.observe(point(0.65, 0.5), band, { force: true });
  assert.equal(first.calibrated, true);
  const shiftedBand = { ...band, supportMin: 0.1, supportMax: 0.7, supportLength: 0.6 };
  const shifted = calibrator.guideFor(shiftedBand);
  assert.ok(Math.abs(shifted.tangentCenter - 0.55) < 1e-9);
});

test('string band stabilizer requires repeated frames before counting is enabled', () => {
  const stabilizer = new StringBandStabilizer();
  assert.equal(stabilizer.update(stringResult(), 0).band.stable, false);
  assert.equal(stabilizer.update(stringResult(), 220).band.stable, false);
  assert.equal(stabilizer.update(stringResult(), 440).band.stable, true);
});

test('one-frame string detection jump is held instead of moving the counting coordinates', () => {
  const stabilizer = new StringBandStabilizer();
  stabilizer.update(stringResult(), 0);
  stabilizer.update(stringResult(), 220);
  const stable = stabilizer.update(stringResult(), 440);
  const jumped = stabilizer.update(stringResult({ band: { top: 0.66, bottom: 0.74, center: 0.7 } }), 660);
  assert.equal(stable.band.stable, true);
  assert.equal(jumped.band.stable, false);
  assert.equal(jumped.band.held, true);
  assert.ok(Math.abs(jumped.band.center - stable.band.center) < 0.02);
});

test('consistent camera movement is adopted only after confirmation', () => {
  const stabilizer = new StringBandStabilizer({ confirmationFrames: 2 });
  stabilizer.update(stringResult(), 0);
  stabilizer.update(stringResult(), 220);
  stabilizer.update(stringResult(), 440);
  const moved = stringResult({ band: { top: 0.61, bottom: 0.69, center: 0.65 } });
  assert.equal(stabilizer.update(moved, 660).band.held, true);
  const confirmed = stabilizer.update(moved, 880);
  assert.equal(confirmed.band.held, false);
  assert.ok(confirmed.band.center > 0.6);
});

test('strict tracker counts one complete monotonic down crossing', () => {
  const tracker = new StrictDirectionalStrumTracker();
  const guide = buildStrumGuide(band, 0.5);
  const events = sampleDown(tracker, guide).filter(Boolean);
  assert.deepEqual(events, ['down']);
  assert.ok(tracker.lastEventDetail.monotonicity >= 0.9);
  assert.ok(tracker.lastEventDetail.bandSamples >= 2);
});

test('strict tracker rejects a direct one-frame jump', () => {
  const tracker = new StrictDirectionalStrumTracker({ maximumFrameJump: 0.3 });
  const guide = buildStrumGuide(band, 0.5);
  tracker.sample({ timestamp: 0, point: point(0.5, 0.4), band, guide, ready: true });
  tracker.sample({ timestamp: 40, point: point(0.5, 0.4), band, guide, ready: true });
  tracker.sample({ timestamp: 80, point: point(0.5, 0.59), band, guide, ready: true });
  const event = tracker.sample({ timestamp: 120, point: point(0.5, 0.59), band, guide, ready: true });
  assert.equal(event, null);
});

test('strict tracker rejects motion outside the calibrated corridor', () => {
  const tracker = new StrictDirectionalStrumTracker();
  const guide = buildStrumGuide(band, 0.5);
  const samples = [0.4, 0.4, 0.48, 0.52, 0.59, 0.59]
    .map((y, index) => tracker.sample({ timestamp: index * 45, point: point(0.72, y), band, guide, ready: true }))
    .filter(Boolean);
  assert.deepEqual(samples, []);
  assert.equal(tracker.lastRejectReason, 'outside-guide');
});

test('zigzag motion across the strings is rejected as non-monotonic', () => {
  const tracker = new StrictDirectionalStrumTracker();
  const guide = buildStrumGuide(band, 0.5);
  const samples = [0.4, 0.4, 0.48, 0.44, 0.5, 0.46, 0.52, 0.59, 0.59]
    .map((y, index) => tracker.sample({ timestamp: index * 40, point: point(0.5, y), band, guide, ready: true }))
    .filter(Boolean);
  assert.deepEqual(samples, []);
  assert.ok(['reversal-excess', 'non-monotonic-crossing'].includes(tracker.lastRejectReason));
});

test('unstable contact coordinates never generate a stroke', () => {
  const tracker = new StrictDirectionalStrumTracker();
  const guide = buildStrumGuide(band, 0.5);
  const samples = [0.4, 0.4, 0.48, 0.52, 0.59, 0.59]
    .map((y, index) => tracker.sample({
      timestamp: index * 45,
      point: point(0.5, y, { stable: false, filterConfidence: 0.2 }),
      band,
      guide,
      ready: true,
    }))
    .filter(Boolean);
  assert.deepEqual(samples, []);
  assert.equal(tracker.lastRejectReason, 'contact-unstable');
});

test('another down stroke requires a verified up return first', () => {
  const tracker = new StrictDirectionalStrumTracker();
  const guide = buildStrumGuide(band, 0.5);
  assert.deepEqual(sampleDown(tracker, guide).filter(Boolean), ['down']);

  const repeatedBottom = [320, 360, 400]
    .map((timestamp) => tracker.sample({ timestamp, point: point(0.5, 0.59), band, guide, ready: true }))
    .filter(Boolean);
  assert.deepEqual(repeatedBottom, []);

  const returnEvents = [
    tracker.sample({ timestamp: 440, point: point(0.5, 0.55), band, guide, ready: true }),
    tracker.sample({ timestamp: 480, point: point(0.5, 0.52), band, guide, ready: true }),
    tracker.sample({ timestamp: 520, point: point(0.5, 0.48), band, guide, ready: true }),
    tracker.sample({ timestamp: 560, point: point(0.5, 0.43), band, guide, ready: true }),
    tracker.sample({ timestamp: 600, point: point(0.5, 0.4), band, guide, ready: true }),
    tracker.sample({ timestamp: 640, point: point(0.5, 0.4), band, guide, ready: true }),
  ].filter(Boolean);
  assert.deepEqual(returnEvents, ['up']);
  assert.deepEqual(sampleDown(tracker, guide, 700).filter(Boolean), ['down']);
});
