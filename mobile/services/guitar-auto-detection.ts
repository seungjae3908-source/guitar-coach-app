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
export type AutoGuitarStructureEvidence = {
  detected: boolean;
  model: string;
  label: string;
  objectConfidence: number;
  structureConfidence: number;
  objectBox: AutoGuitarRegion;
  bodyDetected: boolean;
  bodyConfidence: number;
  bodyBox: AutoGuitarRegion;
  neckDetected: boolean;
  neckConfidence: number;
  neckAngleDegrees: number;
  neckStartX: number;
  neckStartY: number;
  neckEndX: number;
  neckEndY: number;
  soundholeDetected: boolean;
  soundholeConfidence: number;
  soundholeCenterX: number;
  soundholeCenterY: number;
  soundholeRadiusRatio: number;
  pickupDetected: boolean;
  pickupConfidence: number;
  pickupCenterX: number;
  pickupCenterY: number;
  bridgeDetected: boolean;
  bridgeConfidence: number;
  bridgeCenterX: number;
  bridgeCenterY: number;
  bridgeAngleDegrees: number;
};
export type AutoGuitarDetection = {
  accepted: boolean;
  confidence: number;
  reason: string;
  region: AutoGuitarRegion | null;
  centerX: number;
  centerY: number;
  angleDegrees: number;
  nearbyFingerCount: number;
  objectCenterX: number;
  objectCenterY: number;
  resonatorCenterX: number;
  resonatorCenterY: number;
  bridgeCenterX: number;
  bridgeCenterY: number;
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

function pointToSegmentDistance(point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = Math.max(0.000001, dx * dx + dy * dy);
  const amount = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator, 0, 1);
  return Math.hypot(point.x - (start.x + dx * amount), point.y - (start.y + dy * amount));
}

function finitePoint(point: AutoPoint | undefined): point is AutoPoint {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= -0.05 && point.x <= 1.05 && point.y >= -0.05 && point.y <= 1.05);
}

