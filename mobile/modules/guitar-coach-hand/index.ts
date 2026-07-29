import { requireOptionalNativeModule } from 'expo';

import { publishLiveAnalysisFrame } from '../../services/analysis-stream';

export type HandLandmarkName =
  | 'wrist'
  | 'thumbCmc'
  | 'thumbMcp'
  | 'thumbIp'
  | 'thumbTip'
  | 'indexMcp'
  | 'indexPip'
  | 'indexDip'
  | 'indexTip'
  | 'middleMcp'
  | 'middlePip'
  | 'middleDip'
  | 'middleTip'
  | 'ringMcp'
  | 'ringPip'
  | 'ringDip'
  | 'ringTip'
  | 'pinkyMcp'
  | 'pinkyPip'
  | 'pinkyDip'
  | 'pinkyTip';

export type HandLandmarkPoint = {
  index: number;
  name: HandLandmarkName;
  x: number;
  y: number;
  z: number;
};

export type PickColor =
  | 'none'
  | 'auto'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'white'
  | 'black';

export type PickAnalysisResult = {
  detected: boolean;
  color: PickColor | string;
  confidence: number;
  angleDegrees: number;
  exposure: number;
  centerX: number;
  centerY: number;
};

export type GuitarStringLine = {
  visualIndex: 1 | 2 | 3 | 4 | 5 | 6;
  stringNumber: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  strength: number;
};

export type GuitarStringTrackingResult = {
  detected: boolean;
  confidence: number;
  angleDegrees: number;
  visibleLineCount: number;
  stringOrder: 'low-to-high' | 'high-to-low' | 'unknown' | string;
  numberingConfidence: number;
  nearestVisualIndex: number;
  nearestStringNumber: number;
  nearestDistanceRatio: number;
  lines: GuitarStringLine[];
};

export type HandAnalysisResult = {
  hasHand: boolean;
  imageWidth: number;
  imageHeight: number;
  latencyMs: number;
  handedness: 'Left' | 'Right' | 'Unknown' | string;
  handednessScore: number;
  landmarks: HandLandmarkPoint[];
  pick: PickAnalysisResult;
  stringTracking?: GuitarStringTrackingResult;
};

type GuitarCoachHandModule = {
  androidHandCoachAvailable: boolean;
  analyzeHandAsync(uri: string, pickColor: PickColor): Promise<HandAnalysisResult>;
};

type GuitarCoachStringVisionModule = {
  androidStringVisionAvailable: boolean;
  analyzeStringsAsync(uri: string): Promise<GuitarStringTrackingResult>;
};

const NativeModule = requireOptionalNativeModule<GuitarCoachHandModule>('GuitarCoachHand');
const StringVisionModule = requireOptionalNativeModule<GuitarCoachStringVisionModule>('GuitarCoachStringVision');

export const isDetailedHandCoachAvailable = Boolean(NativeModule?.androidHandCoachAvailable);
export const isAutomaticStringVisionAvailable = Boolean(StringVisionModule?.androidStringVisionAvailable);

function pointToLineDistance(point: { x: number; y: number }, line: GuitarStringLine) {
  const abX = line.endX - line.startX;
  const abY = line.endY - line.startY;
  const denominator = Math.max(0.000001, abX * abX + abY * abY);
  const amount = Math.min(1, Math.max(0, ((point.x - line.startX) * abX + (point.y - line.startY) * abY) / denominator));
  const x = line.startX + abX * amount;
  const y = line.startY + abY * amount;
  return Math.hypot(point.x - x, point.y - y);
}

function lineMidpoint(line: GuitarStringLine) {
  return { x: (line.startX + line.endX) / 2, y: (line.startY + line.endY) / 2 };
}

function averageLineSpacing(lines: GuitarStringLine[]) {
  const ordered = [...lines].sort((a, b) => a.visualIndex - b.visualIndex);
  const distances = ordered.slice(1).map((line, index) => {
    const current = lineMidpoint(line);
    const previous = lineMidpoint(ordered[index]);
    return Math.hypot(current.x - previous.x, current.y - previous.y);
  }).filter((value) => value > 0.001);
  return distances.length ? distances.reduce((sum, value) => sum + value, 0) / distances.length : 0.03;
}

function contactPoint(result: HandAnalysisResult) {
  if (result.pick.detected && result.pick.confidence >= 0.45) {
    return { x: result.pick.centerX, y: result.pick.centerY };
  }
  const tips = [4, 8, 12, 16].map((index) => result.landmarks[index]).filter(Boolean);
  if (!tips.length) return null;
  return {
    x: tips.reduce((sum, point) => sum + point.x, 0) / tips.length,
    y: tips.reduce((sum, point) => sum + point.y, 0) / tips.length,
  };
}

function fuseNearestString(tracking: GuitarStringTrackingResult, hand: HandAnalysisResult): GuitarStringTrackingResult {
  if (!tracking.detected || tracking.lines.length < 4 || !hand.hasHand) return tracking;
  const point = contactPoint(hand);
  if (!point) return tracking;
  const candidates = tracking.lines
    .map((line) => ({ line, distance: pointToLineDistance(point, line) }))
    .sort((a, b) => a.distance - b.distance);
  const nearest = candidates[0];
  const distanceRatio = nearest ? nearest.distance / Math.max(0.004, averageLineSpacing(tracking.lines)) : 1;
  const numberTrusted = Boolean(
    nearest
    && nearest.line.stringNumber > 0
    && tracking.confidence >= 0.58
    && tracking.numberingConfidence >= 0.62
    && distanceRatio <= 0.82
  );
  return {
    ...tracking,
    nearestVisualIndex: nearest && distanceRatio <= 1.15 ? nearest.line.visualIndex : 0,
    nearestStringNumber: numberTrusted ? nearest.line.stringNumber : 0,
    nearestDistanceRatio: Math.round(distanceRatio * 100) / 100,
  };
}

async function analyzeHandRawAsync(uri: string, pickColor: PickColor) {
  if (!NativeModule) throw new Error('손가락 상세 분석 모듈을 사용할 수 없습니다.');
  return NativeModule.analyzeHandAsync(uri, pickColor);
}

function publish(result: HandAnalysisResult) {
  publishLiveAnalysisFrame({ kind: 'hand', capturedAt: Date.now(), result });
  return result;
}

export async function analyzeHandWithStringsAsync(uri: string, pickColor: PickColor) {
  let tracking: GuitarStringTrackingResult | null = null;
  if (StringVisionModule?.androidStringVisionAvailable) {
    try {
      tracking = await StringVisionModule.analyzeStringsAsync(uri);
    } catch {
      tracking = null;
    }
  }
  const hand = await analyzeHandRawAsync(uri, pickColor);
  const result = tracking ? { ...hand, stringTracking: fuseNearestString(tracking, hand) } : hand;
  return publish(result);
}

export async function analyzeHandAsync(uri: string, pickColor: PickColor) {
  return analyzeHandWithStringsAsync(uri, pickColor);
}
