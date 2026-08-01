"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChordRecognitionTracker = exports.OPEN_CHORD_TEMPLATES = void 0;
exports.validateFretboardCalibration = validateFretboardCalibration;
exports.projectFingerToFretboard = projectFingerToFretboard;
exports.recognizeChord = recognizeChord;
const STANDARD_TUNING_PITCH_CLASSES = {
    6: 4,
    5: 9,
    4: 2,
    3: 7,
    2: 11,
    1: 4,
};
exports.OPEN_CHORD_TEMPLATES = [
    { id: 'C', name: 'C', strings: [-1, 3, 2, 0, 1, 0], preferredFingers: { '5:3': 'ring', '4:2': 'middle', '2:1': 'index' } },
    { id: 'Cadd9', name: 'Cadd9', strings: [-1, 3, 2, 0, 3, 3], preferredFingers: { '5:3': 'middle', '4:2': 'index', '2:3': 'ring', '1:3': 'pinky' } },
    { id: 'D', name: 'D', strings: [-1, -1, 0, 2, 3, 2], preferredFingers: { '3:2': 'index', '2:3': 'ring', '1:2': 'middle' } },
    { id: 'Dm', name: 'Dm', strings: [-1, -1, 0, 2, 3, 1], preferredFingers: { '3:2': 'middle', '2:3': 'ring', '1:1': 'index' } },
    { id: 'D7', name: 'D7', strings: [-1, -1, 0, 2, 1, 2], preferredFingers: { '3:2': 'middle', '2:1': 'index', '1:2': 'ring' } },
    { id: 'E', name: 'E', strings: [0, 2, 2, 1, 0, 0], preferredFingers: { '5:2': 'middle', '4:2': 'ring', '3:1': 'index' } },
    { id: 'Em', name: 'Em', strings: [0, 2, 2, 0, 0, 0], preferredFingers: { '5:2': 'middle', '4:2': 'ring' } },
    { id: 'E7', name: 'E7', strings: [0, 2, 0, 1, 0, 0], preferredFingers: { '5:2': 'middle', '3:1': 'index' } },
    { id: 'G', name: 'G', strings: [3, 2, 0, 0, 0, 3], preferredFingers: { '6:3': 'middle', '5:2': 'index', '1:3': 'ring' } },
    { id: 'G-four-finger', name: 'G', aliases: ['G(4손가락)'], strings: [3, 2, 0, 0, 3, 3], preferredFingers: { '6:3': 'middle', '5:2': 'index', '2:3': 'ring', '1:3': 'pinky' } },
    { id: 'G7', name: 'G7', strings: [3, 2, 0, 0, 0, 1], preferredFingers: { '6:3': 'ring', '5:2': 'middle', '1:1': 'index' } },
    { id: 'A', name: 'A', strings: [-1, 0, 2, 2, 2, 0] },
    { id: 'Am', name: 'Am', strings: [-1, 0, 2, 2, 1, 0], preferredFingers: { '4:2': 'middle', '3:2': 'ring', '2:1': 'index' } },
    { id: 'A7', name: 'A7', strings: [-1, 0, 2, 0, 2, 0] },
    { id: 'B7', name: 'B7', strings: [-1, 2, 1, 2, 0, 2], preferredFingers: { '5:2': 'middle', '4:1': 'index', '3:2': 'ring', '1:2': 'pinky' } },
    { id: 'Fmaj7', name: 'Fmaj7', strings: [-1, -1, 3, 2, 1, 0], preferredFingers: { '4:3': 'ring', '3:2': 'middle', '2:1': 'index' } },
    { id: 'F-small', name: 'F', aliases: ['F 미니 바레'], strings: [-1, -1, 3, 2, 1, 1], preferredFingers: { '4:3': 'ring', '3:2': 'middle', '2:1': 'index', '1:1': 'index' } },
];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
function distance(left, right) {
    return Math.hypot(left.x - right.x, left.y - right.y);
}
function lerp(left, right, amount) {
    return {
        x: left.x + (right.x - left.x) * amount,
        y: left.y + (right.y - left.y) * amount,
    };
}
function projectionAmount(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const denominator = Math.max(0.000001, dx * dx + dy * dy);
    return ((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator;
}
function fretDistance(fret) {
    return 1 - 2 ** (-Math.max(0, fret) / 12);
}
function validateFretboardCalibration(calibration) {
    const nutWidth = distance(calibration.nutSixth, calibration.nutFirst);
    const referenceWidth = distance(calibration.referenceSixth, calibration.referenceFirst);
    const centerNut = lerp(calibration.nutSixth, calibration.nutFirst, 0.5);
    const centerReference = lerp(calibration.referenceSixth, calibration.referenceFirst, 0.5);
    const neckLength = distance(centerNut, centerReference);
    const widthRatio = Math.max(nutWidth, referenceWidth) / Math.max(0.0001, Math.min(nutWidth, referenceWidth));
    const valid = calibration.referenceFret >= 3
        && calibration.referenceFret <= 12
        && calibration.maxVisibleFret >= calibration.referenceFret
        && nutWidth >= 0.035
        && referenceWidth >= 0.035
        && neckLength >= 0.12
        && widthRatio <= 2.4;
    return {
        valid,
        message: valid
            ? '지판 좌표가 코드 인식 기준을 통과했습니다.'
            : '너트와 기준 프렛의 양쪽 끝을 다시 지정하세요.',
        measurements: { nutWidth, referenceWidth, neckLength, widthRatio },
    };
}
function fretboardAxis(calibration) {
    return {
        start: lerp(calibration.nutSixth, calibration.nutFirst, 0.5),
        end: lerp(calibration.referenceSixth, calibration.referenceFirst, 0.5),
    };
}
function projectFingerToFretboard(observation, calibration) {
    if (observation.confidence < 0.42 || !validateFretboardCalibration(calibration).valid)
        return null;
    const axis = fretboardAxis(calibration);
    const referenceAmount = projectionAmount(observation.tip, axis.start, axis.end);
    const referenceDistance = fretDistance(calibration.referenceFret);
    const absoluteDistance = referenceAmount * referenceDistance;
    const maxDistance = fretDistance(calibration.maxVisibleFret + 1);
    if (absoluteDistance < -0.035 || absoluteDistance > maxDistance + 0.025)
        return null;
    const safeDistance = clamp(absoluteDistance, 0, 0.999);
    const continuousFret = -12 * Math.log2(Math.max(0.0001, 1 - safeDistance));
    const fret = clamp(Math.ceil(continuousFret - 0.08), 1, calibration.maxVisibleFret);
    const sideAtPoint = referenceAmount;
    const sixthAtPoint = lerp(calibration.nutSixth, calibration.referenceSixth, sideAtPoint);
    const firstAtPoint = lerp(calibration.nutFirst, calibration.referenceFirst, sideAtPoint);
    const stringAmount = projectionAmount(observation.tip, sixthAtPoint, firstAtPoint);
    const stringFloat = 6 - clamp(stringAmount, 0, 1) * 5;
    const stringNumber = clamp(Math.round(stringFloat), 1, 6);
    const expectedAmount = (6 - stringNumber) / 5;
    const expectedPoint = lerp(sixthAtPoint, firstAtPoint, expectedAmount);
    const stringSpacing = distance(sixthAtPoint, firstAtPoint) / 5;
    const stringDistance = distance(observation.tip, expectedPoint) / Math.max(0.0001, stringSpacing);
    if (stringDistance > 0.74)
        return null;
    const fretCenter = fretDistance(fret - 0.48);
    const fretPosition = Math.abs(safeDistance - fretCenter) / Math.max(0.002, fretDistance(fret) - fretDistance(fret - 1));
    const confidence = clamp(observation.confidence * 0.42
        + calibration.confidencePercent / 100 * 0.28
        + (1 - stringDistance / 0.74) * 0.20
        + (1 - clamp(fretPosition, 0, 1)) * 0.10, 0, 1);
    return {
        finger: observation.finger,
        stringNumber,
        fret,
        stringDistance,
        fretPosition,
        confidence,
    };
}
function pressedEntries(template) {
    return template.strings.flatMap((value, index) => value > 0
        ? [{ stringNumber: (6 - index), fret: value }]
        : []);
}
function positionKey(stringNumber, fret) {
    return `${stringNumber}:${fret}`;
}
function pitchClassesForTemplate(template) {
    return [...new Set(template.strings.flatMap((state, index) => {
            if (state < 0)
                return [];
            const stringNumber = (6 - index);
            return [(STANDARD_TUNING_PITCH_CLASSES[stringNumber] + state) % 12];
        }))];
}
function audioSimilarity(template, audio) {
    if (!audio || audio.confidence < 0.48 || audio.signalToNoiseDb < 10 || audio.clippingRatio >= 0.03)
        return null;
    const expected = new Set(pitchClassesForTemplate(template));
    const observed = new Set(audio.pitchClasses.map((value) => ((Math.round(value) % 12) + 12) % 12));
    const intersection = [...expected].filter((value) => observed.has(value)).length;
    const union = new Set([...expected, ...observed]).size;
    return union > 0 ? intersection / union : 0;
}
function scoreTemplate(template, positions, audio) {
    const expected = pressedEntries(template);
    const observedKeys = new Set(positions.map((position) => positionKey(position.stringNumber, position.fret)));
    const expectedKeys = new Set(expected.map((position) => positionKey(position.stringNumber, position.fret)));
    const matched = [...expectedKeys].filter((key) => observedKeys.has(key)).length;
    const missing = [...expectedKeys].filter((key) => !observedKeys.has(key));
    const extras = [...observedKeys].filter((key) => !expectedKeys.has(key));
    const pressedRecall = expectedKeys.size ? matched / expectedKeys.size : 0;
    const pressedPrecision = observedKeys.size ? matched / observedKeys.size : 0;
    const visual = pressedRecall * 0.58 + pressedPrecision * 0.42;
    const audioScore = audioSimilarity(template, audio);
    const total = audioScore == null ? visual : visual * 0.68 + audioScore * 0.32;
    return { total, visual, audioScore, missing, extras, matched, expectedCount: expectedKeys.size };
}
function correctionForKey(key) {
    const [stringNumber, fret] = key.split(':');
    return `${stringNumber}번 줄 ${fret}프렛을 정확히 누르세요.`;
}
function extraCorrection(key) {
    const [stringNumber, fret] = key.split(':');
    return `${stringNumber}번 줄 ${fret}프렛의 불필요한 손가락을 떼세요.`;
}
function recognizeChord(observations, calibration, audio, templates = exports.OPEN_CHORD_TEMPLATES) {
    if (!calibration || !validateFretboardCalibration(calibration).valid) {
        return {
            status: 'cannot-judge',
            chordName: null,
            aliases: [],
            score: null,
            confidencePercent: 0,
            evidence: ['왼손 코드 인식을 위한 지판 보정이 필요합니다.'],
            positions: [],
            corrections: ['촬영보정에서 너트와 기준 프렛의 양쪽 끝을 지정하세요.'],
            positives: [],
            expectedStrings: null,
        };
    }
    const positions = observations
        .map((observation) => projectFingerToFretboard(observation, calibration))
        .filter((position) => Boolean(position))
        .sort((left, right) => right.confidence - left.confidence);
    const uniquePositions = positions.filter((position, index, list) => list.findIndex((candidate) => (candidate.stringNumber === position.stringNumber && candidate.fret === position.fret)) === index);
    if (uniquePositions.length < 2) {
        return {
            status: 'cannot-judge',
            chordName: null,
            aliases: [],
            score: null,
            confidencePercent: Math.round((uniquePositions[0]?.confidence ?? 0) * 100),
            evidence: [`신뢰 가능한 줄·프렛 손가락이 ${uniquePositions.length}개입니다.`],
            positions: uniquePositions,
            corrections: ['검지·중지·약지·새끼 끝과 사용하는 프렛이 모두 보이도록 구도를 맞추세요.'],
            positives: [],
            expectedStrings: null,
        };
    }
    const ranked = templates
        .map((template) => ({ template, ...scoreTemplate(template, uniquePositions, audio) }))
        .sort((left, right) => right.total - left.total || right.matched - left.matched);
    const best = ranked[0];
    const second = ranked[1];
    const margin = best ? best.total - (second?.total ?? 0) : 0;
    const positionConfidence = uniquePositions.reduce((sum, position) => sum + position.confidence, 0) / uniquePositions.length;
    const audioVerified = best?.audioScore != null && (best.audioScore ?? 0) >= 0.62;
    const confidence = best
        ? clamp(best.total * 0.58 + positionConfidence * 0.26 + clamp(margin / 0.22, 0, 1) * 0.16, 0, 1)
        : 0;
    const candidateAllowed = Boolean(best && best.total >= 0.62 && best.matched >= 2 && margin >= 0.06);
    const confirmed = candidateAllowed && audioVerified && confidence >= 0.70;
    if (!candidateAllowed || !best) {
        return {
            status: 'cannot-judge',
            chordName: null,
            aliases: [],
            score: null,
            confidencePercent: Math.round(confidence * 100),
            evidence: ['현재 손가락의 줄·프렛 조합이 지원 코드 운지와 충분히 일치하지 않습니다.'],
            positions: uniquePositions,
            corrections: ['손가락 끝이 프렛 바로 뒤에 오도록 한 뒤 코드를 다시 잡으세요.'],
            positives: [],
            expectedStrings: null,
        };
    }
    const corrections = [
        ...best.missing.map(correctionForKey),
        ...best.extras.map(extraCorrection),
    ];
    const preferred = best.template.preferredFingers ?? {};
    uniquePositions.forEach((position) => {
        const expectedFinger = preferred[positionKey(position.stringNumber, position.fret)];
        if (expectedFinger && expectedFinger !== position.finger) {
            const label = expectedFinger === 'index' ? '검지' : expectedFinger === 'middle' ? '중지' : expectedFinger === 'ring' ? '약지' : '새끼';
            corrections.push(`${position.stringNumber}번 줄 ${position.fret}프렛은 ${label} 사용이 더 안정적입니다.`);
        }
    });
    if (!audioVerified)
        corrections.push('한 번 스트럼해 오픈현·뮤트현과 실제 울림을 확인하세요.');
    const visualScore = Math.round(best.visual * 100);
    const finalScore = confirmed ? Math.round(clamp(best.total, 0, 1) * 100) : null;
    return {
        status: confirmed ? 'confirmed' : 'candidate',
        chordName: best.template.name,
        aliases: best.template.aliases ?? [],
        score: finalScore,
        confidencePercent: Math.round(confidence * 100),
        evidence: [
            `눌린 줄·프렛 ${best.matched}/${best.expectedCount}개 일치`,
            `영상 운지 일치 ${visualScore}%`,
            best.audioScore == null
                ? '소리 확인 전: 오픈현·뮤트현은 아직 확정하지 않음'
                : `소리 음군 일치 ${Math.round(best.audioScore * 100)}%`,
        ],
        positions: uniquePositions,
        corrections: [...new Set(corrections)].slice(0, 5),
        positives: [
            best.matched >= best.expectedCount ? '필요한 프렛 위치를 모두 잡았습니다.' : `${best.matched}개 프렛 위치가 코드 운지와 맞습니다.`,
            margin >= 0.16 ? '다른 코드 후보와 구분되는 손 모양입니다.' : '손 모양 후보를 유지하고 한 번 스트럼해 확인하세요.',
        ],
        expectedStrings: best.template.strings,
    };
}
class ChordRecognitionTracker {
    history = [];
    reset() {
        this.history = [];
    }
    process(result, capturedAt = Date.now()) {
        this.history.push({ capturedAt, result });
        this.history = this.history
            .filter((entry) => capturedAt - entry.capturedAt <= 900)
            .slice(-8);
        if (!result.chordName || result.status === 'cannot-judge')
            return result;
        const compatible = this.history.filter((entry) => entry.result.chordName === result.chordName);
        const stableCount = compatible.length;
        const averageConfidence = compatible.reduce((sum, entry) => sum + entry.result.confidencePercent, 0) / Math.max(1, stableCount);
        if (stableCount < 3 || averageConfidence < 65) {
            return {
                ...result,
                status: 'candidate',
                score: null,
                confidencePercent: Math.round(averageConfidence),
                evidence: [...result.evidence, `동일 코드 후보 ${stableCount}/3프레임`],
            };
        }
        const confirmedFrames = compatible.filter((entry) => entry.result.status === 'confirmed');
        return {
            ...result,
            status: confirmedFrames.length >= 2 ? 'confirmed' : 'candidate',
            score: confirmedFrames.length >= 2 ? result.score : null,
            confidencePercent: Math.round(averageConfidence),
            evidence: [...result.evidence, `동일 코드 후보 ${stableCount}프레임 유지`],
        };
    }
}
exports.ChordRecognitionTracker = ChordRecognitionTracker;
