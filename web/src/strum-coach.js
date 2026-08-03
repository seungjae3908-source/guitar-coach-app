import { clamp, projectPointAlongBand, projectPointToBand } from './vision-logic.js';

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function median(values = []) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function distance(left, right) {
  if (!left || !right) return Infinity;
  return Math.hypot(finite(left.x) - finite(right.x), finite(left.y) - finite(right.y));
}

export function estimateStrumContactPoint(landmarks = []) {
  const thumbTip = landmarks?.[4];
  const indexTip = landmarks?.[8];
  if (thumbTip && indexTip) {
    return {
      x: (finite(thumbTip.x) + finite(indexTip.x)) / 2,
      y: (finite(thumbTip.y) + finite(indexTip.y)) / 2,
      z: (finite(thumbTip.z) + finite(indexTip.z)) / 2,
      source: 'thumb-index',
    };
  }
  const fallback = indexTip || thumbTip || landmarks?.[12] || landmarks?.[0];
  return fallback ? { x: finite(fallback.x), y: finite(fallback.y), z: finite(fallback.z), source: 'fallback' } : null;
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
    ? clamp(supportLength * 0.2, 0.06, 0.115)
    : clamp(supportLength * 0.42, 0.12, 0.22);
  const halfWidth = Math.min(desiredHalfWidth, Math.max(0.035, supportLength * 0.47));
  const defaultCenter = (supportMin + supportMax) / 2;
  const tangentCenter = clamp(
    calibrated ? Number(anchorTangent) : defaultCenter,
    supportMin + halfWidth,
    supportMax - halfWidth,
  );
  const normalPadding = clamp(Math.max(0.065, bandWidth * 1.45), 0.065, 0.18);
  const normalMin = top - normalPadding;
  const normalMax = bottom + normalPadding;
  const tangentMin = tangentCenter - halfWidth;
  const tangentMax = tangentCenter + halfWidth;

  return {
    ready: supportLength >= 0.2,
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
    polygon: [
      pointFromBandCoordinates(normalMin, tangentMin, band),
      pointFromBandCoordinates(normalMin, tangentMax, band),
      pointFromBandCoordinates(normalMax, tangentMax, band),
      pointFromBandCoordinates(normalMax, tangentMin, band),
    ],
    topGate: [
      pointFromBandCoordinates(top, tangentMin, band),
      pointFromBandCoordinates(top, tangentMax, band),
    ],
    bottomGate: [
      pointFromBandCoordinates(bottom, tangentMin, band),
      pointFromBandCoordinates(bottom, tangentMax, band),
    ],
    centerLine: [
      pointFromBandCoordinates(normalMin, tangentCenter, band),
      pointFromBandCoordinates(normalMax, tangentCenter, band),
    ],
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
  constructor({ requiredSamples = 6 } = {}) {
    this.requiredSamples = requiredSamples;
    this.reset();
  }

  reset() {
    this.anchorTangent = null;
    this.samples = [];
    this.lastAngle = null;
  }

  guideFor(band) {
    return buildStrumGuide(band, this.anchorTangent);
  }

  observe(point, band, { force = false } = {}) {
    if (!point || !band || finite(band.supportLength) < 0.2) return this.guideFor(band);
    const angle = finite(band.angle);
    if (this.lastAngle != null && Math.abs(angle - this.lastAngle) > 14) this.reset();
    this.lastAngle = angle;

    const tangent = projectPointAlongBand(point, band);
    const normal = projectPointToBand(point, band);
    const supportMin = finite(band.supportMin, -Infinity);
    const supportMax = finite(band.supportMax, Infinity);
    const normalAllowance = Math.max(0.2, Math.abs(finite(band.bottom) - finite(band.top)) * 4);
    if (tangent == null || normal == null || tangent < supportMin || tangent > supportMax || Math.abs(normal - finite(band.center, normal)) > normalAllowance) {
      return this.guideFor(band);
    }

    if (force) {
      this.anchorTangent = tangent;
      this.samples = [tangent];
      return this.guideFor(band);
    }
    if (this.anchorTangent == null) {
      this.samples.push(tangent);
      this.samples = this.samples.slice(-Math.max(this.requiredSamples, 12));
      if (this.samples.length >= this.requiredSamples) this.anchorTangent = median(this.samples);
    }
    return this.guideFor(band);
  }
}

export class StrictDirectionalStrumTracker {
  constructor({ minimumTravel = 0.05, cooldownMs = 190, maximumCrossingMs = 900, maximumFrameJump = 0.18, minimumStrokeMs = 70, sideConfirmSamples = 2 } = {}) {
    this.minimumTravel = minimumTravel;
    this.cooldownMs = cooldownMs;
    this.maximumCrossingMs = maximumCrossingMs;
    this.maximumFrameJump = maximumFrameJump;
    this.minimumStrokeMs = minimumStrokeMs;
    this.sideConfirmSamples = sideConfirmSamples;
    this.reset();
  }

  reset() {
    this.lastEventAt = -Infinity;
    this.lastDirection = 'none';
    this.lastProjection = null;
    this.lastSampleAt = 0;
    this.pendingSide = null;
    this.pendingSideCount = 0;
    this.armed = null;
    this.lastRejectReason = '';
  }

  resetTransient(reason = '') {
    this.lastProjection = null;
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
      enteredBand: false,
      maximumLateralRatio: 0,
    };
  }

  sample({ timestamp, point, band, guide, ready }) {
    const status = evaluateStrumGuidePoint(point, band, guide);
    if (!ready || !status.ready || status.normal == null || status.tangent == null) {
      this.resetTransient('evidence-not-ready');
      return null;
    }
    if (!status.lateralInside || !status.normalInside) {
      this.resetTransient('outside-guide');
      return null;
    }

    const now = finite(timestamp);
    const projection = status.normal;
    const previous = this.lastProjection;
    const previousAt = this.lastSampleAt;
    this.lastProjection = projection;
    this.lastSampleAt = now;

    if (previous != null && (now - previousAt > 300 || Math.abs(projection - previous) > this.maximumFrameJump)) {
      this.resetTransient('discontinuous-sample');
      this.lastProjection = projection;
      this.lastSampleAt = now;
      return null;
    }

    if (this.armed) {
      this.armed.maximumLateralRatio = Math.max(this.armed.maximumLateralRatio, status.lateralRatio);
      if (now - this.armed.at > this.maximumCrossingMs) this.armed = null;
      else if (status.zone === 'strings') this.armed.enteredBand = true;
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

    const duration = now - this.armed.at;
    const travel = Math.abs(projection - this.armed.startProjection);
    const requiredTravel = Math.max(this.minimumTravel, finite(guide?.bandWidth) * 0.9);
    const direction = this.armed.side === 'above' && side === 'below' ? 'down' : 'up';
    const accepted = this.armed.enteredBand
      && duration >= this.minimumStrokeMs
      && duration <= this.maximumCrossingMs
      && travel >= requiredTravel
      && this.armed.maximumLateralRatio <= 1
      && now - this.lastEventAt >= this.cooldownMs;

    this.arm(side, projection, status.tangent, now);
    if (!accepted) {
      this.lastRejectReason = 'incomplete-crossing';
      return null;
    }
    this.lastEventAt = now;
    this.lastDirection = direction;
    this.lastRejectReason = '';
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
      let bestDistance = Infinity;
      for (const track of unusedTracks) {
        const candidateDistance = distance(track.wrist, hand.wrist || hand.landmarks?.[0]);
        if (candidateDistance < bestDistance) {
          best = track;
          bestDistance = candidateDistance;
        }
      }
      if (!best || bestDistance > 0.24) {
        best = {
          id: this.nextId++,
          wrist: null,
          lastProjection: null,
          lastTangent: null,
          lastSeenAt: now,
          score: 0,
          tracker: new StrictDirectionalStrumTracker(),
        };
        this.tracks.push(best);
      } else {
        unusedTracks.delete(best);
      }

      const pickPoint = hand.pickPoint || null;
      const projection = projectPointToBand(pickPoint, band);
      const tangent = projectPointAlongBand(pickPoint, band);
      const elapsed = Math.max(0.04, Math.min(0.35, (now - best.lastSeenAt) / 1000 || 0.05));
      const normalActivity = projection == null || best.lastProjection == null ? 0 : Math.abs(projection - best.lastProjection) / elapsed;
      const tangentActivity = tangent == null || best.lastTangent == null ? 0 : Math.abs(tangent - best.lastTangent) / elapsed;
      const guideStatus = evaluateStrumGuidePoint(pickPoint, band, guide);
      const event = best.tracker.sample({ timestamp: now, point: pickPoint, band, guide, ready: ready && guideStatus.inside });
      const directionalActivity = clamp(normalActivity - tangentActivity * 0.55, 0, 4);
      best.score = best.score * 0.8 + directionalActivity * 0.2 + (event ? 1.35 : 0);
      best.wrist = hand.wrist || hand.landmarks?.[0] || null;
      best.lastProjection = projection;
      best.lastTangent = tangent;
      best.lastSeenAt = now;
      best.hand = { ...hand, trackId: best.id, normalActivity, tangentActivity, guideStatus };
      best.event = event;
      assigned.push(best);
    }

    const eventTracks = assigned.filter((track) => track.event).sort((left, right) => right.score - left.score);
    if (eventTracks.length) this.selectedId = eventTracks[0].id;
    if (this.selectedId != null && !assigned.some((track) => track.id === this.selectedId)) {
      const old = this.tracks.find((track) => track.id === this.selectedId);
      if (!old || now - old.lastSeenAt > 800) this.selectedId = null;
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
    };
  }
}
