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

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)))];
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

function sampleNormalEdge(gray, width, height, x, y, normalX, normalY, tangentX, tangentY) {
  const px = Math.round(x * (width - 1));
  const py = Math.round(y * (height - 1));
  if (px < 2 || px >= width - 2 || py < 2 || py >= height - 2) return 0;
  let best = 0;
  for (let offset = -2; offset <= 2; offset += 1) {
    const ox = Math.round(px + normalX * offset);
    const oy = Math.round(py + normalY * offset);
    if (ox < 1 || ox >= width - 1 || oy < 1 || oy >= height - 1) continue;
    const index = oy * width + ox;
    const gradientX = gray[index + 1] - gray[index - 1];
    const gradientY = gray[index + width] - gray[index - width];
    const normalEdge = Math.abs(gradientX * normalX + gradientY * normalY);
    const tangentEdge = Math.abs(gradientX * tangentX + gradientY * tangentY);
    best = Math.max(best, normalEdge - tangentEdge * 0.28);
  }
  return best;
}

function localizeLine(gray, width, height, segment, normalX, normalY, tangentX, tangentY) {
  if (!segment) return null;
  const sampleCount = 120;
  const values = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const ratio = index / (sampleCount - 1);
    const x = segment.start.x + (segment.end.x - segment.start.x) * ratio;
    const y = segment.start.y + (segment.end.y - segment.start.y) * ratio;
    values.push(sampleNormalEdge(gray, width, height, x, y, normalX, normalY, tangentX, tangentY));
  }

  const baseline = median(values);
  const mad = Math.max(1, median(values.map((value) => Math.abs(value - baseline))));
  const threshold = Math.max(10, Math.min(34, baseline + mad * 0.35));
  const strong = values.map((value) => value >= threshold);
  let best = null;

  for (let start = 0; start < sampleCount; start += 1) {
    if (!strong[start]) continue;
    let strongCount = 0;
    let gap = 0;
    for (let end = start; end < sampleCount; end += 1) {
      if (strong[end]) {
        strongCount += 1;
        gap = 0;
      } else {
        gap += 1;
        if (gap > 7) break;
      }
      const span = end - start + 1;
      if (span < 18) continue;
      const density = strongCount / span;
      const score = strongCount + span * 0.12 - gap * 0.4;
      if (density >= 0.24 && (!best || score > best.score)) best = { start, end, density, score };
    }
  }

  if (!best) return null;
  const padding = 5;
  const startRatio = Math.max(0, best.start - padding) / (sampleCount - 1);
  const endRatio = Math.min(sampleCount - 1, best.end + padding) / (sampleCount - 1);
  if (endRatio - startRatio < 0.2) return null;

  const pointAt = (ratio) => ({
    x: clamp(segment.start.x + (segment.end.x - segment.start.x) * ratio),
    y: clamp(segment.start.y + (segment.end.y - segment.start.y) * ratio),
  });
  return {
    start: pointAt(startRatio),
    end: pointAt(endRatio),
    support: clamp(best.density * 0.72 + (endRatio - startRatio) * 0.28),
  };
}

