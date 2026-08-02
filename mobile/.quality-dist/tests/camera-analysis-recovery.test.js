"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("node:assert/strict");
const camera_analysis_recovery_1 = require("../services/camera-analysis-recovery");
const right_hand_roi_1 = require("../services/right-hand-roi");
const capture = (0, camera_analysis_recovery_1.cameraRecoveryDecision)('capture', 1, 320);
assert.equal(capture.blocksPreview, false, '분석용 사진 실패가 카메라 영상을 막으면 안 됩니다.');
assert.ok(capture.retryDelayMs >= 420, '첫 촬영 실패 뒤에는 카메라가 안정될 시간을 줘야 합니다.');
const repeated = (0, camera_analysis_recovery_1.cameraRecoveryDecision)('analysis', 4, 320);
assert.equal(repeated.blocksPreview, false, 'AI 분석 실패가 반복되어도 프리뷰는 유지되어야 합니다.');
assert.ok(repeated.retryDelayMs > capture.retryDelayMs, '반복 실패 시 재시도 간격이 늘어나야 합니다.');
const mount = (0, camera_analysis_recovery_1.cameraRecoveryDecision)('mount', 1, 320);
assert.equal(mount.blocksPreview, true, '실제 카메라 마운트 실패만 프리뷰 차단 오류입니다.');
assert.equal((0, camera_analysis_recovery_1.initialAnalysisDelayMs)(1_000, 1_250), 650, '카메라 준비 직후 분석을 서두르면 안 됩니다.');
assert.equal((0, camera_analysis_recovery_1.initialAnalysisDelayMs)(1_000, 2_000), 0, '안정 시간이 지난 뒤에는 바로 분석할 수 있어야 합니다.');
const region = (0, right_hand_roi_1.deriveRightHandRegion)({ x: 0.43, y: 0.70 }, { x: 0.64, y: 0.75 });
assert.ok(region.top >= 0.30, '오른손 ROI가 얼굴과 목까지 올라가면 안 됩니다.');
assert.ok(region.bottom >= 0.88, '오른손 ROI는 사운드홀 아래 복귀 궤적까지 포함해야 합니다.');
assert.equal((0, right_hand_roi_1.pointInsideRegion)({ x: 0.31, y: 0.34 }, region), false, '영상의 목·가슴 오검출 위치는 ROI 밖이어야 합니다.');
assert.equal((0, right_hand_roi_1.pointInsideRegion)({ x: 0.53, y: 0.70 }, region), true, '사운드홀 위 실제 오른손 위치는 ROI 안이어야 합니다.');
const validLandmarks = Array.from({ length: 21 }, (_, index) => ({
    x: 0.48 + (index % 5) * 0.018,
    y: 0.62 + Math.floor(index / 5) * 0.025,
}));
validLandmarks[0] = { x: 0.50, y: 0.72 };
validLandmarks[9] = { x: 0.54, y: 0.64 };
const validHand = (0, right_hand_roi_1.validateHandInRegion)(validLandmarks, region);
assert.equal(validHand.valid, true, 'ROI 안의 정상 손 구조는 승인되어야 합니다.');
const falseBodyLandmarks = validLandmarks.map((point) => ({ x: point.x - 0.23, y: point.y - 0.34 }));
const falseBody = (0, right_hand_roi_1.validateHandInRegion)(falseBodyLandmarks, region);
assert.equal(falseBody.valid, false, '목·가슴에 생긴 가짜 관절은 승인되면 안 됩니다.');
const gate = new right_hand_roi_1.ConsecutiveHandGate(5, 0.17);
for (let index = 1; index <= 4; index += 1) {
    const state = gate.add(validHand);
    assert.equal(state.locked, false, `${index}프레임만으로 피드백을 열면 안 됩니다.`);
}
assert.equal(gate.add(validHand).locked, true, '같은 오른손이 5프레임 연속 검출된 뒤에만 피드백을 열어야 합니다.');
assert.equal(gate.add({ ...validHand, valid: false, reason: 'outside-roi' }).locked, false, 'ROI 이탈 즉시 피드백 잠금을 해제해야 합니다.');
console.log('Camera analysis recovery and calibrated ROI tests passed: 18');
