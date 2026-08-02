"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const left_hand_fingering_engine_1 = require("../services/left-hand-fingering-engine");
let checks = 0;
function assert(condition, message) {
    checks += 1;
    if (!condition)
        throw new Error(message);
}
const midiToFrequency = (midi) => 440 * 2 ** ((midi - 69) / 12);
function projected(finger, stringNumber, fret, motion = 0.03) {
    return {
        finger,
        stringNumber,
        fret,
        stringDistance: 0.12,
        fretPosition: 0.18,
        confidence: 0.92,
        motion,
    };
}
function note(capturedAt, finger, fret, stringNumber = 6) {
    return {
        capturedAt,
        status: 'confirmed',
        finger,
        stringNumber,
        fret,
        midi: 40 + fret,
        centsError: 4,
        confidencePercent: 91,
    };
}
{
    const target = (0, left_hand_fingering_engine_1.parseFingeringTarget)('1-2-3-4', 'fingering');
    assert(target?.kind === 'relative-chromatic', '1-2-3-4 패턴은 크로매틱 목표로 해석해야 합니다.');
    assert(target?.steps.map((step) => step.finger).join(',') === 'index,middle,ring,pinky', '1-2-3-4를 검지·중지·약지·새끼 순서로 변환해야 합니다.');
}
{
    const target = (0, left_hand_fingering_engine_1.parseFingeringTarget)('S6-5-i S6-7-r S6-8-k S5-5-i S5-7-r S5-8-k', 'scales');
    assert(target?.kind === 'absolute-sequence', '줄·프렛 표기는 절대 스케일 순서로 해석해야 합니다.');
    assert(target?.steps[1]?.stringNumber === 6 && target.steps[1]?.fret === 7 && target.steps[1]?.finger === 'ring', '절대 스케일의 줄·프렛·손가락을 보존해야 합니다.');
}
{
    const event = (0, left_hand_fingering_engine_1.matchFingeringAttack)({
        capturedAt: 1_000,
        frequencyHz: midiToFrequency(45),
        pitchConfidence: 0.94,
        signalToNoiseDb: 24,
        clippingRatio: 0.001,
    }, [
        projected('index', 6, 5, 0.05),
        projected('middle', 5, 5, 0.01),
    ]);
    assert(event?.status === 'confirmed', '음정과 손가락 위치가 일치하면 음표 이벤트를 확정해야 합니다.');
    assert(event?.finger === 'index' && event.stringNumber === 6 && event.fret === 5, '확정 이벤트에 실제 손가락·줄·프렛이 있어야 합니다.');
}
{
    const target = (0, left_hand_fingering_engine_1.parseFingeringTarget)('1-2-3-4', 'fingering');
    const fingers = ['index', 'middle', 'ring', 'pinky'];
    const events = Array.from({ length: 8 }, (_, index) => note(2_000 + index * 180, fingers[index % 4], 5 + index % 4));
    const result = (0, left_hand_fingering_engine_1.analyzeFingeringEvents)({
        events,
        target,
        calibrationAvailable: true,
        microphoneEnabled: true,
    });
    assert(result.status === 'confirmed', '영상·음정이 맞는 1-2-3-4 두 세트는 확정해야 합니다.');
    assert(result.score != null && result.score >= 80, '확정된 핑거링은 근거 기반 점수가 있어야 합니다.');
    assert(result.positives.some((item) => item.includes('새끼손가락')), '잘 사용한 새끼손가락을 성공 피드백으로 알려야 합니다.');
}
{
    const target = (0, left_hand_fingering_engine_1.parseFingeringTarget)('1-2-3-4', 'fingering');
    const events = [
        note(4_000, 'index', 5),
        note(4_180, 'middle', 6),
        note(4_360, 'ring', 7),
        note(4_540, 'index', 8),
        note(4_720, 'index', 5),
        note(4_900, 'middle', 6),
        note(5_080, 'ring', 7),
        note(5_260, 'index', 8),
    ];
    const result = (0, left_hand_fingering_engine_1.analyzeFingeringEvents)({
        events,
        target,
        calibrationAvailable: true,
        microphoneEnabled: true,
    });
    assert(result.status === 'candidate', '새끼손가락이 빠진 패턴은 점수를 확정하면 안 됩니다.');
    assert(result.score == null, '빠진 손가락이 있는 핑거링은 점수가 없어야 합니다.');
    assert(result.corrections.some((item) => item.includes('새끼손가락')), '새끼손가락 누락을 구체적으로 교정해야 합니다.');
}
{
    const target = (0, left_hand_fingering_engine_1.parseFingeringTarget)('1-2-3-4', 'fingering');
    const events = [
        note(6_000, 'index', 5),
        note(6_180, 'middle', 7),
        note(6_360, 'ring', 7),
        note(6_540, 'pinky', 8),
    ];
    const result = (0, left_hand_fingering_engine_1.analyzeFingeringEvents)({
        events,
        target,
        calibrationAvailable: true,
        microphoneEnabled: true,
    });
    assert(result.corrections.some((item) => item.includes('6번 줄 6프렛')), '잘못된 프렛은 기대 줄·프렛을 정확히 알려야 합니다.');
}
{
    const result = (0, left_hand_fingering_engine_1.analyzeFingeringEvents)({
        events: [],
        target: (0, left_hand_fingering_engine_1.parseFingeringTarget)('1-2-3-4', 'fingering'),
        calibrationAvailable: false,
        microphoneEnabled: true,
    });
    assert(result.status === 'cannot-judge', '지판 보정이 없으면 판정 불가여야 합니다.');
    assert(result.score == null, '지판 보정 없이 점수를 만들면 안 됩니다.');
}
console.log(`left-hand fingering quality gate: ${checks} checks passed`);
