const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, finite(value)));

function normalize(vector, fallback = { x: 1, y: 0 }) {
  const x = finite(vector?.x, fallback.x);
  const y = finite(vector?.y, fallback.y);
  const length = Math.hypot(x, y);
  return length > 0.0001 ? { x: x / length, y: y / length } : { ...fallback };
}

function dot(point, axis) {
  return finite(point?.x) * finite(axis?.x) + finite(point?.y) * finite(axis?.y);
}

function distance(left, right) {
  if (!left || !right) return Infinity;
  return Math.hypot(finite(left.x) - finite(right.x), finite(left.y) - finite(right.y));
}

function angleDegrees(axis) {
  return Math.atan2(finite(axis?.y), finite(axis?.x, 1)) * 180 / Math.PI;
}

function angleDelta(left, right) {
  let delta = finite(right) - finite(left);
  while (delta > 90) delta -= 180;
  while (delta < -90) delta += 180;
  return Math.abs(delta);
}

function axisForPose(pose) {
  const tangent = normalize(
    pose?.axis?.tangent || {
      x: pose?.stringBand?.tangentX,
      y: pose?.stringBand?.tangentY,
    },
  );
  const suppliedNormal = pose?.axis?.normal || {
    x: pose?.stringBand?.normalX,
    y: pose?.stringBand?.normalY,
  };
  let normal = normalize(suppliedNormal, { x: -tangent.y, y: tangent.x });
  if (Math.abs(tangent.x * normal.x + tangent.y * normal.y) > 0.18) {
    normal = { x: -tangent.y, y: tangent.x };
  }
  return { tangent, normal, angle: angleDegrees(tangent) };
}

function validPoint(point) {
  return Boolean(point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)));
}

export function estimateAdaptiveContactPoint(landmarks = []) {
  const thumbTip = landmarks?.[4];
  const thumbIp = landmarks?.[3];
  const indexTip = landmarks?.[8];
  const indexDip = landmarks?.[7];
  const wrist = landmarks?.[0];
  const indexMcp = landmarks?.[5];
  const pinkyMcp = landmarks?.[17];
  if (!validPoint(thumbTip) || !validPoint(indexTip)) return null;

  const palmScale = [distance(wrist, indexMcp), distance(indexMcp, pinkyMcp), distance(wrist, pinkyMcp)]
    .filter(Number.isFinite)
    .sort((left, right) => left - right)[1] || 0.12;
  const pinchDistance = distance(thumbTip, indexTip);
  const pinchRatio = pinchDistance / Math.max(0.035, palmScale);
  const center = {
    x: (finite(thumbTip.x) + finite(indexTip.x)) / 2,
    y: (finite(thumbTip.y) + finite(indexTip.y)) / 2,
    z: (finite(thumbTip.z) + finite(indexTip.z)) / 2,
  };
  const palmPoints = [wrist, indexMcp, pinkyMcp].filter(validPoint);
  const palmCenter = palmPoints.length ? {
    x: palmPoints.reduce((sum, point) => sum + finite(point.x), 0) / palmPoints.length,
    y: palmPoints.reduce((sum, point) => sum + finite(point.y), 0) / palmPoints.length,
  } : center;
  const outwardX = center.x - palmCenter.x;
  const outwardY = center.y - palmCenter.y;
  const outwardLength = Math.hypot(outwardX, outwardY);
  const extension = pinchRatio <= 0.82 ? clamp(palmScale * 0.07, 0, 0.016) : 0;
  const quality = clamp(
    0.38
      + (validPoint(thumbIp) ? 0.12 : 0)
      + (validPoint(indexDip) ? 0.12 : 0)
      + clamp(1 - pinchRatio / 2) * 0.38,
  );
  return {
    x: clamp(center.x + (outwardLength ? outwardX / outwardLength * extension : 0)),
    y: clamp(center.y + (outwardLength ? outwardY / outwardLength * extension : 0)),
    z: center.z,
    quality,
    source: 'thumb-index-contact',
  };
}

