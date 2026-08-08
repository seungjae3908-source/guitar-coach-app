import { clamp, projectPointAlongBand, projectPointToBand } from './vision-logic.js';

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function median(values = []) {
  const usable = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!usable.length) return null;
  const sorted = usable.sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function distance(left, right) {
  if (!left || !right) return Infinity;
  return Math.hypot(finite(left.x) - finite(right.x), finite(left.y) - finite(right.y));
}

function interpolate(left, right, alpha) {
  return finite(left) + (finite(right) - finite(left)) * clamp(alpha);
}

function normalizedAngleDelta(left, right) {
  let delta = finite(right) - finite(left);
  while (delta > 90) delta -= 180;
  while (delta < -90) delta += 180;
  return delta;
}

function validPoint(point) {
  return point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y));
}

export function estimateStrumContactPoint(landmarks = []) {
  const thumbTip = landmarks?.[4];
  const thumbIp = landmarks?.[3];
  const indexTip = landmarks?.[8];
  const indexDip = landmarks?.[7];
  const indexMcp = landmarks?.[5];
  const pinkyMcp = landmarks?.[17];
  const wrist = landmarks?.[0];

  if (validPoint(thumbTip) && validPoint(indexTip)) {
    const palmScale = median([
      distance(wrist, indexMcp),
      distance(indexMcp, pinkyMcp),
      distance(wrist, pinkyMcp),
    ]) || 0.12;
    const pinchDistance = distance(thumbTip, indexTip);
    const pinchRatio = pinchDistance / Math.max(0.035, palmScale);
    const center = {
      x: (finite(thumbTip.x) + finite(indexTip.x)) / 2,
      y: (finite(thumbTip.y) + finite(indexTip.y)) / 2,
      z: (finite(thumbTip.z) + finite(indexTip.z)) / 2,
    };

    const palmPoints = [wrist, indexMcp, pinkyMcp].filter(validPoint);
    const palmCenter = palmPoints.reduce((sum, point) => ({
      x: sum.x + finite(point.x),
      y: sum.y + finite(point.y),
    }), { x: 0, y: 0 });
    if (palmPoints.length) {
      palmCenter.x /= palmPoints.length;
      palmCenter.y /= palmPoints.length;
    } else {
      palmCenter.x = center.x;
      palmCenter.y = center.y;
    }

    const outwardX = center.x - palmCenter.x;
    const outwardY = center.y - palmCenter.y;
    const outwardLength = Math.hypot(outwardX, outwardY);
    const extension = pinchRatio <= 0.72 ? clamp(palmScale * 0.08, 0, 0.018) : 0;
    const quality = clamp(
      0.42
      + (validPoint(thumbIp) ? 0.1 : 0)
      + (validPoint(indexDip) ? 0.1 : 0)
      + clamp(1 - pinchRatio / 1.8) * 0.38,
    );

    return {
      x: clamp(center.x + (outwardLength > 0.001 ? outwardX / outwardLength * extension : 0)),
      y: clamp(center.y + (outwardLength > 0.001 ? outwardY / outwardLength * extension : 0)),
      z: center.z,
      source: pinchRatio <= 0.72 ? 'thumb-index-pick' : 'thumb-index-open',
      quality,
      pinchRatio,
      palmScale,
    };
  }

  const fallback = indexTip || thumbTip || landmarks?.[12] || wrist;
  return validPoint(fallback) ? {
    x: clamp(finite(fallback.x)),
    y: clamp(finite(fallback.y)),
    z: finite(fallback.z),
    source: indexTip ? 'index-tip-fallback' : 'fallback',
    quality: indexTip ? 0.46 : 0.28,
    pinchRatio: Infinity,
    palmScale: 0,
  } : null;
}

class AdaptiveContactFilter {
  constructor() {
    this.reset();
  }

  reset() {
    this.filtered = null;
    this.lastRaw = null;
    this.lastAt = 0;
    this.samples = [];
    this.jitter = 0;
    this.confidence = 0;
  }

