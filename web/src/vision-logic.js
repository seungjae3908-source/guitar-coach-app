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

export function detectStringBand(imageData, width, height) {
  if (!imageData || width < 40 || height < 30) return { count: 0, confidence: 0, rows: [], band: null };
  const gray = grayscale(imageData, width, height);
  const xStart = Math.floor(width * 0.08);
  const xEnd = Math.floor(width * 0.92);
  const yStart = Math.floor(height * 0.12);
  const yEnd = Math.floor(height * 0.88);
  const scores = [];

  for (let y = yStart + 1; y < yEnd - 1; y += 1) {
    let strong = 0;
    let total = 0;
    let continuity = 0;
    let run = 0;
    let longestRun = 0;
    for (let x = xStart; x < xEnd; x += 1) {
      const index = y * width + x;
      const verticalEdge = Math.abs(gray[index + width] - gray[index - width]);
      total += verticalEdge;
      if (verticalEdge >= 18) {
        strong += 1;
        run += 1;
        longestRun = Math.max(longestRun, run);
      } else {
        run = Math.max(0, run - 2);
      }
    }
    continuity = longestRun / Math.max(1, xEnd - xStart);
    const density = strong / Math.max(1, xEnd - xStart);
    scores.push({ y, score: total / Math.max(1, xEnd - xStart), density, continuity });
  }

  const baseline = median(scores.map((entry) => entry.score));
  const deviations = scores.map((entry) => Math.abs(entry.score - baseline));
  const mad = Math.max(1, median(deviations));
  const candidates = scores
    .filter((entry, index) => {
      const previous = scores[index - 1]?.score ?? -Infinity;
      const next = scores[index + 1]?.score ?? -Infinity;
      return entry.score >= baseline + mad * 2.4 && entry.score >= previous && entry.score >= next && (entry.density >= 0.13 || entry.continuity >= 0.18);
    })
    .sort((a, b) => b.score - a.score);

  const selected = [];
  for (const candidate of candidates) {
    if (selected.every((entry) => Math.abs(entry.y - candidate.y) >= 3)) selected.push(candidate);
    if (selected.length >= 10) break;
  }
  selected.sort((a, b) => a.y - b.y);

  let best = [];
  for (let start = 0; start < selected.length; start += 1) {
    const group = [selected[start]];
    for (let index = start + 1; index < selected.length; index += 1) {
      const gap = selected[index].y - group[group.length - 1].y;
      if (gap >= 2 && gap <= Math.max(14, height * 0.09)) group.push(selected[index]);
      else if (gap > Math.max(14, height * 0.09)) break;
    }
    if (group.length > best.length) best = group;
  }

  const rows = best.slice(0, 8).map((entry) => entry.y);
  const gaps = rows.slice(1).map((row, index) => row - rows[index]);
  const averageGap = gaps.reduce((sum, gap) => sum + gap, 0) / Math.max(1, gaps.length);
  const variance = gaps.reduce((sum, gap) => sum + Math.abs(gap - averageGap), 0) / Math.max(1, gaps.length);
  const spacingScore = gaps.length ? clamp(1 - variance / Math.max(2, averageGap)) : 0;
  const evidenceScore = rows.length ? clamp(rows.length / 6) : 0;
  const confidence = clamp(evidenceScore * 0.72 + spacingScore * 0.28);
  const band = rows.length >= 2 ? {
    top: clamp((rows[0] - 4) / height),
    bottom: clamp((rows[rows.length - 1] + 4) / height),
    center: clamp((rows[0] + rows[rows.length - 1]) / (2 * height)),
  } : null;

  return { count: rows.length, confidence, rows, band };
}

export function combinedGuitarConfidence({ modelScore = 0, stringConfidence = 0, stringCount = 0, handConfidence = 0 } = {}) {
  const geometricEvidence = stringCount >= 4 && handConfidence >= 0.45 ? stringConfidence * 0.78 : 0;
  return clamp(Math.max(modelScore, geometricEvidence));
}

export class DirectionalStrumTracker {
  constructor({ minimumTravel = 0.055, cooldownMs = 320 } = {}) {
    this.minimumTravel = minimumTravel;
    this.cooldownMs = cooldownMs;
    this.reset();
  }

  reset() {
    this.previous = null;
    this.lastEventAt = -Infinity;
    this.armed = { down: true, up: true };
  }

  sample({ timestamp, pointY, band, ready }) {
    if (!ready || !Number.isFinite(pointY) || !band) {
      this.previous = null;
      return null;
    }
    const now = Number(timestamp) || 0;
    const top = clamp(band.top - 0.025);
    const bottom = clamp(band.bottom + 0.025);
    const current = clamp(pointY);
    const previous = this.previous;
    this.previous = { y: current, at: now };
    if (!previous || now - previous.at > 800 || now - this.lastEventAt < this.cooldownMs) return null;

    if (current <= top) this.armed.down = true;
    if (current >= bottom) this.armed.up = true;

    const travel = current - previous.y;
    const crossedDown = this.armed.down && previous.y <= top && current >= bottom && travel >= this.minimumTravel;
    const crossedUp = this.armed.up && previous.y >= bottom && current <= top && -travel >= this.minimumTravel;

    if (crossedDown) {
      this.armed.down = false;
      this.lastEventAt = now;
      return 'down';
    }
    if (crossedUp) {
      this.armed.up = false;
      this.lastEventAt = now;
      return 'up';
    }
    return null;
  }
}

export function canCountStrum({ handConfidence = 0, guitarConfidence = 0, stringCount = 0, stringConfidence = 0 } = {}) {
  return handConfidence >= 0.55 && guitarConfidence >= 0.35 && stringCount >= 4 && stringConfidence >= 0.42;
}