function soundholeInsideBody(pose, axis) {
  const soundhole = pose?.soundhole;
  if (!validPoint(soundhole)) return false;
  const body = pose?.body;
  if (!body?.center) return finite(soundhole.confidence, 0.5) >= 0.48;
  const delta = { x: soundhole.x - body.center.x, y: soundhole.y - body.center.y };
  const along = Math.abs(dot(delta, axis.tangent));
  const across = Math.abs(dot(delta, axis.normal));
  const alongRadius = Math.max(0.12, finite(body.radiusAlong, finite(body.alongRadius, 0.3)));
  const acrossRadius = Math.max(0.09, finite(body.radiusAcross, finite(body.acrossRadius, 0.22)));
  return along <= alongRadius * 0.92 && across <= acrossRadius * 0.78;
}

function normalizedBand(candidate, axis) {
  if (!candidate) return null;
  const top = finite(candidate.top, NaN);
  const bottom = finite(candidate.bottom, NaN);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= top) return null;
  const supportMin = finite(candidate.supportMin, NaN);
  const supportMax = finite(candidate.supportMax, NaN);
  if (!Number.isFinite(supportMin) || !Number.isFinite(supportMax) || supportMax <= supportMin) return null;
  return {
    ...candidate,
    top,
    bottom,
    center: finite(candidate.center, (top + bottom) / 2),
    tangentX: axis.tangent.x,
    tangentY: axis.tangent.y,
    normalX: axis.normal.x,
    normalY: axis.normal.y,
    angle: axis.angle,
    supportMin,
    supportMax,
    supportLength: supportMax - supportMin,
  };
}

export function deriveAdaptiveStringBand(pose) {
  if (!pose || finite(pose.confidence) < 0.22) {
    return { valid: false, band: null, source: 'none', reason: 'guitar-pose-missing', confidence: 0 };
  }
  const axis = axisForPose(pose);
  const candidate = normalizedBand(pose.stringBand, axis);
  const soundholeValid = soundholeInsideBody(pose, axis);
  const body = pose.body;
  const soundhole = soundholeValid ? pose.soundhole : null;
  const bodyCenter = body?.center;
  const bodyAcrossRadius = Math.max(0.08, finite(body?.radiusAcross, finite(body?.acrossRadius, 0.2)));
  const candidateWidth = candidate ? candidate.bottom - candidate.top : 0;
  const candidateCenter = candidate?.center;
  const candidateAngle = candidate ? angleDelta(finite(pose.stringBand?.angle, axis.angle), axis.angle) : Infinity;
  const soundholeNormal = soundhole ? dot(soundhole, axis.normal) : null;
  const soundholeTangent = soundhole ? dot(soundhole, axis.tangent) : null;
  const bodyNormal = bodyCenter ? dot(bodyCenter, axis.normal) : null;
  const bodyTangent = bodyCenter ? dot(bodyCenter, axis.tangent) : null;
  const crossesSoundhole = candidate && soundhole
    ? Math.abs(candidateCenter - soundholeNormal) <= Math.max(0.035, finite(soundhole.radius, 0.07) * 0.78, candidateWidth * 1.65)
      && soundholeTangent >= candidate.supportMin - 0.08
      && soundholeTangent <= candidate.supportMax + 0.08
    : false;
  const crossesBody = candidate && bodyCenter
    ? Math.abs(candidateCenter - bodyNormal) <= bodyAcrossRadius * 0.72
      && bodyTangent >= candidate.supportMin - 0.12
      && bodyTangent <= candidate.supportMax + 0.12
    : false;
  const candidateValid = Boolean(candidate
    && candidate.supportLength >= 0.18
    && candidateAngle <= 18
    && (crossesSoundhole || (!soundhole && crossesBody)));

  if (candidateValid) {
    return {
      valid: true,
      band: { ...candidate, geometryValidated: true, source: 'observed-validated' },
      source: 'observed-validated',
      reason: crossesSoundhole ? 'observed-band-crosses-soundhole' : 'observed-band-crosses-body',
      confidence: clamp(finite(pose.confidence) * 0.82 + 0.16),
    };
  }

  if (!soundhole) {
    return {
      valid: false,
      band: null,
      source: 'none',
      reason: candidate ? 'string-band-away-from-guitar' : 'soundhole-and-string-band-missing',
      confidence: 0,
    };
  }

  const center = soundholeNormal;
  const radius = clamp(finite(soundhole.radius, 0.07), 0.035, 0.16);
  const halfWidth = clamp(radius * 0.29, 0.012, 0.034);
  const alongRadius = Math.max(0.24, finite(body?.radiusAlong, finite(body?.alongRadius, 0.34)));
  const supportHalf = clamp(alongRadius * 1.04, 0.27, 0.55);
  const supportMin = soundholeTangent - supportHalf;
  const supportMax = soundholeTangent + supportHalf;
  return {
    valid: true,
    band: {
      top: center - halfWidth,
      bottom: center + halfWidth,
      center,
      tangentX: axis.tangent.x,
      tangentY: axis.tangent.y,
      normalX: axis.normal.x,
      normalY: axis.normal.y,
      angle: axis.angle,
      supportMin,
      supportMax,
      supportLength: supportMax - supportMin,
      geometryValidated: true,
      source: 'soundhole-fallback',
    },
    source: 'soundhole-fallback',
    reason: candidate ? 'replaced-misaligned-string-band' : 'constructed-from-soundhole-axis',
    confidence: clamp(finite(pose.confidence) * 0.72 + finite(soundhole.confidence, 0.5) * 0.2),
  };
}

