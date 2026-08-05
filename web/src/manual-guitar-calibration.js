const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, finite(value)));

function validPoint(point) {
  return Boolean(point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)));
}

function point(pointLike) {
  return { x: clamp(pointLike?.x), y: clamp(pointLike?.y) };
}

function distance(left, right) {
  if (!validPoint(left) || !validPoint(right)) return Infinity;
  return Math.hypot(finite(left.x) - finite(right.x), finite(left.y) - finite(right.y));
}

function normalize(vector, fallback = { x: 1, y: 0 }) {
  const x = finite(vector?.x, fallback.x);
  const y = finite(vector?.y, fallback.y);
  const length = Math.hypot(x, y);
  return length > 0.0001 ? { x: x / length, y: y / length } : { ...fallback };
}

function dot(entry, axis) {
  return finite(entry?.x) * finite(axis?.x) + finite(entry?.y) * finite(axis?.y);
}

function fromAxes(tangentProjection, normalProjection, tangent, normal) {
  return {
    x: clamp(tangent.x * tangentProjection + normal.x * normalProjection),
    y: clamp(tangent.y * tangentProjection + normal.y * normalProjection),
  };
}

function angleDegrees(axis) {
  return Math.atan2(axis.y, axis.x) * 180 / Math.PI;
}

function makeLines({ tangent, normal, supportMin, supportMax, center, halfWidth }) {
  const lines = [];
  for (let index = 0; index < 6; index += 1) {
    const ratio = index / 5;
    const offset = -halfWidth + ratio * halfWidth * 2;
    const projection = center + offset;
    lines.push({
      start: fromAxes(supportMin, projection, tangent, normal),
      end: fromAxes(supportMax, projection, tangent, normal),
      confidence: 0.96,
      synthetic: true,
      source: 'manual-three-point',
    });
  }
  return lines;
}

export function buildManualGuitarPose(points, timestamp = 0) {
  if (!Array.isArray(points) || points.length < 3 || !points.slice(0, 3).every(validPoint)) {
    return { pose: null, error: '세 지점을 모두 지정해야 합니다.' };
  }

  const soundhole = point(points[0]);
  const neckPoint = point(points[1]);
  const strumPoint = point(points[2]);
  const neckDistance = distance(soundhole, neckPoint);
  if (neckDistance < 0.16) return { pose: null, error: '사운드홀과 넥 지점을 더 멀리 지정하세요.' };
  if (neckDistance > 0.86) return { pose: null, error: '사운드홀과 넥 지점의 거리가 너무 큽니다.' };

  const tangent = normalize({ x: neckPoint.x - soundhole.x, y: neckPoint.y - soundhole.y });
  let normal = { x: -tangent.y, y: tangent.x };
  if (normal.y < 0) normal = { x: -normal.x, y: -normal.y };

  const soundholeAlong = dot(soundhole, tangent);
  const neckAlong = dot(neckPoint, tangent);
  const soundholeNormal = dot(soundhole, normal);
  const strumAlong = dot(strumPoint, tangent);
  const strumNormalDistance = Math.abs(dot(strumPoint, normal) - soundholeNormal);
  const strumAlongDistance = Math.abs(strumAlong - soundholeAlong);
  if (strumNormalDistance > 0.2 || strumAlongDistance > Math.max(0.3, neckDistance * 0.72)) {
    return { pose: null, error: '세 번째 지점은 사운드홀 근처의 실제 스트럼 위치에 찍으세요.' };
  }

  const angle = angleDegrees(tangent);
  const halfWidth = clamp(neckDistance * 0.046, 0.012, 0.028);
  const bodyExtension = clamp(neckDistance * 0.58, 0.18, 0.38);
  const neckExtension = clamp(neckDistance * 0.12, 0.04, 0.11);
  const supportMin = Math.min(soundholeAlong, neckAlong) - bodyExtension;
  const supportMax = Math.max(soundholeAlong, neckAlong) + neckExtension;
  const supportLength = supportMax - supportMin;
  const lines = makeLines({
    tangent,
    normal,
    supportMin,
    supportMax,
    center: soundholeNormal,
    halfWidth,
  });

  const bodyCenter = {
    x: clamp(soundhole.x - tangent.x * clamp(neckDistance * 0.16, 0.045, 0.11)),
    y: clamp(soundhole.y - tangent.y * clamp(neckDistance * 0.16, 0.045, 0.11)),
  };
  const fretCenter = {
    x: clamp(soundhole.x + tangent.x * neckDistance * 0.72),
    y: clamp(soundhole.y + tangent.y * neckDistance * 0.72),
  };
  const stringBand = {
    top: soundholeNormal - halfWidth,
    bottom: soundholeNormal + halfWidth,
    center: soundholeNormal,
    tangentX: tangent.x,
    tangentY: tangent.y,
    normalX: normal.x,
    normalY: normal.y,
    angle,
    supportMin,
    supportMax,
    supportLength,
    geometryValidated: true,
    source: 'manual-three-point',
    synthetic: true,
  };
  const pose = {
    mode: 'manual-three-point',
    confidence: 0.96,
    guitarValidated: true,
    partialValidation: true,
    manualCalibration: true,
    recoverySource: 'manual-three-point',
    recoveryConfidence: 0.96,
    validationReason: '사용자 수동 3점 보정',
    soundhole: {
      ...soundhole,
      radius: clamp(neckDistance * 0.18, 0.055, 0.105),
      confidence: 0.98,
      synthetic: true,
    },
    neck: {
      point: neckPoint,
      angle,
      confidence: 0.98,
      synthetic: true,
    },
    body: {
      center: bodyCenter,
      radiusAlong: clamp(neckDistance * 0.72, 0.24, 0.43),
      radiusAcross: clamp(neckDistance * 0.48, 0.18, 0.31),
      confidence: 0.94,
      synthetic: true,
    },
    lines,
    stringBand,
    axis: { tangent, normal },
    zones: {
      strum: {
        center: strumPoint,
        alongRadius: clamp(neckDistance * 0.34, 0.12, 0.22),
        acrossRadius: clamp(neckDistance * 0.24, 0.085, 0.16),
      },
      fret: {
        center: fretCenter,
        alongRadius: clamp(neckDistance * 0.28, 0.11, 0.2),
        acrossRadius: clamp(neckDistance * 0.17, 0.07, 0.13),
      },
    },
    manualPoints: [soundhole, neckPoint, strumPoint],
    validatedAt: finite(timestamp),
    updatedAt: finite(timestamp),
  };
  return { pose, error: '' };
}

