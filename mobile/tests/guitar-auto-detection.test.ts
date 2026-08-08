import assert = require('node:assert/strict');

import {
  AutomaticGuitarGate,
  evaluateAutomaticGuitarDetection,
  isPlausiblePlayingHand,
  type AutoGuitarStructureEvidence,
  type AutoHandEvidence,
  type AutoStringEvidence,
} from '../services/guitar-auto-detection';

function playingHand(offsetX = 0, offsetY = 0): AutoHandEvidence {
  const raw: Array<[number, number]> = [
    [0.58, 0.68],
    [0.53, 0.65], [0.49, 0.61], [0.46, 0.57], [0.43, 0.54],
    [0.54, 0.60], [0.52, 0.57], [0.50, 0.54], [0.49, 0.51],
    [0.58, 0.59], [0.58, 0.56], [0.58, 0.53], [0.58, 0.50],
    [0.62, 0.60], [0.64, 0.57], [0.65, 0.54], [0.66, 0.51],
    [0.66, 0.62], [0.69, 0.59], [0.71, 0.56], [0.73, 0.53],
  ];
  return {
    hasHand: true,
    handednessScore: 0.88,
    landmarks: raw.map(([x, y], index) => ({ index, x: x + offsetX, y: y + offsetY })),
  };
}

function guitarStrings(offsetX = 0, offsetY = 0, angleDegrees = 0): AutoStringEvidence {
  const ys = [0.49, 0.51, 0.53, 0.55, 0.57, 0.59];
  const radians = angleDegrees * Math.PI / 180;
  const dx = Math.cos(radians) * 0.72;
  const dy = Math.sin(radians) * 0.72;
  const normalX = -Math.sin(radians);
  const normalY = Math.cos(radians);
  return {
    detected: true,
    confidence: 0.86,
    visibleLineCount: 6,
    angleDegrees,
    lines: ys.map((_, index) => {
      const displacement = (index - 2.5) * 0.02;
      const centerX = 0.52 + offsetX + normalX * displacement;
      const centerY = 0.54 + offsetY + normalY * displacement;
      return {
        startX: centerX - dx / 2,
        startY: centerY - dy / 2,
        endX: centerX + dx / 2,
        endY: centerY + dy / 2,
        strength: 0.84,
      };
    }),
  };
}

function guitarStructure(overrides: Partial<AutoGuitarStructureEvidence> = {}): AutoGuitarStructureEvidence {
  return {
    detected: true,
    model: 'efficientdet-lite0-coco+geometry-v1',
    label: 'guitar',
    objectConfidence: 0.83,
    structureConfidence: 0.78,
    objectBox: { left: 0.12, top: 0.27, right: 0.91, bottom: 0.82 },
    bodyDetected: true,
    bodyConfidence: 0.76,
    bodyBox: { left: 0.40, top: 0.35, right: 0.90, bottom: 0.80 },
    neckDetected: true,
    neckConfidence: 0.79,
    neckAngleDegrees: 0,
    neckStartX: 0.46,
    neckStartY: 0.54,
    neckEndX: 0.13,
    neckEndY: 0.54,
    soundholeDetected: true,
    soundholeConfidence: 0.74,
    soundholeCenterX: 0.55,
    soundholeCenterY: 0.54,
    soundholeRadiusRatio: 0.075,
    pickupDetected: false,
    pickupConfidence: 0,
    pickupCenterX: 0,
    pickupCenterY: 0,
    bridgeDetected: true,
    bridgeConfidence: 0.72,
    bridgeCenterX: 0.72,
    bridgeCenterY: 0.54,
    bridgeAngleDegrees: 90,
    ...overrides,
  };
}

const hand = playingHand();
assert.equal(isPlausiblePlayingHand(hand), true, '정상 21점 손 구조는 자동 기타 인식 후보가 되어야 합니다.');

const structure = guitarStructure();
const accepted = evaluateAutomaticGuitarDetection(hand, guitarStrings(), structure);
assert.equal(accepted.accepted, true, '기타 객체와 모든 구조 증거가 논리적으로 맞아야 승인해야 합니다.');
assert.ok(accepted.region, '승인 결과에는 자동 오른손 ROI가 있어야 합니다.');
assert.ok(accepted.confidence >= 0.5, '통합 신뢰도 기준을 통과해야 합니다.');
assert.match(accepted.reason, /몸통.*넥.*사운드홀.*브리지.*6줄/, '승인 사유에 실제 교차검증 증거가 표시되어야 합니다.');
assert.ok((accepted.region?.right ?? 1) - (accepted.region?.left ?? 0) <= 0.66, '자동 ROI가 화면 전체로 커지면 안 됩니다.');
assert.ok((accepted.region?.bottom ?? 1) - (accepted.region?.top ?? 0) <= 0.62, '자동 ROI가 얼굴·가슴까지 과도하게 포함하면 안 됩니다.');
assert.ok((accepted.region?.left ?? -1) >= 0 && (accepted.region?.right ?? 2) <= 1, 'ROI 가로 좌표는 화면 안이어야 합니다.');
assert.ok((accepted.region?.top ?? -1) >= 0 && (accepted.region?.bottom ?? 2) <= 1, 'ROI 세로 좌표는 화면 안이어야 합니다.');

