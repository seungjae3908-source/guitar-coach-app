import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ManualGuitarCalibration,
  buildManualGuitarPose,
  mapMirroredCoverPointer,
} from './manual-guitar-calibration.js';

const validPoints = [
  { x: 0.52, y: 0.66 },
  { x: 0.8, y: 0.38 },
  { x: 0.56, y: 0.61 },
];

test('builds a validated six-line manual guitar pose', () => {
  const result = buildManualGuitarPose(validPoints, 1200);
  assert.equal(result.error, '');
  assert.equal(result.pose.guitarValidated, true);
  assert.equal(result.pose.manualCalibration, true);
  assert.equal(result.pose.recoverySource, 'manual-three-point');
  assert.equal(result.pose.lines.length, 6);
  assert.equal(result.pose.stringBand.geometryValidated, true);
  assert.ok(result.pose.stringBand.supportLength > 0.4);
  assert.equal(result.pose.updatedAt, 1200);
});

test('supports mirrored neck direction', () => {
  const result = buildManualGuitarPose([
    { x: 0.5, y: 0.65 },
    { x: 0.18, y: 0.4 },
    { x: 0.46, y: 0.6 },
  ]);
  assert.equal(result.pose.guitarValidated, true);
  assert.ok(result.pose.axis.tangent.x < 0);
});

test('rejects a neck point too close to the soundhole', () => {
  const result = buildManualGuitarPose([
    { x: 0.5, y: 0.6 },
    { x: 0.56, y: 0.58 },
    { x: 0.52, y: 0.62 },
  ]);
  assert.equal(result.pose, null);
  assert.match(result.error, /더 멀리/);
});

test('rejects a third point far away from the string axis', () => {
  const result = buildManualGuitarPose([
    { x: 0.5, y: 0.6 },
    { x: 0.82, y: 0.4 },
    { x: 0.12, y: 0.9 },
  ]);
  assert.equal(result.pose, null);
  assert.match(result.error, /스트럼 위치/);
});

test('calibration requires three ordered taps and then locks the pose', () => {
  const calibration = new ManualGuitarCalibration();
  let snapshot = calibration.begin();
  assert.equal(snapshot.active, true);
  assert.equal(snapshot.step, 1);

  snapshot = calibration.addPoint(validPoints[0], 100);
  assert.equal(snapshot.step, 2);
  snapshot = calibration.addPoint(validPoints[1], 200);
  assert.equal(snapshot.step, 3);
  snapshot = calibration.addPoint(validPoints[2], 300);
  assert.equal(snapshot.ready, true);
  assert.equal(snapshot.active, false);
  assert.equal(calibration.poseFor(800).updatedAt, 800);
});

test('an invalid second tap does not advance the sequence', () => {
  const calibration = new ManualGuitarCalibration();
  calibration.begin();
  calibration.addPoint({ x: 0.5, y: 0.6 });
  const snapshot = calibration.addPoint({ x: 0.54, y: 0.6 });
  assert.equal(snapshot.step, 2);
  assert.equal(snapshot.points.length, 1);
  assert.match(snapshot.error, /더 멀리/);
});

test('clear removes the manual pose and cancel keeps completed geometry absent', () => {
  const calibration = new ManualGuitarCalibration();
  calibration.begin();
  calibration.addPoint(validPoints[0]);
  calibration.cancel();
  assert.equal(calibration.snapshot().active, false);
  assert.equal(calibration.poseFor(), null);
  calibration.begin();
  validPoints.forEach((entry) => calibration.addPoint(entry));
  assert.equal(calibration.snapshot().ready, true);
  calibration.clear();
  assert.equal(calibration.snapshot().ready, false);
  assert.equal(calibration.poseFor(), null);
});

test('maps taps through mirrored object-cover geometry', () => {
  const rect = { left: 10, top: 20, width: 300, height: 600 };
  const center = mapMirroredCoverPointer({
    clientX: 160,
    clientY: 320,
    rect,
    sourceWidth: 1920,
    sourceHeight: 1080,
  });
  assert.ok(Math.abs(center.x - 0.5) < 0.001);
  assert.ok(Math.abs(center.y - 0.5) < 0.001);

  const left = mapMirroredCoverPointer({
    clientX: 20,
    clientY: 320,
    rect,
    sourceWidth: 1080,
    sourceHeight: 1920,
  });
  assert.ok(left.x > 0.9);
});

test('all six synthetic lines span the same calibrated support', () => {
  const { pose } = buildManualGuitarPose(validPoints);
  const tangent = pose.axis.tangent;
  const projections = pose.lines.map((line) => ({
    start: line.start.x * tangent.x + line.start.y * tangent.y,
    end: line.end.x * tangent.x + line.end.y * tangent.y,
  }));
  const startSpread = Math.max(...projections.map((entry) => entry.start)) - Math.min(...projections.map((entry) => entry.start));
  const endSpread = Math.max(...projections.map((entry) => entry.end)) - Math.min(...projections.map((entry) => entry.end));
  assert.ok(startSpread < 0.03);
  assert.ok(endSpread < 0.03);
});
