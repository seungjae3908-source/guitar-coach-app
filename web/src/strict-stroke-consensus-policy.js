export const STRICT_STROKE_MIN_GAP_MS = 240;
export const STRICT_RETURN_MIN_GAP_MS = 110;
export const STRICT_MOTION_AFTER_LANDMARK_SUPPRESSION_MS = 420;

function validDirection(direction) {
  return direction === 'down' || direction === 'up';
}

function opposite(direction) {
  return direction === 'down' ? 'up' : 'down';
}

export class StrictTargetStrokeConsensus {
  constructor({
    minimumTargetGapMs = STRICT_STROKE_MIN_GAP_MS,
    minimumReturnGapMs = STRICT_RETURN_MIN_GAP_MS,
    motionAfterLandmarkSuppressionMs = STRICT_MOTION_AFTER_LANDMARK_SUPPRESSION_MS,
  } = {}) {
    this.minimumTargetGapMs = minimumTargetGapMs;
    this.minimumReturnGapMs = minimumReturnGapMs;
    this.motionAfterLandmarkSuppressionMs = motionAfterLandmarkSuppressionMs;
    this.reset();
  }

  reset(target = 'none') {
    this.target = target;
    this.armed = true;
    this.lastCountAt = Number.NEGATIVE_INFINITY;
    this.lastLandmarkAt = Number.NEGATIVE_INFINITY;
    this.lastReturnAt = Number.NEGATIVE_INFINITY;
  }

  sample({ direction, source = 'landmark', target = 'none', timestamp = 0 } = {}) {
    const now = Number(timestamp) || 0;
    if (!validDirection(target) || !validDirection(direction)) {
      return { count: false, reason: 'inactive', rearmed: false };
    }

    if (target !== this.target) this.reset(target);
    if (source === 'landmark') this.lastLandmarkAt = now;

    if (direction === opposite(target)) {
      const returnGap = now - this.lastCountAt;
      if (!this.armed && returnGap >= this.minimumReturnGapMs) {
        this.armed = true;
        this.lastReturnAt = now;
        return { count: false, reason: 'verified-return', rearmed: true };
      }
      return { count: false, reason: 'return-too-soon', rearmed: false };
    }

    const sinceCount = now - this.lastCountAt;
    if (sinceCount < this.minimumTargetGapMs) {
      return { count: false, reason: 'same-stroke-duplicate', rearmed: false };
    }

    if (
      source === 'motion' &&
      now - this.lastLandmarkAt >= 0 &&
      now - this.lastLandmarkAt <= this.motionAfterLandmarkSuppressionMs
    ) {
      return { count: false, reason: 'landmark-already-covered', rearmed: false };
    }

    if (!this.armed) {
      return { count: false, reason: 'awaiting-verified-return', rearmed: false };
    }

    this.armed = false;
    this.lastCountAt = now;
    return {
      count: true,
      reason: source === 'motion' ? 'motion-fallback' : 'landmark-primary',
      rearmed: false,
    };
  }
}