assert.equal(
  evaluateAutomaticGuitarDetection(hand, guitarStrings(), guitarStructure({ detected: false, objectConfidence: 0 })).accepted,
  false,
  '손과 평행선만 있고 기타 객체가 없으면 승인하면 안 됩니다.',
);
assert.equal(
  evaluateAutomaticGuitarDetection(hand, guitarStrings(), guitarStructure({ label: 'sports ball' })).accepted,
  false,
  '기타가 아닌 객체 라벨을 기타로 승인하면 안 됩니다.',
);
assert.equal(
  evaluateAutomaticGuitarDetection(hand, guitarStrings(), guitarStructure({ bodyDetected: false, bodyConfidence: 0 })).accepted,
  false,
  '기타 몸통 윤곽이 없으면 승인하면 안 됩니다.',
);
assert.equal(
  evaluateAutomaticGuitarDetection(hand, guitarStrings(), guitarStructure({ neckDetected: false, neckConfidence: 0 })).accepted,
  false,
  '넥 방향 증거가 없으면 승인하면 안 됩니다.',
);
assert.equal(
  evaluateAutomaticGuitarDetection(hand, guitarStrings(), guitarStructure({ soundholeDetected: false, soundholeConfidence: 0 })).accepted,
  false,
  '통기타 사운드홀이나 일렉 픽업 증거가 모두 없으면 승인하면 안 됩니다.',
);
assert.equal(
  evaluateAutomaticGuitarDetection(
    hand,
    guitarStrings(),
    guitarStructure({ soundholeDetected: false, soundholeConfidence: 0, pickupDetected: true, pickupConfidence: 0.72, pickupCenterX: 0.57, pickupCenterY: 0.54 }),
  ).accepted,
  true,
  '일렉기타는 픽업 구조로 사운드홀 조건을 대체할 수 있어야 합니다.',
);
assert.equal(
  evaluateAutomaticGuitarDetection(hand, guitarStrings(), guitarStructure({ bridgeDetected: false, bridgeConfidence: 0 })).accepted,
  false,
  '브리지 구조가 없으면 승인하면 안 됩니다.',
);
assert.equal(
  evaluateAutomaticGuitarDetection(hand, guitarStrings(), guitarStructure({ neckAngleDegrees: 36 })).accepted,
  false,
  '줄 방향과 넥 방향이 다르면 승인하면 안 됩니다.',
);
assert.equal(
  evaluateAutomaticGuitarDetection(hand, guitarStrings(), guitarStructure({ bridgeAngleDegrees: 12 })).accepted,
  false,
  '브리지가 줄과 거의 평행하면 승인하면 안 됩니다.',
);
assert.equal(
  evaluateAutomaticGuitarDetection(hand, guitarStrings(), guitarStructure({ bridgeCenterX: 0.56, bridgeCenterY: 0.54 })).accepted,
  false,
  '사운드홀과 브리지가 같은 위치이면 승인하면 안 됩니다.',
);

const stringsWithoutNearbyHand = evaluateAutomaticGuitarDetection(playingHand(0, -0.35), guitarStrings(), structure);
assert.equal(stringsWithoutNearbyHand.accepted, false, '기타와 멀리 떨어진 손을 연주 손으로 승인하면 안 됩니다.');

const collapsedHand: AutoHandEvidence = {
  hasHand: true,
  handednessScore: 0.9,
  landmarks: Array.from({ length: 21 }, (_, index) => ({ index, x: 0.58, y: 0.54 })),
};
assert.equal(isPlausiblePlayingHand(collapsedHand), false, '얼굴·문신처럼 뭉친 가짜 21점은 손으로 인정하면 안 됩니다.');
assert.equal(evaluateAutomaticGuitarDetection(collapsedHand, guitarStrings(), structure).accepted, false, '가짜 손과 기타 구조 조합도 승인하면 안 됩니다.');

const incompleteStrings = { ...guitarStrings(), visibleLineCount: 3, lines: guitarStrings().lines.slice(0, 3) };
assert.equal(evaluateAutomaticGuitarDetection(hand, incompleteStrings, structure).accepted, false, '줄이 부족하면 기타로 승인하면 안 됩니다.');

const gate = new AutomaticGuitarGate(5);
assert.equal(gate.add(accepted).locked, false, '첫 프레임에 자동 인식을 확정하면 안 됩니다.');
assert.equal(gate.add(accepted).locked, false, '두 프레임만으로 자동 인식을 확정하면 안 됩니다.');
assert.equal(gate.add(accepted).locked, false, '세 프레임만으로 자동 인식을 확정하면 안 됩니다.');
assert.equal(gate.add(accepted).locked, false, '네 프레임만으로 자동 인식을 확정하면 안 됩니다.');
const locked = gate.add(accepted);
assert.equal(locked.locked, true, '서로 맞는 다섯 프레임이 연속될 때만 자동 인식을 확정해야 합니다.');
assert.ok(locked.region, '잠금 결과에 평균 ROI가 있어야 합니다.');

const shiftedDetection = evaluateAutomaticGuitarDetection(
  playingHand(0.18, 0),
  guitarStrings(0.18, 0),
  guitarStructure({
    objectBox: { left: 0.30, top: 0.27, right: 0.99, bottom: 0.82 },
    bodyBox: { left: 0.55, top: 0.35, right: 0.99, bottom: 0.80 },
    soundholeCenterX: 0.73,
    bridgeCenterX: 0.88,
    neckStartX: 0.64,
    neckEndX: 0.31,
  }),
);
assert.equal(shiftedDetection.accepted, true, '새 위치 자체가 유효하면 단일 프레임 판정은 승인될 수 있어야 합니다.');
const reset = gate.add(shiftedDetection);
assert.equal(reset.locked, false, '기타와 구조 기준점이 갑자기 크게 이동하면 연속 잠금을 초기화해야 합니다.');
assert.equal(reset.consecutive, 1, '이동 후 새 위치의 첫 프레임부터 다시 세어야 합니다.');

console.log('Automatic guitar structure localization tests passed: 31');
