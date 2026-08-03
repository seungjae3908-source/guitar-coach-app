export const GUITAR_LABEL_PATTERN = /(acoustic guitar|electric guitar|classical guitar|steel guitar|banjo|cello|violin|musical instrument)/i;

export function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function guitarPredictionScore(predictions = []) {
  return predictions.reduce((best, prediction) => {
    if (!GUITAR_LABEL_PATTERN.test(String(prediction?.className || ''))) return best;
    return Math.max(best, clamp(prediction?.probability));
  }, 0);
}

function grayscale(imageData, width, height) {
  const output = new Uint8Array(width * height);
  const source = imageData.data || imageData;
  for (let pixel = 0, index = 0; pixel < source.length; pixel += 4, index += 1) {
    output[index] = Math.round(source[pixel] * 0.299 + source[pixel + 1] * 0.587 + source[pixel + 2] * 0.114);
  }
  return output;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function projectionRange(normalX, normalY) {
  const corners = [0, normalX, normalY, normalX + normalY];
  return { min: Math.min(...corners), max: Math.max(...corners) };
}

function lineSegment(normalX, normalY, rho) {
  const points = [];
  const add = (x, y) => {
    if (x < -0.001 || x > 1.001 || y < -0.001 || y > 1.001) return;
    const point = { x: clamp(x), y: clamp(y) };
    if (!points.some((item) => Math.abs(item.x - point.x) < 0.001 && Math.abs(item.y - point.y) < 0.001)) points.push(point);
  };

  if (Math.abs(normalY) > 0.0001) {
    add(0, rho / normalY);
    add(1, (rho - normalX) / normalY);
  }
  if (Math.abs(normalX) > 0.0001) {
    add(rho / normalX, 0);
    add((rho - normalY) / normalX, 1);
  }
  if (points.length < 2) return null;

  let best = [points[0], points[1]];
  let bestDistance = -1;
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      const distance = (points[first].x - points[second].x) ** 2 + (points[first].y - points[second].y) ** 2;
      if (distance > bestDistance) {
        bestDistance = distance;
        best = [points[first], points[second]];
      }
    }
  }
  return { start: best[0], end: best[1] };
}