class PointFilter {
  constructor() { this.reset(); }
  reset() { this.point = null; this.lastAt = 0; this.samples = []; this.confidence = 0; }
  update(point, timestamp) {
    if (!validPoint(point)) return null;
    const now = finite(timestamp);
    if (this.lastAt && now - this.lastAt > 260) this.reset();
    const elapsed = Math.max(16, now - this.lastAt || 56);
    if (this.point) {
      const jump = distance(this.point, point);
      const allowed = clamp(0.06 + elapsed * 0.0018, 0.08, 0.24);
      if (jump > allowed) {
        this.confidence *= 0.45;
        this.lastAt = now;
        return { ...this.point, stable: false, filterConfidence: this.confidence, rejectedJump: jump };
      }
    }
    this.samples.push({ x: finite(point.x), y: finite(point.y) });
    this.samples = this.samples.slice(-3);
    const sortedX = this.samples.map((entry) => entry.x).sort((a, b) => a - b);
    const sortedY = this.samples.map((entry) => entry.y).sort((a, b) => a - b);
    const medianPoint = { x: sortedX[Math.floor(sortedX.length / 2)], y: sortedY[Math.floor(sortedY.length / 2)] };
    const alpha = this.point ? clamp(0.48 + elapsed / 250, 0.5, 0.78) : 1;
    this.point = {
      ...point,
      x: this.point ? this.point.x + (medianPoint.x - this.point.x) * alpha : medianPoint.x,
      y: this.point ? this.point.y + (medianPoint.y - this.point.y) * alpha : medianPoint.y,
    };
    this.lastAt = now;
    this.confidence = clamp(this.confidence * 0.65 + finite(point.quality, 0.7) * 0.35, 0, 1);
    return { ...this.point, stable: this.confidence >= 0.4, filterConfidence: this.confidence };
  }
}

