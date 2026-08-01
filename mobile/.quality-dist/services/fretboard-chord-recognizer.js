"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateFretboardCalibration = exports.projectFingerToFretboard = exports.OPEN_CHORD_TEMPLATES = exports.ChordRecognitionTracker = void 0;
exports.recognizeChord = recognizeChord;
const fretboard_chord_engine_1 = require("./fretboard-chord-engine");
Object.defineProperty(exports, "ChordRecognitionTracker", { enumerable: true, get: function () { return fretboard_chord_engine_1.ChordRecognitionTracker; } });
Object.defineProperty(exports, "OPEN_CHORD_TEMPLATES", { enumerable: true, get: function () { return fretboard_chord_engine_1.OPEN_CHORD_TEMPLATES; } });
Object.defineProperty(exports, "projectFingerToFretboard", { enumerable: true, get: function () { return fretboard_chord_engine_1.projectFingerToFretboard; } });
Object.defineProperty(exports, "validateFretboardCalibration", { enumerable: true, get: function () { return fretboard_chord_engine_1.validateFretboardCalibration; } });
function positionKey(stringNumber, fret) {
    return `${stringNumber}:${fret}`;
}
function expectedFrettedPositions(strings) {
    return strings.flatMap((fret, index) => fret > 0
        ? [{ stringNumber: 6 - index, fret }]
        : []);
}
function correctionForMissing(key) {
    const [stringNumber, fret] = key.split(':');
    return `${stringNumber}번 줄 ${fret}프렛을 정확히 누르세요.`;
}
function correctionForExtra(key) {
    const [stringNumber, fret] = key.split(':');
    return `${stringNumber}번 줄 ${fret}프렛의 불필요한 손가락을 떼세요.`;
}
/**
 * Base recognition plus a strict final-position gate.
 * Audio evidence may identify the chord family, but it cannot excuse a missing
 * or extra fretted position. In that case the result remains a candidate and
 * no score is published.
 */
function recognizeChord(observations, calibration, audio, templates = fretboard_chord_engine_1.OPEN_CHORD_TEMPLATES) {
    const result = (0, fretboard_chord_engine_1.recognizeChord)(observations, calibration, audio, templates);
    if (!result.chordName || !result.expectedStrings)
        return result;
    const expected = expectedFrettedPositions(result.expectedStrings);
    const expectedKeys = new Set(expected.map((position) => positionKey(position.stringNumber, position.fret)));
    const observedKeys = new Set(result.positions.map((position) => positionKey(position.stringNumber, position.fret)));
    const missing = [...expectedKeys].filter((key) => !observedKeys.has(key));
    const extras = [...observedKeys].filter((key) => !expectedKeys.has(key));
    if (!missing.length && !extras.length)
        return result;
    const strictCorrections = [
        ...missing.map(correctionForMissing),
        ...extras.map(correctionForExtra),
        ...result.corrections,
    ];
    const matched = Math.max(0, expectedKeys.size - missing.length);
    return {
        ...result,
        status: 'candidate',
        score: null,
        confidencePercent: Math.min(89, result.confidencePercent),
        evidence: [
            ...result.evidence,
            `필수 프렛 ${matched}/${expectedKeys.size}개 확인 · 누락 ${missing.length}개 · 추가 ${extras.length}개`,
            '소리가 비슷해도 손가락 위치가 완성되기 전에는 점수를 확정하지 않음',
        ],
        corrections: [...new Set(strictCorrections)].slice(0, 6),
        positives: matched > 0
            ? [`${matched}개 필수 프렛 위치는 코드 운지와 맞습니다.`]
            : [],
    };
}