function evaluateStringAngle(gray, width, height, angle) {
  const radians = angle * Math.PI / 180;
  const directionX = Math.cos(radians);
  const directionY = Math.sin(radians);
  const normalX = -directionY;
  const normalY = directionX;
  const range = projectionRange(normalX, normalY);
  const binCount = 260;
  const histogram = new Float64Array(binCount);
  const supports = new Uint16Array(binCount);
  const scale = (binCount - 1) / Math.max(0.0001, range.max - range.min);
  const xStart = Math.max(2, Math.floor(width * 0.02));
  const xEnd = Math.min(width - 2, Math.ceil(width * 0.98));
  const yStart = Math.max(2, Math.floor(height * 0.02));
  const yEnd = Math.min(height - 2, Math.ceil(height * 0.98));

  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      const index = y * width + x;
      const gradientX = gray[index + 1] - gray[index - 1];
      const gradientY = gray[index + width] - gray[index - width];
      const normalEdge = Math.abs(gradientX * normalX + gradientY * normalY);
      const tangentEdge = Math.abs(gradientX * directionX + gradientY * directionY);
      const strength = normalEdge - tangentEdge * 0.32;
      if (strength < 14) continue;
      const normalizedX = x / Math.max(1, width - 1);
      const normalizedY = y / Math.max(1, height - 1);
      const projection = normalX * normalizedX + normalY * normalizedY;
      const bin = Math.max(0, Math.min(binCount - 1, Math.round((projection - range.min) * scale)));
      histogram[bin] += strength;
      supports[bin] += 1;
    }
  }

  const smooth = Array.from(histogram, (_, index) => {
    let total = 0;
    let weight = 0;
    for (let offset = -2; offset <= 2; offset += 1) {
      const target = index + offset;
      if (target < 0 || target >= binCount) continue;
      const localWeight = offset === 0 ? 3 : Math.abs(offset) === 1 ? 2 : 1;
      total += histogram[target] * localWeight;
      weight += localWeight;
    }
    return total / Math.max(1, weight);
  });
  const baseline = median(smooth);
  const mad = Math.max(1, median(smooth.map((value) => Math.abs(value - baseline))));
  const threshold = baseline + Math.max(18, mad * 2.2);
  const candidates = [];

  for (let index = 2; index < binCount - 2; index += 1) {
    if (smooth[index] < threshold || smooth[index] < smooth[index - 1] || smooth[index] < smooth[index + 1]) continue;
    const projection = range.min + index / scale;
    let localSupport = 0;
    for (let offset = -2; offset <= 2; offset += 1) localSupport += supports[index + offset] || 0;
    candidates.push({ index, projection, score: smooth[index], support: localSupport });
  }

  candidates.sort((left, right) => right.score - left.score);
  const separated = [];
  for (const candidate of candidates) {
    if (separated.every((entry) => Math.abs(entry.index - candidate.index) >= 3)) separated.push(candidate);
    if (separated.length >= 18) break;
  }
  separated.sort((left, right) => left.projection - right.projection);

  let bestSequence = [];
  let bestSequenceScore = 0;
  for (let first = 0; first < separated.length; first += 1) {
    for (let second = first + 1; second < separated.length; second += 1) {
      const expectedGap = separated[second].projection - separated[first].projection;
      if (expectedGap < 0.008 || expectedGap > 0.13) continue;
      const sequence = [separated[first], separated[second]];
      let expected = separated[second].projection + expectedGap;
      for (let index = second + 1; index < separated.length && sequence.length < 8; index += 1) {
        const tolerance = Math.max(0.006, expectedGap * 0.42);
        if (Math.abs(separated[index].projection - expected) <= tolerance) {
          sequence.push(separated[index]);
          expected = separated[index].projection + expectedGap;
        }
      }
      if (sequence.length < 3) continue;
      const gaps = sequence.slice(1).map((entry, index) => entry.projection - sequence[index].projection);
      const averageGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
      const variation = gaps.reduce((sum, gap) => sum + Math.abs(gap - averageGap), 0) / gaps.length;
      const spacingScore = clamp(1 - variation / Math.max(0.006, averageGap));
      const countScore = clamp((sequence.length - 2) / 4);
      const peakScore = clamp(sequence.reduce((sum, entry) => sum + entry.score / Math.max(threshold, 1), 0) / sequence.length / 2);
      const averageSupport = sequence.reduce((sum, entry) => sum + entry.support, 0) / sequence.length;
      const supportScore = clamp(averageSupport / Math.max(20, Math.min(width, height) * 0.55));
      const sequenceScore = countScore * 0.34 + spacingScore * 0.2 + peakScore * 0.12 + supportScore * 0.34;
      if (sequenceScore > bestSequenceScore) {
        bestSequenceScore = sequenceScore;
        bestSequence = sequence;
      }
    }
  }

  if (bestSequence.length < 3) return null;
  const projections = bestSequence.map((entry) => entry.projection);
  const gaps = projections.slice(1).map((value, index) => value - projections[index]);
  const averageGap = gaps.reduce((sum, gap) => sum + gap, 0) / Math.max(1, gaps.length);
  const margin = Math.max(0.012, averageGap * 0.55);
  const lines = projections.map((rho) => lineSegment(normalX, normalY, rho)).filter(Boolean);
  const rows = projections.map((rho) => {
    if (Math.abs(normalY) < 0.001) return height / 2;
    return clamp((rho - normalX * 0.5) / normalY) * height;
  });

  return {
    count: Math.min(8, bestSequence.length),
    confidence: clamp(bestSequenceScore),
    rows,
    lines,
    angle,
    band: {
      top: projections[0] - margin,
      bottom: projections[projections.length - 1] + margin,
      center: (projections[0] + projections[projections.length - 1]) / 2,
      normalX,
      normalY,
      angle,
    },
  };
}