class DirectionTracker {
  constructor() { this.reset(); }
  reset() {
    this.lastAt = 0;
    this.lastProjection = null;
    this.side = null;
    this.sideFrames = 0;
    this.armed = null;
    this.lastEventAt = -Infinity;
    this.rejectReason = '';
  }
  sample({ point, band, timestamp, ready }) {
    if (!ready || !point || !band || point.stable === false) {
      this.armed = null;
      this.side = null;
      this.sideFrames = 0;
      this.rejectReason = point?.stable === false ? 'contact-unstable' : 'evidence-not-ready';
      return null;
    }
    const now = finite(timestamp);
    const projection = finite(band.normalX) * finite(point.x) + finite(band.normalY, 1) * finite(point.y);
    const tangent = finite(band.tangentX, 1) * finite(point.x) + finite(band.tangentY) * finite(point.y);
    const previous = this.lastProjection;
    const elapsed = now - this.lastAt;
    this.lastAt = now;
    this.lastProjection = projection;
    if (previous != null && (elapsed > 320 || Math.abs(projection - previous) > 0.22)) {
      this.armed = null;
      this.rejectReason = 'discontinuous-sample';
      return null;
    }
    const margin = Math.max(0.006, (band.bottom - band.top) * 0.12);
    const zone = projection <= band.top - margin ? 'above' : projection >= band.bottom + margin ? 'below' : 'strings';
    if (this.armed && previous != null) {
      const delta = projection - previous;
      const expected = this.armed.startSide === 'above' ? 1 : -1;
      if (delta * expected >= -0.002) this.armed.forward += Math.abs(delta);
      else this.armed.reverse += Math.abs(delta);
      this.armed.samples += 1;
      if (zone === 'strings') this.armed.bandSamples += 1;
      this.armed.maxLateral = Math.max(this.armed.maxLateral, Math.abs(tangent - this.armed.anchorTangent));
      if (now - this.armed.at > 940) this.armed = null;
    }
    if (zone === 'strings') {
      this.side = null;
      this.sideFrames = 0;
      return null;
    }
    if (this.side === zone) this.sideFrames += 1;
    else { this.side = zone; this.sideFrames = 1; }
    if (!this.armed && this.sideFrames < 2) return null;
    if (!this.armed) {
      this.armed = { startSide: zone, startProjection: projection, anchorTangent: tangent, at: now, bandSamples: 0, forward: 0, reverse: 0, samples: 1, maxLateral: 0 };
      return null;
    }
    if (this.armed.startSide === zone) return null;
    const travel = Math.abs(projection - this.armed.startProjection);
    const duration = now - this.armed.at;
    const direction = this.armed.startSide === 'above' ? 'down' : 'up';
    const monotonicity = this.armed.forward / Math.max(0.0001, this.armed.forward + this.armed.reverse);
    const accepted = this.armed.bandSamples >= 1
      && travel >= Math.max(0.045, (band.bottom - band.top) * 0.82)
      && duration >= 45
      && duration <= 940
      && monotonicity >= 0.62
      && this.armed.maxLateral <= 0.19
      && now - this.lastEventAt >= 175;
    this.armed = { startSide: zone, startProjection: projection, anchorTangent: tangent, at: now, bandSamples: 0, forward: 0, reverse: 0, samples: 1, maxLateral: 0 };
    if (!accepted) {
      this.rejectReason = 'incomplete-crossing';
      return null;
    }
    this.lastEventAt = now;
    this.rejectReason = '';
    return direction;
  }
}

function pointBandDistance(point, band) {
  if (!point || !band) return Infinity;
  const normal = finite(band.normalX) * finite(point.x) + finite(band.normalY, 1) * finite(point.y);
  return Math.abs(normal - finite(band.center));
}

export function selectAdaptiveStrumHand({ roles = [], band = null, soundhole = null, selectedId = null } = {}) {
  const candidates = roles
    .filter((hand) => !hand?.inferred && Array.isArray(hand?.landmarks) && hand.landmarks.length === 21)
    .map((hand) => {
      const pickPoint = estimateAdaptiveContactPoint(hand.landmarks) || hand.pickPoint;
      const normalDistance = pointBandDistance(pickPoint, band);
      const soundholeDistance = soundhole ? distance(pickPoint, soundhole) : normalDistance;
      const explicit = hand.role === 'strum';
      const fretLike = hand.role === 'fret' || finite(hand.fretDistance, Infinity) + 0.12 < finite(hand.strumDistance, Infinity);
      let score = explicit ? 2.2 : hand.role === 'unknown' ? 0.55 : -0.6;
      score += clamp(1 - normalDistance / 0.24) * 1.15;
      score += clamp(1 - soundholeDistance / 0.42) * 0.9;
      if (hand.trackId === selectedId) score += 0.45;
      if (fretLike) score -= 2.1;
      return { hand: { ...hand, pickPoint }, score, normalDistance, soundholeDistance, fretLike };
    })
    .filter((entry) => entry.hand.pickPoint && entry.score >= 0.45 && entry.normalDistance <= 0.3)
    .sort((left, right) => right.score - left.score);
  return candidates[0]?.hand || null;
}

