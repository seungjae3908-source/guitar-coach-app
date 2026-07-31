"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const right_hand_string_role_engine_1 = require("../services/right-hand-string-role-engine");
let checks = 0;
function assert(condition, message) {
    checks += 1;
    if (!condition)
        throw new Error(message);
}
const fingerIds = ['thumb', 'index', 'middle', 'ring', 'pinky'];
function baseSample(capturedAt, category, hits, pattern) {
    const fingers = Object.fromEntries(fingerIds.map((finger, index) => [finger, {
            tip: { x: 0.42 + index * 0.03, y: 0.40 + index * 0.01 },
            base: { x: 0.43 + index * 0.02, y: 0.52 },
            pip: { x: 0.43 + index * 0.02, y: 0.47 },
            jointAngle: 145,
            reach: 0.78,
        }]));
    return {
        capturedAt,
        category,
        pattern,
        handConfidence: 0.93,
        palmSize: 0.28,
        wrist: { x: 0.5, y: 0.52 },
        palmAngle: 14,
        pick: {
            detected: true,
            confidence: 0.91,
            angleDegrees: 18,
            exposure: 0.34,
            center: { x: 0.5, y: 0.44 },
        },
        stringAngle: 0,
        stringConfidence: 0.91,
        stringStability: 0.88,
        visibleStringCount: 6,
        fingers,
        contacts: [
            { id: 'thumb', visualIndex: 1, stringNumber: 6, distanceRatio: 0.24, confidence: 0.9 },
            { id: 'index', visualIndex: 4, stringNumber: 3, distanceRatio: 0.22, confidence: 0.9 },
            { id: 'middle', visualIndex: 5, stringNumber: 2, distanceRatio: 0.20, confidence: 0.9 },
            { id: 'ring', visualIndex: 6, stringNumber: 1, distanceRatio: 0.23, confidence: 0.9 },
        ],
        hits,
    };
}
function hit(capturedAt, contactId, stringNumber, direction = 'up') {
    return {
        capturedAt,
        contactId,
        visualIndex: 7 - stringNumber,
        stringNumber,
        direction,
        confidence: 0.9,
    };
}
{
    const pattern = [
        ['thumb', 6], ['index', 3], ['middle', 2], ['ring', 1],
        ['thumb', 5], ['index', 3], ['middle', 2], ['ring', 1],
        ['thumb', 4], ['index', 3], ['middle', 2], ['ring', 1],
    ];
    const samples = pattern.map(([finger, stringNumber], index) => {
        const capturedAt = 1_000 + index * 120;
        return baseSample(capturedAt, 'arpeggio', [hit(capturedAt, finger, stringNumber)], 'P-i-m-a');
    });
    const feedback = (0, right_hand_string_role_engine_1.analyzeRightHandStringRoles)(samples);
    assert(feedback.some((item) => item.id === 'arpeggio-string-roles-good'), '정확한 P/i/m/a 줄 역할에는 성공 피드백이 필요합니다.');
}
{
    const pattern = [
        ['thumb', 6], ['index', 2], ['middle', 2], ['ring', 1],
        ['thumb', 5], ['index', 2], ['middle', 2], ['ring', 1],
        ['thumb', 4], ['index', 2], ['middle', 2], ['ring', 1],
    ];
    const samples = pattern.map(([finger, stringNumber], index) => {
        const capturedAt = 3_000 + index * 120;
        return baseSample(capturedAt, 'arpeggio', [hit(capturedAt, finger, stringNumber)], 'P-i-m-a');
    });
    const feedback = (0, right_hand_string_role_engine_1.analyzeRightHandStringRoles)(samples);
    const correction = feedback.find((item) => item.id === 'arpeggio-index-wrong-string');
    assert(Boolean(correction), '검지가 2번 줄을 반복 탄현하면 오탄현 교정이 필요합니다.');
    assert(correction?.instruction.includes('3번 줄'), '검지 교정은 정확한 목표 줄을 알려야 합니다.');
}
{
    const samples = [];
    for (let stroke = 0; stroke < 10; stroke += 1) {
        const capturedAt = 5_000 + stroke * 220;
        const down = stroke % 2 === 0;
        const strings = down ? [6, 5, 4, 3, 2] : [1, 2, 3];
        samples.push(baseSample(capturedAt, 'strumming', strings.map((stringNumber, index) => hit(capturedAt + index * 12, 'pick', stringNumber, down ? 'down' : 'up'))));
    }
    const feedback = (0, right_hand_string_role_engine_1.analyzeRightHandStringRoles)(samples);
    assert(feedback.some((item) => item.id === 'strum-du-alternation-good'), '정확한 D-U 왕복에는 성공 피드백이 필요합니다.');
    assert(feedback.some((item) => item.id === 'strum-string-range-good'), '다운 5줄·업 3줄에는 범위 성공 피드백이 필요합니다.');
}
{
    const directions = ['down', 'down', 'down', 'up', 'down', 'up', 'down', 'down'];
    const samples = directions.map((direction, index) => {
        const capturedAt = 8_000 + index * 160;
        return baseSample(capturedAt, 'downPicking', [hit(capturedAt, 'pick', 3, direction)]);
    });
    while (samples.length < 10)
        samples.push(baseSample(9_500 + samples.length * 100, 'downPicking', []));
    const feedback = (0, right_hand_string_role_engine_1.analyzeRightHandStringRoles)(samples);
    const correction = feedback.find((item) => item.id === 'down-picking-up-contamination');
    assert(Boolean(correction), '다운피킹에 업이 섞이면 방향 교정이 필요합니다.');
    assert(correction?.nextGoal.includes('다운만 8회'), '다운피킹 교정은 구체적인 반복 목표를 줘야 합니다.');
}
console.log(`right-hand string-role quality gate: ${checks} checks passed`);
