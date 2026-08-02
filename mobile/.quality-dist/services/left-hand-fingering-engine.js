"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseFingeringTarget = parseFingeringTarget;
exports.frequencyToMidi = frequencyToMidi;
exports.matchFingeringAttack = matchFingeringAttack;
exports.analyzeFingeringEvents = analyzeFingeringEvents;
const OPEN_STRING_MIDI = {
    6: 40,
    5: 45,
    4: 50,
    3: 55,
    2: 59,
    1: 64,
};
const FINGER_FROM_NUMBER = {
    '1': 'index',
    '2': 'middle',
    '3': 'ring',
    '4': 'pinky',
};
const FINGER_FROM_TOKEN = {
    i: 'index',
    m: 'middle',
    r: 'ring',
    k: 'pinky',
    p: 'pinky',
};
const FINGER_KO = {
    index: '검지',
    middle: '중지',
    ring: '약지',
    pinky: '새끼손가락',
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
function mean(values) {
    if (!values.length)
        return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function standardDeviation(values) {
    if (values.length < 2)
        return 0;
    const average = mean(values);
    return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}
function unique(values) {
    return [...new Set(values)];
}
function normalizePattern(pattern) {
    return (pattern ?? '').replace(/\s+/g, '').toLowerCase();
}
function parseFingeringTarget(pattern, category) {
    const normalized = normalizePattern(pattern);
    const numberSequence = normalized.match(/[1-4]/g) ?? [];
    if (normalized.includes('1-2-3-4')
        || normalized.includes('1234')
        || (category === 'fingering' && numberSequence.join('').startsWith('1234'))) {
        return {
            id: 'chromatic-1234',
            label: '1-2-3-4 크로매틱',
            kind: 'relative-chromatic',
            steps: ['1', '2', '3', '4'].map((number, index) => ({
                finger: FINGER_FROM_NUMBER[number],
                relativeFret: index,
            })),
        };
    }
    const absoluteSteps = [];
    const expression = /(?:s)?([1-6])[-:f]([0-9]{1,2})[-:(]?([imrkp])\)?/g;
    let match = expression.exec(normalized);
    while (match) {
        const stringNumber = Number(match[1]);
        const fret = Number(match[2]);
        const finger = FINGER_FROM_TOKEN[match[3]];
        if (finger && fret >= 1 && fret <= 24) {
            absoluteSteps.push({ finger, stringNumber, fret });
        }
        match = expression.exec(normalized);
    }
    if (absoluteSteps.length >= 4) {
        return {
            id: 'absolute-sequence',
            label: category === 'scales' ? '지정 스케일 순서' : '지정 줄·프렛 순서',
            kind: 'absolute-sequence',
            steps: absoluteSteps,
        };
    }
    return null;
}
function frequencyToMidi(frequencyHz) {
    if (!Number.isFinite(frequencyHz) || frequencyHz <= 0)
        return null;
    return 69 + 12 * Math.log2(frequencyHz / 440);
}
function expectedMidi(position) {
    return OPEN_STRING_MIDI[position.stringNumber] + position.fret;
}
function matchFingeringAttack(attack, positions) {
    const midiFloat = frequencyToMidi(attack.frequencyHz);
    if (midiFloat == null
        || attack.pitchConfidence < 0.48
        || attack.signalToNoiseDb < 9
        || attack.clippingRatio >= 0.04)
        return null;
    const candidates = positions
        .filter((position) => position.confidence >= 0.48)
        .map((position) => {
        const midi = expectedMidi(position);
        const centsError = Math.abs(midiFloat - midi) * 100;
        const motionScore = clamp((position.motion ?? 0) / 0.04, 0, 1);
        const geometryScore = clamp(position.confidence * 0.58
            + (1 - clamp(position.stringDistance / 0.74, 0, 1)) * 0.18
            + (1 - clamp(position.fretPosition, 0, 1)) * 0.12
            + motionScore * 0.12, 0, 1);
        const pitchScore = 1 - clamp(centsError / 85, 0, 1);
        return {
            position,
            midi,
            centsError,
            score: geometryScore * 0.58 + pitchScore * 0.42,
        };
    })
        .filter((candidate) => candidate.centsError <= 85)
        .sort((left, right) => right.score - left.score || left.centsError - right.centsError);
    const best = candidates[0];
    if (!best)
        return null;
    const second = candidates[1];
    const ambiguous = Boolean(second && best.score - second.score < 0.075 && Math.abs(best.centsError - second.centsError) < 18);
    const confirmed = !ambiguous
        && best.centsError <= 45
        && best.position.confidence >= 0.58
        && attack.pitchConfidence >= 0.58;
    const confidence = clamp(best.position.confidence * 0.42
        + attack.pitchConfidence * 0.34
        + (1 - clamp(best.centsError / 85, 0, 1)) * 0.18
        + (ambiguous ? 0 : 0.06), 0, 1);
    return {
        capturedAt: attack.capturedAt,
        status: confirmed ? 'confirmed' : 'candidate',
        finger: best.position.finger,
        stringNumber: best.position.stringNumber,
        fret: best.position.fret,
        midi: best.midi,
        centsError: Math.round(best.centsError),
        confidencePercent: Math.round(confidence * 100),
    };
}
function expectedForEvent(target, events, index) {
    const stepIndex = index % target.steps.length;
    const step = target.steps[stepIndex];
    if (target.kind === 'absolute-sequence')
        return step;
    const groupStartIndex = index - stepIndex;
    const groupStart = events[groupStartIndex] ?? events[index];
    return {
        ...step,
        stringNumber: groupStart.stringNumber,
        fret: groupStart.fret + (step.relativeFret ?? 0),
    };
}
function timingStability(events) {
    const intervals = events.slice(1).map((event, index) => event.capturedAt - events[index].capturedAt)
        .filter((value) => value >= 50 && value <= 2_000);
    if (intervals.length < 3)
        return 0;
    const coefficient = standardDeviation(intervals) / Math.max(1, mean(intervals));
    return Math.round((1 - clamp(coefficient / 0.55, 0, 1)) * 100);
}
function mostFrequentMismatch(mismatches) {
    const counts = new Map();
    mismatches.forEach(({ event, expected, fingerWrong, positionWrong }) => {
        let key = '';
        let message = '';
        if (positionWrong && expected.stringNumber && expected.fret) {
            key = `position-${expected.stringNumber}-${expected.fret}`;
            message = `${expected.stringNumber}번 줄 ${expected.fret}프렛을 ${FINGER_KO[expected.finger]}로 누르세요. 현재 ${event.stringNumber}번 줄 ${event.fret}프렛이 감지됐습니다.`;
        }
        else if (fingerWrong) {
            key = `finger-${expected.finger}-${event.finger}`;
            message = `${event.stringNumber}번 줄 ${event.fret}프렛은 ${FINGER_KO[expected.finger]} 순서입니다. 현재 ${FINGER_KO[event.finger]}가 감지됐습니다.`;
        }
        if (!key)
            return;
        const previous = counts.get(key);
        counts.set(key, { count: (previous?.count ?? 0) + 1, message });
    });
    return [...counts.values()].sort((left, right) => right.count - left.count)[0]?.message ?? null;
}
function analyzeFingeringEvents(options) {
    const events = options.events.slice(-24);
    const targetLabel = options.target?.label ?? '줄·프렛 순서';
    const cannot = (correction, evidence) => ({
        status: 'cannot-judge',
        score: null,
        confidencePercent: 0,
        targetLabel,
        events,
        latestEvent: events.at(-1) ?? null,
        corrections: [correction],
        positives: [],
        evidence: [evidence],
        fingerAccuracyPercent: 0,
        positionAccuracyPercent: 0,
        timingStabilityPercent: 0,
    });
    if (!options.calibrationAvailable) {
        return cannot('왼손 지판 보정에서 너트와 기준 프렛의 양끝을 먼저 저장하세요.', '줄·프렛 좌표가 없어 손가락 위치를 추측하지 않습니다.');
    }
    if (!options.microphoneEnabled) {
        return cannot('마이크를 켜고 한 음씩 또렷하게 탄현하세요.', '영상 위치만으로 실제로 울린 줄·프렛을 확정하지 않습니다.');
    }
    if (!options.target) {
        return cannot('줄·프렛과 손가락이 명시된 연습 패턴을 선택하세요.', '목표 순서가 없어 임의의 정답이나 점수를 만들지 않습니다.');
    }
    if (events.length < 4) {
        return {
            ...cannot('같은 패턴을 최소 4음 이상 천천히 연주하세요.', `확정 가능한 음표 이벤트가 ${events.length}개입니다.`),
            status: 'candidate',
            confidencePercent: events.length ? Math.round(mean(events.map((event) => event.confidencePercent))) : 0,
        };
    }
    const comparisons = events.map((event, index) => {
        const expected = expectedForEvent(options.target, events, index);
        const fingerWrong = event.finger !== expected.finger;
        const positionWrong = Boolean(expected.stringNumber
            && expected.fret
            && (event.stringNumber !== expected.stringNumber || event.fret !== expected.fret));
        return { event, expected, fingerWrong, positionWrong };
    });
    const fingerCorrect = comparisons.filter((item) => !item.fingerWrong).length;
    const positionCorrect = comparisons.filter((item) => !item.positionWrong).length;
    const confirmedEvents = events.filter((event) => event.status === 'confirmed').length;
    const fingerAccuracyPercent = Math.round(fingerCorrect / events.length * 100);
    const positionAccuracyPercent = Math.round(positionCorrect / events.length * 100);
    const timingStabilityPercent = timingStability(events);
    const confidencePercent = Math.round(mean(events.map((event) => event.confidencePercent)));
    const expectedPinky = options.target.steps.some((step) => step.finger === 'pinky');
    const pinkyCount = events.filter((event) => event.finger === 'pinky').length;
    const corrections = [];
    const positives = [];
    const evidence = [
        `확정 음 ${confirmedEvents}/${events.length}개`,
        `손가락 순서 ${fingerAccuracyPercent}%`,
        `줄·프렛 위치 ${positionAccuracyPercent}%`,
        `간격 안정 ${timingStabilityPercent}%`,
    ];
    if (expectedPinky && events.length >= options.target.steps.length * 2 && pinkyCount === 0) {
        corrections.push('4번 순서에서 새끼손가락이 빠집니다. 검지·중지·약지를 누른 채 새끼손가락만 다음 프렛에 낮게 내려놓으세요.');
    }
    const mismatch = mostFrequentMismatch(comparisons.filter((item) => item.fingerWrong || item.positionWrong));
    if (mismatch)
        corrections.push(mismatch);
    if (timingStabilityPercent < 62 && events.length >= 6) {
        corrections.push('음 사이 간격이 흔들립니다. 손가락을 미리 준비하고 메트로놈 한 박 안에서 같은 간격으로 내려놓으세요.');
    }
    if (confirmedEvents / events.length < 0.75) {
        corrections.push('손가락 위치와 실제 음정이 동시에 맞는 표본이 부족합니다. 한 음씩 분리하고 다른 줄은 뮤트하세요.');
    }
    if (fingerAccuracyPercent >= 88)
        positives.push('손가락 순서가 목표 패턴과 안정적으로 맞습니다.');
    if (positionAccuracyPercent >= 88)
        positives.push('실제로 울린 줄·프렛이 목표 위치와 정확히 맞습니다.');
    if (expectedPinky && pinkyCount >= 2)
        positives.push('새끼손가락까지 빠뜨리지 않고 사용하고 있습니다.');
    if (timingStabilityPercent >= 78)
        positives.push('각 음의 시간 간격이 일정하게 유지됩니다.');
    const requiredEvents = Math.max(8, options.target.steps.length * 2);
    const confirmed = events.length >= requiredEvents
        && confirmedEvents / events.length >= 0.75
        && fingerAccuracyPercent >= 78
        && positionAccuracyPercent >= 78
        && confidencePercent >= 65;
    const score = confirmed
        ? Math.round(clamp(fingerAccuracyPercent * 0.34
            + positionAccuracyPercent * 0.36
            + timingStabilityPercent * 0.15
            + confidencePercent * 0.15, 0, 100))
        : null;
    return {
        status: confirmed ? 'confirmed' : 'candidate',
        score,
        confidencePercent,
        targetLabel,
        events,
        latestEvent: events.at(-1) ?? null,
        corrections: unique(corrections).slice(0, 5),
        positives: unique(positives).slice(0, 4),
        evidence,
        fingerAccuracyPercent,
        positionAccuracyPercent,
        timingStabilityPercent,
    };
}