export function mapMirroredCoverPointer({ clientX, clientY, rect, sourceWidth, sourceHeight }) {
  const width = Math.max(1, finite(rect?.width));
  const height = Math.max(1, finite(rect?.height));
  const sourceW = Math.max(1, finite(sourceWidth, width));
  const sourceH = Math.max(1, finite(sourceHeight, height));
  const scale = Math.max(width / sourceW, height / sourceH);
  const renderedWidth = sourceW * scale;
  const renderedHeight = sourceH * scale;
  const offsetX = (width - renderedWidth) / 2;
  const offsetY = (height - renderedHeight) / 2;
  const visualX = clamp((finite(clientX) - finite(rect?.left) - offsetX) / renderedWidth);
  const visualY = clamp((finite(clientY) - finite(rect?.top) - offsetY) / renderedHeight);
  return { x: 1 - visualX, y: visualY };
}

const STEP_TEXT = [
  '1/3 · 사운드홀 가운데를 누르세요.',
  '2/3 · 헤드 쪽 줄 또는 넥 위를 누르세요.',
  '3/3 · 피크가 줄에 닿는 스트럼 위치를 누르세요.',
];

export class ManualGuitarCalibration {
  constructor() {
    this.clear();
  }

  clear() {
    this.active = false;
    this.points = [];
    this.pose = null;
    this.error = '';
    return this.snapshot();
  }

  begin() {
    this.active = true;
    this.points = [];
    this.pose = null;
    this.error = '';
    return this.snapshot();
  }

  cancel() {
    this.active = false;
    this.error = '';
    return this.snapshot();
  }

  addPoint(entry, timestamp = 0) {
    if (!this.active) return this.snapshot();
    if (!validPoint(entry)) {
      this.error = '화면 안의 유효한 위치를 누르세요.';
      return this.snapshot();
    }
    const nextPoint = point(entry);
    if (this.points.length === 1 && distance(this.points[0], nextPoint) < 0.16) {
      this.error = '넥 지점을 사운드홀에서 더 멀리 누르세요.';
      return this.snapshot();
    }
    const candidatePoints = [...this.points, nextPoint].slice(0, 3);
    if (candidatePoints.length < 3) {
      this.points = candidatePoints;
      this.error = '';
      return this.snapshot();
    }
    const result = buildManualGuitarPose(candidatePoints, timestamp);
    if (!result.pose) {
      this.error = result.error;
      return this.snapshot();
    }
    this.points = candidatePoints;
    this.pose = result.pose;
    this.active = false;
    this.error = '';
    return this.snapshot();
  }

  poseFor(timestamp = 0) {
    if (!this.pose) return null;
    return { ...this.pose, updatedAt: finite(timestamp, this.pose.updatedAt) };
  }

  snapshot() {
    const ready = Boolean(this.pose);
    const step = ready ? 3 : Math.min(3, this.points.length + 1);
    return {
      active: this.active,
      ready,
      step,
      points: this.points.map((entry) => ({ ...entry })),
      instruction: ready ? '수동 3점 보정 적용됨' : STEP_TEXT[Math.max(0, step - 1)],
      error: this.error,
      pose: this.pose,
    };
  }
}
