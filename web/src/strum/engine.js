import { clamp, strumPoint, toGuitarSpace } from "./geometry.js";

export const REJECT_REASONS = Object.freeze({
  NO_HAND: "NO_HAND",
  NO_STRUM_HAND: "NO_STRUM_HAND",
  CALIBRATION_INVALID: "CALIBRATION_INVALID",
  OUTSIDE_STRUM_ZONE: "OUTSIDE_STRUM_ZONE",
  WAITING_FOR_TRAJECTORY: "WAITING_FOR_TRAJECTORY",
  NO_AXIS_CROSS: "NO_AXIS_CROSS",
  TRAVEL_TOO_SMALL: "TRAVEL_TOO_SMALL",
  VELOCITY_TOO_LOW: "VELOCITY_TOO_LOW",
  TRACKING_CONFIDENCE_LOW: "TRACKING_CONFIDENCE_LOW",
  REFRACTORY: "REFRACTORY",
  WEAK_VISION_NO_AUDIO: "WEAK_VISION_NO_AUDIO",
  DUPLICATE: "DUPLICATE",
  OTHER: "OTHER",
});

const percentile = (values, ratio) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
};

export class AudioOnsetDetector {
  constructor({ refractoryMs = 90, calibrationMs = 650 } = {}) {
    Object.assign(this, { refractoryMs, calibrationMs });
    this.noiseFloor = 0.008;
    this.lastOnset = -Infinity;
    this.previous = 0;
    this.startedAt = null;
    this.ambient = [];
    this.recent = [];
  }
  push(rms, timestamp) {
    if (this.startedAt == null) this.startedAt = timestamp;
    if (timestamp - this.startedAt < this.calibrationMs) {
      this.ambient.push(rms);
      this.noiseFloor = percentile(this.ambient, 0.7) || this.noiseFloor;
      this.previous = rms;
      return null;
    }
    this.recent.push(rms);
    if (this.recent.length > 90) this.recent.shift();
    const robustFloor = percentile(this.recent, 0.35);
    if (robustFloor > 0)
      this.noiseFloor = this.noiseFloor * 0.96 + robustFloor * 0.04;
    const threshold = Math.max(0.008, this.noiseFloor * 2.8);
    const onset =
      rms > threshold &&
      rms > this.previous * 1.65 &&
      timestamp - this.lastOnset >= this.refractoryMs;
    this.previous = rms;
    if (onset) this.lastOnset = timestamp;
    return onset
      ? {
          timestamp,
          strength: clamp((rms - threshold) / Math.max(threshold, 0.001)),
        }
      : null;
  }
}

export function fuseStrokeEvidence(candidate, audioOnset) {
  if (!candidate) return null;
  const audioConfirmed = Boolean(audioOnset);
  const vision = candidate.visionConfidence ?? 0;
  const confidence = clamp(
    vision * (audioConfirmed ? 0.72 : 0.88) +
      (audioOnset?.strength ?? 0) * 0.28,
  );
  const accepted =
    (candidate.crossedCentralBand && vision >= 0.64) ||
    (audioConfirmed && vision >= 0.38 && confidence >= 0.48);
  return {
    ...candidate,
    audioConfirmed,
    confidence,
    accepted,
    evidence: audioConfirmed
      ? candidate.crossedCentralBand
        ? "vision+audio"
        : "audio-supported-trajectory"
      : accepted
        ? "strong-vision"
        : "weak-vision",
  };
}

export class StrokeDetector {
  constructor({
    minTravel = 0.045,
    minVelocity = 0.25,
    refractoryMs = 105,
    audioWindowMs = 150,
    sampleWindowMs = 280,
  } = {}) {
    Object.assign(this, {
      minTravel,
      minVelocity,
      refractoryMs,
      audioWindowMs,
      sampleWindowMs,
    });
    this.samples = [];
    this.onsets = [];
    this.lastStroke = -Infinity;
    this.acceptedCount = 0;
    this.rejectionCounts = {};
    this.lastDebug = null;
  }

  addOnset(onset) {
    if (onset) this.onsets.push(onset);
    this.onsets = this.onsets.slice(-16);
  }

  markReject(reason, data = {}) {
    this.rejectionCounts[reason] = (this.rejectionCounts[reason] || 0) + 1;
    this.lastDebug = {
      accepted: false,
      reason,
      ...data,
    };
    return null;
  }

  getDebugSnapshot() {
    return {
      ...(this.lastDebug || {}),
      acceptedCount: this.acceptedCount,
      rejectionCounts: { ...this.rejectionCounts },
      minTravel: this.minTravel,
      minVelocity: this.minVelocity,
    };
  }