  update(point, timestamp) {
    if (!validPoint(point)) {
      this.confidence *= 0.7;
      return null;
    }
    const now = finite(timestamp);
    const dt = this.lastAt ? Math.max(0.016, Math.min(0.35, (now - this.lastAt) / 1000)) : 0.05;
    const rawJump = this.lastRaw ? distance(point, this.lastRaw) : 0;
    const maximumPlausibleJump = 0.075 + dt * 2.7;
    if (this.lastRaw && rawJump > maximumPlausibleJump) {
      this.confidence *= 0.55;
      return this.filtered ? { ...this.filtered, stable: false, filterConfidence: this.confidence, rawPoint: point } : null;
    }

    this.samples.push({ x: finite(point.x), y: finite(point.y), z: finite(point.z), quality: finite(point.quality, 0.35) });
    this.samples = this.samples.slice(-5);
    const robust = {
      x: median(this.samples.map((sample) => sample.x)),
      y: median(this.samples.map((sample) => sample.y)),
      z: median(this.samples.map((sample) => sample.z)),
    };
    const speed = this.filtered ? distance(robust, this.filtered) / dt : 0;
    const alpha = clamp(0.18 + speed * 0.34, 0.18, 0.82);
    const next = this.filtered ? {
      x: interpolate(this.filtered.x, robust.x, alpha),
      y: interpolate(this.filtered.y, robust.y, alpha),
      z: interpolate(this.filtered.z, robust.z, alpha),
    } : robust;
    const residual = distance(point, next);
    this.jitter = this.jitter * 0.72 + residual * 0.28;
    const sourceQuality = finite(point.quality, 0.35);
    const jitterScore = clamp(1 - this.jitter / 0.035);
    this.confidence = clamp(this.confidence * 0.58 + (sourceQuality * 0.68 + jitterScore * 0.32) * 0.42);
    this.filtered = next;
    this.lastRaw = point;
    this.lastAt = now;
    return {
      ...point,
      ...next,
      rawPoint: point,
      jitter: this.jitter,
      filterConfidence: this.confidence,
      stable: this.samples.length >= 3 && this.confidence >= 0.48,
    };
  }
}

function pointFromBandCoordinates(normal, tangent, band) {
  return {
    x: clamp(finite(band?.normalX) * normal + finite(band?.tangentX, 1) * tangent),
    y: clamp(finite(band?.normalY, 1) * normal + finite(band?.tangentY) * tangent),
  };
}

export function buildStrumGuide(band, anchorTangent = null) {
  if (!band) return null;
  const top = finite(band.top, NaN);
  const bottom = finite(band.bottom, NaN);
  const supportMin = finite(band.supportMin, NaN);
  const supportMax = finite(band.supportMax, NaN);
  if (![top, bottom, supportMin, supportMax].every(Number.isFinite) || bottom <= top || supportMax <= supportMin) return null;

  const bandWidth = Math.max(0.02, bottom - top);
  const supportLength = supportMax - supportMin;
  const calibrated = Number.isFinite(Number(anchorTangent));
  const desiredHalfWidth = calibrated
    ? clamp(supportLength * 0.16, 0.052, 0.095)
    : clamp(supportLength * 0.36, 0.11, 0.19);
  const halfWidth = Math.min(desiredHalfWidth, Math.max(0.035, supportLength * 0.46));
  const defaultCenter = (supportMin + supportMax) / 2;
  const tangentCenter = clamp(
    calibrated ? Number(anchorTangent) : defaultCenter,
    supportMin + halfWidth,
    supportMax - halfWidth,
  );
  const normalPadding = clamp(Math.max(0.055, bandWidth * 1.2), 0.055, 0.145);
  const normalMin = top - normalPadding;
  const normalMax = bottom + normalPadding;
  const tangentMin = tangentCenter - halfWidth;
  const tangentMax = tangentCenter + halfWidth;

  return {
    ready: supportLength >= 0.2 && band.stable !== false,
    calibrated,
    normalMin,
    normalMax,
    tangentMin,
    tangentMax,
    tangentCenter,
    halfWidth,
    top,
    bottom,
    bandWidth,
    supportLength,
    stability: finite(band.stability, band.stable === false ? 0 : 1),
    polygon: [
      pointFromBandCoordinates(normalMin, tangentMin, band),
      pointFromBandCoordinates(normalMin, tangentMax, band),
      pointFromBandCoordinates(normalMax, tangentMax, band),
      pointFromBandCoordinates(normalMax, tangentMin, band),
    ],
    topGate: [pointFromBandCoordinates(top, tangentMin, band), pointFromBandCoordinates(top, tangentMax, band)],
    bottomGate: [pointFromBandCoordinates(bottom, tangentMin, band), pointFromBandCoordinates(bottom, tangentMax, band)],
    centerLine: [pointFromBandCoordinates(normalMin, tangentCenter, band), pointFromBandCoordinates(normalMax, tangentCenter, band)],
  };
}

