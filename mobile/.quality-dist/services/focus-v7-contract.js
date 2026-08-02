"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FOCUS_V7_SCREEN_ORDER = void 0;
exports.focusV7CameraHeight = focusV7CameraHeight;
exports.canShowFocusV7Coaching = canShowFocusV7Coaching;
exports.focusV7WaitingMessage = focusV7WaitingMessage;
exports.FOCUS_V7_SCREEN_ORDER = [
    'header',
    'mode-selector',
    'primary-action',
    'camera',
    'recognition-status',
    'feedback-scroll',
];
function focusV7CameraHeight(viewportWidth, viewportHeight) {
    const portraitFourThree = Math.max(280, viewportWidth * 4 / 3);
    const availableAfterControls = Math.max(320, viewportHeight - 350);
    return Math.round(Math.min(portraitFourThree, availableAfterControls, viewportHeight * 0.58));
}
function canShowFocusV7Coaching(evidence) {
    return evidence.lessonRunning
        && evidence.calibrationReady
        && evidence.handLocked
        && evidence.acceptedFrames >= 5;
}
function focusV7WaitingMessage(evidence) {
    if (!evidence.calibrationReady)
        return '사운드홀과 브리지 촬영 보정이 필요합니다.';
    if (!evidence.lessonRunning)
        return '관절만 추적 중입니다. 레슨 시작 전에는 자세를 평가하지 않습니다.';
    if (!evidence.handLocked || evidence.acceptedFrames < 5)
        return '같은 오른손을 5프레임 연속 확인하는 중입니다. 아직 판정하지 않습니다.';
    return '판정 근거가 준비되었습니다.';
}
