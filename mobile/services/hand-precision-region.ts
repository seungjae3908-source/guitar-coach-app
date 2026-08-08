export type HandPrecisionPoint = { x: number; y: number };

export type HandPrecisionRegion = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type HandPrecisionPayload = {
  applied?: boolean;
  passes?: number;
  reason?: string;
  sourcePalmSize?: number;
  sourceEdgeMargin?: number;
  regionArea?: number;
  region?: Partial<HandPrecisionRegion> | null;
  fallbackReason?: string;
};

export type HandPrecisionDecision = {
  shouldRefine: boolean;
  reason: 'no-hand' | 'insufficient-landmarks' | 'invalid-landmarks' | 'hand-too-small' | 'already-detailed' | 'region-ready';
  sourcePalmSize: number;
  sourceEdgeMargin: number;
  regionArea: number;
  region?: HandPrecisionRegion;
};

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

function fitAxis(center: number, requestedSize: number) {
  const size = clamp(requestedSize, 0.06, 0.98);
  let start = center - size / 2;
  let end = center + size / 2;
  if (start < 0.01) { end += 0.01 - start; start = 0.01; }
  if (end > 0.99) { start -= end - 0.99; end = 0.99; }
  return { start: clamp(start, 0.01, 0.93), end: clamp(end, 0.07, 0.99) };
}

export function rawPalmSize(landmarks: HandPrecisionPoint[]) {
  const wrist = landmarks[0];
  const middleMcp = landmarks[9];
  return wrist && middleMcp ? Math.hypot(wrist.x - middleMcp.x, wrist.y - middleMcp.y) : 0;
}

export function effectiveHandDetailSize(input: {
  landmarks: HandPrecisionPoint[];
  precision?: HandPrecisionPayload | null;
}) {
  const raw = rawPalmSize(input.landmarks);
  const region = input.precision?.applied ? input.precision.region : null;
  const wrist = input.landmarks[0];
  const middleMcp = input.landmarks[9];
  if (!region || !wrist || !middleMcp) return raw;
  const width = Number(region.right) - Number(region.left);
  const height = Number(region.bottom) - Number(region.top);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0.06 || height < 0.06) return raw;
  return Math.hypot((wrist.x - middleMcp.x) / width, (wrist.y - middleMcp.y) / height);
}

export function hasUsableHandDetail(input: {
  hasHand: boolean;
  handednessScore: number;
  landmarks: HandPrecisionPoint[];
  precision?: HandPrecisionPayload | null;
}) {
  return input.hasHand
    && input.landmarks.length >= 21
    && input.handednessScore >= 0.30
    && effectiveHandDetailSize(input) >= 0.105;
}

export function decideHandPrecisionRegion(input: { hasHand: boolean; landmarks: HandPrecisionPoint[] }): HandPrecisionDecision {
  if (!input.hasHand) return { shouldRefine: false, reason: 'no-hand', sourcePalmSize: 0, sourceEdgeMargin: 0, regionArea: 1 };
  if (input.landmarks.length < 21) return { shouldRefine: false, reason: 'insufficient-landmarks', sourcePalmSize: 0, sourceEdgeMargin: 0, regionArea: 1 };
  const points = input.landmarks.slice(0, 21);
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return { shouldRefine: false, reason: 'invalid-landmarks', sourcePalmSize: 0, sourceEdgeMargin: 0, regionArea: 1 };
  }
  const xs = points.map((point) => clamp(point.x, 0, 1));
  const ys = points.map((point) => clamp(point.y, 0, 1));
  const minimumX = Math.min(...xs);
  const maximumX = Math.max(...xs);
  const minimumY = Math.min(...ys);
  const maximumY = Math.max(...ys);
  const sourcePalmSize = rawPalmSize(points);
  const sourceEdgeMargin = Math.min(minimumX, 1 - maximumX, minimumY, 1 - maximumY);
  if (sourcePalmSize < 0.016) return { shouldRefine: false, reason: 'hand-too-small', sourcePalmSize, sourceEdgeMargin, regionArea: 1 };
  const boxWidth = Math.max(0.02, maximumX - minimumX);
  const boxHeight = Math.max(0.02, maximumY - minimumY);
  const horizontalPadding = Math.max(0.06, sourcePalmSize * 0.68);
  const verticalPadding = Math.max(0.07, sourcePalmSize * 0.76);
  const requestedWidth = clamp(Math.max(0.28, boxWidth + horizontalPadding * 2, sourcePalmSize * 3.0), 0.28, 0.78);
  const requestedHeight = clamp(Math.max(0.32, boxHeight + verticalPadding * 2, sourcePalmSize * 3.35), 0.32, 0.82);
  const horizontal = fitAxis((minimumX + maximumX) / 2, requestedWidth);
  const vertical = fitAxis((minimumY + maximumY) / 2, requestedHeight);
  const region = { left: horizontal.start, top: vertical.start, right: horizontal.end, bottom: vertical.end };
  const regionArea = (region.right - region.left) * (region.bottom - region.top);
  const alreadyDetailed = sourcePalmSize >= 0.30 && sourceEdgeMargin >= 0.075 && boxWidth >= 0.34 && boxHeight >= 0.34;
  if (alreadyDetailed || regionArea >= 0.76) return { shouldRefine: false, reason: 'already-detailed', sourcePalmSize, sourceEdgeMargin, regionArea, region };
  return { shouldRefine: true, reason: 'region-ready', sourcePalmSize, sourceEdgeMargin, regionArea, region };
}