export function evaluateStrumGuidePoint(point, band, guide) {
  if (!point || !band || !guide) {
    return { ready: false, inside: false, lateralInside: false, normalInside: false, zone: 'unknown', lateralOffset: Infinity, lateralRatio: Infinity };
  }
  const normal = projectPointToBand(point, band);
  const tangent = projectPointAlongBand(point, band);
  if (normal == null || tangent == null) {
    return { ready: false, inside: false, lateralInside: false, normalInside: false, zone: 'unknown', lateralOffset: Infinity, lateralRatio: Infinity };
  }
  const lateralOffset = Math.abs(tangent - guide.tangentCenter);
  const lateralInside = tangent >= guide.tangentMin && tangent <= guide.tangentMax;
  const normalInside = normal >= guide.normalMin && normal <= guide.normalMax;
  const zone = normal < guide.top ? 'above' : normal > guide.bottom ? 'below' : 'strings';
  return {
    ready: Boolean(guide.ready),
    inside: Boolean(guide.ready && lateralInside && normalInside),
    lateralInside,
    normalInside,
    normal,
    tangent,
    zone,
    lateralOffset,
    lateralRatio: lateralOffset / Math.max(0.001, guide.halfWidth),
  };
}

export class StrumGuideCalibrator {
  constructor({ requiredSamples = 7 } = {}) {
    this.requiredSamples = requiredSamples;
    this.reset();
  }

  reset() {
    this.anchorRatio = null;
    this.samples = [];
    this.lastAngle = null;
    this.confidence = 0;
  }

  anchorFor(band) {
    if (this.anchorRatio == null || !band) return null;
    const supportMin = finite(band.supportMin, NaN);
    const supportLength = finite(band.supportLength, finite(band.supportMax) - supportMin);
    if (!Number.isFinite(supportMin) || !(supportLength > 0)) return null;
    return supportMin + clamp(this.anchorRatio) * supportLength;
  }

  guideFor(band) {
    const guide = buildStrumGuide(band, this.anchorFor(band));
    if (guide) guide.calibrationConfidence = this.confidence;
    return guide;
  }

  observe(point, band, { force = false } = {}) {
    if (!point || !band || finite(band.supportLength) < 0.2 || band.stable === false) return this.guideFor(band);
    const angle = finite(band.angle);
    if (this.lastAngle != null && Math.abs(normalizedAngleDelta(this.lastAngle, angle)) > 10) this.reset();
    this.lastAngle = angle;

    const tangent = projectPointAlongBand(point, band);
    const normal = projectPointToBand(point, band);
    const supportMin = finite(band.supportMin, -Infinity);
    const supportMax = finite(band.supportMax, Infinity);
    const supportLength = supportMax - supportMin;
    const normalAllowance = Math.max(0.16, Math.abs(finite(band.bottom) - finite(band.top)) * 3.2);
    if (tangent == null || normal == null || !(supportLength > 0) || tangent < supportMin || tangent > supportMax || Math.abs(normal - finite(band.center, normal)) > normalAllowance) {
      return this.guideFor(band);
    }

    const ratio = clamp((tangent - supportMin) / supportLength);
    if (force && this.anchorRatio == null) {
      this.anchorRatio = ratio;
      this.samples = [ratio];
      this.confidence = 0.72;
      return this.guideFor(band);
    }
    if (this.anchorRatio == null) {
      this.samples.push(ratio);
      this.samples = this.samples.slice(-Math.max(this.requiredSamples, 14));
      if (this.samples.length >= this.requiredSamples) {
        const center = median(this.samples);
        const spread = median(this.samples.map((sample) => Math.abs(sample - center))) || 0;
        if (spread <= 0.09) {
          this.anchorRatio = center;
          this.confidence = clamp(0.88 - spread * 3.2, 0.56, 0.9);
        }
      }
    }
    return this.guideFor(band);
  }
}

