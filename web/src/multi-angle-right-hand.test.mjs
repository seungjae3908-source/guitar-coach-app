import assert from 'node:assert/strict';
import test from 'node:test';
import { MultiAngleRightHandTechniqueAnalyzer, estimateCameraView } from './multi-angle-right-hand.js';

function point(x, y, visibility = 1, z = 0) {
  return { x, y, z, visibility, presence: visibility };
}

function pose({ elbowX = 0.62, elbowY = 0.46, wristX = 0.58, wristY = 0.58 } = {}) {
  const landmarks = Array.from({ length: 33 }, () => point(0, 0, 0));
  landmarks[11] = point(0.38, 0.3);
  landmarks[12] = point(0.65, 0.3);
  landmarks[13] = point(0.4, 0.48);
  landmarks[14] = point(elbowX, elbowY);
  landmarks[15] = point(0.42, 0.62);
  landmarks[16] = point(wristX, wristY);
  landmarks[23] = point(0.43, 0.68);
  landmarks[24] = point(0.61, 0.68);
  return landmarks;
}

function world({ yaw = 0, elbowX = 0.16, elbowY = 0.1, wristX = 0.2, wristY = 0.25 } = {}) {
  const landmarks = Array.from({ length: 33 }, () => point(0, 0, 0, 0));
  landmarks[11] = point(-0.15, 0, 1, -yaw * 0.15);
  landmarks[12] = point(0.15, 0, 1, yaw * 0.15);
  landmarks[13] = point(-0.18, 0.2, 1, -0.04);
  landmarks[14] = point(elbowX, elbowY, 1, 0.02);
  landmarks[15] = point(-0.2, 0.4, 1, -0.03);
  landmarks[16] = point(wristX, wristY, 1, 0.04);
  landmarks[23] = point(-0.11, 0.55, 1, 0.02);
  landmarks[24] = point(0.11, 0.55, 1, 0.02);
  return landmarks;
}

function hand({ wristX = 0.58, wristY = 0.58, contactX = 0.58, contactY = 0.48 } = {}) {
  const landmarks = Array.from({ length: 21 }, () => point(wristX, wristY));
  landmarks[0] = point(wristX, wristY);
  landmarks[2] = point(wristX - 0.03, wristY - 0.02);
  landmarks[4] = point(contactX - 0.01, contactY);
  landmarks[5] = point(wristX - 0.04, wristY - 0.04);
  landmarks[8] = point(contactX + 0.01, contactY);
  landmarks[9] = point(wristX, wristY - 0.05);
  landmarks[12] = point(wristX, wristY - 0.14);
  landmarks[13] = point(wristX + 0.025, wristY - 0.045);
  landmarks[16] = point(wristX + 0.025, wristY - 0.13);
  landmarks[17] = point(wristX + 0.05, wristY - 0.035);
  landmarks[20] = point(wristX + 0.05, wristY - 0.12);
  return { trackId: 1, role: 'strum', wrist: landmarks[0], pickPoint: point(contactX, contactY), landmarks };
}

function transformPoint(input, { angle = 0, scale = 1, dx = 0, dy = 0, mirror = false } = {}) {
  const x = (mirror ? 1 - input.x : input.x) - 0.5;
  const y = input.y - 0.5;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { ...input, x: 0.5 + (x * cos - y * sin) * scale + dx, y: 0.5 + (x * sin + y * cos) * scale + dy, z: (mirror ? -1 : 1) * (input.z || 0) * scale };
}

function transformPose(source, transform) {
  return source.map((entry) => transformPoint(entry, transform));
}

function transformHand(source, transform) {
  const landmarks = source.landmarks.map((entry) => transformPoint(entry, transform));
  return { ...source, landmarks, wrist: landmarks[0], pickPoint: transformPoint(source.pickPoint, transform) };
}

const band = { top: 0.47, bottom: 0.53, center: 0.5, normalX: 0, normalY: 1, tangentX: 1, tangentY: 0 };

