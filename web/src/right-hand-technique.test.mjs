import assert from 'node:assert/strict';
import test from 'node:test';

import { RightHandTechniqueAnalyzer, classifyRightHandMotion, matchPoseArm } from './right-hand-technique.js';

function point(x, y, visibility = 1) {
  return { x, y, visibility, presence: visibility };
}

function pose(side = 'right', offset = 0) {
  const landmarks = Array.from({ length: 33 }, () => point(0, 0, 0));
  const ids = side === 'right' ? [12, 14, 16] : [11, 13, 15];
  landmarks[ids[0]] = point(0.65 + offset, 0.3);
  landmarks[ids[1]] = point(0.62 + offset, 0.46);
  landmarks[ids[2]] = point(0.58 + offset, 0.58);
  return landmarks;
}

function hand({ wristX = 0.58, wristY = 0.58, contactX = 0.58, contactY = 0.48, fingerCurl = {} } = {}) {
  const landmarks = Array.from({ length: 21 }, () => point(wristX, wristY));
  landmarks[0] = point(wristX, wristY);
  landmarks[2] = point(wristX - 0.03, wristY - 0.02);
  landmarks[5] = point(wristX - 0.04, wristY - 0.04);
  landmarks[9] = point(wristX, wristY - 0.05);
  landmarks[13] = point(wristX + 0.025, wristY - 0.045);
  landmarks[17] = point(wristX + 0.05, wristY - 0.035);
  const definitions = {
    p: [2, 4, -0.075],
    i: [5, 8, -0.09],
    m: [9, 12, -0.095],
    a: [13, 16, -0.085],
  };
  for (const [id, [mcp, tip, length]] of Object.entries(definitions)) {
    const factor = fingerCurl[id] ?? 0;
    landmarks[tip] = point(landmarks[mcp].x, landmarks[mcp].y + length * (1 - factor * 0.7));
  }
  return {
    trackId: 1,
    role: 'strum',
    wrist: landmarks[0],
    pickPoint: point(contactX, contactY),
    landmarks,
  };
}

const band = {
  top: 0.47,
  bottom: 0.53,
  center: 0.5,
  normalX: 0,
  normalY: 1,
  tangentX: 1,
  tangentY: 0,
};

test('matches the pose arm by wrist geometry rather than handedness text', () => {
  const matched = matchPoseArm(point(0.58, 0.58), pose('right'));
  assert.equal(matched.side, 'right');
});

test('classifies relative pick motion with a stable elbow as wrist driven', () => {
  const result = classifyRightHandMotion([
    { armEnergy: 0.002, wristEnergy: 0.02, quality: 1 },
    { armEnergy: 0.001, wristEnergy: 0.018, quality: 1 },
  ]);
  assert.equal(result.type, 'wrist');
  assert.ok(result.wristRatio > 0.8);
});

test('classifies proximal arm translation with a stable hand shape as arm driven', () => {
  const result = classifyRightHandMotion([
    { armEnergy: 0.025, wristEnergy: 0.002, quality: 1 },
    { armEnergy: 0.02, wristEnergy: 0.001, quality: 1 },
  ]);
  assert.equal(result.type, 'arm');
  assert.ok(result.armRatio > 0.85);
});

test('live analyzer separates wrist and arm driven samples', () => {
  const wristAnalyzer = new RightHandTechniqueAnalyzer();
  wristAnalyzer.update({ timestamp: 0, hand: hand({ contactY: 0.48 }), bodyLandmarks: pose(), band });
  wristAnalyzer.update({ timestamp: 60, hand: hand({ contactY: 0.54 }), bodyLandmarks: pose(), band });
  const wristResult = wristAnalyzer.update({ timestamp: 120, hand: hand({ contactY: 0.46 }), bodyLandmarks: pose(), band });
  assert.equal(wristResult.movementType, 'wrist');

  const armAnalyzer = new RightHandTechniqueAnalyzer();
  armAnalyzer.update({ timestamp: 0, hand: hand({}), bodyLandmarks: pose('right', 0), band });
  armAnalyzer.update({ timestamp: 60, hand: hand({ wristX: 0.63, contactX: 0.63 }), bodyLandmarks: pose('right', 0.05), band });
  const armResult = armAnalyzer.update({ timestamp: 120, hand: hand({ wristX: 0.68, contactX: 0.68 }), bodyLandmarks: pose('right', 0.1), band });
  assert.equal(armResult.movementType, 'arm');
});

test('counts fast alternating strum speed and stable maximum', () => {
  const analyzer = new RightHandTechniqueAnalyzer();
  const sequence = ['down', 'up', 'down', 'up', 'down', 'up', 'down'];
  let result;
  sequence.forEach((event, index) => {
    result = analyzer.update({
      timestamp: index * 120,
      hand: hand({ contactY: index % 2 ? 0.54 : 0.46 }),
      bodyLandmarks: pose(),
      band,
      strokeEvent: event,
    });
  });
  assert.ok(result.strumSps > 8);
  assert.equal(result.strumAlternation, 1);
  assert.ok(result.maxStableSps > 8);
});

test('detects i-m-a three finger activity and speed', () => {
  const analyzer = new RightHandTechniqueAnalyzer();
  let timestamp = 0;
  let result;
  for (const finger of ['i', 'm', 'a', 'i', 'm', 'a']) {
    result = analyzer.update({ timestamp, hand: hand(), bodyLandmarks: pose(), band });
    timestamp += 55;
    result = analyzer.update({ timestamp, hand: hand({ fingerCurl: { [finger]: 0.9 } }), bodyLandmarks: pose(), band });
    timestamp += 90;
    result = analyzer.update({ timestamp, hand: hand(), bodyLandmarks: pose(), band });
    timestamp += 35;
  }
  assert.ok(result.fingerEventCount >= 5);
  assert.ok(result.threeFingerSps > 4);
  assert.equal(result.detectedPattern, 'i-m-a');
});