export class StringBandStabilizer {
  constructor({ smoothing = 0.28, confirmationFrames = 2, holdMs = 520 } = {}) {
    this.smoothing = smoothing;
    this.confirmationFrames = confirmationFrames;
    this.holdMs = holdMs;
    this.reset();
  }

  reset() {
    this.current = null;
    this.pending = null;
    this.pendingCount = 0;
    this.lastGoodAt = 0;
    this.acceptedFrames = 0;
  }

  isValid(result) {
    const band = result?.band;
    return Boolean(band
      && Number.isFinite(Number(band.top))
      && Number.isFinite(Number(band.bottom))
      && finite(band.bottom) > finite(band.top)
      && finite(band.supportLength) >= 0.18
      && finite(result.count) >= 4
      && finite(result.confidence) >= 0.28);
  }

  discontinuity(left, right) {
    if (!left || !right) return Infinity;
    const leftWidth = Math.max(0.02, finite(left.bottom) - finite(left.top));
    const rightWidth = Math.max(0.02, finite(right.bottom) - finite(right.top));
    const centerShift = Math.abs(finite(left.center) - finite(right.center));
    const supportCenterShift = Math.abs(
      (finite(left.supportMin) + finite(left.supportMax)) / 2
      - (finite(right.supportMin) + finite(right.supportMax)) / 2,
    );
    const widthChange = Math.abs(rightWidth - leftWidth) / Math.max(leftWidth, rightWidth);
    const angleChange = Math.abs(normalizedAngleDelta(left.angle, right.angle));
    return Math.max(centerShift / Math.max(0.035, leftWidth * 0.9), supportCenterShift / 0.11, widthChange / 0.55, angleChange / 11);
  }

  smoothBand(previous, next) {
    const alpha = clamp(this.smoothing + this.discontinuity(previous, next) * 0.08, 0.2, 0.46);
    const angle = finite(previous.angle) + normalizedAngleDelta(previous.angle, next.angle) * alpha;
    const radians = angle * Math.PI / 180;
    return {
      ...next,
      top: interpolate(previous.top, next.top, alpha),
      bottom: interpolate(previous.bottom, next.bottom, alpha),
      center: interpolate(previous.center, next.center, alpha),
      supportMin: interpolate(previous.supportMin, next.supportMin, alpha),
      supportMax: interpolate(previous.supportMax, next.supportMax, alpha),
      supportLength: interpolate(previous.supportLength, next.supportLength, alpha),
      angle,
      tangentX: Math.cos(radians),
      tangentY: Math.sin(radians),
      normalX: -Math.sin(radians),
      normalY: Math.cos(radians),
    };
  }

  update(result, timestamp) {
    const now = finite(timestamp);
    if (!this.isValid(result)) {
      if (this.current && now - this.lastGoodAt <= this.holdMs) {
        return {
          ...this.current.result,
          confidence: finite(this.current.result.confidence) * 0.82,
          band: { ...this.current.band, stable: false, stability: 0.25, held: true, ageMs: now - this.lastGoodAt },
        };
      }
      this.pending = null;
      this.pendingCount = 0;
      return { count: 0, confidence: 0, rows: [], lines: [], angle: 0, band: null };
    }

    const candidateBand = result.band;
    if (!this.current) {
      this.current = { result, band: { ...candidateBand } };
      this.lastGoodAt = now;
      this.acceptedFrames = 1;
      return { ...result, band: { ...candidateBand, stable: false, stability: 0.42, held: false, ageMs: 0 } };
    }

    const jump = this.discontinuity(this.current.band, candidateBand);
    if (jump > 1) {
      const pendingJump = this.pending ? this.discontinuity(this.pending.band, candidateBand) : Infinity;
      if (!this.pending || pendingJump > 0.62) {
        this.pending = { result, band: { ...candidateBand } };
        this.pendingCount = 1;
      } else {
        this.pending = { result, band: this.smoothBand(this.pending.band, candidateBand) };
        this.pendingCount += 1;
      }
      if (this.pendingCount < this.confirmationFrames) {
        return {
          ...this.current.result,
          band: { ...this.current.band, stable: false, stability: 0.36, held: true, ageMs: now - this.lastGoodAt },
        };
      }
      this.current = this.pending;
      this.pending = null;
      this.pendingCount = 0;
      this.acceptedFrames = 1;
    } else {
      this.current = {
        result,
        band: this.smoothBand(this.current.band, candidateBand),
      };
      this.pending = null;
      this.pendingCount = 0;
      this.acceptedFrames += 1;
    }

    this.lastGoodAt = now;
    const stability = clamp(0.45 + this.acceptedFrames * 0.12 - jump * 0.18, 0.35, 1);
    const stable = this.acceptedFrames >= 3 && stability >= 0.62;
    const output = {
      ...result,
      angle: this.current.band.angle,
      band: { ...this.current.band, stable, stability, held: false, ageMs: 0 },
    };
    this.current.result = output;
    return output;
  }
}