export class AdaptiveLiveStrumEngine {
  constructor() { this.reset(); }
  reset() {
    this.selectedId = null;
    this.lastSelectedAt = 0;
    this.filters = new Map();
    this.trackers = new Map();
    this.lastBand = null;
    this.lastBandAt = 0;
    this.pendingBand = null;
    this.pendingBandCount = 0;
    this.lastReason = 'waiting';
  }
  stabilizeBand(derived, timestamp) {
    const now = finite(timestamp);
    if (!derived.valid || !derived.band) {
      if (this.lastBand && now - this.lastBandAt <= 900) return { band: this.lastBand, held: true, ...derived, valid: true, source: `${this.lastBand.source || 'stable'}-held` };
      return derived;
    }
    if (!this.lastBand) {
      this.lastBand = derived.band;
      this.lastBandAt = now;
      return derived;
    }
    const shift = Math.abs(finite(derived.band.center) - finite(this.lastBand.center));
    const angle = angleDelta(derived.band.angle, this.lastBand.angle);
    if (shift > 0.11 || angle > 16) {
      const closePending = this.pendingBand && Math.abs(finite(this.pendingBand.center) - finite(derived.band.center)) < 0.055;
      this.pendingBand = derived.band;
      this.pendingBandCount = closePending ? this.pendingBandCount + 1 : 1;
      if (this.pendingBandCount < 2) return { ...derived, band: this.lastBand, valid: true, held: true, source: `${this.lastBand.source || 'stable'}-jump-held` };
    }
    this.lastBand = derived.band;
    this.lastBandAt = now;
    this.pendingBand = null;
    this.pendingBandCount = 0;
    return derived;
  }
  update({ timestamp, roles = [], pose = null } = {}) {
    const geometry = this.stabilizeBand(deriveAdaptiveStringBand(pose), timestamp);
    const band = geometry.band;
    let hand = selectAdaptiveStrumHand({ roles, band, soundhole: pose?.soundhole, selectedId: this.selectedId });
    if (!hand && this.selectedId != null && finite(timestamp) - this.lastSelectedAt > 520) this.selectedId = null;
    if (hand) {
      this.selectedId = hand.trackId;
      this.lastSelectedAt = finite(timestamp);
      if (!this.filters.has(hand.trackId)) this.filters.set(hand.trackId, new PointFilter());
      const filtered = this.filters.get(hand.trackId).update(hand.pickPoint, timestamp);
      hand = filtered ? { ...hand, pickPoint: filtered, adaptiveSelected: true } : null;
    }
    let event = null;
    if (hand?.pickPoint && band) {
      if (!this.trackers.has(hand.trackId)) this.trackers.set(hand.trackId, new DirectionTracker());
      event = this.trackers.get(hand.trackId).sample({
        point: hand.pickPoint,
        band,
        timestamp,
        ready: geometry.valid && finite(geometry.confidence, pose?.confidence) >= 0.38,
      });
    }
    this.lastReason = !geometry.valid ? geometry.reason : !hand ? 'strum-hand-not-near-strings' : hand.pickPoint?.stable === false ? 'contact-unstable' : 'ready';
    return {
      event,
      hand,
      band,
      bandSource: geometry.source,
      bandConfidence: geometry.confidence,
      ready: Boolean(geometry.valid && hand?.pickPoint?.stable !== false),
      reason: this.lastReason,
    };
  }
}
