export type AutoPoint = { index: number; x: number; y: number };
export type AutoHandEvidence = {
  hasHand: boolean;
  handednessScore: number;
  landmarks: AutoPoint[];
};
export type AutoStringLine = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  strength: number;
};
export type AutoStringEvidence = {
  detected: boolean;
  confidence: number;
  visibleLineCount: number;
  angleDegrees: number;
  lines: AutoStringLine[];
};
export type AutoGuitarRegion = { left: number; top: number; right: number; bottom: number };
export type AutoGuitarDetection = {
  accepted: boolean;
  confidence: number;
  reason: string;
  region: AutoGuitarRegion | null;
  centerX: number;
  centerY: number;
  angleDegrees: number;
  nearbyFingerCount: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function pointToLineDistance(point: { x: number; y: number }, line: AutoStringLine) {
  const dx = line.endX - line.startX;
  const dy = line.endY - line.startY;
  const denominator = Math.max(0.000001, dx * dx + dy * dy);
  const amount = clamp(((point.x - line.startX) * dx + (point.y - line.startY) * dy) / denominator, 0, 1);
  return Math.hypot(point.x - (line.startX + dx * amount), point.y - (line.startY + dy * amount));
}

function finitePoint(point: AutoPoint | undefined): point is AutoPoint {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= -0.05 && point.x <= 1.05 && point.y >= -0.05 && point.y <= 1.05);
}