function transformBand(source, transform = {}) {
  const center = transformPoint(point(0.5, source.center), transform);
  const tangentPoint = transformPoint(point(0.6, source.center), transform);
  const length = Math.hypot(tangentPoint.x - center.x, tangentPoint.y - center.y);
  const tangentX = (tangentPoint.x - center.x) / length;
  const tangentY = (tangentPoint.y - center.y) / length;
  const normalX = -tangentY;
  const normalY = tangentX;
  const half = (source.bottom - source.top) * (transform.scale || 1) / 2;
  const projection = normalX * center.x + normalY * center.y;
  return { top: projection - half, bottom: projection + half, center: projection, normalX, normalY, tangentX, tangentY };
}

function wristResult(transform = {}) {
  const analyzer = new MultiAngleRightHandTechniqueAnalyzer();
  let result;
  [0.48, 0.54, 0.46, 0.55].forEach((contactY, index) => {
    result = analyzer.update({
      timestamp: index * 70,
      hand: transformHand(hand({ contactY }), transform),
      bodyLandmarks: transformPose(pose(), transform),
      bodyWorldLandmarks: world({ yaw: transform.yaw || 0 }),
      band: transformBand(band, transform),
    });
  });
  return result;
}

function armResult(transform = {}) {
  const analyzer = new MultiAngleRightHandTechniqueAnalyzer();
  let result;
  const samples = [
    { elbowX: 0.62, elbowY: 0.46, wristX: 0.58, wristY: 0.58 },
    { elbowX: 0.59, elbowY: 0.49, wristX: 0.54, wristY: 0.62 },
    { elbowX: 0.56, elbowY: 0.52, wristX: 0.50, wristY: 0.66 },
    { elbowX: 0.60, elbowY: 0.48, wristX: 0.55, wristY: 0.61 },
  ];
  samples.forEach((sample, index) => {
    result = analyzer.update({
      timestamp: index * 70,
      hand: transformHand(hand({ wristX: sample.wristX, wristY: sample.wristY, contactX: sample.wristX, contactY: sample.wristY - 0.1 }), transform),
      bodyLandmarks: transformPose(pose(sample), transform),
      bodyWorldLandmarks: world({ yaw: transform.yaw || 0, elbowX: sample.elbowX - 0.46, elbowY: sample.elbowY - 0.36, wristX: sample.wristX - 0.38, wristY: sample.wristY - 0.33 }),
      band: transformBand(band, transform),
    });
  });
  return result;
}

test('view estimator identifies both oblique sides', () => {
  assert.equal(estimateCameraView(pose(), world({ yaw: 0.8 })).type, 'right-oblique');
  assert.equal(estimateCameraView(pose(), world({ yaw: -0.8 })).type, 'left-oblique');
});

test('wrist-led motion remains wrist-led after camera roll and scale changes', () => {
  for (const transform of [
    { angle: Math.PI / 5, scale: 0.72, dx: 0.08, dy: -0.05 },
    { angle: -Math.PI / 4, scale: 1.18, dx: -0.05, dy: 0.03 },
  ]) {
    const result = wristResult(transform);
    assert.equal(result.movementType, 'wrist');
    assert.ok(result.angleCorrectionReady);
  }
});

test('front-camera mirroring does not change wrist classification', () => {
  const result = wristResult({ angle: Math.PI / 7, scale: 0.9, mirror: true, dx: 0.02 });
  assert.equal(result.movementType, 'wrist');
});

test('arm-led motion survives left and right oblique views', () => {
  for (const transform of [
    { angle: Math.PI / 6, scale: 0.78, yaw: 0.7 },
    { angle: -Math.PI / 5, scale: 1.12, yaw: -0.7, dy: 0.04 },
  ]) {
    const result = armResult(transform);
    assert.equal(result.movementType, 'arm');
    assert.ok(result.movementConfidence > 0.25);
  }
});

test('mirrored oblique arm motion remains arm-led', () => {
  const result = armResult({ angle: Math.PI / 8, scale: 0.86, mirror: true, yaw: 0.6 });
  assert.equal(result.movementType, 'arm');
});

test('hidden right arm returns unjudgeable instead of switching to the left arm', () => {
  const hidden = pose();
  for (const index of [12, 14, 16]) hidden[index] = { ...hidden[index], visibility: 0.05, presence: 0.05 };
  const analyzer = new MultiAngleRightHandTechniqueAnalyzer();
  const result = analyzer.update({ timestamp: 0, hand: hand(), bodyLandmarks: hidden, band });
  assert.equal(result.movementType, 'unjudgeable');
  assert.equal(result.poseReady, false);
});