export class StrictDirectionalStrumTracker {
  constructor({
    minimumTravel = 0.05,
    cooldownMs = 190,
    maximumCrossingMs = 900,
    maximumFrameJump = 0.18,
    minimumStrokeMs = 65,
    sideConfirmSamples = 2,
    minimumBandSamples = 2,
    minimumMonotonicity = 0.76,
  } = {}) {
    this.minimumTravel = minimumTravel;
    this.cooldownMs = cooldownMs;
    this.maximumCrossingMs = maximumCrossingMs;
    this.maximumFrameJump = maximumFrameJump;
    this.minimumStrokeMs = minimumStrokeMs;
    this.sideConfirmSamples = sideConfirmSamples;
    this.minimumBandSamples = minimumBandSamples;
    this.minimumMonotonicity = minimumMonotonicity;
    this.reset();
  }

  reset() {
    this.lastEventAt = -Infinity;
    this.lastDirection = 'none';
    this.lastProjection = null;
    this.lastTangent = null;
    this.lastSampleAt = 0;
    this.pendingSide = null;
    this.pendingSideCount = 0;
    this.armed = null;
    this.lastRejectReason = '';
    this.lastEventDetail = null;
  }

  resetTransient(reason = '') {
    this.lastProjection = null;
    this.lastTangent = null;
    this.lastSampleAt = 0;
    this.pendingSide = null;
    this.pendingSideCount = 0;
    this.armed = null;
    this.lastRejectReason = reason;
  }

  arm(side, projection, tangent, now) {
    this.armed = {
      side,
      at: now,
      startProjection: projection,
      startTangent: tangent,
      enteredBandSamples: 0,
      maximumLateralRatio: 0,
      forwardTravel: 0,
      reverseTravel: 0,
      reversals: 0,
      lastDeltaSign: 0,
      tangentSamples: [tangent],
      sampleCount: 1,
    };
  }