function handBounds(points: AutoPoint[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

export function isPlausiblePlayingHand(hand: AutoHandEvidence) {
  if (!hand.hasHand || hand.landmarks.length < 21 || hand.handednessScore < 0.25) return false;
  const points = hand.landmarks.slice(0, 21);
  if (!points.every(finitePoint)) return false;
  const wrist = points[0];
  const middleMcp = points[9];
  if (!wrist || !middleMcp) return false;
  const palm = distance(wrist, middleMcp);
  const bounds = handBounds(points);
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  if (palm < 0.035 || palm > 0.30 || width < 0.055 || width > 0.62 || height < 0.055 || height > 0.72) return false;

  const fingerPairs: Array<[number, number]> = [[4, 2], [8, 5], [12, 9], [16, 13], [20, 17]];
  const plausibleFingers = fingerPairs.filter(([tipIndex, baseIndex]) => {
    const tip = points[tipIndex];
    const base = points[baseIndex];
    if (!tip || !base) return false;
    const length = distance(tip, base);
    return length >= palm * 0.35 && length <= palm * 3.9;
  }).length;
  return plausibleFingers >= 4;
}

function averageStringSpacing(lines: AutoStringLine[]) {
  if (lines.length < 2) return 0;
  const longest = [...lines].sort((a, b) => distance(b, { x: b.endX, y: b.endY }) - distance(a, { x: a.endX, y: a.endY }))[0] ?? lines[0];
  const dx = longest.endX - longest.startX;
  const dy = longest.endY - longest.startY;
  const magnitude = Math.max(0.000001, Math.hypot(dx, dy));
  const normalX = -dy / magnitude;
  const normalY = dx / magnitude;
  const projections = lines
    .map((line) => {
      const x = (line.startX + line.endX) / 2;
      const y = (line.startY + line.endY) / 2;
      return x * normalX + y * normalY;
    })
    .sort((a, b) => a - b);
  const gaps = projections.slice(1).map((value, index) => value - projections[index]).filter((value) => value > 0.001 && value < 0.20);
  if (!gaps.length) return 0;
  return gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
}

function expandAroundHand(hand: AutoHandEvidence, stringLines: AutoStringLine[]): AutoGuitarRegion {
  const bounds = handBounds(hand.landmarks.slice(0, 21));
  const handCenterX = (bounds.left + bounds.right) / 2;
  const handCenterY = (bounds.top + bounds.bottom) / 2;
  const stringNearHand = stringLines.flatMap((line) => {
    const points = [
      { x: line.startX, y: line.startY },
      { x: line.endX, y: line.endY },
      { x: (line.startX + line.endX) / 2, y: (line.startY + line.endY) / 2 },
    ];
    return points.filter((point) => Math.abs(point.x - handCenterX) <= 0.34 && Math.abs(point.y - handCenterY) <= 0.34);
  });
  const xValues = [bounds.left, bounds.right, ...stringNearHand.map((point) => point.x)];
  const yValues = [bounds.top, bounds.bottom, ...stringNearHand.map((point) => point.y)];
  let left = Math.min(...xValues) - 0.105;
  let right = Math.max(...xValues) + 0.105;
  let top = Math.min(...yValues) - 0.105;
  let bottom = Math.max(...yValues) + 0.105;

  const ensureSize = (minimum: number, maximum: number, start: number, end: number, center: number) => {
    let size = end - start;
    if (size < minimum) {
      start = center - minimum / 2;
      end = center + minimum / 2;
      size = minimum;
    }
    if (size > maximum) {
      start = center - maximum / 2;
      end = center + maximum / 2;
    }
    if (start < 0) {
      end -= start;
      start = 0;
    }
    if (end > 1) {
      start -= end - 1;
      end = 1;
    }
    return { start: clamp(start, 0, 1), end: clamp(end, 0, 1) };
  };

  const horizontal = ensureSize(0.36, 0.72, left, right, handCenterX);
  const vertical = ensureSize(0.34, 0.70, top, bottom, handCenterY);
  left = horizontal.start;
  right = horizontal.end;
  top = vertical.start;
  bottom = vertical.end;
  return { left, top, right, bottom };
}

export function evaluateAutomaticGuitarDetection(
  hand: AutoHandEvidence,
  strings: AutoStringEvidence,
): AutoGuitarDetection {
  const empty = (reason: string, confidence = 0): AutoGuitarDetection => ({
    accepted: false,
    confidence,
    reason,
    region: null,
    centerX: 0.5,
    centerY: 0.5,
    angleDegrees: strings.angleDegrees || 0,
    nearbyFingerCount: 0,
  });

  if (!strings.detected || strings.lines.length < 5 || strings.visibleLineCount < 4 || strings.confidence < 0.40) {
    return empty('규칙적인 기타줄 묶음이 부족합니다.', strings.confidence || 0);
  }
  if (!isPlausiblePlayingHand(hand)) return empty('기타줄 위의 정상 손 구조를 찾지 못했습니다.', strings.confidence * 0.45);

  const spacing = averageStringSpacing(strings.lines);
  if (spacing <= 0.002 || spacing >= 0.15) return empty('기타줄 간격이 비정상입니다.', strings.confidence * 0.55);
  const threshold = clamp(spacing * 3.0, 0.028, 0.085);
  const fingerIndices = [4, 8, 12, 16, 20];
  const nearbyFingerCount = fingerIndices.filter((index) => {
    const point = hand.landmarks[index];
    return point && Math.min(...strings.lines.map((line) => pointToLineDistance(point, line))) <= threshold;
  }).length;
  const palmPoints = [hand.landmarks[0], hand.landmarks[5], hand.landmarks[9], hand.landmarks[13], hand.landmarks[17]].filter(finitePoint);
  const nearbyPalmCount = palmPoints.filter((point) => Math.min(...strings.lines.map((line) => pointToLineDistance(point, line))) <= threshold * 1.45).length;
  if (nearbyFingerCount < 1 || nearbyFingerCount + nearbyPalmCount < 3) {
    return { ...empty('손과 기타줄이 같은 위치에서 확인되지 않았습니다.', strings.confidence * 0.62), nearbyFingerCount };
  }

  const bounds = handBounds(hand.landmarks.slice(0, 21));
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  const overlapScore = clamp((nearbyFingerCount + nearbyPalmCount) / 8, 0, 1);
  const confidence = clamp(strings.confidence * 0.56 + hand.handednessScore * 0.22 + overlapScore * 0.22, 0, 1);
  if (confidence < 0.48) {
    return { ...empty('자동 인식 신뢰도가 아직 부족합니다.', confidence), centerX, centerY, nearbyFingerCount };
  }
  return {
    accepted: true,
    confidence,
    reason: '기타줄 묶음과 연주 손이 같은 위치에서 확인됐습니다.',
    region: expandAroundHand(hand, strings.lines),
    centerX,
    centerY,
    angleDegrees: strings.angleDegrees,
    nearbyFingerCount,
  };
}

function regionCenter(region: AutoGuitarRegion) {
  return { x: (region.left + region.right) / 2, y: (region.top + region.bottom) / 2 };
}

function averageRegion(regions: AutoGuitarRegion[]): AutoGuitarRegion {
  const count = Math.max(1, regions.length);
  return {
    left: regions.reduce((sum, region) => sum + region.left, 0) / count,
    top: regions.reduce((sum, region) => sum + region.top, 0) / count,
    right: regions.reduce((sum, region) => sum + region.right, 0) / count,
    bottom: regions.reduce((sum, region) => sum + region.bottom, 0) / count,
  };
}

export class AutomaticGuitarGate {
  private detections: AutoGuitarDetection[] = [];

  constructor(
    private readonly required = 3,
    private readonly maximumCenterDrift = 0.14,
    private readonly maximumAngleDifference = 15,
  ) {}

  reset() {
    this.detections = [];
  }

  add(detection: AutoGuitarDetection) {
    if (!detection.accepted || !detection.region) {
      this.reset();
      return { locked: false, consecutive: 0, required: this.required, region: null as AutoGuitarRegion | null, confidence: 0 };
    }
    const previous = this.detections[this.detections.length - 1];
    if (previous?.region) {
      const previousCenter = regionCenter(previous.region);
      const nextCenter = regionCenter(detection.region);
      const centerDrift = distance(previousCenter, nextCenter);
      const angleDifference = Math.abs(previous.angleDegrees - detection.angleDegrees);
      if (centerDrift > this.maximumCenterDrift || angleDifference > this.maximumAngleDifference) this.reset();
    }
    this.detections.push(detection);
    if (this.detections.length > this.required) this.detections.shift();
    const locked = this.detections.length >= this.required;
    return {
      locked,
      consecutive: this.detections.length,
      required: this.required,
      region: locked ? averageRegion(this.detections.map((item) => item.region!).filter(Boolean)) : detection.region,
      confidence: this.detections.reduce((sum, item) => sum + item.confidence, 0) / this.detections.length,
    };
  }
}
