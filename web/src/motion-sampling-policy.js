export const HAND_SAMPLE_INTERVAL_MS = 180;
export const MOTION_SAMPLE_INTERVAL_MS = 30;
export const POSE_SAMPLE_INTERVAL_MS = 700;
export const LOCAL_MOTION_ANCHOR_RADIUS = 0.18;

export function motionConfidenceThreshold(anchorPoint) {
  return anchorPoint ? 0.11 : 0.18;
}

export function isLocalMotionReady({ confidence = 0, handRecent = false, anchorPoint = null } = {}) {
  return Boolean(handRecent) && Number(confidence) >= motionConfidenceThreshold(anchorPoint);
}
