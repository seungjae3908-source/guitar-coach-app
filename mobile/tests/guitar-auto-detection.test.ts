import assert = require('node:assert/strict');

import {
  AutomaticGuitarGate,
  evaluateAutomaticGuitarDetection,
  isPlausiblePlayingHand,
  type AutoHandEvidence,
  type AutoStringEvidence,
} from '../services/guitar-auto-detection';

function playingHand(offsetY = 0): AutoHandEvidence {
  const raw: Array<[number, number]> = [
    [0.52, 0.70],
    [0.47, 0.66], [0.43, 0.62], [0.40, 0.57], [0.38, 0.53],
    [0.49, 0.61], [0.47, 0.57], [0.46, 0.53], [0.45, 0.50],
    [0.53, 0.60], [0.53, 0.56], [0.53, 0.52], [0.53, 0.49],
    [0.57, 0.61], [0.59, 0.57], [0.60, 0.54], [0.61, 0.51],
    [0.61, 0.63], [0.64, 0.60], [0.66, 0.57], [0.68, 0.54],
  ];
  return {
    hasHand: true,
    handednessScore: 0.84,
    landmarks: raw.map(([x, y], index) => ({ index, x, y: y + offsetY })),
  };
}

function guitarStrings(offsetY = 0): AutoStringEvidence {
  const ys = [0.49, 0.51, 0.53, 0.55, 0.57, 0.59];
  return {
    detected: true,
    confidence: 0.82,
    visibleLineCount: 6,
    angleDegrees: 0,
    lines: ys.map((y) => ({
      startX: 0.12,
      startY: y + offsetY,
      endX: 0.92,
      endY: y + offsetY,
      strength: 0.82,
    })),
  };
}

const hand = playingHand();
assert.equal(isPlausiblePlayingHand(hand), true, '정상 21점 손 구조는 자동 기타 인식 후보가 되어야 합니다.');

const accepted = evaluateAutomaticGuitarDetection(hand, guitarStrings());
assert.equal(accepted.accepted, true, '규칙적인 6줄과 실제 손이 겹치면 기타 연주 구역을 승인해야 합니다.');
assert.ok(accepted.region, '승인 결과에는 자동 오른손 ROI가 있어야 합니다.');
assert.ok(accepted.confidence >= 0.48, '승인 신뢰도 기준을 통과해야 합니다.');
assert.ok((accepted.region?.right ?? 1) - (accepted.region?.left ?? 0) <= 0.72, '자동 ROI가 화면 전체로 커지면 안 됩니다.');
assert.ok((accepted.region?.bottom ?? 1) - (accepted.region?.top ?? 0) <= 0.70, '자동 ROI가 얼굴·가슴까지 과도하게 포함하면 안 됩니다.');
assert.ok((accepted.region?.left ?? -1) >= 0 && (accepted.region?.right ?? 2) <= 1, 'ROI 가로 좌표는 화면 안이어야 합니다.');
assert.ok((accepted.region?.top ?? -1) >= 0 && (accepted.region?.bottom ?? 2) <= 1, 'ROI 세로 좌표는 화면 안이어야 합니다.');

const stringsWithoutNearbyHand = evaluateAutomaticGuitarDetection(playingHand(-0.35), guitarStrings());
assert.equal(stringsWithoutNearbyHand.accepted, false, '줄무늬와 멀리 떨어진 손을 기타 연주로 승인하면 안 됩니다.');

const collapsedHand: AutoHandEvidence = {
  hasHand: true,
  handednessScore: 0.9,
  landmarks: Array.from({ length: 21 }, (_, index) => ({ index, x: 0.5, y: 0.5 })),
};
assert.equal(isPlausiblePlayingHand(collapsedHand), false, '얼굴·문신처럼 뭉친 가짜 21점은 손으로 인정하면 안 됩니다.');
assert.equal(evaluateAutomaticGuitarDetection(collapsedHand, guitarStrings()).accepted, false, '가짜 손과 줄무늬 조합은 기타로 승인하면 안 됩니다.');

const incompleteStrings = { ...guitarStrings(), visibleLineCount: 3, lines: guitarStrings().lines.slice(0, 3) };
assert.equal(evaluateAutomaticGuitarDetection(hand, incompleteStrings).accepted, false, '줄이 부족하면 기타로 승인하면 안 됩니다.');

const gate = new AutomaticGuitarGate(3);
assert.equal(gate.add(accepted).locked, false, '첫 프레임에 자동 인식을 확정하면 안 됩니다.');
assert.equal(gate.add(accepted).locked, false, '두 프레임만으로 자동 인식을 확정하면 안 됩니다.');
const locked = gate.add(accepted);
assert.equal(locked.locked, true, '서로 맞는 세 프레임이 연속될 때만 자동 인식을 확정해야 합니다.');
assert.ok(locked.region, '잠금 결과에 평균 ROI가 있어야 합니다.');

const shifted = evaluateAutomaticGuitarDetection(playingHand(0.22), guitarStrings(0.22));
const reset = gate.add(shifted);
assert.equal(reset.locked, false, '기타 위치가 갑자기 크게 이동하면 연속 잠금을 초기화해야 합니다.');
assert.equal(reset.consecutive, 1, '이동 후 새 위치의 첫 프레임부터 다시 세어야 합니다.');

console.log('Automatic guitar localization tests passed: 15');
