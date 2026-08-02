"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeRightHandStringRoles = analyzeRightHandStringRoles;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
function median(values) {
    if (!values.length)
        return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function confidencePercent(samples) {
    return Math.round(clamp(mean(samples.map((sample) => sample.handConfidence)), 0, 1) * 100);
}
function recentWindow(samples) {
    const latest = samples.at(-1);
    if (!latest)
        return [];
    return samples
        .filter((sample) => sample.category === latest.category && latest.capturedAt - sample.capturedAt <= 3_000)
        .slice(-80);
}
function resolvedHits(samples) {
    const deduped = new Map();
    samples.flatMap((sample) => sample.hits).forEach((hit) => {
        if (hit.confidence < 0.55 || hit.stringNumber < 1 || hit.stringNumber > 6)
            return;
        const key = `${hit.capturedAt}-${hit.contactId}-${hit.stringNumber}-${hit.direction}`;
        const previous = deduped.get(key);
        if (!previous || hit.confidence > previous.confidence)
            deduped.set(key, hit);
    });
    return [...deduped.values()].sort((left, right) => left.capturedAt - right.capturedAt);
}
function targetLabel(finger) {
    if (finger === 'thumb')
        return '6·5·4번 베이스줄';
    if (finger === 'index')
        return '3번 줄';
    if (finger === 'middle')
        return '2번 줄';
    if (finger === 'ring')
        return '1번 줄';
    return '지정 줄';
}
function correctString(finger, stringNumber) {
    if (finger === 'thumb')
        return stringNumber >= 4 && stringNumber <= 6;
    if (finger === 'index')
        return stringNumber === 3;
    if (finger === 'middle')
        return stringNumber === 2;
    if (finger === 'ring')
        return stringNumber === 1;
    return true;
}
function fingerLabel(finger) {
    if (finger === 'thumb')
        return '엄지 P';
    if (finger === 'index')
        return '검지 i';
    if (finger === 'middle')
        return '중지 m';
    if (finger === 'ring')
        return '약지 a';
    return '새끼손가락';
}
function parseExpectedFingers(pattern) {
    const ids = [];
    (pattern?.match(/[Ppima]/g) ?? []).forEach((token) => {
        const normalized = token.toLowerCase();
        const finger = normalized === 'p'
            ? 'thumb'
            : normalized === 'i'
                ? 'index'
                : normalized === 'm'
                    ? 'middle'
                    : 'ring';
        if (!ids.includes(finger))
            ids.push(finger);
    });
    return ids.length ? ids : ['thumb', 'index', 'middle', 'ring'];
}
function analyzeArpeggioStrings(samples, hits, feedback) {
    const confidence = confidencePercent(samples);
    const expectedFingers = parseExpectedFingers(samples.at(-1)?.pattern);
    const fingerHits = hits.filter((hit) => expectedFingers.includes(hit.contactId));
    if (fingerHits.length < 6)
        return;
    let totalWrong = 0;
    let totalResolved = 0;
    expectedFingers.forEach((finger) => {
        const relevant = fingerHits.filter((hit) => hit.contactId === finger);
        if (!relevant.length) {
            feedback.push({
                id: `arpeggio-${finger}-not-heard`,
                status: 'correction',
                title: `${fingerLabel(finger)} 탄현이 목표 패턴에서 빠집니다`,
                instruction: `${targetLabel(finger)} 위에 미리 준비한 뒤 다른 손가락과 분리해 한 음씩 확실히 탄현하세요.`,
                evidence: `최근 ${fingerHits.length}회 해결된 탄현 중 ${fingerLabel(finger)} 기록이 없습니다.`,
                nextGoal: `${fingerLabel(finger)} 단독 4회 후 원래 패턴을 다시 연결하세요.`,
                confidencePercent: confidence,
                priority: 12,
                measurements: [{ label: `${fingerLabel(finger)} 횟수`, value: '0회' }],
            });
            return;
        }
        const wrong = relevant.filter((hit) => !correctString(finger, hit.stringNumber));
        totalWrong += wrong.length;
        totalResolved += relevant.length;
        const ratio = wrong.length / relevant.length;
        if (relevant.length >= 2 && ratio > 0.34) {
            const actual = [...new Set(wrong.map((hit) => `${hit.stringNumber}번`))].join('·');
            feedback.push({
                id: `arpeggio-${finger}-wrong-string`,
                status: 'correction',
                title: `${fingerLabel(finger)}가 다른 줄을 자주 건드립니다`,
                instruction: `${fingerLabel(finger)}는 ${targetLabel(finger)} 위에 낮게 준비하고 손끝이 그 줄만 지나 손바닥 쪽으로 복귀하게 하세요.`,
                evidence: `${fingerLabel(finger)} ${relevant.length}회 중 ${wrong.length}회가 목표 밖(${actual})입니다.`,
                nextGoal: `${targetLabel(finger)}만 보면서 ${fingerLabel(finger)} 단독 4회를 정확히 연주하세요.`,
                confidencePercent: confidence,
                priority: 13,
                measurements: [
                    { label: '목표 줄', value: targetLabel(finger) },
                    { label: '오탄현', value: `${Math.round(ratio * 100)}%` },
                ],
            });
        }
    });
    if (totalResolved >= 8 && totalWrong / totalResolved <= 0.15) {
        feedback.push({
            id: 'arpeggio-string-roles-good',
            status: 'success',
            title: 'P·i·m·a가 맡은 줄을 정확히 나눠 연주합니다',
            instruction: '현재 손가락별 준비 위치와 작은 복귀 동작을 그대로 유지하세요.',
            evidence: `해결된 ${totalResolved}회 탄현 중 목표 밖 탄현은 ${totalWrong}회입니다.`,
            nextGoal: '같은 줄 역할을 유지하며 음 사이 간격만 더 일정하게 만드세요.',
            confidencePercent: confidence,
            priority: 5,
            measurements: [{ label: '줄 역할 정확도', value: `${Math.round((1 - totalWrong / totalResolved) * 100)}%` }],
        });
    }
    const latestContacts = samples.slice(-10).flatMap((sample) => sample.contacts);
    expectedFingers.forEach((finger) => {
        const contacts = latestContacts.filter((contact) => contact.id === finger && contact.confidence >= 0.5);
        if (contacts.length < 4)
            return;
        const distanceRatio = median(contacts.map((contact) => contact.distanceRatio));
        if (distanceRatio > 0.92) {
            feedback.push({
                id: `arpeggio-${finger}-hover-high`,
                status: 'correction',
                title: `${fingerLabel(finger)} 준비 위치가 줄에서 너무 멉니다`,
                instruction: `${fingerLabel(finger)} 끝을 ${targetLabel(finger)} 바로 위에 낮게 두고 필요한 순간에만 짧게 움직이세요.`,
                evidence: `최근 줄 거리 중앙값이 ${distanceRatio.toFixed(2)}줄 간격입니다.`,
                nextGoal: '탄현하지 않을 때도 손끝을 한 줄 간격 안에 유지하세요.',
                confidencePercent: confidence,
                priority: 9,
                measurements: [{ label: '준비 거리', value: `${distanceRatio.toFixed(2)}줄` }],
            });
        }
    });
}
function groupStrokes(hits) {
    const strokes = [];
    hits.forEach((hit) => {
        if (hit.direction !== 'down' && hit.direction !== 'up')
            return;
        const previous = strokes.at(-1);
        if (previous && previous.direction === hit.direction && hit.capturedAt - previous.capturedAt <= 150) {
            if (!previous.strings.includes(hit.stringNumber))
                previous.strings.push(hit.stringNumber);
            previous.capturedAt = hit.capturedAt;
        }
        else {
            strokes.push({ direction: hit.direction, capturedAt: hit.capturedAt, strings: [hit.stringNumber] });
        }
    });
    return strokes;
}
function analyzeStrumRoles(samples, hits, feedback) {
    const confidence = confidencePercent(samples);
    const pickHits = hits.filter((hit) => hit.contactId === 'pick');
    const strokes = groupStrokes(pickHits);
    if (strokes.length < 6)
        return;
    let repeatedDirection = 0;
    for (let index = 1; index < strokes.length; index += 1) {
        if (strokes[index].direction === strokes[index - 1].direction)
            repeatedDirection += 1;
    }
    const repeatRatio = repeatedDirection / Math.max(1, strokes.length - 1);
    if (repeatRatio > 0.26) {
        feedback.push({
            id: 'strum-du-alternation-break',
            status: 'correction',
            title: '다운·업 왕복이 중간에 같은 방향으로 반복됩니다',
            instruction: '다운이 끝난 자리에서 손을 멈추지 말고 같은 레일을 따라 바로 업으로 되돌리세요.',
            evidence: `${strokes.length}개 스트로크 전환 중 같은 방향 반복이 ${Math.round(repeatRatio * 100)}%입니다.`,
            nextGoal: 'D-U를 말하면서 8회 연속 정확히 왕복하세요.',
            confidencePercent: confidence,
            priority: 12,
            measurements: [{ label: '방향 반복', value: `${Math.round(repeatRatio * 100)}%` }],
        });
    }
    else {
        feedback.push({
            id: 'strum-du-alternation-good',
            status: 'success',
            title: '다운·업 왕복 순서가 안정적으로 이어집니다',
            instruction: '현재 왕복 흐름을 유지하고 손목을 멈추지 마세요.',
            evidence: `같은 방향 반복이 ${Math.round(repeatRatio * 100)}%입니다.`,
            nextGoal: '왕복 순서는 유지하고 다운·업의 음량 차이만 줄이세요.',
            confidencePercent: confidence,
            priority: 4,
            measurements: [{ label: 'D-U 정확도', value: `${Math.round((1 - repeatRatio) * 100)}%` }],
        });
    }
    const down = strokes.filter((stroke) => stroke.direction === 'down');
    const up = strokes.filter((stroke) => stroke.direction === 'up');
    const downWidth = median(down.map((stroke) => stroke.strings.length));
    const upWidth = median(up.map((stroke) => stroke.strings.length));
    if (down.length >= 2 && up.length >= 2 && downWidth >= 4 && downWidth <= 6 && upWidth >= 1 && upWidth <= 3) {
        feedback.push({
            id: 'strum-string-range-good',
            status: 'success',
            title: '다운은 넓게, 업은 고음줄 위주로 잘 나뉩니다',
            instruction: '현재 다운 시작점과 가벼운 업 깊이를 그대로 유지하세요.',
            evidence: `다운 중앙값 ${downWidth.toFixed(0)}줄, 업 중앙값 ${upWidth.toFixed(0)}줄입니다.`,
            nextGoal: '같은 줄 범위로 D-U 8회를 연속 유지하세요.',
            confidencePercent: confidence,
            priority: 5,
            measurements: [
                { label: '다운', value: `${downWidth.toFixed(0)}줄` },
                { label: '업', value: `${upWidth.toFixed(0)}줄` },
            ],
        });
    }
}
function analyzePickingRoles(samples, hits, feedback) {
    const latest = samples.at(-1);
    const confidence = confidencePercent(samples);
    const pickHits = hits.filter((hit) => hit.contactId === 'pick');
    if (pickHits.length < 6)
        return;
    if (latest.category === 'downPicking') {
        const upHits = pickHits.filter((hit) => hit.direction === 'up');
        const upRatio = upHits.length / pickHits.length;
        if (upRatio > 0.18) {
            feedback.push({
                id: 'down-picking-up-contamination',
                status: 'correction',
                title: '다운피킹 연습에 업피킹이 섞입니다',
                instruction: '각 다운 뒤에는 피크를 줄 위로 조용히 복귀시키고, 다음 음도 다시 다운으로 시작하세요.',
                evidence: `해결된 피크 탄현 ${pickHits.length}회 중 업 방향이 ${upHits.length}회입니다.`,
                nextGoal: '한 줄에서 다운만 8회 연속 정확히 연주하세요.',
                confidencePercent: confidence,
                priority: 13,
                measurements: [{ label: '업 혼입', value: `${Math.round(upRatio * 100)}%` }],
            });
        }
        else {
            feedback.push({
                id: 'down-picking-direction-good',
                status: 'success',
                title: '다운피킹 방향이 일관되게 유지됩니다',
                instruction: '현재 다운 방향과 조용한 복귀를 그대로 유지하세요.',
                evidence: `다운 방향 비율이 ${Math.round((1 - upRatio) * 100)}%입니다.`,
                nextGoal: '방향을 유지한 채 줄 이동 시 피크 폭을 줄이세요.',
                confidencePercent: confidence,
                priority: 4,
                measurements: [{ label: '다운 비율', value: `${Math.round((1 - upRatio) * 100)}%` }],
            });
        }
    }
    if (latest.category === 'alternatePicking') {
        const stringChanges = pickHits.slice(1).filter((hit, index) => hit.stringNumber !== pickHits[index].stringNumber);
        if (stringChanges.length >= 3) {
            let brokenChanges = 0;
            for (let index = 1; index < pickHits.length; index += 1) {
                if (pickHits[index].stringNumber === pickHits[index - 1].stringNumber)
                    continue;
                if (pickHits[index].direction === pickHits[index - 1].direction)
                    brokenChanges += 1;
            }
            const ratio = brokenChanges / stringChanges.length;
            if (ratio > 0.24) {
                feedback.push({
                    id: 'alternate-cross-string-direction-break',
                    status: 'correction',
                    title: '줄을 바꿀 때 다운·업 교대가 무너집니다',
                    instruction: '줄 이동 자체와 피킹 방향을 따로 바꾸지 말고, 직전 탄현의 반대 방향을 유지한 채 옆 줄로 짧게 이동하세요.',
                    evidence: `줄 변경 ${stringChanges.length}회 중 방향 반복이 ${brokenChanges}회입니다.`,
                    nextGoal: '3번↔2번 줄에서 D-U를 유지하며 8음 연주하세요.',
                    confidencePercent: confidence,
                    priority: 12,
                    measurements: [{ label: '줄 변경 교대', value: `${Math.round((1 - ratio) * 100)}%` }],
                });
            }
        }
    }
}
function analyzeRightHandStringRoles(samples) {
    const recent = recentWindow(samples);
    const latest = recent.at(-1);
    if (!latest || recent.length < 10)
        return [];
    if (latest.stringConfidence < 0.52 || latest.stringStability < 0.5 || latest.visibleStringCount < 5)
        return [];
    const hits = resolvedHits(recent);
    const feedback = [];
    if (latest.category === 'arpeggio' || latest.category === 'fingerstyle') {
        analyzeArpeggioStrings(recent, hits, feedback);
    }
    else if (latest.category === 'strumming') {
        analyzeStrumRoles(recent, hits, feedback);
    }
    else if (latest.category === 'downPicking' || latest.category === 'alternatePicking') {
        analyzePickingRoles(recent, hits, feedback);
    }
    return feedback
        .sort((left, right) => {
        const rank = (status) => status === 'warning' ? 4 : status === 'correction' ? 3 : status === 'cannot-judge' ? 2 : 1;
        return rank(right.status) - rank(left.status)
            || right.priority - left.priority
            || right.confidencePercent - left.confidencePercent;
    })
        .slice(0, 5);
}
