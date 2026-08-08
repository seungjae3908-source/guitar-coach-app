import assert = require('node:assert/strict');

import {
  canShowFocusV8Coaching,
  FOCUS_V8_MIN_EVIDENCE_FRAMES,
  FOCUS_V8_SCREEN_ORDER,
  focusV8CameraSize,
  focusV8WaitingMessage,
} from '../services/focus-v8-contract';

assert.deepEqual(
  FOCUS_V8_SCREEN_ORDER,
  ['header', 'mode-selector', 'primary-action', 'camera', 'recognition-status', 'feedback-scroll'],
  '시작 버튼은 카메라보다 위에 있어야 하며 전체 화면 순서가 바뀌면 안 됩니다.',
);

const samsungPortrait = focusV8CameraSize(360, 780);
assert.equal(Math.round(samsungPortrait.height / samsungPortrait.width * 100), 133, '카메라는 정확한 세로 3:4 비율이어야 합니다.');
assert.ok(samsungPortrait.width <= 340, '카메라가 화면 좌우를 넘어가면 안 됩니다.');
assert.ok(samsungPortrait.height <= 480, '상단 조작부와 하단 상태·피드백 공간을 침범하면 안 됩니다.');

const compactPortrait = focusV8CameraSize(320, 640);
assert.ok(compactPortrait.height <= 340, '작은 화면에서 카메라가 시작·하단 영역을 밀어내면 안 됩니다.');

const baseEvidence = {
  lessonRunning: true,
  calibrationReady: true,
  subjectLocked: true,
  acceptedFrames: FOCUS_V8_MIN_EVIDENCE_FRAMES - 1,
};
assert.equal(canShowFocusV8Coaching(baseEvidence), false, '승인 프레임이 부족하면 피드백을 열면 안 됩니다.');
assert.match(
  focusV8WaitingMessage(baseEvidence, '오른손'),
  new RegExp(`${FOCUS_V8_MIN_EVIDENCE_FRAMES}`),
  '대기 문구에 필요한 증거 프레임 수를 표시해야 합니다.',
);
assert.equal(
  canShowFocusV8Coaching({ ...baseEvidence, acceptedFrames: FOCUS_V8_MIN_EVIDENCE_FRAMES }),
  true,
  '보정·레슨·잠금·현재 세션 증거가 모두 충족된 경우에만 피드백을 열어야 합니다.',
);
assert.equal(
  canShowFocusV8Coaching({ ...baseEvidence, acceptedFrames: 99, subjectLocked: false }),
  false,
  '과거 프레임이 많아도 현재 손 잠금이 풀리면 즉시 피드백을 닫아야 합니다.',
);

console.log('Focus V8 layout and evidence contract tests passed: 10');
