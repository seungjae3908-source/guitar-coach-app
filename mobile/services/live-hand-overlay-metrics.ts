export type OverlayPoint = { x: number; y: number };

export type LiveHandMotionInput = {
  capturedAt: number;
  wrist: OverlayPoint | null;
  activePoint: OverlayPoint | null;
  palmSize: number;
};

export type LiveHandMotionMetric = {
  active: boolean;
  angleDegrees: number | null;
  radiusPalmWidths: number | null;
  travelPalmWidths: number;
  confidencePercent: number;
  start: OverlayPoint;
  end: OverlayPoint;
  wrist: OverlayPoint;
};

type MotionSample = {
  capturedAt: number;
  point: OverlayPoint;
  wrist: OverlayPoint;
  palmSize: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const distance = (left: OverlayPoint, right: OverlayPoint) => Math.hypot(left.x - right.x, left.y - right.y);

function finitePoint(point: OverlayPoint | null): point is OverlayPoint {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
}

function normalizeAngle(degrees: number) {
  let value = degrees;
  while (value > 180) value -= 360;
  while (value <= -180) value += 360;
  return value;
}

export class LiveHandOverlayMotionTracker {
  private samples: MotionSample[] = [];

  reset() {
    this.samples = [];
  }

  process(input: LiveHandMotionInput): LiveHandMotionMetric | null {
    if (
      !finitePoint(input.wrist)
      || !finitePoint(input.activePoint)
      || !Number.isFinite(input.capturedAt)
      || !Number.isFinite(input.palmSize)
      || input.palmSize < 0.012
    ) {
      this.reset();
      return null;
    }

    const sample: MotionSample = {
      capturedAt: input.capturedAt,
      point: input.activePoint,
      wrist: input.wrist,
      palmSize: input.palmSize,
    };
    this.samples.push(sample);
    this.samples = this.samples
      .filter((item) => input.capturedAt - item.capturedAt <= 420)
      .slice(-18);

    const preferred = this.samples.filter((item) => input.capturedAt - item.capturedAt >= 90);
    const start = preferred.at(-1) ?? this.samples[0];
    const elapsed = Math.max(0, input.capturedAt - start.capturedAt);
    const referencePalm = Math.max(0.012, (start.palmSize + sample.palmSize) / 2);
    const travelPalmWidths = distance(start.point, sample.point) / referencePalm;
    const radiusPalmWidths = distance(sample.wrist, sample.point) / Math.max(0.012, sample.palmSize);
    const dx = sample.point.x - start.point.x;
    const dy = sample.point.y - start.point.y;
    const angleDegrees = elapsed >= 35 && travelPalmWidths >= 0.02
      ? normalizeAngle(Math.atan2(dy, dx) * 180 / Math.PI)
      : null;
    const active = elapsed >= 55 && travelPalmWidths >= 0.055;
    const confidencePercent = active
      ? Math.round(clamp(
        42
          + Math.min(34, travelPalmWidths * 80)
          + Math.min(16, elapsed / 18)
          + Math.min(8, this.samples.length),
        0,
        99,
      ))
      : Math.round(clamp(travelPalmWidths / 0.055 * 45, 0, 45));

    return {
      active,
      angleDegrees,
      radiusPalmWidths,
      travelPalmWidths,
      confidencePercent,
      start: start.point,
      end: sample.point,
      wrist: sample.wrist,
    };
  }
}
