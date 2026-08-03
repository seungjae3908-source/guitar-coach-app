import assert from 'node:assert/strict';
import test from 'node:test';

import {
  StrictDirectionalStrumTracker,
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
};

const point = (x, y) => ({ x, y });

function sampleDown(tracker, guide, offset = 0) {
  return [
    tracker.sample({ timestamp: offset + 0, point: point(0.5, 0.42), band, guide, ready: true }),
    tracker.sample({ timestamp: offset + 50, point: point(0.5, 0.42), band, guide, ready: true }),
    tracker.sample({ timestamp: offset + 100, point: point(0.5, 0.48), band, guide, ready: true }),
    tracker.sample({ timestamp: offset + 150, point: point(0.5, 0.52), band, guide, ready: true }),
    tracker.sample({ timestamp: offset + 200, point: point(0.5, 0.58), band, guide, ready: true }),
    tracker.sample({ timestamp: offset + 250, point: point(0.5, 0.58), band, guide, ready: true }),
  ];
}

test('strum contact point follows the thumb-index pinch instead of averaging all fingertips', () => {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.9, y: 0.9, z: 0 }));
  landmarks[4] = { x: 0.4, y: 0.5, z: -0.02 };
  landmarks[8] = { x: 0.6, y: 0.3, z: -0.04 };
  landmarks[12] = { x: 0.95, y: 0.95, z: 0 };
  const contact = estimateStrumContactPoint(landmarks);
  assert.equal(contact.source, 'thumb-index');
  assert.equal(contact.x, 0.5);
  assert.equal(contact.y, 0.4);
  assert.equal(contact.z, -0.03);
});

test('calibrated guide creates a visible corridor and detects lateral escape', () => {
  const guide = buildStrumGuide(band, 0.5);
  assert.equal(guide.ready, true);
  assert.equal(guide.calibrated, true);
  assert.equal(guide.polygon.length, 4);
  assert.equal(evaluateStrumGuidePoint(point(0.5, 0.5), band, guide).inside, true);
  const escaped = evaluateStrumGuidePoint(point(0.78, 0.5), band, guide);
  assert.equal(escaped.inside, false);
  assert.equal(escaped.lateralInside, false);
});

test('guide calibrator locks the corridor to the selected strumming position', () => {
  const calibrator = new StrumGuideCalibrator();
  const guide = calibrator.observe(point(0.66, 0.5), band, { force: true });
  assert.equal(guide.calibrated, true);
  assert.ok(Math.abs(guide.tangentCenter - 0.66) < 1e-9);
  assert.equal(evaluateStrumGuidePoint(point(0.66, 0.5), band, guide).inside, true);
});

test('strict tracker counts one complete down crossing only after entering the string band', () => {
  const tracker = new StrictDirectionalStrumTracker();
  const guide = buildStrumGuide(band, 0.5);
  const events = sampleDown(tracker, guide).filter(Boolean);
  assert.deepEqual(events, ['down']);
  assert.equal(tracker.sample({ timestamp: 300, point: point(0.5, 0.58), band, guide, ready: true }), null);
});

test('strict tracker rejects a direct one-frame jump that never traverses the strings', () => {
  const tracker = new StrictDirectionalStrumTracker({ maximumFrameJump: 0.3 });
  const guide = buildStrumGuide(band, 0.5);
  tracker.sample({ timestamp: 0, point: point(0.5, 0.42), band, guide, ready: true });
  tracker.sample({ timestamp: 50, point: point(0.5, 0.42), band, guide, ready: true });
  tracker.sample({ timestamp: 100, point: point(0.5, 0.58), band, guide, ready: true });
  const event = tracker.sample({ timestamp: 150, point: point(0.5, 0.58), band, guide, ready: true });
  assert.equal(event, null);
});

test('strict tracker rejects motion outside the calibrated corridor', () => {
  const tracker = new StrictDirectionalStrumTracker();
  const guide = buildStrumGuide(band, 0.5);
  const samples = [0.42, 0.42, 0.48, 0.52, 0.58, 0.58]
    .map((y, index) => tracker.sample({ timestamp: index * 50, point: point(0.78, y), band, guide, ready: true }))
    .filter(Boolean);
  assert.deepEqual(samples, []);
  assert.equal(tracker.lastRejectReason, 'outside-guide');
});

test('another down stroke requires a verified up return first', () => {
  const tracker = new StrictDirectionalStrumTracker();
  const guide = buildStrumGuide(band, 0.5);
  assert.deepEqual(sampleDown(tracker, guide).filter(Boolean), ['down']);

  const repeatedBottom = [300, 350, 400]
    .map((timestamp) => tracker.sample({ timestamp, point: point(0.5, 0.58), band, guide, ready: true }))
    .filter(Boolean);
  assert.deepEqual(repeatedBottom, []);

  const returnEvents = [
    tracker.sample({ timestamp: 450, point: point(0.5, 0.52), band, guide, ready: true }),
    tracker.sample({ timestamp: 500, point: point(0.5, 0.48), band, guide, ready: true }),
    tracker.sample({ timestamp: 550, point: point(0.5, 0.42), band, guide, ready: true }),
    tracker.sample({ timestamp: 600, point: point(0.5, 0.42), band, guide, ready: true }),
  ].filter(Boolean);
  assert.deepEqual(returnEvents, ['up']);
  assert.deepEqual(sampleDown(tracker, guide, 650).filter(Boolean), ['down']);
});
