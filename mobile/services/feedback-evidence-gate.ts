export const MIN_VISUAL_EVIDENCE_FRAMES = 12;
export const MIN_AUDIO_EVIDENCE_CYCLES = 2;
export const MIN_AUDIO_EVIDENCE_ATTACKS = 8;

export function visualFeedbackReady({
  running,
  acceptedFrames,
  sessionStartedAt,
}: {
  running: boolean;
  acceptedFrames: number;
  sessionStartedAt: number | null;
}) {
  return running
    && Boolean(sessionStartedAt && sessionStartedAt > 0)
    && acceptedFrames >= MIN_VISUAL_EVIDENCE_FRAMES;
}

export function audioFeedbackReady({
  microphoneActive,
  completedCycles,
  acceptedAttacks,
}: {
  microphoneActive: boolean;
  completedCycles: number;
  acceptedAttacks: number;
}) {
  return microphoneActive
    && completedCycles >= MIN_AUDIO_EVIDENCE_CYCLES
    && acceptedAttacks >= MIN_AUDIO_EVIDENCE_ATTACKS;
}
