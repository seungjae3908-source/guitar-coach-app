export const STROKE_MIN_TARGET_GAP_MS = 260;
export const STROKE_REARM_TIMEOUT_MS = 620;
export const MOTION_AFTER_LANDMARK_SUPPRESSION_MS = 320;

function validDirection(direction) {
  return direction === 'down' || direction === 'up';
}

function opposite(direction) {
  return direction === 'down' ? 'up' : 'down';
}

export class TargetStrokeConsensus {
  constructor({
    minimumTargetGapMs = STROKE_MIN_TARGET_GAP_MS,
    rearmTimeoutMs = STROKE_REARM_TIMEOUT_MS,
    motionAfterLandmarkSuppressionMs = MOTION_AFTER_LANDMARK_SUPPRESSION_MS,
  } = {}) {
    this.minimumTargetGapMs = minimumTargetGapMs;
    this.rearmTimeoutMs = rearmTimeoutMs;
    this.motionAfterLandmarkSuppressionMs = motionAfterLandmarkSuppressionMs;
    this.reset();
  }

  reset(target = 'none') {
    this.target = target;
    this.armed = true;
    this.lastCountAt = Number.NEGATIVE_INFINITY;
    this.lastLandmarkAt = Number.NEGATIVE_INFINITY;
    this.lastRecoveryAt = Number.NEGATIVE_INFINITY;
  }

  sample({ direction, source = 'landmark', target = 'none', timestamp = 0 } = {}) {
    const now = Number(timestamp) || 0;
    if (!validDirection(target) || !validDirection(direction)) {
      return { count: false, reason: 'inactive', rearmed: false };
    }

    if (target !== this.target) this.reset(target);
    if (source === 'landmark') this.lastLandmarkAt = now;

    if (direction === opposite(target)) {
      const changed = !this.armed;
      this.armed = true;
      this.lastRecoveryAt = now;
      return { count: false, reason: 'recovery', rearmed: changed };
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

    if (!this.armed && sinceCount < this.rearmTimeoutMs) {
      return { count: false, reason: 'awaiting-return', rearmed: false };
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

export class SegmentDirectionalTracker {
  constructor({
    cooldownMs = 210,
    maximumCrossingMs = 720,
    maximumSampleGapMs = 380,
    minimumTravel = 0.02,
    partialTravel = 0.012,
    bandMargin = 0.006,
  } = {}) {
    this.cooldownMs = cooldownMs;
    this.maximumCrossingMs = maximumCrossingMs;
    this.maximumSampleGapMs = maximumSampleGapMs;
    this.minimumTravel = minimumTravel;
    this.partialTravel = partialTravel;
    this.bandMargin = bandMargin;
    this.reset();
  }

  reset() {
    this.start = null;
    this.lastProjection = null;
    this.lastAt = 0;
    this.lastEventAt = Number.NEGATIVE_INFINITY;
  }

  sample({ point, band, timestamp, ready = true } = {}) {
    if (!ready || !point || !band) {
      this.start = null;
      this.lastProjection = null;
      this.lastAt = 0;
      return null;
    }

    const now = Number(timestamp) || 0;
    const projection = band.normalX * point.x + band.normalY * point.y;
    const top = Math.min(band.top, band.bottom) - this.bandMargin;
    const bottom = Math.max(band.top, band.bottom) + this.bandMargin;
    const previous = this.lastProjection;
    const previousAt = this.lastAt;
    const gap = previousAt ? now - previousAt : Number.POSITIVE_INFINITY;

    if (gap > this.maximumSampleGapMs) this.start = null;
    if (this.start && now - this.start.at > this.maximumCrossingMs) this.start = null;

    let event = null;
    const canEmit = now - this.lastEventAt >= this.cooldownMs;
    if (previous != null && gap <= this.maximumSampleGapMs && canEmit) {
      const travel = projection - previous;
      const previousInside = previous > top && previous < bottom;
      const crossedDown = previous <= top && projection >= bottom && travel >= this.minimumTravel;
      const crossedUp = previous >= bottom && projection <= top && -travel >= this.minimumTravel;
      const exitedDown = previousInside && projection >= bottom && travel >= this.partialTravel;
      const exitedUp = previousInside && projection <= top && -travel >= this.partialTravel;
      if (crossedDown || exitedDown) event = 'down';
      else if (crossedUp || exitedUp) event = 'up';
    }

    if (!event) {
      if (!this.start && (projection <= top || projection >= bottom)) {
        this.start = {
          projection,
          at: now,
          side: projection <= top ? 'top' : 'bottom',
        };
      } else if (this.start && canEmit) {
        if (
          this.start.side === 'top' &&
          projection >= bottom &&
          projection - this.start.projection >= this.minimumTravel
        ) {
          event = 'down';
        } else if (
          this.start.side === 'bottom' &&
          projection <= top &&
          this.start.projection - projection >= this.minimumTravel
        ) {
          event = 'up';
        }
      }
    }

    this.lastProjection = projection;
    this.lastAt = now;
    if (event) {
      this.start = null;
      this.lastEventAt = now;
    }
    return event;
  }
}
