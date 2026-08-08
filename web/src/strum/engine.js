import { clamp, distance, strumPoint, toGuitarSpace } from './geometry.js';

export class AudioOnsetDetector {
  constructor({ refractoryMs = 90 } = {}) { this.noiseFloor = 0.008; this.lastOnset = -Infinity; this.previous = 0; this.refractoryMs = refractoryMs; }
  push(rms, timestamp) {
    if (rms < this.noiseFloor * 1.8) this.noiseFloor = this.noiseFloor * 0.985 + rms * 0.015;
    const threshold = Math.max(0.012, this.noiseFloor * 3.2);
    const onset = rms > threshold && rms > this.previous * 1.7 && timestamp - this.lastOnset >= this.refractoryMs;
    this.previous = rms;
    if (onset) this.lastOnset = timestamp;
    return onset ? { timestamp, strength: clamp((rms - threshold) / Math.max(threshold, 0.001)) } : null;
  }
}

export class StrokeDetector {
  constructor({ minTravel = 0.055, minVelocity = 0.32, refractoryMs = 115, audioWindowMs = 130 } = {}) {
    Object.assign(this, { minTravel, minVelocity, refractoryMs, audioWindowMs });
    this.samples = []; this.onsets = []; this.lastStroke = -Infinity;
  }
  addOnset(onset) { if (onset) this.onsets.push(onset); this.onsets = this.onsets.slice(-12); }
  push({ timestamp, landmarks, calibration, trackingConfidence = 1 }) {
    const point = strumPoint(landmarks); if (!point || !calibration || trackingConfidence < 0.2) return null;
    const guitar = toGuitarSpace(point, calibration);
    const zone = calibration.strumZone;
    const near = guitar.along >= zone.alongMin && guitar.along <= zone.alongMax && guitar.across >= zone.acrossMin && guitar.across <= zone.acrossMax;
    this.samples.push({ timestamp, point, guitar, near });
    this.samples = this.samples.filter((s) => timestamp - s.timestamp <= 240);
    if (!near || timestamp - this.lastStroke < this.refractoryMs || this.samples.length < 2) return null;
    const start = this.samples[0]; const dt = Math.max(1, timestamp - start.timestamp);
    const travel = Math.abs(guitar.across - start.guitar.across); const velocity = travel / (dt / 1000);
    const crossed = Math.sign(start.guitar.across) !== Math.sign(guitar.across) && Math.abs(start.guitar.across) > calibration.stringBand.max * 0.55;
    if (!crossed || travel < this.minTravel || velocity < this.minVelocity) return null;
    const onset = this.onsets.findLast((item) => Math.abs(item.timestamp - timestamp) <= this.audioWindowMs);
    const visionConfidence = clamp((travel / (this.minTravel * 2)) * 0.45 + (velocity / (this.minVelocity * 3)) * 0.35 + trackingConfidence * 0.2);
    const confidence = clamp(visionConfidence * (onset ? 0.72 : 0.48) + (onset?.strength ?? 0) * 0.28);
    this.lastStroke = timestamp; this.samples = [this.samples.at(-1)];
    return { timestamp, direction: guitar.across > start.guitar.across ? 'down' : 'up', confidence, audioConfirmed: Boolean(onset), travel, velocity, point };
  }
}

export function chooseStrumHand(hands, calibration, previousPoint) {
  return hands.map((hand) => {
    const point = strumPoint(hand.landmarks); if (!point) return { hand, point, score: -Infinity };
    const g = toGuitarSpace(point, calibration); const zone = calibration.strumZone;
    const zoneDistance = Math.max(0, zone.alongMin - g.along, g.along - zone.alongMax, zone.acrossMin - g.across, g.across - zone.acrossMax);
    const motion = previousPoint ? distance(point, previousPoint) : 0;
    return { hand, point, score: -zoneDistance * 5 + motion * 2 + (hand.score ?? 0) * 0.2 };
  }).sort((a, b) => b.score - a.score)[0] ?? null;
}

export function sessionMetrics(strokes, targetBpm) {
  const intervals = strokes.slice(1).map((s, i) => s.timestamp - strokes[i].timestamp).filter((n) => n > 150 && n < 2500);
  const mean = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0;
  const bpm = mean ? 60000 / mean : 0; const targetMs = 60000 / targetBpm;
  const offsets = strokes.map((s, i) => s.timestamp - (strokes[0]?.timestamp ?? 0) - i * targetMs);
  const centered = offsets.map((n) => ((n + targetMs / 2) % targetMs + targetMs) % targetMs - targetMs / 2);
  const avgOffset = centered.length ? centered.reduce((a, b) => a + b, 0) / centered.length : 0;
  const variance = centered.length ? centered.reduce((sum, n) => sum + (n - avgOffset) ** 2, 0) / centered.length : 0;
  const consistency = Math.round(clamp(1 - Math.sqrt(variance) / (targetMs * 0.35)) * 100);
  return { total: strokes.length, down: strokes.filter((s) => s.direction === 'down').length, up: strokes.filter((s) => s.direction === 'up').length, currentBpm: Math.round(bpm), averageBpm: Math.round(bpm), averageOffsetMs: Math.round(avgOffset), timingStdDevMs: Math.round(Math.sqrt(variance)), consistency, missedBeatEstimate: Math.max(0, Math.round((strokes.at(-1)?.timestamp - strokes[0]?.timestamp) / targetMs) + 1 - strokes.length) || 0 };
}
