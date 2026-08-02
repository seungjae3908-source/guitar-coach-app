"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeRightHandTechniqueWindow = analyzeRightHandTechniqueWindow;
const RIGHT_HAND_CATEGORIES = new Set([
    'arpeggio', 'fingerstyle', 'strumming', 'downPicking', 'alternatePicking', 'palmMute',
]);
const PICK_CATEGORIES = new Set([
    'strumming', 'downPicking', 'alternatePicking', 'palmMute',
]);
const FINGER_CATEGORIES = new Set(['arpeggio', 'fingerstyle']);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
function median(values) {
    if (!values.length)
        return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function standardDeviation(values) {
    if (values.length < 2)
        return 0;
    const average = mean(values);
    return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}
function range(values) {
    return values.length ? Math.max(...values) - Math.min(...values) : 0;
}
function coefficientOfVariation(values) {
    const average = mean(values);
    return average > 0.000001 ? standardDeviation(values) / average : 0;
}
function distance(left, right) {
    return Math.hypot(left.x - right.x, left.y - right.y);
}
function deltas(values) {
    return values.slice(1).map((value, index) => value - values[index]);
}
function correlation(left, right) {
    if (left.length !== right.length || left.length < 6)
        return 0;
    const leftMean = mean(left);
    const rightMean = mean(right);
    let numerator = 0;
    let leftPower = 0;
    let rightPower = 0;
    for (let index = 0; index < left.length; index += 1) {
        const leftDifference = left[index] - leftMean;
        const rightDifference = right[index] - rightMean;
        numerator += leftDifference * rightDifference;
        leftPower += leftDifference ** 2;
        rightPower += rightDifference ** 2;
    }
    const denominator = Math.sqrt(leftPower * rightPower);
    return denominator > 0.000001 ? numerator / denominator : 0;
}
function recentWindow(samples) {
    const latest = samples.at(-1);
    if (!latest || !RIGHT_HAND_CATEGORIES.has(latest.category))
        return [];
    return samples
        .filter((sample) => sample.category === latest.category && latest.capturedAt - sample.capturedAt <= 2_800)
        .slice(-72);
}
function confidencePercent(samples) {
    return Math.round(clamp(mean(samples.map((sample) => Math.min(sample.handConfidence, sample.wristConfidence ?? sample.handConfidence))), 0, 1) * 100);
}
function pointForMotion(sample) {
    return sample.pick.detected && sample.pick.confidence >= 0.42 ? sample.pick.center : sample.wrist;
}
function motionSteps(samples) {
    const steps = [];
    for (let index = 1; index < samples.length; index += 1) {
        const previous = samples[index - 1];
        const current = samples[index];
        const elapsedMs = current.capturedAt - previous.capturedAt;
        if (elapsedMs < 8 || elapsedMs > 650)
            continue;
        const stringAngle = current.stringAngle ?? previous.stringAngle;
        if (stringAngle == null)
            continue;
        const previousPoint = pointForMotion(previous);
        const currentPoint = pointForMotion(current);
        const dx = currentPoint.x - previousPoint.x;
        const dy = currentPoint.y - previousPoint.y;
        const palm = Math.max(0.001, (previous.palmSize + current.palmSize) / 2);
        const radians = stringAngle * Math.PI / 180;
        const tangentX = Math.cos(radians);
        const tangentY = Math.sin(radians);
        const normalX = -tangentY;
        const normalY = tangentX;
        const normal = dx * normalX + dy * normalY;
        const tangent = dx * tangentX + dy * tangentY;
        const total = Math.abs(normal) + Math.abs(tangent);
        const normalizedDistance = Math.hypot(dx, dy) / palm;
        steps.push({
            speed: normalizedDistance / (elapsedMs / 1_000),
            offAxisRatio: total > 0.00001 ? Math.abs(tangent) / total : 0,
            signedNormal: normal / palm,
        });
    }
    return steps;
}
function usableHits(samples) {
    return samples.flatMap((sample) => sample.hits)
        .filter((hit) => hit.confidence >= 0.50)
        .sort((left, right) => left.capturedAt - right.capturedAt);
}
function groupStrokes(hits) {
    const groups = [];
    hits.forEach((hit) => {
        if (hit.direction !== 'down' && hit.direction !== 'up')
            return;
        const string = hit.stringNumber > 0 ? hit.stringNumber : hit.visualIndex;
        if (string < 1 || string > 6)
            return;
        const previous = groups.at(-1);
        if (previous && previous.direction === hit.direction && hit.capturedAt - previous.capturedAt <= 145) {
            if (!previous.strings.includes(string))
                previous.strings.push(string);
            previous.capturedAt = hit.capturedAt;
            previous.confidence = Math.max(previous.confidence, hit.confidence);
            return;
        }
        groups.push({ direction: hit.direction, capturedAt: hit.capturedAt, strings: [string], confidence: hit.confidence });
    });
    return groups;
}
function parseExpectedPattern(pattern) {
    const tokens = pattern?.match(/[Ppima]/g) ?? [];
    return tokens.map((token) => {
        const normalized = token.toLowerCase();
        if (normalized === 'p')
            return 'thumb';
        if (normalized === 'i')
            return 'index';
        if (normalized === 'm')
            return 'middle';
        return 'ring';
    });
}
function sequenceMismatchRatio(actual, expected) {
    if (!expected.length || actual.length < expected.length)
        return null;
    let best = 1;
    for (let offset = 0; offset < expected.length; offset += 1) {
        let mismatches = 0;
        actual.forEach((finger, index) => {
            if (finger !== expected[(index + offset) % expected.length])
                mismatches += 1;
        });
        best = Math.min(best, mismatches / actual.length);
    }
    return best;
}
function returnDelays(samples, finger, hits) {
    const delays = [];
    hits.filter((hit) => hit.contactId === finger).forEach((hit) => {
        const hitIndex = samples.findIndex((sample) => sample.capturedAt >= hit.capturedAt);
        if (hitIndex < 2)
            return;
        const baselineSamples = samples.slice(Math.max(0, hitIndex - 3), hitIndex);
        const baseline = {
            x: median(baselineSamples.map((sample) => sample.fingers[finger].tip.x)),
            y: median(baselineSamples.map((sample) => sample.fingers[finger].tip.y)),
        };
        const palm = Math.max(0.001, samples[hitIndex].palmSize);
        const returned = samples.slice(hitIndex + 1).find((sample) => (sample.capturedAt - hit.capturedAt <= 520
            && distance(sample.fingers[finger].tip, baseline) / palm <= 0.22));
        delays.push(returned ? returned.capturedAt - hit.capturedAt : 520);
    });
    return delays;
}
function success(id, title, evidence, nextGoal, confidence, measurements) {
    return {
        id,
        status: 'success',
        title,
        instruction: '현재 움직임을 그대로 유지하세요.',
        evidence,
        nextGoal,
        confidencePercent: confidence,
        priority: 3,
        measurements,
    };
}
function analyzePickReadiness(samples, feedback) {
    const latest = samples.at(-1);
    const confidence = confidencePercent(samples);
    const pickSamples = samples.filter((sample) => sample.pick.detected && sample.pick.confidence >= 0.45);
    if (pickSamples.length < Math.max(5, Math.floor(samples.length * 0.55))) {
        feedback.push({
            id: 'right-pick-tracking-unreliable',
            status: 'cannot-judge',
            title: '피크 끝을 연속으로 확인하지 못했습니다',
            instruction: '피크와 손가락이 겹치지 않도록 카메라를 브리지 옆 30~45° 방향에 두고 피크 끝이 보이게 하세요.',
            evidence: `최근 ${samples.length}개 프레임 중 신뢰 가능한 피크가 ${pickSamples.length}개입니다.`,
            nextGoal: '피크 표시가 1초 이상 끊기지 않는 구도를 먼저 맞추세요.',
            confidencePercent: Math.round(mean(samples.map((sample) => sample.pick.confidence)) * 100),
            priority: 13,
            measurements: [{ label: '피크 유지', value: `${pickSamples.length}/${samples.length}` }],
        });
    }
    if (latest.stringConfidence < 0.45 || latest.stringStability < 0.43 || latest.visibleStringCount < 5) {
        feedback.push({
            id: 'right-string-plane-unreliable',
            status: 'cannot-judge',
            title: '기타줄 기준면이 안정적이지 않습니다',
            instruction: '브리지 근처 1~6번 줄이 화면을 가로지르게 하고 줄과 같은 방향의 반사광을 피하세요.',
            evidence: `줄 검출 ${Math.round(latest.stringConfidence * 100)}%, 안정 ${Math.round(latest.stringStability * 100)}%, ${latest.visibleStringCount}/6개입니다.`,
            nextGoal: '줄 5개 이상이 1초 동안 유지된 뒤 연주하세요.',
            confidencePercent: confidence,
            priority: 12,
            measurements: [
                { label: '줄 검출', value: `${Math.round(latest.stringConfidence * 100)}%` },
                { label: '줄 안정', value: `${Math.round(latest.stringStability * 100)}%` },
            ],
        });
    }
}
function analyzeStrumming(samples, feedback) {
    const confidence = confidencePercent(samples);
    const steps = motionSteps(samples).filter((step) => step.speed >= 0.08);
    const strokes = groupStrokes(usableHits(samples));
    if (steps.length < 8) {
        feedback.push({
            id: 'strum-motion-insufficient',
            status: 'cannot-judge',
            title: '스트럼 궤적 표본이 부족합니다',
            instruction: '브리지·피크·손목이 함께 보이게 하고 D-U를 8회 이상 끊지 말고 연주하세요.',
            evidence: `유효 이동 표본이 ${steps.length}개입니다.`,
            nextGoal: '같은 속도로 2초 이상 연속 스트럼하세요.',
            confidencePercent: confidence,
            priority: 11,
            measurements: [{ label: '이동 표본', value: `${steps.length}` }],
        });
        return;
    }
    const alignment = 1 - mean(steps.map((step) => step.offAxisRatio));
    const speedVariation = coefficientOfVariation(steps.map((step) => step.speed));
    const palmAngleRange = range(samples.map((sample) => sample.palmAngle));
    const palm = Math.max(0.001, mean(samples.map((sample) => sample.palmSize)));
    const wristTravel = Math.hypot(range(samples.map((sample) => sample.wrist.x)), range(samples.map((sample) => sample.wrist.y))) / palm;
    const speedChanges = steps.slice(1).map((step, index) => Math.abs(step.speed - steps[index].speed));
    const jerkRatio = mean(speedChanges) / Math.max(0.01, mean(steps.map((step) => step.speed)));
    if (alignment < 0.64) {
        feedback.push({
            id: 'strum-path-diagonal',
            status: 'correction',
            title: '스트럼 경로가 줄을 비스듬히 긁고 있습니다',
            instruction: '다운은 6번 줄 쪽에서 1번 줄 쪽으로, 업은 같은 축을 되짚어 줄에 거의 수직으로 통과시키세요.',
            evidence: `줄 수직축 일치도가 ${Math.round(alignment * 100)}%입니다.`,
            nextGoal: '좁은 레일을 따라간다고 생각하고 D-U를 같은 선으로 6회 반복하세요.',
            confidencePercent: confidence,
            priority: 12,
            measurements: [{ label: '궤도 일치', value: `${Math.round(alignment * 100)}%` }],
        });
    }
    else {
        feedback.push(success('strum-path-good', '스트럼 방향이 줄 수직축을 안정적으로 통과합니다', `궤도 일치도가 ${Math.round(alignment * 100)}%입니다.`, '같은 축을 유지하며 속도만 조금씩 올리세요.', confidence, [{ label: '궤도 일치', value: `${Math.round(alignment * 100)}%` }]));
    }
    if (wristTravel > 0.78 && palmAngleRange < 9 && (speedVariation > 0.48 || jerkRatio > 0.42)) {
        feedback.push({
            id: 'strum-wrist-rigidity-pattern',
            status: 'correction',
            title: '손목이 굳어 손 전체로 미는 패턴이 나타납니다',
            instruction: '엄지·검지 압력을 조금 줄이고, 손목을 고정한 채 팔로 밀지 말고 전완 회전과 작은 부채꼴 움직임으로 줄을 스치세요.',
            evidence: `손 전체 이동 ${wristTravel.toFixed(2)}배, 손바닥 각도 변화 ${Math.round(palmAngleRange)}°, 속도 흔들림 ${Math.round(speedVariation * 100)}%입니다.`,
            nextGoal: '60 BPM에서 피크를 놓치지 않을 정도로만 잡고 D-U 8회를 부드럽게 연결하세요.',
            confidencePercent: confidence,
            priority: 13,
            measurements: [
                { label: '손 전체 이동', value: `${wristTravel.toFixed(2)}배` },
                { label: '손목 회전', value: `${Math.round(palmAngleRange)}°` },
                { label: '속도 흔들림', value: `${Math.round(speedVariation * 100)}%` },
            ],
        });
    }
    else if (palmAngleRange >= 9 && palmAngleRange <= 38 && speedVariation <= 0.48) {
        feedback.push(success('strum-relaxation-good', '손목 회전과 스트럼 속도가 자연스럽게 이어집니다', `손바닥 각도 변화 ${Math.round(palmAngleRange)}°, 속도 흔들림 ${Math.round(speedVariation * 100)}%입니다.`, '힘을 더 주지 말고 같은 느낌으로 8회 유지하세요.', confidence, [
            { label: '손목 회전', value: `${Math.round(palmAngleRange)}°` },
            { label: '속도 흔들림', value: `${Math.round(speedVariation * 100)}%` },
        ]));
    }
    const downStrokes = strokes.filter((stroke) => stroke.direction === 'down');
    const upStrokes = strokes.filter((stroke) => stroke.direction === 'up');
    const downWidth = median(downStrokes.map((stroke) => stroke.strings.length));
    const upWidth = median(upStrokes.map((stroke) => stroke.strings.length));
    if (downStrokes.length >= 2 && downWidth < 4) {
        feedback.push({
            id: 'strum-down-too-narrow',
            status: 'correction',
            title: '다운스트로크가 필요한 저음줄까지 충분히 통과하지 않습니다',
            instruction: '다운은 6번 또는 5번 줄에서 시작해 목표 코드의 고음줄까지 한 번에 통과시키세요.',
            evidence: `다운 한 번당 중앙값이 ${downWidth.toFixed(0)}개 줄입니다.`,
            nextGoal: '다운만 4회 연습해 매번 4개 이상 줄을 통과하세요.',
            confidencePercent: confidence,
            priority: 10,
            measurements: [{ label: '다운 폭', value: `${downWidth.toFixed(0)}줄` }],
        });
    }
    if (upStrokes.length >= 2 && upWidth > 4) {
        feedback.push({
            id: 'strum-up-too-deep',
            status: 'correction',
            title: '업스트로크가 저음줄까지 너무 깊게 들어갑니다',
            instruction: '업은 1~3번 고음줄을 가볍게 스치고 손을 다음 다운 위치로 바로 복귀시키세요.',
            evidence: `업 한 번당 중앙값이 ${upWidth.toFixed(0)}개 줄입니다.`,
            nextGoal: '업만 4회 연습해 2~3개 고음줄만 스치세요.',
            confidencePercent: confidence,
            priority: 10,
            measurements: [{ label: '업 폭', value: `${upWidth.toFixed(0)}줄` }],
        });
    }
    const pickSamples = samples.filter((sample) => sample.pick.detected && sample.pick.confidence >= 0.45);
    const exposure = median(pickSamples.map((sample) => sample.pick.exposure));
    if (pickSamples.length >= 5 && exposure > 0.88 && jerkRatio > 0.36) {
        feedback.push({
            id: 'strum-pick-catching-risk',
            status: 'correction',
            title: '피크 노출과 급격한 감속이 커서 줄에 걸릴 가능성이 높습니다',
            instruction: '피크 끝을 엄지 안쪽으로 조금 넣고, 줄을 밀어내지 말고 사선으로 살짝 기울여 통과시키세요.',
            evidence: `피크 노출 ${exposure.toFixed(2)}, 움직임 급변 ${Math.round(jerkRatio * 100)}%입니다.`,
            nextGoal: '피크 끝을 일정하게 유지하며 60 BPM D-U 8회를 연주하세요.',
            confidencePercent: confidence,
            priority: 12,
            measurements: [
                { label: '피크 노출', value: exposure.toFixed(2) },
                { label: '급변', value: `${Math.round(jerkRatio * 100)}%` },
            ],
        });
    }
}
function analyzePicking(samples, feedback) {
    const confidence = confidencePercent(samples);
    const hits = usableHits(samples).filter((hit) => hit.contactId === 'pick');
    const directions = hits.map((hit) => hit.direction).filter((direction) => direction === 'down' || direction === 'up');
    const steps = motionSteps(samples).filter((step) => step.speed >= 0.08);
    const alignment = steps.length ? 1 - mean(steps.map((step) => step.offAxisRatio)) : 0;
    if (samples.at(-1)?.category === 'alternatePicking' && directions.length >= 6) {
        let repeats = 0;
        for (let index = 1; index < directions.length; index += 1) {
            if (directions[index] === directions[index - 1])
                repeats += 1;
        }
        const repeatRatio = repeats / Math.max(1, directions.length - 1);
        if (repeatRatio > 0.22) {
            feedback.push({
                id: 'alternate-direction-break-precise',
                status: 'correction',
                title: '얼터네이트 피킹의 다운·업 교대가 끊깁니다',
                instruction: '피크 이동 폭을 줄이고 줄을 통과한 직후 반대 방향으로 바로 복귀시키세요.',
                evidence: `같은 방향 반복이 ${Math.round(repeatRatio * 100)}%입니다.`,
                nextGoal: '한 줄에서 D-U를 8회 정확히 교대하세요.',
                confidencePercent: confidence,
                priority: 12,
                measurements: [{ label: '방향 반복', value: `${Math.round(repeatRatio * 100)}%` }],
            });
        }
        else {
            feedback.push(success('alternate-direction-good', '다운·업 교대가 안정적으로 유지됩니다', `같은 방향 반복이 ${Math.round(repeatRatio * 100)}%입니다.`, '현재 이동 폭을 유지한 채 BPM을 조금씩 올리세요.', confidence, [{ label: '방향 반복', value: `${Math.round(repeatRatio * 100)}%` }]));
        }
    }
    if (steps.length >= 8 && alignment < 0.67) {
        feedback.push({
            id: 'picking-side-scrape',
            status: 'correction',
            title: '피킹 경로가 줄 옆으로 새고 있습니다',
            instruction: '손목 중심을 유지하고 피크 끝이 현재 줄의 위·아래를 짧게 왕복하도록 이동 폭을 줄이세요.',
            evidence: `줄 수직축 일치도가 ${Math.round(alignment * 100)}%입니다.`,
            nextGoal: '한 줄에서 짧은 D-U를 8회 반복하세요.',
            confidencePercent: confidence,
            priority: 10,
            measurements: [{ label: '궤도 일치', value: `${Math.round(alignment * 100)}%` }],
        });
    }
    const pickSamples = samples.filter((sample) => sample.pick.detected && sample.pick.confidence >= 0.45);
    const exposure = median(pickSamples.map((sample) => sample.pick.exposure));
    const exposureVariation = standardDeviation(pickSamples.map((sample) => sample.pick.exposure));
    if (pickSamples.length >= 5 && exposure > 0.88) {
        feedback.push({
            id: 'picking-pick-too-deep',
            status: 'correction',
            title: '피크가 줄 사이로 너무 깊게 들어갑니다',
            instruction: '피크 끝을 조금 넣어 줄 표면만 통과시키고, 줄을 지난 뒤 멀리 보내지 마세요.',
            evidence: `피크 노출 중앙값이 ${exposure.toFixed(2)}입니다.`,
            nextGoal: '같은 줄에서 얕은 D-U 8회를 유지하세요.',
            confidencePercent: confidence,
            priority: 11,
            measurements: [{ label: '피크 노출', value: exposure.toFixed(2) }],
        });
    }
    if (pickSamples.length >= 5 && exposureVariation > 0.18) {
        feedback.push({
            id: 'picking-grip-depth-changing',
            status: 'correction',
            title: '연주 중 피크를 잡는 깊이가 계속 달라집니다',
            instruction: '엄지와 검지가 피크의 같은 지점을 잡도록 하고 압력을 일정하게 유지하세요.',
            evidence: `피크 노출 표준편차가 ${exposureVariation.toFixed(2)}입니다.`,
            nextGoal: '피크 노출 표시를 같은 크기로 유지하며 8회 피킹하세요.',
            confidencePercent: confidence,
            priority: 9,
            measurements: [{ label: '노출 흔들림', value: exposureVariation.toFixed(2) }],
        });
    }
}
function analyzeArpeggio(samples, feedback) {
    const confidence = confidencePercent(samples);
    const hits = usableHits(samples).filter((hit) => ['thumb', 'index', 'middle', 'ring'].includes(hit.contactId));
    const actual = hits.map((hit) => hit.contactId);
    const expected = parseExpectedPattern(samples.at(-1)?.pattern);
    const mismatch = sequenceMismatchRatio(actual, expected);
    if (expected.length && mismatch != null && mismatch > 0.28) {
        feedback.push({
            id: 'arpeggio-pattern-order',
            status: 'correction',
            title: 'P·i·m·a 연주 순서가 목표 패턴과 다릅니다',
            instruction: '한 박마다 사용할 손가락을 먼저 말한 뒤 P·i·m·a를 한 손가락씩 분리해 연주하세요.',
            evidence: `목표 패턴 대비 순서 불일치가 ${Math.round(mismatch * 100)}%입니다.`,
            nextGoal: '목표 순서를 2회 연속 정확히 연주하세요.',
            confidencePercent: confidence,
            priority: 13,
            measurements: [{ label: '순서 불일치', value: `${Math.round(mismatch * 100)}%` }],
        });
    }
    else if (expected.length && mismatch != null) {
        feedback.push(success('arpeggio-pattern-good', '아르페지오 손가락 순서가 목표 패턴과 맞습니다', `순서 불일치가 ${Math.round(mismatch * 100)}%입니다.`, '순서를 유지하며 음 사이 간격을 일정하게 만드세요.', confidence, [{ label: '순서 불일치', value: `${Math.round(mismatch * 100)}%` }]));
    }
    ['thumb', 'index', 'middle', 'ring'].forEach((finger) => {
        const delays = returnDelays(samples, finger, hits);
        const delay = median(delays);
        if (delays.length >= 2 && delay > 300) {
            const label = finger === 'thumb' ? '엄지 P' : finger === 'index' ? '검지 i' : finger === 'middle' ? '중지 m' : '약지 a';
            feedback.push({
                id: `arpeggio-${finger}-late-return`,
                status: 'correction',
                title: `${label}가 탄현 뒤 준비 위치로 늦게 돌아옵니다`,
                instruction: '줄을 튕긴 뒤 손가락을 앞으로 남겨두지 말고 손바닥 쪽 중립 위치로 짧게 복귀시키세요.',
                evidence: `복귀시간 중앙값이 ${Math.round(delay)}ms입니다.`,
                nextGoal: `${label}만 4회 연주하며 260ms 안에 복귀하세요.`,
                confidencePercent: confidence,
                priority: finger === 'index' ? 12 : 10,
                measurements: [{ label: '복귀시간', value: `${Math.round(delay)}ms` }],
            });
        }
    });
    const indexAngles = samples.map((sample) => sample.fingers.index.jointAngle);
    const indexAngle = median(indexAngles);
    const indexDelays = returnDelays(samples, 'index', hits);
    if (indexAngle > 163 && (median(indexDelays) > 250 || range(indexAngles) < 14)) {
        feedback.push({
            id: 'arpeggio-index-too-straight',
            status: 'correction',
            title: '검지가 너무 펴진 채로 연주합니다',
            instruction: '검지 첫마디를 살짝 굽혀 손끝이 줄을 지나 손바닥 쪽으로 돌아오게 하세요.',
            evidence: `검지 관절각 중앙값이 ${Math.round(indexAngle)}°입니다.`,
            nextGoal: 'i만 천천히 4회 연주하며 둥근 모양을 유지하세요.',
            confidencePercent: confidence,
            priority: 12,
            measurements: [{ label: '검지 관절각', value: `${Math.round(indexAngle)}°` }],
        });
    }
    const thumbReach = median(samples.map((sample) => sample.fingers.thumb.reach));
    const thumbContacts = samples.flatMap((sample) => sample.contacts).filter((contact) => contact.id === 'thumb');
    const thumbDistance = median(thumbContacts.map((contact) => contact.distanceRatio));
    const thumbHits = hits.filter((hit) => hit.contactId === 'thumb').length;
    if (thumbReach < 0.62 && (thumbDistance > 0.78 || thumbHits < 2)) {
        feedback.push({
            id: 'arpeggio-thumb-hidden',
            status: 'correction',
            title: '엄지 P가 안쪽으로 말려 베이스줄 접근이 늦습니다',
            instruction: '엄지 끝을 검지 바깥쪽으로 조금 더 내밀고 6·5·4번 줄 위에 미리 준비하세요.',
            evidence: `엄지 도달비 ${thumbReach.toFixed(2)}, 줄 거리 ${thumbDistance.toFixed(2)}입니다.`,
            nextGoal: 'P만 6·5·4번 줄에서 한 번씩 미리 준비한 뒤 탄현하세요.',
            confidencePercent: confidence,
            priority: 12,
            measurements: [
                { label: '엄지 도달', value: thumbReach.toFixed(2) },
                { label: '줄 거리', value: thumbDistance.toFixed(2) },
            ],
        });
    }
    const indexReach = samples.map((sample) => sample.fingers.index.reach);
    const middleReach = samples.map((sample) => sample.fingers.middle.reach);
    const ringReach = samples.map((sample) => sample.fingers.ring.reach);
    const indexMiddle = correlation(deltas(indexReach), deltas(middleReach));
    const ringMiddle = correlation(deltas(ringReach), deltas(middleReach));
    if (indexMiddle > 0.80 && range(indexReach) > 0.10 && range(middleReach) > 0.10) {
        feedback.push({
            id: 'arpeggio-index-middle-follow-precise',
            status: 'correction',
            title: '검지 i와 중지 m이 함께 움직입니다',
            instruction: 'i가 탄현할 때 m은 2번 줄 위 준비 위치에 남기고, i만 손바닥 쪽으로 복귀시키세요.',
            evidence: `i-m 동반 움직임 상관값이 ${indexMiddle.toFixed(2)}입니다.`,
            nextGoal: 'i만 4회, m만 4회 분리한 뒤 P-i-m을 연결하세요.',
            confidencePercent: confidence,
            priority: 11,
            measurements: [{ label: 'i-m 동반', value: indexMiddle.toFixed(2) }],
        });
    }
    if (ringMiddle > 0.80 && range(ringReach) > 0.10 && range(middleReach) > 0.10) {
        feedback.push({
            id: 'arpeggio-ring-middle-follow-precise',
            status: 'correction',
            title: '약지 a를 움직일 때 중지 m이 같이 들립니다',
            instruction: 'a만 1번 줄을 탄현하고 m은 2번 줄 위에 낮게 남겨두세요.',
            evidence: `a-m 동반 움직임 상관값이 ${ringMiddle.toFixed(2)}입니다.`,
            nextGoal: 'a 단독 4회 뒤 m-a를 교대로 4회 연주하세요.',
            confidencePercent: confidence,
            priority: 11,
            measurements: [{ label: 'a-m 동반', value: ringMiddle.toFixed(2) }],
        });
    }
}
function analyzeRightHandTechniqueWindow(samples) {
    const recent = recentWindow(samples);
    const latest = recent.at(-1);
    if (!latest)
        return [];
    const confidence = confidencePercent(recent);
    const latestWristConfidence = latest.wristConfidence ?? latest.handConfidence;
    if (latest.handConfidence >= 0.45 && latest.palmSize > 0 && latestWristConfidence < 0.42) {
        return [{
                id: 'right-wrist-unreliable',
                status: 'cannot-judge',
                title: '손목 관절점 판정 불가',
                instruction: '손가락만 넣지 말고 손목 주름부터 손가락 끝까지 화면 안쪽에 넣으세요. 빨간 손목 표시가 연속으로 보여야 분석을 시작합니다.',
                evidence: `손목 추적 신뢰도가 ${Math.round(latestWristConfidence * 100)}%입니다.`,
                nextGoal: '손목 표시 70% 이상을 1초간 유지하세요.',
                confidencePercent: Math.round(latestWristConfidence * 100),
                priority: 15,
                measurements: [{ label: '손목 추적', value: `${Math.round(latestWristConfidence * 100)}%` }],
            }];
    }
    if (latest.handConfidence < 0.45 || latest.palmSize <= 0) {
        return [{
                id: 'right-hand-unreliable',
                status: 'cannot-judge',
                title: '오른손 정밀 판정 불가',
                instruction: '손목과 다섯 손가락 끝, 브리지 근처 줄이 모두 보이도록 자동 프레이밍이 끝날 때까지 잠시 기다리세요.',
                evidence: `손 검출 신뢰도가 ${Math.round(latest.handConfidence * 100)}%입니다.`,
                nextGoal: '구도 고정 표시 후 같은 동작을 다시 연주하세요.',
                confidencePercent: Math.round(latest.handConfidence * 100),
                priority: 14,
                measurements: [{ label: '손 검출', value: `${Math.round(latest.handConfidence * 100)}%` }],
            }];
    }
    if (latest.palmSize < 0.15 || latest.palmSize > 0.60) {
        return [{
                id: latest.palmSize < 0.15 ? 'right-hand-too-small' : 'right-hand-too-large',
                status: 'cannot-judge',
                title: latest.palmSize < 0.15 ? '자동 줌 조정 후에도 손이 너무 작습니다' : '손가락 끝이 잘릴 정도로 너무 가깝습니다',
                instruction: latest.palmSize < 0.15
                    ? '앱이 최대 줌까지 조정했습니다. 휴대폰을 조금만 가까이 두고 브리지와 손목을 함께 넣으세요.'
                    : '휴대폰을 조금 멀리 두어 손목과 손가락 끝을 모두 화면 안에 넣으세요.',
                evidence: `화면 대비 손바닥 크기가 ${latest.palmSize.toFixed(2)}입니다.`,
                nextGoal: '손바닥 크기 0.18~0.45 범위에서 다시 연주하세요.',
                confidencePercent: confidence,
                priority: 14,
                measurements: [{ label: '손 크기', value: latest.palmSize.toFixed(2) }],
            }];
    }
    if (recent.length < 10)
        return [];
    const feedback = [];
    if (PICK_CATEGORIES.has(latest.category))
        analyzePickReadiness(recent, feedback);
    if (latest.category === 'strumming')
        analyzeStrumming(recent, feedback);
    else if (PICK_CATEGORIES.has(latest.category))
        analyzePicking(recent, feedback);
    if (FINGER_CATEGORIES.has(latest.category))
        analyzeArpeggio(recent, feedback);
    return feedback
        .sort((left, right) => {
        const statusRank = (status) => status === 'warning' ? 4 : status === 'correction' ? 3 : status === 'cannot-judge' ? 2 : 1;
        return statusRank(right.status) - statusRank(left.status)
            || right.priority - left.priority
            || right.confidencePercent - left.confidencePercent;
    })
        .slice(0, 6);
}
