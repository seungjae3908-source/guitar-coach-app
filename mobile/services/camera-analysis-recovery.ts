export type CameraFailureKind = 'mount' | 'capture' | 'analysis';

export type CameraRecoveryDecision = {
  blocksPreview: boolean;
  retryDelayMs: number;
  message: string;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function cameraRecoveryDecision(
  kind: CameraFailureKind,
  consecutiveFailures: number,
  targetIntervalMs: number,
): CameraRecoveryDecision {
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

export function initialAnalysisDelayMs(cameraReadyAt: number, now = Date.now()) {
  return Math.max(0, 900 - Math.max(0, now - cameraReadyAt));
}


export const STRUM_LOCK_HOLD_MS = 850;

export function extendStrumLockUntil(
  currentUntil: number,
  capturedAt: number,
  hasStrumHit: boolean,
  holdMs = STRUM_LOCK_HOLD_MS,
) {
  if (!hasStrumHit) return currentUntil;
  return Math.max(currentUntil, capturedAt + Math.max(0, holdMs));
}

export function isStrumLockActive(lockUntil: number, capturedAt: number) {
  return capturedAt < lockUntil;
}