  sample({ timestamp, point, band, guide, ready }) {
    const status = evaluateStrumGuidePoint(point, band, guide);
    const pointStable = point?.stable !== false && finite(point?.filterConfidence, 1) >= 0.42;
    if (!ready || !status.ready || status.normal == null || status.tangent == null || !pointStable) {
      this.resetTransient(!pointStable ? 'contact-unstable' : 'evidence-not-ready');
      return null;
    }
    if (!status.lateralInside || !status.normalInside) {
      this.resetTransient('outside-guide');
      return null;
    }

    const now = finite(timestamp);
    const projection = status.normal;
    const previous = this.lastProjection;
    const previousTangent = this.lastTangent;
    const previousAt = this.lastSampleAt;
    this.lastProjection = projection;
    this.lastTangent = status.tangent;
    this.lastSampleAt = now;

    if (previous != null) {
      const elapsed = now - previousAt;
      const normalJump = Math.abs(projection - previous);
      const tangentJump = Math.abs(status.tangent - previousTangent);
      if (elapsed <= 0 || elapsed > 300 || normalJump > this.maximumFrameJump || tangentJump > Math.max(0.12, finite(guide?.halfWidth) * 1.2)) {
        this.resetTransient('discontinuous-sample');
        this.lastProjection = projection;
        this.lastTangent = status.tangent;
        this.lastSampleAt = now;
        return null;
      }
    }

    if (this.armed) {
      const expectedSign = this.armed.side === 'above' ? 1 : -1;
      const delta = previous == null ? 0 : projection - previous;
      const noiseFloor = Math.max(0.0018, finite(guide?.bandWidth) * 0.025);
      if (Math.abs(delta) > noiseFloor) {
        const sign = Math.sign(delta);
        if (sign === expectedSign) this.armed.forwardTravel += Math.abs(delta);
        else this.armed.reverseTravel += Math.abs(delta);
        if (this.armed.lastDeltaSign && sign !== this.armed.lastDeltaSign) this.armed.reversals += 1;
        this.armed.lastDeltaSign = sign;
      }
      this.armed.maximumLateralRatio = Math.max(this.armed.maximumLateralRatio, status.lateralRatio);
      this.armed.tangentSamples.push(status.tangent);
      this.armed.tangentSamples = this.armed.tangentSamples.slice(-28);
      this.armed.sampleCount += 1;
      if (status.zone === 'strings') this.armed.enteredBandSamples += 1;
      const reverseLimit = Math.max(0.012, finite(guide?.bandWidth) * 0.28);
      if (this.armed.reverseTravel > reverseLimit || this.armed.reversals > 4) {
        this.resetTransient('reversal-excess');
        return null;
      }
      if (now - this.armed.at > this.maximumCrossingMs) {
        this.resetTransient('crossing-timeout');
        return null;
      }
    }

    const side = status.zone === 'above' || status.zone === 'below' ? status.zone : null;
    if (!side) {
      this.pendingSide = null;
      this.pendingSideCount = 0;
      return null;
    }

    if (this.pendingSide === side) this.pendingSideCount += 1;
    else {
      this.pendingSide = side;
      this.pendingSideCount = 1;
    }
    if (this.pendingSideCount < this.sideConfirmSamples) return null;

    if (!this.armed) {
      this.arm(side, projection, status.tangent, now);
      return null;
    }
    if (this.armed.side === side) return null;

    const completed = this.armed;
    const duration = now - completed.at;
    const travel = Math.abs(projection - completed.startProjection);
    const requiredTravel = Math.max(this.minimumTravel, finite(guide?.bandWidth) * 1.02);
    const totalDirectionalTravel = completed.forwardTravel + completed.reverseTravel;
    const monotonicity = completed.forwardTravel / Math.max(0.001, totalDirectionalTravel);
    const speed = travel / Math.max(0.001, duration / 1000);
    const direction = completed.side === 'above' && side === 'below' ? 'down' : 'up';
    const accepted = completed.enteredBandSamples >= this.minimumBandSamples
      && duration >= this.minimumStrokeMs
      && duration <= this.maximumCrossingMs
      && travel >= requiredTravel
      && completed.forwardTravel >= requiredTravel * 0.78
      && monotonicity >= this.minimumMonotonicity
      && completed.maximumLateralRatio <= 0.98
      && speed >= 0.08
      && speed <= 3.8
      && now - this.lastEventAt >= this.cooldownMs;

    this.arm(side, projection, status.tangent, now);
    if (!accepted) {
      this.lastRejectReason = completed.enteredBandSamples < this.minimumBandSamples
        ? 'insufficient-band-samples'
        : monotonicity < this.minimumMonotonicity
          ? 'non-monotonic-crossing'
          : 'incomplete-crossing';
      return null;
    }
    this.lastEventAt = now;
    this.lastDirection = direction;
    this.lastRejectReason = '';
    this.lastEventDetail = {
      direction,
      duration,
      travel,
      speed,
      monotonicity,
      reversals: completed.reversals,
      bandSamples: completed.enteredBandSamples,
      tangent: median(completed.tangentSamples),
      lateralRatio: completed.maximumLateralRatio,
    };
    return direction;
  }
}

export class GuidedHandRoleResolver {
  constructor() {
    this.reset();
  }

  reset() {
    this.tracks = [];
    this.nextId = 1;
    this.selectedId = null;
  }

