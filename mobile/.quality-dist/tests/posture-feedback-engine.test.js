"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const posture_feedback_engine_1 = require("../services/posture-feedback-engine");
let checks = 0;
function assert(condition, message) {
    checks += 1;
    if (!condition)
        throw new Error(message);
}
const names = [
    'nose', 'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow',
    'leftWrist', 'rightWrist', 'leftHip', 'rightHip',
];
function result(overrides = {}) {
    const defaults = {
        nose: { x: 0.50, y: 0.18 },
        leftShoulder: { x: 0.38, y: 0.35 },
        rightShoulder: { x: 0.62, y: 0.35 },
        leftElbow: { x: 0.32, y: 0.50 },
        rightElbow: { x: 0.68, y: 0.50 },
        leftWrist: { x: 0.42, y: 0.62 },
        rightWrist: { x: 0.60, y: 0.62 },
        leftHip: { x: 0.43, y: 0.70 },
        rightHip: { x: 0.57, y: 0.70 },
    };
    return {
        hasPerson: true,
        imageWidth: 720,
        imageHeight: 1280,
        latencyMs: 30,
        landmarks: names.map((name) => ({ name, ...(overrides[name] ?? defaults[name]), z: 0, confidence: 0.92 })),
    };
}
{
    const feedback = (0, posture_feedback_engine_1.analyzePostureWindow)([{ capturedAt: 1000, result: { ...result(), hasPerson: false, landmarks: [] } }]);
    assert(feedback[0]?.status === 'cannot-judge', '사람이 없으면 자세를 추측하면 안 됩니다.');
}
{
    const samples = Array.from({ length: 8 }, (_, index) => ({ capturedAt: 1000 + index * 180, result: result() }));
    const feedback = (0, posture_feedback_engine_1.analyzePostureWindow)(samples);
    assert(feedback.some((item) => item.status === 'success'), '안정된 자세에는 잘한 점이 나와야 합니다.');
}
{
    const samples = Array.from({ length: 8 }, (_, index) => ({
        capturedAt: 1000 + index * 180,
        result: result({ leftShoulder: { x: 0.38, y: 0.25 }, rightShoulder: { x: 0.62, y: 0.42 } }),
    }));
    const feedback = (0, posture_feedback_engine_1.analyzePostureWindow)(samples);
    assert(feedback.some((item) => item.id === 'posture-shoulder-tilt'), '어깨 기울기를 구체적으로 지적해야 합니다.');
}
{
    const samples = Array.from({ length: 8 }, (_, index) => ({
        capturedAt: 1000 + index * 180,
        result: result({ leftHip: { x: 0.62, y: 0.70 }, rightHip: { x: 0.76, y: 0.70 } }),
    }));
    const feedback = (0, posture_feedback_engine_1.analyzePostureWindow)(samples);
    assert(feedback.some((item) => item.id === 'posture-torso-lean'), '상체 쏠림을 구체적으로 지적해야 합니다.');
}
console.log(`Posture feedback engine tests passed: ${checks}`);
