export const STROKE_MIN_TARGET_GAP_MS = 220;
export const STROKE_REARM_TIMEOUT_MS = 620;
export const MOTION_AFTER_LANDMARK_SUPPRESSION_MS = 300;

function validDirection(direction) {
  return direction === 'down' || direction === 'up';
}

function opposite(direction) {
  return direction === 'down' ? 'up' : 'down';
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
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
    cooldownMs = 190,
    maximumCrossingMs = 900,
    maximumSampleGapMs = 420,
    minimumTravel = 0.018,
    partialTravel = 0.01,
    minimumCenterTravel = 0.012,
    centerDeadZoneRatio = 0.04,
    minimumCenterDeadZone = 0.0035,
    maximumCenterDeadZone = 0.007,
    bandMargin = 0.006,
  } = {}) {
    this.cooldownMs = cooldownMs;
    this.maximumCrossingMs = maximumCrossingMs;
    this.maximumSampleGapMs = maximumSampleGapMs;
    this.minimumTravel = minimumTravel;
    this.partialTravel = partialTravel;
    this.minimumCenterTravel = minimumCenterTravel;
    this.centerDeadZoneRatio = centerDeadZoneRatio;
    this.minimumCenterDeadZone = minimumCenterDeadZone;
    this.maximumCenterDeadZone = maximumCenterDeadZone;
    this.bandMargin = bandMargin;
    this.reset();
  }

  reset() {
    this.centerStart = null;
    this.lastProjection = null;
    this.lastAt = null;
    this.lastEventAt = Number.NEGATIVE_INFINITY;
  }

  clearCrossingState() {
    this.centerStart = null;
  }

  sample({ point, band, timestamp, ready = true } = {}) {
    if (!ready || !point || !band) {
      this.clearCrossingState();
      this.lastProjection = null;
      this.lastAt = null;
      return null;
    }

    const now = Number(timestamp) || 0;
    const projection = band.normalX * point.x + band.normalY * point.y;
    const top = Math.min(band.top, band.bottom) - this.bandMargin;
    const bottom = Math.max(band.top, band.bottom) + this.bandMargin;
    const center = (top + bottom) / 2;
    const bandWidth = Math.max(0.001, bottom - top);
    const centerDeadZone = clamp(
      bandWidth * this.centerDeadZoneRatio,
      this.minimumCenterDeadZone,
      this.maximumCenterDeadZone,
    );
    const centerTop = center - centerDeadZone;
    const centerBottom = center + centerDeadZone;
    const currentSide =
      projection <= centerTop ? 'top' : projection >= centerBottom ? 'bottom' : 'center';
    const previous = this.lastProjection;
    const previousAt = this.lastAt;
    const gap = previousAt != null ? now - previousAt : Number.POSITIVE_INFINITY;

    if (gap > this.maximumSampleGapMs) this.clearCrossingState();
    if (this.centerStart && now - this.centerStart.at > this.maximumCrossingMs) {
      this.clearCrossingState();
    }

    let event = null;
    const canEmit = now - this.lastEventAt >= this.cooldownMs;

    if (previous != null && gap <= this.maximumSampleGapMs && canEmit) {
      const travel = projection - previous;
      const previousInside = previous > top && previous < bottom;
      const crossedDown = previous <= top && projection >= bottom && travel >= this.minimumTravel;
      const crossedUp = previous >= bottom && projection <= top && -travel >= this.minimumTravel;
      const exitedDown = previousInside && projection >= bottom && travel >= this.partialTravel;
      const exitedUp = previousInside && projection <= top && -travel >= this.partialTravel;
      const crossedCenterDown =
        previous <= centerTop &&
        projection >= centerBottom &&
        travel >= this.minimumCenterTravel;
      const crossedCenterUp =
        previous >= centerBottom &&
        projection <= centerTop &&
        -travel >= this.minimumCenterTravel;

      if (crossedDown || exitedDown || crossedCenterDown) event = 'down';
      else if (crossedUp || exitedUp || crossedCenterUp) event = 'up';
    }

    if (!event && canEmit) {
      if (!this.centerStart && currentSide !== 'center') {
        this.centerStart = { projection, at: now, side: currentSide };
      } else if (this.centerStart && currentSide === this.centerStart.side) {
        const isMoreExtreme =
          (currentSide === 'top' && projection < this.centerStart.projection) ||
          (currentSide === 'bottom' && projection > this.centerStart.projection);
        if (isMoreExtreme) this.centerStart.projection = projection;
      } else if (this.centerStart && currentSide !== 'center') {
        const totalTravel = projection - this.centerStart.projection;
        if (
          this.centerStart.side === 'top' &&
          currentSide === 'bottom' &&
          totalTravel >= this.minimumCenterTravel
        ) {
          event = 'down';
        } else if (
          this.centerStart.side === 'bottom' &&
          currentSide === 'top' &&
          -totalTravel >= this.minimumCenterTravel
        ) {
          event = 'up';
        } else {
          this.centerStart = { projection, at: now, side: currentSide };
        }
      }
    }

    this.lastProjection = projection;
    this.lastAt = now;
    if (event) {
      this.centerStart =
        currentSide === 'center' ? null : { projection, at: now, side: currentSide };
      this.lastEventAt = now;
    }
    return event;
  }
}
