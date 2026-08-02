"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FOCUS_V8_MIN_EVIDENCE_FRAMES = exports.FOCUS_V8_SCREEN_ORDER = void 0;
exports.focusV8CameraSize = focusV8CameraSize;
exports.canShowFocusV8Coaching = canShowFocusV8Coaching;
exports.focusV8WaitingMessage = focusV8WaitingMessage;
exports.FOCUS_V8_SCREEN_ORDER = [
    'header',
    'mode-selector',
    'primary-action',
    'camera',
    'recognition-status',
    'feedback-scroll',
];
exports.FOCUS_V8_MIN_EVIDENCE_FRAMES = 12;
function focusV8CameraSize(viewportWidth, viewportHeight) {
    const safeWidth = Math.max(150, viewportWidth - 20);
    const availableHeight = Math.max(200, viewportHeight - 300);
    const widthFromHeight = Math.floor(availableHeight * 3 / 4);
    const width = Math.max(150, Math.min(safeWidth, widthFromHeight, 430));
    return {
        width,
        height: Math.round(width * 4 / 3),
    };
}
function canShowFocusV8Coaching(evidence) {
    return evidence.lessonRunning
        && evidence.calibrationReady
        && evidence.subjectLocked
        && evidence.acceptedFrames >= exports.FOCUS_V8_MIN_EVIDENCE_FRAMES;
}
function focusV8WaitingMessage(evidence, subjectLabel) {
    if (!evidence.calibrationReady)
        return '사운드홀과 브리지 촬영 보정이 필요합니다.';
    if (!evidence.lessonRunning)
        return `${subjectLabel} 관절만 추적 중입니다. 레슨 시작 전에는 평가하지 않습니다.`;
    if (!evidence.subjectLocked)
        return `${subjectLabel}을 연속 확인하는 중입니다. 아직 판정하지 않습니다.`;
    if (evidence.acceptedFrames < exports.FOCUS_V8_MIN_EVIDENCE_FRAMES) {
        return `현재 세션 증거 ${evidence.acceptedFrames}/${exports.FOCUS_V8_MIN_EVIDENCE_FRAMES} · 아직 판정하지 않습니다.`;
    }
    return '판정 근거가 준비되었습니다.';
}
