import { clamp, strumPoint, toGuitarSpace } from "./geometry.js";

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
  const audioConfirmed = Boolean(audioOnset),
    vision = candidate.visionConfidence ?? 0;
  const confidence = clamp(
    vision * (audioConfirmed ? 0.7 : 0.82) + (audioOnset?.strength ?? 0) * 0.3,
  );
  const accepted =
    vision >= 0.7 || (audioConfirmed && vision >= 0.34 && confidence >= 0.5);
  return {
    ...candidate,
    audioConfirmed,
    confidence,
    accepted,
    evidence: audioConfirmed
      ? vision >= 0.7
        ? "vision+audio"
        : "audio-supported"
      : accepted
        ? "strong-vision"
        : "weak-vision",
  };
}

export class StrokeDetector {
  constructor({
    minTravel = 0.055,
    minVelocity = 0.32,
    refractoryMs = 115,
    audioWindowMs = 130,
  } = {}) {
    Object.assign(this, {
      minTravel,
      minVelocity,
      refractoryMs,
      audioWindowMs,
    });
    this.samples = [];
    this.onsets = [];
    this.lastStroke = -Infinity;
  }
  addOnset(onset) {
    if (onset) this.onsets.push(onset);
    this.onsets = this.onsets.slice(-12);
  }
  push({ timestamp, landmarks, calibration, trackingConfidence = 1 }) {
    const point = strumPoint(landmarks);
    if (!point || !calibration || trackingConfidence < 0.2) return null;
    const guitar = toGuitarSpace(point, calibration),
      z = calibration.strumZone;
    const near =
      guitar.along >= z.alongMin &&
      guitar.along <= z.alongMax &&
      guitar.across >= z.acrossMin &&
      guitar.across <= z.acrossMax;
    this.samples.push({ timestamp, point, guitar, near });
    this.samples = this.samples.filter((s) => timestamp - s.timestamp <= 240);
    if (
      !near ||
      timestamp - this.lastStroke < this.refractoryMs ||
      this.samples.length < 2
    )
      return null;
    const start = this.samples[0],
      dt = Math.max(1, timestamp - start.timestamp),
      travel = Math.abs(guitar.across - start.guitar.across),
      velocity = travel / (dt / 1000),
      crossed =
        Math.sign(start.guitar.across) !== Math.sign(guitar.across) &&
        Math.abs(start.guitar.across) > calibration.stringBand.max * 0.55;
    if (!crossed || travel < this.minTravel || velocity < this.minVelocity)
      return null;
    const onset = this.onsets.findLast(
      (item) => Math.abs(item.timestamp - timestamp) <= this.audioWindowMs,
    );
    const visionConfidence = clamp(
      (travel / (this.minTravel * 2)) * 0.45 +
        (velocity / (this.minVelocity * 3)) * 0.35 +
        trackingConfidence * 0.2,
    );
    this.lastStroke = timestamp;
    this.samples = [this.samples.at(-1)];
    return fuseStrokeEvidence(
      {
        timestamp,
        direction: guitar.across < start.guitar.across ? "down" : "up",
        visionConfidence,
        travel,
        velocity,
        point,
      },
      onset,
    );
  }
}

export function sessionMetrics(strokes, targetBpm, beats = []) {
  const intervals = strokes
      .slice(1)
      .map((s, i) => s.timestamp - strokes[i].timestamp)
      .filter((n) => n > 150 && n < 2500),
    mean = intervals.length
      ? intervals.reduce((a, b) => a + b, 0) / intervals.length
      : 0,
    bpm = mean ? 60000 / mean : 0,
    targetMs = 60000 / targetBpm,
    available = new Set(beats.map((_, i) => i)),
    offsets = [];
  for (const stroke of strokes) {
    let best = null;
    for (const i of available) {
      const offset = stroke.timestamp - beats[i].timestamp,
        d = Math.abs(offset);
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
      : 0,
    variance = offsets.length
      ? offsets.reduce((sum, n) => sum + (n - avgOffset) ** 2, 0) /
        offsets.length
      : 0,
    consistency = Math.round(
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
