"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzePostureWindow = analyzePostureWindow;
const midpoint = (left, right) => ({
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2,
});
const distance = (left, right) => (Math.hypot(left.x - right.x, left.y - right.y));
function pointMap(result) {
    return new Map(result.landmarks.map((point) => [point.name, point]));
}
function percent(value) {
    return Math.round(Math.max(0, Math.min(1, value)) * 100);
}
function analyzePostureWindow(samples) {
    const latestSample = samples.at(-1);
    if (!latestSample)
        return [];
    const latest = latestSample.result;
    const points = pointMap(latest);
    const requiredNames = [
        'nose', 'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow',
        'leftWrist', 'rightWrist', 'leftHip', 'rightHip',
    ];
    const required = requiredNames.map((name) => points.get(name));
    const visible = required.filter((point) => point && point.confidence >= 0.35);
    const confidence = visible.length
        ? visible.reduce((sum, point) => sum + point.confidence, 0) / requiredNames.length
        : 0;
    if (!latest.hasPerson || visible.length < requiredNames.length) {
        return [{
                id: 'posture-unavailable',
                status: 'cannot-judge',
                title: '자세 정밀 판정 불가',
                instruction: '머리, 양쪽 어깨·팔꿈치·손목과 골반이 모두 화면 안에 들어오게 휴대폰 거리를 맞추세요.',
                evidence: `필수 자세 관절 ${visible.length}/${requiredNames.length}개가 신뢰 기준을 통과했습니다.`,
                nextGoal: '기타를 든 상태로 상체 전체가 보이게 한 뒤 같은 자세를 2초 유지하세요.',
                confidencePercent: percent(confidence),
                stableCount: 0,
                priority: 15,
                measurements: [{ label: '자세 관절', value: `${visible.length}/${requiredNames.length}` }],
            }];
    }
    const nose = points.get('nose');
    const leftShoulder = points.get('leftShoulder');
    const rightShoulder = points.get('rightShoulder');
    const leftHip = points.get('leftHip');
    const rightHip = points.get('rightHip');
    const rightElbow = points.get('rightElbow');
    const shoulderMid = midpoint(leftShoulder, rightShoulder);
    const hipMid = midpoint(leftHip, rightHip);
    const shoulderWidth = Math.max(0.08, distance(leftShoulder, rightShoulder));
    const shoulderTilt = Math.abs(leftShoulder.y - rightShoulder.y) / shoulderWidth;
    const headOffset = Math.abs(nose.x - shoulderMid.x) / shoulderWidth;
    const torsoLean = Math.abs(shoulderMid.x - hipMid.x) / shoulderWidth;
    const elbowLift = Math.max(0, (rightShoulder.y - rightElbow.y) / shoulderWidth);
    const recent = samples.filter((sample) => latestSample.capturedAt - sample.capturedAt <= 2_400);
    const centers = recent.flatMap((sample) => {
        const map = pointMap(sample.result);
        const left = map.get('leftShoulder');
        const right = map.get('rightShoulder');
        if (!sample.result.hasPerson || !left || !right || left.confidence < 0.35 || right.confidence < 0.35)
            return [];
        return [midpoint(left, right)];
    });
    const averageCenter = centers.length
        ? centers.reduce((sum, item) => ({ x: sum.x + item.x, y: sum.y + item.y }), { x: 0, y: 0 })
        : shoulderMid;
    if (centers.length) {
        averageCenter.x /= centers.length;
        averageCenter.y /= centers.length;
    }
    const bodyJitter = centers.length >= 4
        ? Math.sqrt(centers.reduce((sum, item) => sum + distance(item, averageCenter) ** 2, 0) / centers.length) / shoulderWidth
        : 0;
    const measurements = [
        { label: '어깨 기울기', value: `${Math.round(shoulderTilt * 100)}%` },
        { label: '머리 쏠림', value: `${Math.round(headOffset * 100)}%` },
        { label: '상체 기울기', value: `${Math.round(torsoLean * 100)}%` },
        { label: '몸 흔들림', value: `${Math.round(bodyJitter * 100)}%` },
    ];
    const feedback = [];
    if (shoulderTilt > 0.18)
        feedback.push({
            id: 'posture-shoulder-tilt',
            status: shoulderTilt > 0.30 ? 'warning' : 'correction',
            title: '양쪽 어깨 높이가 크게 다릅니다',
            instruction: '기타를 끌어올리려고 한쪽 어깨를 들지 말고, 스트랩이나 기타 위치를 조정해 어깨를 아래로 내려놓으세요.',
            evidence: `어깨 높이 차이가 어깨 폭의 ${Math.round(shoulderTilt * 100)}%입니다.`,
            nextGoal: '숨을 내쉬고 양쪽 어깨 높이 차이를 15% 아래로 3회 유지하세요.',
            confidencePercent: percent(confidence),
            stableCount: 0,
            priority: 14,
            measurements,
        });
    if (torsoLean > 0.24)
        feedback.push({
            id: 'posture-torso-lean',
            status: torsoLean > 0.38 ? 'warning' : 'correction',
            title: '상체가 한쪽으로 쏠리고 있습니다',
            instruction: '기타를 보기 위해 허리를 옆으로 꺾지 말고 골반 위에 가슴 중앙을 다시 올리세요.',
            evidence: `어깨 중심과 골반 중심 차이가 어깨 폭의 ${Math.round(torsoLean * 100)}%입니다.`,
            nextGoal: '가슴 중앙을 골반 중앙 위에 두고 같은 구절을 다시 연주하세요.',
            confidencePercent: percent(confidence),
            stableCount: 0,
            priority: 13,
            measurements,
        });
    if (headOffset > 0.30)
        feedback.push({
            id: 'posture-head-offset',
            status: 'correction',
            title: '고개가 지판 쪽으로 과하게 빠졌습니다',
            instruction: '눈만 지판으로 내리고 턱과 머리는 어깨 중앙 위에 남겨 목 긴장을 줄이세요.',
            evidence: `머리 중심이 어깨 중앙에서 ${Math.round(headOffset * 100)}% 벗어났습니다.`,
            nextGoal: '턱을 살짝 당긴 상태로 다음 코드 전환까지 유지하세요.',
            confidencePercent: percent(confidence),
            stableCount: 0,
            priority: 12,
            measurements,
        });
    if (bodyJitter > 0.075)
        feedback.push({
            id: 'posture-body-jitter',
            status: bodyJitter > 0.12 ? 'warning' : 'correction',
            title: '연주할 때 상체가 박자마다 흔들립니다',
            instruction: '리듬은 손목과 팔에서 만들고 몸통은 의자나 양발 위에 안정시켜 두세요.',
            evidence: `최근 자세 중심 흔들림이 어깨 폭의 ${Math.round(bodyJitter * 100)}%입니다.`,
            nextGoal: '다음 2마디 동안 가슴 중심 이동을 6% 아래로 줄이세요.',
            confidencePercent: percent(confidence),
            stableCount: 0,
            priority: 11,
            measurements,
        });
    if (elbowLift > 0.18)
        feedback.push({
            id: 'posture-right-elbow-lift',
            status: 'correction',
            title: '오른쪽 팔꿈치가 어깨 쪽으로 올라갑니다',
            instruction: '오른쪽 어깨 힘을 빼고 팔꿈치를 기타 옆면을 따라 자연스럽게 아래로 내리세요.',
            evidence: `오른쪽 팔꿈치가 어깨선보다 ${Math.round(elbowLift * 100)}% 위에 있습니다.`,
            nextGoal: '팔꿈치를 내린 뒤 손목만으로 같은 스트로크를 3회 반복하세요.',
            confidencePercent: percent(confidence),
            stableCount: 0,
            priority: 10,
            measurements,
        });
    if (!feedback.length && recent.length >= 6) {
        feedback.push({
            id: 'posture-balanced-success',
            status: 'success',
            title: '상체 중심과 어깨가 안정적입니다',
            instruction: '현재 어깨 높이와 가슴 중심을 유지한 채 손목·손가락 동작만 이어가세요.',
            evidence: `어깨 ${Math.round(shoulderTilt * 100)}% · 상체 ${Math.round(torsoLean * 100)}% · 흔들림 ${Math.round(bodyJitter * 100)}%로 안정 범위입니다.`,
            nextGoal: '같은 자세를 다음 구간까지 유지하세요.',
            confidencePercent: percent(confidence),
            stableCount: 3,
            priority: 8,
            measurements,
        });
    }
    return feedback.slice(0, 5);
}
