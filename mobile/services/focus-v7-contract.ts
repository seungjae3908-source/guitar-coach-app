export const FOCUS_V7_SCREEN_ORDER = [
  'header',
  'mode-selector',
  'primary-action',
  'camera',
  'recognition-status',
  'feedback-scroll',
] as const;

export type FocusV7Evidence = {
  lessonRunning: boolean;
  handLocked: boolean;
  acceptedFrames: number;
  calibrationReady: boolean;
};

export function focusV7CameraHeight(viewportWidth: number, viewportHeight: number) {
  const portraitFourThree = Math.max(280, viewportWidth * 4 / 3);
  const available = Math.max(320, viewportHeight - 300);
  return Math.round(Math.min(portraitFourThree, available, viewportHeight * 0.62));
}

export function canShowFocusV7Coaching(evidence: FocusV7Evidence) {
  return evidence.lessonRunning
    && evidence.calibrationReady
    && evidence.handLocked
    && evidence.acceptedFrames >= 5;
}

export function focusV7WaitingMessage(evidence: FocusV7Evidence) {
  if (!evidence.calibrationReady) return '사운드홀과 브리지 촬영 보정이 필요합니다.';
  if (!evidence.lessonRunning) return '관절만 추적 중입니다. 레슨 시작 전에는 자세를 평가하지 않습니다.';
  if (!evidence.handLocked || evidence.acceptedFrames < 5) return '같은 오른손을 5프레임 연속 확인하는 중입니다. 아직 판정하지 않습니다.';
  return '판정 근거가 준비되었습니다.';
}
