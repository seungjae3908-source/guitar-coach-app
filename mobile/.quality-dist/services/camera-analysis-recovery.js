"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cameraRecoveryDecision = cameraRecoveryDecision;
exports.initialAnalysisDelayMs = initialAnalysisDelayMs;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
function cameraRecoveryDecision(kind, consecutiveFailures, targetIntervalMs) {
    const failures = Math.max(1, Math.round(consecutiveFailures));
    if (kind === 'mount') {
        return {
            blocksPreview: true,
            retryDelayMs: clamp(700 * failures, 700, 2_800),
            message: '카메라 영상 연결에 실패했습니다.',
        };
    }
    const base = kind === 'capture' ? Math.max(420, targetIntervalMs) : Math.max(520, targetIntervalMs);
    return {
        blocksPreview: false,
        retryDelayMs: clamp(base * Math.pow(1.55, failures - 1), base, 2_400),
        message: kind === 'capture'
            ? '영상은 유지하고 분석 프레임을 다시 가져옵니다.'
            : '영상은 유지하고 AI 분석을 다시 시도합니다.',
    };
}
function initialAnalysisDelayMs(cameraReadyAt, now = Date.now()) {
    return Math.max(0, 900 - Math.max(0, now - cameraReadyAt));
}