  update({ timestamp, hands = [], band = null, guide = null, ready = false } = {}) {
    const now = finite(timestamp);
    this.tracks = this.tracks.filter((track) => now - track.lastSeenAt <= 1200);
    const unusedTracks = new Set(this.tracks);
    const assigned = [];

    for (const hand of hands.slice(0, 2)) {
      let best = null;
      let bestCost = Infinity;
      for (const track of unusedTracks) {
        const wristDistance = distance(track.wrist, hand.wrist || hand.landmarks?.[0]);
        const handednessPenalty = track.handedness && hand.handedness && track.handedness !== hand.handedness ? 0.12 : 0;
        const candidateCost = wristDistance + handednessPenalty;
        if (candidateCost < bestCost) {
          best = track;
          bestCost = candidateCost;
        }
      }
      if (!best || bestCost > 0.27) {
        best = {
          id: this.nextId++,
          wrist: null,
          handedness: null,
          lastProjection: null,
          lastTangent: null,
          lastSeenAt: now,
          score: 0,
          candidateFrames: 0,
          tracker: new StrictDirectionalStrumTracker(),
          contactFilter: new AdaptiveContactFilter(),
        };
        this.tracks.push(best);
      } else {
        unusedTracks.delete(best);
      }

      const rawPickPoint = hand.pickPoint || null;
      const pickPoint = best.contactFilter.update(rawPickPoint, now);
      const projection = projectPointToBand(pickPoint, band);
      const tangent = projectPointAlongBand(pickPoint, band);
      const elapsed = Math.max(0.04, Math.min(0.35, (now - best.lastSeenAt) / 1000 || 0.05));
      const normalActivity = projection == null || best.lastProjection == null ? 0 : Math.abs(projection - best.lastProjection) / elapsed;
      const tangentActivity = tangent == null || best.lastTangent == null ? 0 : Math.abs(tangent - best.lastTangent) / elapsed;
      const guideStatus = evaluateStrumGuidePoint(pickPoint, band, guide);
      const contactStable = Boolean(pickPoint?.stable && finite(pickPoint?.filterConfidence) >= 0.48);
      const countReady = ready && guideStatus.inside && contactStable;
      const event = best.tracker.sample({ timestamp: now, point: pickPoint, band, guide, ready: countReady });
      const directionalActivity = clamp(normalActivity - tangentActivity * 0.62, 0, 4);
      const proximityBonus = guideStatus.inside ? (guideStatus.zone === 'strings' ? 0.22 : 0.1) : -0.18;
      best.score = clamp(best.score * 0.82 + directionalActivity * 0.16 + proximityBonus + (event ? 1.5 : 0), 0, 6);
      best.candidateFrames = countReady && directionalActivity >= 0.08 ? best.candidateFrames + 1 : Math.max(0, best.candidateFrames - 1);
      best.wrist = hand.wrist || hand.landmarks?.[0] || null;
      best.handedness = hand.handedness || best.handedness;
      best.lastProjection = projection;
      best.lastTangent = tangent;
      best.lastSeenAt = now;
      best.hand = {
        ...hand,
        pickPoint,
        rawPickPoint,
        contactQuality: finite(pickPoint?.quality, finite(rawPickPoint?.quality, 0)),
        contactConfidence: finite(pickPoint?.filterConfidence),
        contactStable,
        trackId: best.id,
        normalActivity,
        tangentActivity,
        guideStatus,
      };
      best.event = event;
      best.eventDetail = event ? best.tracker.lastEventDetail : null;
      assigned.push(best);
    }

    const eventTracks = assigned.filter((track) => track.event).sort((left, right) => right.score - left.score);
    if (eventTracks.length) this.selectedId = eventTracks[0].id;
    if (this.selectedId == null) {
      const candidate = [...assigned]
        .filter((track) => track.candidateFrames >= 4 && track.hand?.guideStatus?.inside)
        .sort((left, right) => right.score - left.score)[0];
      if (candidate && candidate.score >= 0.45) this.selectedId = candidate.id;
    }
    if (this.selectedId != null && !assigned.some((track) => track.id === this.selectedId)) {
      const old = this.tracks.find((track) => track.id === this.selectedId);
      if (!old || now - old.lastSeenAt > 850) this.selectedId = null;
    }

    const selected = assigned.find((track) => track.id === this.selectedId) || null;
    const resolvedHands = assigned.map((track) => ({
      ...track.hand,
      isStrumming: track.id === this.selectedId,
      roleScore: track.score,
    }));
    return {
      hands: resolvedHands,
      selectedHand: selected ? { ...selected.hand, isStrumming: true, roleScore: selected.score } : null,
      selectedId: this.selectedId,
      event: selected?.event || null,
      eventDetail: selected?.eventDetail || null,
    };
  }
}
