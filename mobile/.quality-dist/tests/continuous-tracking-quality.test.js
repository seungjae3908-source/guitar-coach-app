"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const continuous_tracking_quality_1 = require("../services/continuous-tracking-quality");
function assert(condition, message) {
    if (!condition)
        throw new Error(`연속 인식 품질 게이트 실패: ${message}`);
}
const names = [
    'wrist', 'thumbCmc', 'thumbMcp', 'thumbIp', 'thumbTip',
    'indexMcp', 'indexPip', 'indexDip', 'indexTip',
    'middleMcp', 'middlePip', 'middleDip', 'middleTip',
    'ringMcp', 'ringPip', 'ringDip', 'ringTip',
    'pinkyMcp', 'pinkyPip', 'pinkyDip', 'pinkyTip',
];
function landmarks(offsetX = 0, offsetY = 0) {
    return names.map((name, index) => {
        const fingerColumn = index === 0 ? 0 : Math.floor((index - 1) / 4);
        const fingerDepth = index === 0 ? 0 : (index - 1) % 4;
        return {
            index,
            name,
            x: 0.45 + fingerColumn * 0.035 + offsetX,
            y: index === 0 ? 0.60 + offsetY : 0.57 - fingerDepth * 0.055 + offsetY,
            z: 0,
        };
    });
}
function lines(customY) {
    const ys = customY ?? [0.30, 0.35, 0.40, 0.45, 0.50, 0.55];
    return ys.map((y, index) => ({
        visualIndex: (index + 1),
        stringNumber: (6 - index),
        startX: 0.02,
        startY: y,
        endX: 0.98,
        endY: y + 0.002,
        strength: 0.86,
    }));
}
function tracking(overrides = {}) {
    return {
        detected: true,
        confidence: 0.86,
        angleDegrees: 0.1,
        visibleLineCount: 6,
        stringOrder: 'low-to-high',
        numberingConfidence: 0.82,
        stabilityConfidence: 0.8,
        nearestVisualIndex: 0,
        nearestStringNumber: 0,
        nearestDistanceRatio: 1,
        roiLeft: 0.01,
        roiRight: 0.99,
        roiTop: 0.15,
        roiBottom: 0.78,
        lines: lines(),
        ...overrides,
    };
}
function hit(capturedAt) {
    return {
        capturedAt,
        contactId: 'index',
        label: 'i',
        visualIndex: 3,
        stringNumber: 4,
        direction: 'down',
        speed: 0.7,
        confidence: 0.9,
    };
}
function result(input) {
    const hasHand = input.hasHand ?? true;
    const base = {
        hasHand,
        imageWidth: 720,
        imageHeight: 960,
        latencyMs: 24,
        handedness: hasHand ? 'Right' : 'Unknown',
        handednessScore: hasHand ? 0.93 : 0,
        landmarks: hasHand ? landmarks(input.offsetX, input.offsetY) : [],
        pick: {
            detected: true,
            color: 'blue',
            confidence: 0.86,
            angleDegrees: 24,
            exposure: 0.32,
            centerX: 0.49 + (input.offsetX ?? 0),
            centerY: 0.41 + (input.offsetY ?? 0),
        },
        stringTracking: input.tracking ?? tracking(),
    };
    return {
        ...base,
        continuous: {
            enabled: true,
            previewFps: 29,
            analysisFps: 20,
            frameCount: input.frame,
            analyzedFrameCount: input.frame,
            stringRefreshAgeFrames: 0,
            newHits: input.hits ?? [],
            recentHits: input.hits ?? [],
        },
    };
}
const gate = new continuous_tracking_quality_1.ContinuousTrackingQualityGate();
const first = gate.process(result({ frame: 1 }), 1_000);
assert(!first.stringTracking, '한 번의 줄 검출만으로 줄 위치를 확정하면 안 됩니다.');
assert(first.continuous.qualityGate?.trackingAccepted === false, '첫 줄 프레임은 확인 중이어야 합니다.');
const acceptedHit = hit(2_000);
const second = gate.process(result({ frame: 2, hits: [acceptedHit] }), 1_080);
assert(second.stringTracking?.detected === true, '호환되는 줄 프레임 두 개가 연속되면 추적을 허용해야 합니다.');
assert((second.stringTracking?.stabilityConfidence ?? 0) >= 0.43, '허용된 줄 결과는 최소 안정도 기준을 통과해야 합니다.');
assert(second.continuous.newHits.length === 1, '현재 접촉점과 가까운 탄현 후보를 유지해야 합니다.');
assert(second.continuous.newHits[0]?.visualIndex > 0, '탄현 후보는 다시 계산된 줄 위치를 가져야 합니다.');
const duplicate = gate.process(result({ frame: 3, hits: [hit(2_030)] }), 1_150);
assert(duplicate.continuous.newHits.length === 0, '58ms 안의 동일 탄현을 중복 기록하면 안 됩니다.');
assert((duplicate.continuous.qualityGate?.rejectedHitCount ?? 0) >= 1, '중복 제거 횟수를 진단값으로 남겨야 합니다.');
const staleRoi = gate.process(result({
    frame: 4,
    tracking: tracking({ roiTop: 0.82, roiBottom: 0.98 }),
    hits: [hit(2_200)],
}), 1_230);
assert(!staleRoi.stringTracking, '현재 손 위치와 맞지 않는 과거 줄 ROI를 폐기해야 합니다.');
assert(staleRoi.continuous.newHits.length === 0, '폐기된 줄 ROI에서 탄현을 만들면 안 됩니다.');
const geometryGate = new continuous_tracking_quality_1.ContinuousTrackingQualityGate();
geometryGate.process(result({ frame: 1 }), 3_000);
const irregular = geometryGate.process(result({
    frame: 2,
    tracking: tracking({ lines: lines([0.30, 0.35, 0.51, 0.55, 0.60, 0.65]) }),
}), 3_080);
assert(!irregular.stringTracking, '간격이 불규칙한 선 묶음을 기타줄로 인정하면 안 됩니다.');
const missing = gate.process(result({ frame: 5, hasHand: false, hits: [hit(2_400)] }), 1_320);
assert(!missing.stringTracking, '손이 사라지면 이전 줄 결과를 유지하면 안 됩니다.');
assert(missing.continuous.recentHits.length === 0, '손이 사라지면 과거 탄현 기록도 초기화해야 합니다.');
const reacquired = gate.process(result({ frame: 6 }), 1_420);
assert(!reacquired.stringTracking, '손을 다시 잡은 첫 프레임에서 과거 줄 상태를 재사용하면 안 됩니다.');
console.log('continuous-tracking quality gate: 13 checks passed');