  push({ timestamp, landmarks, calibration, trackingConfidence = 1 }) {
    const point = strumPoint(landmarks || []);
    if (!point)
      return this.markReject(REJECT_REASONS.NO_HAND, { timestamp });
    if (!calibration)
      return this.markReject(REJECT_REASONS.CALIBRATION_INVALID, {
        timestamp,
        point,
      });
    if (trackingConfidence < 0.2)
      return this.markReject(REJECT_REASONS.TRACKING_CONFIDENCE_LOW, {
        timestamp,
        point,
        trackingConfidence,
      });

    const guitar = toGuitarSpace(point, calibration);
    const z = calibration.strumZone;
    const near =
      guitar.along >= z.alongMin &&
      guitar.along <= z.alongMax &&
      guitar.across >= z.acrossMin &&
      guitar.across <= z.acrossMax;

    this.samples.push({ timestamp, point, guitar, near });
    this.samples = this.samples.filter(
      (sample) => timestamp - sample.timestamp <= this.sampleWindowMs,
    );

    if (!near)
      return this.markReject(REJECT_REASONS.OUTSIDE_STRUM_ZONE, {
        timestamp,
        point,
        guitar,
        trackingConfidence,
      });
    if (timestamp - this.lastStroke < this.refractoryMs)
      return this.markReject(REJECT_REASONS.REFRACTORY, {
        timestamp,
        point,
        guitar,
        trackingConfidence,
      });

    const prior = this.samples
      .slice(0, -1)
      .filter((sample) => sample.near)
      .map((sample) => ({
        ...sample,
        travel: Math.abs(guitar.across - sample.guitar.across),
      }))
      .sort((a, b) => b.travel - a.travel)[0];

    if (!prior)
      return this.markReject(REJECT_REASONS.WAITING_FOR_TRAJECTORY, {
        timestamp,
        point,
        guitar,
        trackingConfidence,
      });

    const dt = Math.max(1, timestamp - prior.timestamp);
    const deltaAcross = guitar.across - prior.guitar.across;
    const travel = Math.abs(deltaAcross);
    const velocity = travel / (dt / 1000);
    if (travel < this.minTravel)
      return this.markReject(REJECT_REASONS.TRAVEL_TOO_SMALL, {
        timestamp,
        point,
        guitar,
        travel,
        velocity,
        trackingConfidence,
      });
    if (velocity < this.minVelocity)
      return this.markReject(REJECT_REASONS.VELOCITY_TOO_LOW, {
        timestamp,
        point,
        guitar,
        travel,
        velocity,
        trackingConfidence,
      });

    const centralHalfWidth = calibration.stringBand.max * 0.6;
    const low = Math.min(prior.guitar.across, guitar.across);
    const high = Math.max(prior.guitar.across, guitar.across);
    const crossedCentralBand = low <= centralHalfWidth && high >= -centralHalfWidth;
    const onset = this.onsets.findLast(
      (item) => Math.abs(item.timestamp - timestamp) <= this.audioWindowMs,
    );

    const travelScore = clamp(travel / (this.minTravel * 2));
    const velocityScore = clamp(velocity / (this.minVelocity * 3));
    const visionConfidence = clamp(
      travelScore * 0.42 +
        velocityScore * 0.3 +
        clamp(trackingConfidence) * 0.18 +
        (crossedCentralBand ? 0.1 : 0),
    );

    const fused = fuseStrokeEvidence(
      {
        timestamp,
        direction: deltaAcross < 0 ? "down" : "up",
        visionConfidence,
        travel,
        velocity,
        point,
        crossedCentralBand,
      },
      onset,
    );

    if (!fused?.accepted) {
      const reason = !crossedCentralBand && !onset
        ? REJECT_REASONS.NO_AXIS_CROSS
        : REJECT_REASONS.WEAK_VISION_NO_AUDIO;
      return this.markReject(reason, {
        timestamp,
        point,
        guitar,
        travel,
        velocity,
        visionConfidence,
        crossedCentralBand,
        audioMatched: Boolean(onset),
        trackingConfidence,
      });
    }

    // Only an accepted physical stroke may consume the refractory window.
    this.lastStroke = timestamp;
    this.samples = [this.samples.at(-1)];
    this.acceptedCount += 1;
    this.lastDebug = {
      accepted: true,
      reason: null,
      timestamp,
      point,
      guitar,
      travel,
      velocity,
      visionConfidence,
      crossedCentralBand,
      audioMatched: Boolean(onset),
      trackingConfidence,
      direction: fused.direction,
    };
    return fused;
  }
}

export function sessionMetrics(strokes, targetBpm, beats = []) {
  const intervals = strokes
      .slice(1)
      .map((s, i) => s.timestamp - strokes[i].timestamp)
      .filter((n) => n > 150 && n < 2500);
  const mean = intervals.length
    ? intervals.reduce((a, b) => a + b, 0) / intervals.length
    : 0;
  const bpm = mean ? 60000 / mean : 0;
  const targetMs = 60000 / targetBpm;
  const available = new Set(beats.map((_, i) => i));
  const offsets = [];
  for (const stroke of strokes) {
    let best = null;
    for (const i of available) {
      const offset = stroke.timestamp - beats[i].timestamp;
      const d = Math.abs(offset);
      if (d <= targetMs * 0.46 && (!best || d < best.d))
        best = { i, offset, d };
    }
    if (best) {
      available.delete(best.i);
      offsets.push(best.offset);
    }
  }
  const avgOffset = offsets.length
    ? offsets.reduce((a, b) => a + b, 0) / offsets.length
    : 0;
  const variance = offsets.length
    ? offsets.reduce((sum, n) => sum + (n - avgOffset) ** 2, 0) /
      offsets.length
    : 0;
  const consistency = Math.round(
    clamp(1 - Math.sqrt(variance) / (targetMs * 0.35)) * 100,
  );
  return {
    total: strokes.length,
    down: strokes.filter((s) => s.direction === "down").length,
    up: strokes.filter((s) => s.direction === "up").length,
    currentBpm: Math.round(bpm),
    averageBpm: Math.round(bpm),
    averageOffsetMs: Math.round(avgOffset),
    timingStdDevMs: Math.round(Math.sqrt(variance)),
    consistency,
    missedBeatEstimate: available.size,
    matchedBeats: offsets.length,
    early: offsets.filter((n) => n < 0).length,
    late: offsets.filter((n) => n > 0).length,
  };
}