function finiteRegion(region: AutoGuitarRegion | undefined) {
  return Boolean(
    region
      && [region.left, region.top, region.right, region.bottom].every(Number.isFinite)
      && region.left >= -0.03
      && region.top >= -0.03
      && region.right <= 1.03
      && region.bottom <= 1.03
      && region.right > region.left
      && region.bottom > region.top,
  );
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

function regionCenter(region: AutoGuitarRegion) {
  return { x: (region.left + region.right) / 2, y: (region.top + region.bottom) / 2 };
}

function pointInRegion(point: { x: number; y: number }, region: AutoGuitarRegion, margin = 0) {
  return point.x >= region.left - margin
    && point.x <= region.right + margin
    && point.y >= region.top - margin
    && point.y <= region.bottom + margin;
}

function angleDifference(left: number, right: number) {
  let difference = Math.abs(left - right) % 180;
  if (difference > 90) difference = 180 - difference;
  return difference;
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
  const lineLength = (line: AutoStringLine) => Math.hypot(line.endX - line.startX, line.endY - line.startY);
  const longest = [...lines].sort((a, b) => lineLength(b) - lineLength(a))[0] ?? lines[0];
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

function playingPoint(hand: AutoHandEvidence) {
  const indices = [4, 8, 12, 16];
  const points = indices.map((index) => hand.landmarks[index]).filter(finitePoint);
  if (!points.length) return regionCenter(handBounds(hand.landmarks.slice(0, 21)));
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function structureResonator(structure: AutoGuitarStructureEvidence) {
  if (structure.soundholeDetected && structure.soundholeConfidence >= structure.pickupConfidence) {
    return {
      detected: true,
      confidence: structure.soundholeConfidence,
      x: structure.soundholeCenterX,
      y: structure.soundholeCenterY,
      label: '사운드홀',
    };
  }
  if (structure.pickupDetected) {
    return {
      detected: true,
      confidence: structure.pickupConfidence,
      x: structure.pickupCenterX,
      y: structure.pickupCenterY,
      label: '픽업',
    };
  }
  return { detected: false, confidence: 0, x: 0.5, y: 0.5, label: '사운드홀/픽업' };
}

function expandPlayingRegion(
  hand: AutoHandEvidence,
  resonator: { x: number; y: number },
  bridge: { x: number; y: number },
  body: AutoGuitarRegion,
): AutoGuitarRegion {
  const handPoints = hand.landmarks.slice(0, 21);
  const xs = [...handPoints.map((point) => point.x), resonator.x, bridge.x];
  const ys = [...handPoints.map((point) => point.y), resonator.y, bridge.y];
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  let left = Math.max(body.left - 0.03, Math.min(...xs) - 0.075);
  let right = Math.min(body.right + 0.03, Math.max(...xs) + 0.075);
  let top = Math.max(body.top - 0.03, Math.min(...ys) - 0.075);
  let bottom = Math.min(body.bottom + 0.03, Math.max(...ys) + 0.075);

  const ensure = (start: number, end: number, center: number, minimum: number, maximum: number) => {
    let width = end - start;
    if (width < minimum) {
      start = center - minimum / 2;
      end = center + minimum / 2;
      width = minimum;
    }
    if (width > maximum) {
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

  const horizontal = ensure(left, right, centerX, 0.30, 0.66);
  const vertical = ensure(top, bottom, centerY, 0.28, 0.62);
  left = horizontal.start;
  right = horizontal.end;
  top = vertical.start;
  bottom = vertical.end;
  return { left, top, right, bottom };
}

export function evaluateAutomaticGuitarDetection(
  hand: AutoHandEvidence,
  strings: AutoStringEvidence,
  structure: AutoGuitarStructureEvidence,
): AutoGuitarDetection {
  const objectCenter = finiteRegion(structure.objectBox) ? regionCenter(structure.objectBox) : { x: 0.5, y: 0.5 };
  const resonator = structureResonator(structure);
  const empty = (reason: string, confidence = 0, nearbyFingerCount = 0): AutoGuitarDetection => ({
    accepted: false,
    confidence: clamp(confidence, 0, 1),
    reason,
    region: null,
    centerX: 0.5,
    centerY: 0.5,
    angleDegrees: strings.angleDegrees || structure.neckAngleDegrees || 0,
    nearbyFingerCount,
    objectCenterX: objectCenter.x,
    objectCenterY: objectCenter.y,
    resonatorCenterX: resonator.x,
    resonatorCenterY: resonator.y,
    bridgeCenterX: structure.bridgeCenterX || 0.5,
    bridgeCenterY: structure.bridgeCenterY || 0.5,
  });

  if (!structure.detected || structure.label.toLowerCase() !== 'guitar' || structure.objectConfidence < 0.28 || !finiteRegion(structure.objectBox)) {
    return empty('기타 객체 모델이 기타 몸통 전체를 확인하지 못했습니다.', structure.objectConfidence || 0);
  }
  const objectWidth = structure.objectBox.right - structure.objectBox.left;
  const objectHeight = structure.objectBox.bottom - structure.objectBox.top;
  const objectArea = objectWidth * objectHeight;
  if (objectArea < 0.055 || objectArea > 0.94 || Math.max(objectWidth, objectHeight) < 0.30) {
    return empty('기타 객체 크기나 화면 배치가 판정 범위를 벗어났습니다.', structure.objectConfidence * 0.55);
  }
  if (!structure.bodyDetected || structure.bodyConfidence < 0.34 || !finiteRegion(structure.bodyBox)) {
    return empty('기타 몸통 윤곽 증거가 부족합니다.', structure.bodyConfidence * 0.65);
  }
  if (!structure.neckDetected || structure.neckConfidence < 0.32) {
    return empty('기타 넥 방향 증거가 부족합니다.', structure.neckConfidence * 0.65);
  }
  if (!resonator.detected || resonator.confidence < 0.30 || !pointInRegion(resonator, structure.bodyBox, 0.035)) {
    return empty('몸통 안의 사운드홀 또는 픽업 구조를 확인하지 못했습니다.', resonator.confidence * 0.65);
  }
  if (!structure.bridgeDetected || structure.bridgeConfidence < 0.28) {
    return empty('기타줄을 가로지르는 브리지 구조를 확인하지 못했습니다.', structure.bridgeConfidence * 0.65);
  }
  const bridge = { x: structure.bridgeCenterX, y: structure.bridgeCenterY };
  if (!pointInRegion(bridge, structure.bodyBox, 0.045)) {
    return empty('브리지 후보가 기타 몸통 밖에 있어 승인하지 않았습니다.', structure.bridgeConfidence * 0.55);
  }
  const anchorDistance = distance(resonator, bridge);
  if (anchorDistance < 0.025 || anchorDistance > Math.max(0.38, Math.hypot(objectWidth, objectHeight) * 0.58)) {
    return empty('사운드홀/픽업과 브리지의 위치 관계가 기타 구조와 맞지 않습니다.', structure.structureConfidence * 0.58);
  }

  if (!strings.detected || strings.lines.length < 5 || strings.visibleLineCount < 4 || strings.confidence < 0.40) {
    return empty('기타 객체 안에서 규칙적인 6줄 묶음을 확인하지 못했습니다.', strings.confidence || 0);
  }
  const neckAngleDifference = angleDifference(strings.angleDegrees, structure.neckAngleDegrees);
  if (neckAngleDifference > 19) {
    return empty('기타줄 방향과 넥 방향이 서로 맞지 않습니다.', Math.min(strings.confidence, structure.neckConfidence) * 0.62);
  }
  const bridgePerpendicularError = Math.abs(90 - angleDifference(strings.angleDegrees, structure.bridgeAngleDegrees));
  if (bridgePerpendicularError > 30) {
    return empty('브리지가 기타줄을 가로지르는 방향으로 확인되지 않았습니다.', structure.bridgeConfidence * 0.62);
  }
  const lineCenters = strings.lines.map((line) => ({ x: (line.startX + line.endX) / 2, y: (line.startY + line.endY) / 2 }));
  const stringCentersInside = lineCenters.filter((point) => pointInRegion(point, structure.objectBox, 0.045)).length;
  if (stringCentersInside < Math.min(5, strings.lines.length)) {
    return empty('검출된 줄 묶음이 기타 객체 경계와 겹치지 않습니다.', strings.confidence * 0.58);
  }

  if (!isPlausiblePlayingHand(hand)) return empty('기타 위의 정상적인 손 21개 관절을 찾지 못했습니다.', strings.confidence * 0.42);
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
    return empty('손과 기타줄이 같은 위치에서 확인되지 않았습니다.', strings.confidence * 0.62, nearbyFingerCount);
  }

  const handPlayPoint = playingPoint(hand);
  if (!pointInRegion(handPlayPoint, structure.objectBox, 0.055)) {
    return empty('연주 손이 기타 객체 영역 안에 있지 않습니다.', hand.handednessScore * 0.52, nearbyFingerCount);
  }
  const bodyDiagonal = Math.hypot(
    structure.bodyBox.right - structure.bodyBox.left,
    structure.bodyBox.bottom - structure.bodyBox.top,
  );
  const playingZoneDistance = pointToSegmentDistance(handPlayPoint, resonator, bridge);
  if (playingZoneDistance > clamp(bodyDiagonal * 0.34, 0.075, 0.18)) {
    return empty('오른손이 사운드홀/픽업과 브리지 사이의 연주 구역에서 확인되지 않았습니다.', hand.handednessScore * 0.58, nearbyFingerCount);
  }

  const bounds = handBounds(hand.landmarks.slice(0, 21));
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  const overlapScore = clamp((nearbyFingerCount + nearbyPalmCount) / 8, 0, 1);
  const geometryScore = clamp(
    structure.objectConfidence * 0.24
      + structure.bodyConfidence * 0.16
      + structure.neckConfidence * 0.15
      + resonator.confidence * 0.15
      + structure.bridgeConfidence * 0.15
      + structure.structureConfidence * 0.15,
    0,
    1,
  );
  const confidence = clamp(
    geometryScore * 0.48
      + strings.confidence * 0.22
      + hand.handednessScore * 0.14
      + overlapScore * 0.10
      + (1 - clamp(playingZoneDistance / 0.18, 0, 1)) * 0.06,
    0,
    1,
  );
  if (confidence < 0.50) {
    return { ...empty('모든 구조가 보이지만 자동 인식 신뢰도가 아직 부족합니다.', confidence, nearbyFingerCount), centerX, centerY };
  }

  return {
    accepted: true,
    confidence,
    reason: `기타 객체·몸통·넥·${resonator.label}·브리지·6줄·연주 손의 위치 관계를 확인했습니다.`,
    region: expandPlayingRegion(hand, resonator, bridge, structure.bodyBox),
    centerX,
    centerY,
    angleDegrees: strings.angleDegrees,
    nearbyFingerCount,
    objectCenterX: objectCenter.x,
    objectCenterY: objectCenter.y,
    resonatorCenterX: resonator.x,
    resonatorCenterY: resonator.y,
    bridgeCenterX: bridge.x,
    bridgeCenterY: bridge.y,
  };
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
    private readonly required = 5,
    private readonly maximumCenterDrift = 0.09,
    private readonly maximumAngleDifference = 11,
    private readonly maximumAnchorDrift = 0.075,
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
      const centerDrift = distance(regionCenter(previous.region), regionCenter(detection.region));
      const objectDrift = distance(
        { x: previous.objectCenterX, y: previous.objectCenterY },
        { x: detection.objectCenterX, y: detection.objectCenterY },
      );
      const resonatorDrift = distance(
        { x: previous.resonatorCenterX, y: previous.resonatorCenterY },
        { x: detection.resonatorCenterX, y: detection.resonatorCenterY },
      );
      const bridgeDrift = distance(
        { x: previous.bridgeCenterX, y: previous.bridgeCenterY },
        { x: detection.bridgeCenterX, y: detection.bridgeCenterY },
      );
      const rotation = angleDifference(previous.angleDegrees, detection.angleDegrees);
      if (
        centerDrift > this.maximumCenterDrift
        || objectDrift > this.maximumCenterDrift
        || resonatorDrift > this.maximumAnchorDrift
        || bridgeDrift > this.maximumAnchorDrift
        || rotation > this.maximumAngleDifference
      ) this.reset();
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