export function detectStringBand(imageData, width, height) {
  if (!imageData || width < 40 || height < 30) return { count: 0, confidence: 0, rows: [], lines: [], angle: 0, band: null };
  const gray = grayscale(imageData, width, height);
  const angles = [-35, -28, -21, -14, -7, 0, 7, 14, 21, 28, 35];
  let best = null;
  for (const angle of angles) {
    const candidate = evaluateStringAngle(gray, width, height, angle);
    if (!candidate) continue;
    const score = candidate.confidence + Math.min(candidate.count, 6) * 0.025;
    if (!best || score > best.score) best = { ...candidate, score };
  }
  if (!best) return { count: 0, confidence: 0, rows: [], lines: [], angle: 0, band: null };
  const { score, ...result } = best;
  return result;
}

export function projectPointToBand(point, band) {
  if (!point || !band) return null;
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const normalX = Number.isFinite(band.normalX) ? band.normalX : 0;
  const normalY = Number.isFinite(band.normalY) ? band.normalY : 1;
  return normalX * x + normalY * y;
}

export function combinedGuitarConfidence({ modelScore = 0, stringConfidence = 0, stringCount = 0, handConfidence = 0, handPoint = null, band = null } = {}) {
  const projected = projectPointToBand(handPoint, band);
  const bandDistance = projected == null || !band ? 0 : Math.abs(projected - band.center);
  const nearStrings = projected == null || bandDistance <= Math.max(0.24, Math.abs(band.bottom - band.top) * 3.5);
  const geometricEvidence = stringCount >= 3 && handConfidence >= 0.35 && nearStrings ? stringConfidence * 0.84 : 0;
  return clamp(Math.max(modelScore, geometricEvidence));
}

export class DirectionalStrumTracker {
  constructor({ minimumTravel = 0.045, cooldownMs = 220, maximumCrossingMs = 1400 } = {}) {
    this.minimumTravel = minimumTravel;
    this.cooldownMs = cooldownMs;
    this.maximumCrossingMs = maximumCrossingMs;
    this.reset();
  }

  reset() {
    this.lastEventAt = -Infinity;
    this.downStart = null;
    this.upStart = null;
    this.lastProjection = null;
    this.lastDirection = 'none';
  }

  sample({ timestamp, point, pointY, band, ready }) {
    const fallbackPoint = Number.isFinite(pointY) ? { x: 0.5, y: pointY } : null;
    const projection = projectPointToBand(point || fallbackPoint, band);
    if (!ready || projection == null || !band) {
      this.downStart = null;
      this.upStart = null;
      this.lastProjection = null;
      return null;
    }

    const now = Number(timestamp) || 0;
    const top = Number(band.top) - 0.018;
    const bottom = Number(band.bottom) + 0.018;
    const previous = this.lastProjection;
    this.lastProjection = projection;

    if (projection <= top) {
      this.downStart = { projection, at: now };
      if (this.upStart && now - this.upStart.at <= this.maximumCrossingMs && this.upStart.projection - projection >= this.minimumTravel && now - this.lastEventAt >= this.cooldownMs) {
        this.lastEventAt = now;
        this.lastDirection = 'up';
        this.upStart = null;
        return 'up';
      }
    } else if (projection >= bottom) {
      this.upStart = { projection, at: now };
      if (this.downStart && now - this.downStart.at <= this.maximumCrossingMs && projection - this.downStart.projection >= this.minimumTravel && now - this.lastEventAt >= this.cooldownMs) {
        this.lastEventAt = now;
        this.lastDirection = 'down';
        this.downStart = null;
        return 'down';
      }
    }

    if (this.downStart && now - this.downStart.at > this.maximumCrossingMs) this.downStart = null;
    if (this.upStart && now - this.upStart.at > this.maximumCrossingMs) this.upStart = null;
    if (previous != null && Math.abs(projection - previous) > 0.45) {
      this.downStart = null;
      this.upStart = null;
    }
    return null;
  }
}

export function canCountStrum({ handConfidence = 0, guitarConfidence = 0, stringCount = 0, stringConfidence = 0, stringBand = null, pickPoint = null } = {}) {
  const projected = projectPointToBand(pickPoint, stringBand);
  const nearBand = projected == null || !stringBand || Math.abs(projected - stringBand.center) <= Math.max(0.3, Math.abs(stringBand.bottom - stringBand.top) * 4);
  return handConfidence >= 0.45 && guitarConfidence >= 0.3 && stringCount >= 4 && stringConfidence >= 0.32 && nearBand;
}
