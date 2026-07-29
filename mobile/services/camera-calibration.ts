import type { GuitarModeId } from '../config/guitar-mode-profiles';

export type NormalizedPoint = { x: number; y: number };

export type StringGuide = {
  stringNumber: 1 | 2 | 3 | 4 | 5 | 6;
  start: NormalizedPoint;
  end: NormalizedPoint;
};

export type BridgeGuide = {
  top: NormalizedPoint;
  bottom: NormalizedPoint;
};

export type CameraCalibration = {
  id: string;
  guitarMode: GuitarModeId;
  cameraFacing: 'front' | 'back';
  mirrored: boolean;
  createdAt: string;
  handCenter?: NormalizedPoint;
  pickCenter?: NormalizedPoint;
  strings: StringGuide[];
  bridge?: BridgeGuide;
  frameRotationDegrees: 0 | 90 | 180 | 270;
  confidencePercent: number;
};

export type CalibrationDraft = {
  handCenter?: NormalizedPoint;
  pickCenter?: NormalizedPoint;
  sixthStringLeft?: NormalizedPoint;
  sixthStringRight?: NormalizedPoint;
  firstStringLeft?: NormalizedPoint;
  firstStringRight?: NormalizedPoint;
  bridgeTop?: NormalizedPoint;
  bridgeBottom?: NormalizedPoint;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function lerpPoint(a: NormalizedPoint, b: NormalizedPoint, amount: number): NormalizedPoint {
  return {
    x: a.x + (b.x - a.x) * amount,
    y: a.y + (b.y - a.y) * amount,
  };
}

function validPoint(point: NormalizedPoint | undefined): point is NormalizedPoint {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
}

export function buildStringGuides(draft: CalibrationDraft): StringGuide[] {
  if (!validPoint(draft.sixthStringLeft) || !validPoint(draft.sixthStringRight) || !validPoint(draft.firstStringLeft) || !validPoint(draft.firstStringRight)) {
    return [];
  }

  return Array.from({ length: 6 }, (_, index) => {
    const amount = index / 5;
    const stringNumber = (6 - index) as 1 | 2 | 3 | 4 | 5 | 6;
    return {
      stringNumber,
      start: lerpPoint(draft.sixthStringLeft!, draft.firstStringLeft!, amount),
      end: lerpPoint(draft.sixthStringRight!, draft.firstStringRight!, amount),
    };
  });
}

export function validateCalibrationDraft(draft: CalibrationDraft) {
  const missing: string[] = [];
  if (!validPoint(draft.handCenter)) missing.push('오른손 중심');
  if (!validPoint(draft.sixthStringLeft) || !validPoint(draft.sixthStringRight)) missing.push('6번 줄 좌우');
  if (!validPoint(draft.firstStringLeft) || !validPoint(draft.firstStringRight)) missing.push('1번 줄 좌우');
  if (!validPoint(draft.bridgeTop) || !validPoint(draft.bridgeBottom)) missing.push('브리지 위아래');

  const strings = buildStringGuides(draft);
  let geometryValid = strings.length === 6;
  if (geometryValid) {
    const averageGap = strings.slice(0, -1).reduce((sum, string, index) => {
      const next = strings[index + 1];
      const currentMidY = (string.start.y + string.end.y) / 2;
      const nextMidY = (next.start.y + next.end.y) / 2;
      return sum + Math.abs(nextMidY - currentMidY);
    }, 0) / 5;
    geometryValid = averageGap >= 0.008 && averageGap <= 0.16;
  }

  return {
    complete: missing.length === 0 && geometryValid,
    missing,
    geometryValid,
    message: missing.length > 0
      ? `${missing.join(', ')} 보정이 필요합니다.`
      : geometryValid
        ? '줄과 브리지 보정이 완료되었습니다.'
        : '줄 가이드 간격이 비정상입니다. 1번 줄과 6번 줄을 다시 지정하세요.',
  };
}

export function createCameraCalibration(
  draft: CalibrationDraft,
  options: {
    guitarMode: GuitarModeId;
    cameraFacing: 'front' | 'back';
    mirrored: boolean;
    frameRotationDegrees?: 0 | 90 | 180 | 270;
  },
): CameraCalibration {
  const validation = validateCalibrationDraft(draft);
  if (!validation.complete) throw new Error(validation.message);
  const strings = buildStringGuides(draft);
  const bridge = draft.bridgeTop && draft.bridgeBottom
    ? { top: draft.bridgeTop, bottom: draft.bridgeBottom }
    : undefined;
  const completedPoints = [
    draft.handCenter,
    draft.pickCenter,
    draft.sixthStringLeft,
    draft.sixthStringRight,
    draft.firstStringLeft,
    draft.firstStringRight,
    draft.bridgeTop,
    draft.bridgeBottom,
  ].filter(validPoint).length;

  return {
    id: `calibration-${Date.now()}`,
    guitarMode: options.guitarMode,
    cameraFacing: options.cameraFacing,
    mirrored: options.mirrored,
    createdAt: new Date().toISOString(),
    handCenter: draft.handCenter,
    pickCenter: draft.pickCenter,
    strings,
    bridge,
    frameRotationDegrees: options.frameRotationDegrees ?? 0,
    confidencePercent: Math.round(clamp01(completedPoints / 8) * 100),
  };
}

export function distanceToStringGuide(point: NormalizedPoint, guide: StringGuide) {
  const ax = guide.start.x;
  const ay = guide.start.y;
  const bx = guide.end.x;
  const by = guide.end.y;
  const abx = bx - ax;
  const aby = by - ay;
  const denominator = Math.max(0.000001, abx * abx + aby * aby);
  const amount = clamp01(((point.x - ax) * abx + (point.y - ay) * aby) / denominator);
  const nearest = { x: ax + abx * amount, y: ay + aby * amount };
  return Math.hypot(point.x - nearest.x, point.y - nearest.y);
}

export function nearestStringGuide(point: NormalizedPoint, calibration: CameraCalibration) {
  return calibration.strings.reduce<{ guide: StringGuide; distance: number } | null>((best, guide) => {
    const distance = distanceToStringGuide(point, guide);
    if (!best || distance < best.distance) return { guide, distance };
    return best;
  }, null);
}