function evaluateStringAngle(gray, width, height, angle) {
  const radians = angle * Math.PI / 180;
  const tangentX = Math.cos(radians);
  const tangentY = Math.sin(radians);
  const normalX = -tangentY;
  const normalY = tangentX;
  const range = projectionRange(normalX, normalY);
  const binCount = 320;
  const histogram = new Float64Array(binCount);
  const supports = new Uint16Array(binCount);
  const scale = (binCount - 1) / Math.max(0.0001, range.max - range.min);
  const xStart = Math.max(2, Math.floor(width * 0.01));
  const xEnd = Math.min(width - 2, Math.ceil(width * 0.99));
  const yStart = Math.max(2, Math.floor(height * 0.01));
  const yEnd = Math.min(height - 2, Math.ceil(height * 0.99));

  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      const index = y * width + x;
      const gradientX = gray[index + 1] - gray[index - 1];
      const gradientY = gray[index + width] - gray[index - width];
      const normalEdge = Math.abs(gradientX * normalX + gradientY * normalY);
      const tangentEdge = Math.abs(gradientX * tangentX + gradientY * tangentY);
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
    let total = histogram[index] * 3;
    let weight = 3;
    for (const offset of [-1, 1]) {
      const target = index + offset;
      if (target < 0 || target >= binCount) continue;
      total += histogram[target];
      weight += 1;
    }
    return total / weight;
  });
  const baseline = median(smooth);
  const mad = Math.max(1, median(smooth.map((value) => Math.abs(value - baseline))));
  const threshold = baseline + Math.max(18, mad * 2.1);
  const candidates = [];

  for (let index = 2; index < binCount - 2; index += 1) {
    if (smooth[index] < threshold || smooth[index] < smooth[index - 1] || smooth[index] < smooth[index + 1]) continue;
    const projection = range.min + index / scale;
    candidates.push({ index, projection, score: smooth[index], support: supports[index] });
  }

  candidates.sort((left, right) => right.score - left.score);
  const separated = [];
  for (const candidate of candidates) {
    if (separated.every((entry) => Math.abs(entry.index - candidate.index) >= 3)) separated.push(candidate);
    if (separated.length >= 20) break;
  }
  separated.sort((left, right) => left.projection - right.projection);

  let bestSequence = [];
  let bestSequenceScore = 0;
  for (let first = 0; first < separated.length; first += 1) {
    for (let second = first + 1; second < separated.length; second += 1) {
      const expectedGap = separated[second].projection - separated[first].projection;
      if (expectedGap < 0.006 || expectedGap > 0.13) continue;
      const sequence = [separated[first], separated[second]];
      let expected = separated[second].projection + expectedGap;
      for (let index = second + 1; index < separated.length && sequence.length < 8; index += 1) {
        const tolerance = Math.max(0.005, expectedGap * 0.4);
        if (Math.abs(separated[index].projection - expected) <= tolerance) {
          sequence.push(separated[index]);
          expected = separated[index].projection + expectedGap;
        }
      }
      if (sequence.length < 3) continue;
      const gaps = sequence.slice(1).map((entry, index) => entry.projection - sequence[index].projection);
      const averageGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
      const variation = gaps.reduce((sum, gap) => sum + Math.abs(gap - averageGap), 0) / gaps.length;
      const spacingScore = clamp(1 - variation / Math.max(0.005, averageGap));
      const countScore = clamp((sequence.length - 2) / 4);
      const peakScore = clamp(sequence.reduce((sum, entry) => sum + entry.score / Math.max(threshold, 1), 0) / sequence.length / 2);
      const sequenceScore = countScore * 0.58 + spacingScore * 0.27 + peakScore * 0.15;
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
  const margin = Math.max(0.01, averageGap * 0.55);
  const localizedLines = projections
    .map((rho) => localizeLine(gray, width, height, lineSegment(normalX, normalY, rho), normalX, normalY, tangentX, tangentY))
    .filter(Boolean);
  if (localizedLines.length < 3) return null;

  const tangentValues = localizedLines.flatMap((line) => [
    tangentX * line.start.x + tangentY * line.start.y,
    tangentX * line.end.x + tangentY * line.end.y,
  ]);
  const supportMin = percentile(tangentValues, 0.12);
  const supportMax = percentile(tangentValues, 0.88);
  const supportLength = Math.max(0, supportMax - supportMin);
  const averageSupport = localizedLines.reduce((sum, line) => sum + line.support, 0) / localizedLines.length;
  const rows = projections.map((rho) => {
    if (Math.abs(normalY) < 0.001) return height / 2;
    return clamp((rho - normalX * 0.5) / normalY) * height;
  });

  return {
    count: Math.min(8, localizedLines.length),
    confidence: clamp(bestSequenceScore * 0.68 + averageSupport * 0.22 + clamp(supportLength / 0.55) * 0.1),
    rows,
    lines: localizedLines,
    angle,
    band: {
      top: projections[0] - margin,
      bottom: projections[projections.length - 1] + margin,
      center: (projections[0] + projections[projections.length - 1]) / 2,
      normalX,
      normalY,
      tangentX,
      tangentY,
      angle,
      supportMin,
      supportMax,
      supportLength,
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
    const score = candidate.confidence + clamp(candidate.band?.supportLength / 0.65) * 0.08;
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
  return (Number.isFinite(band.normalX) ? band.normalX : 0) * x + (Number.isFinite(band.normalY) ? band.normalY : 1) * y;
}

export function projectPointAlongBand(point, band) {
  if (!point || !band) return null;
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return (Number.isFinite(band.tangentX) ? band.tangentX : 1) * x + (Number.isFinite(band.tangentY) ? band.tangentY : 0) * y;
}

function pointInsideSupportedArea(point, band, tangentMargin = 0.16, normalMargin = 0.24) {
  const normal = projectPointToBand(point, band);
  const tangent = projectPointAlongBand(point, band);
  if (normal == null || tangent == null || !band) return false;
  const width = Math.max(0.03, Math.abs(band.bottom - band.top));
  const normalOk = Math.abs(normal - band.center) <= Math.max(normalMargin, width * 4);
  const tangentOk = tangent >= Number(band.supportMin ?? -Infinity) - tangentMargin
    && tangent <= Number(band.supportMax ?? Infinity) + tangentMargin;
  return normalOk && tangentOk;
}

export function combinedGuitarConfidence({ modelScore = 0, stringConfidence = 0, stringCount = 0, handConfidence = 0, handPoint = null, band = null } = {}) {
  const supported = !handPoint || !band || pointInsideSupportedArea(handPoint, band, 0.2, 0.3);
  const localized = Number(band?.supportLength || 0) >= 0.2;
  const geometricEvidence = stringCount >= 4 && handConfidence >= 0.35 && supported && localized ? stringConfidence * 0.86 : 0;
  return clamp(Math.max(modelScore, geometricEvidence));
}

export class DirectionalStrumTracker {
  constructor({ minimumTravel = 0.04, cooldownMs = 180, maximumCrossingMs = 950, maximumFrameJump = 0.24 } = {}) {
    this.minimumTravel = minimumTravel;
    this.cooldownMs = cooldownMs;
    this.maximumCrossingMs = maximumCrossingMs;
    this.maximumFrameJump = maximumFrameJump;
    this.reset();
  }

  reset() {
    this.lastEventAt = -Infinity;
    this.downStart = null;
    this.upStart = null;
    this.lastProjection = null;
    this.lastSampleAt = 0;
    this.lastDirection = 'none';
  }

  sample({ timestamp, point, pointY, band, ready }) {
    const fallbackPoint = Number.isFinite(pointY) ? { x: 0.5, y: pointY } : null;
    const projection = projectPointToBand(point || fallbackPoint, band);
    if (!ready || projection == null || !band) {
      this.downStart = null;
      this.upStart = null;
      this.lastProjection = null;
      this.lastSampleAt = 0;
      return null;
    }

    const now = Number(timestamp) || 0;
    const top = Number(band.top) - 0.012;
    const bottom = Number(band.bottom) + 0.012;
    const previous = this.lastProjection;
    const previousAt = this.lastSampleAt;
    this.lastProjection = projection;
    this.lastSampleAt = now;

    if (previous != null && (now - previousAt > 320 || Math.abs(projection - previous) > this.maximumFrameJump)) {
      this.downStart = null;
      this.upStart = null;
      return null;
    }

    if (this.downStart && now - this.downStart.at > this.maximumCrossingMs) this.downStart = null;
    if (this.upStart && now - this.upStart.at > this.maximumCrossingMs) this.upStart = null;

    if (projection <= top) {
      if (!this.downStart) this.downStart = { projection, at: now };
      if (this.upStart && now - this.upStart.at <= this.maximumCrossingMs && this.upStart.projection - projection >= this.minimumTravel && now - this.lastEventAt >= this.cooldownMs) {
        this.lastEventAt = now;
        this.lastDirection = 'up';
        this.upStart = null;
        return 'up';
      }
    } else if (projection >= bottom) {
      if (!this.upStart) this.upStart = { projection, at: now };
      if (this.downStart && now - this.downStart.at <= this.maximumCrossingMs && projection - this.downStart.projection >= this.minimumTravel && now - this.lastEventAt >= this.cooldownMs) {
        this.lastEventAt = now;
        this.lastDirection = 'down';
        this.downStart = null;
        return 'down';
      }
    }
    return null;
  }
}

function distance(left, right) {
  if (!left || !right) return Infinity;
  return Math.hypot(Number(left.x || 0) - Number(right.x || 0), Number(left.y || 0) - Number(right.y || 0));
}

export class HandRoleResolver {
  constructor() {
    this.reset();
  }

  reset() {
    this.tracks = [];
    this.nextId = 1;
    this.selectedId = null;
  }

  update({ timestamp, hands = [], band = null, ready = false } = {}) {
    const now = Number(timestamp) || 0;
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
          pickPoint: null,
          lastProjection: null,
          lastTangent: null,
          lastSeenAt: now,
          score: 0,
          tracker: new DirectionalStrumTracker(),
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
      const event = best.tracker.sample({ timestamp: now, point: pickPoint, band, ready: ready && pointInsideSupportedArea(pickPoint, band, 0.18, 0.32) });
      const directionalActivity = clamp(normalActivity - tangentActivity * 0.42, 0, 4);
      best.score = best.score * 0.78 + directionalActivity * 0.22 + (event ? 1.2 : 0);
      best.wrist = hand.wrist || hand.landmarks?.[0] || null;
      best.pickPoint = pickPoint;
      best.lastProjection = projection;
      best.lastTangent = tangent;
      best.lastSeenAt = now;
      best.hand = { ...hand, trackId: best.id, normalActivity, tangentActivity };
      best.event = event;
      assigned.push(best);
    }

    const eventTracks = assigned.filter((track) => track.event).sort((left, right) => right.score - left.score);
    if (eventTracks.length) this.selectedId = eventTracks[0].id;
    const selectedTrack = assigned.find((track) => track.id === this.selectedId) || null;
    if (!selectedTrack && this.selectedId != null) {
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

export function canCountStrum({ handConfidence = 0, guitarConfidence = 0, stringCount = 0, stringConfidence = 0, stringBand = null, pickPoint = null, strumHandSelected = true } = {}) {
  const localized = Number(stringBand?.supportLength || 0) >= 0.2;
  const supported = !pickPoint || !stringBand || pointInsideSupportedArea(pickPoint, stringBand, 0.18, 0.32);
  return handConfidence >= 0.45
    && guitarConfidence >= 0.3
    && stringCount >= 4
    && stringConfidence >= 0.32
    && localized
    && supported
    && strumHandSelected !== false;
}
