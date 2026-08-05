const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, finite(value)));

function validPoint(point) {
  return Boolean(point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)));
}

function distance(left, right) {
  if (!validPoint(left) || !validPoint(right)) return Infinity;
  return Math.hypot(finite(left.x) - finite(right.x), finite(left.y) - finite(right.y));
}

function undirectedAngleDifference(left, right) {
  let raw = Math.abs(finite(left) - finite(right)) % 180;
  if (raw > 90) raw = 180 - raw;
  return raw;
}

function midpoint(line) {
  if (!line?.start || !line?.end) return null;
  return {
    x: (finite(line.start.x) + finite(line.end.x)) / 2,
    y: (finite(line.start.y) + finite(line.end.y)) / 2,
  };
}

function lineAngle(line) {
  if (!line?.start || !line?.end) return null;
  return Math.atan2(
    finite(line.end.y) - finite(line.start.y),
    finite(line.end.x) - finite(line.start.x),
  ) * 180 / Math.PI;
}

function median(values = []) {
  const usable = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!usable.length) return null;
  const middle = Math.floor(usable.length / 2);
  return usable.length % 2 ? usable[middle] : (usable[middle - 1] + usable[middle]) / 2;
}

function poseAngle(pose) {
  const bandAngle = finite(pose?.stringBand?.angle, NaN);
  if (Number.isFinite(bandAngle)) return bandAngle;
  const tangent = pose?.axis?.tangent || {
    x: pose?.stringBand?.tangentX,
    y: pose?.stringBand?.tangentY,
  };
  if (Number.isFinite(Number(tangent?.x)) && Number.isFinite(Number(tangent?.y))) {
    return Math.atan2(finite(tangent.y), finite(tangent.x)) * 180 / Math.PI;
  }
  return finite(pose?.neck?.angle, 0);
}

function bandDistance(point, band) {
  if (!validPoint(point) || !band) return Infinity;
  const projection = finite(band.normalX) * finite(point.x) + finite(band.normalY) * finite(point.y);
  return Math.abs(projection - finite(band.center));
}

function bodyContainsSoundhole(pose) {
  const body = pose?.body;
  const soundhole = pose?.soundhole;
  if (!body?.center || !validPoint(soundhole)) return true;
  const axis = pose?.axis || {};
  const tangent = axis.tangent || { x: pose?.stringBand?.tangentX, y: pose?.stringBand?.tangentY };
  const normal = axis.normal || { x: pose?.stringBand?.normalX, y: pose?.stringBand?.normalY };
  const delta = { x: soundhole.x - body.center.x, y: soundhole.y - body.center.y };
  const along = Math.abs(finite(delta.x) * finite(tangent?.x, 1) + finite(delta.y) * finite(tangent?.y));
  const across = Math.abs(finite(delta.x) * finite(normal?.x) + finite(delta.y) * finite(normal?.y, 1));
  const alongRadius = Math.max(0.12, finite(body.radiusAlong, finite(body.alongRadius, 0.3)));
  const acrossRadius = Math.max(0.09, finite(body.radiusAcross, finite(body.acrossRadius, 0.22)));
  return along <= alongRadius * 0.92 && across <= acrossRadius * 0.82;
}

function lineConsensus(pose, angle) {
  const lines = Array.isArray(pose?.lines) ? pose.lines.filter((line) => line?.start && line?.end) : [];
  if (lines.length < 5 || lines.length > 7) return { ready: false, count: lines.length, angleSpread: Infinity };
  const angles = lines.map(lineAngle).filter(Number.isFinite);
  const medianAngle = median(angles);
  if (!Number.isFinite(medianAngle)) return { ready: false, count: lines.length, angleSpread: Infinity };
  const differences = angles.map((value) => undirectedAngleDifference(value, medianAngle));
  const maximumDifference = Math.max(...differences);
  const poseDifference = undirectedAngleDifference(medianAngle, angle);
  const lengths = lines.map((line) => distance(line.start, line.end));
  const medianLength = median(lengths) || 0;
  return {
    ready: maximumDifference <= 5.5 && poseDifference <= 10 && medianLength >= 0.34,
    count: lines.length,
    angleSpread: maximumDifference,
    poseDifference,
    medianLength,
  };
}

const ALLOWED_STRICT_FAILURES = new Set([
  '실제 기타 줄 미확인',
  '기타 줄 간격 과대 · 몸통 무늬 오인식',
  '기타 방향과 실제 줄 불일치',
  '사운드홀·넥과 실제 줄 위치 불일치',
  '기타 줄 폭이 너무 좁아 판정 불가',
]);

export function evaluateStrongInternalGuitarPose(pose) {
  const band = pose?.stringBand;
  const soundhole = pose?.soundhole;
  const body = pose?.body;
  const neck = pose?.neck;
  const angle = poseAngle(pose);
  const lineCheck = lineConsensus(pose, angle);
  const width = band ? Math.abs(finite(band.bottom) - finite(band.top)) : 0;
  const radius = finite(soundhole?.radius);
  const supportLength = finite(band?.supportLength, finite(band?.supportMax) - finite(band?.supportMin));
  const soundholeDistance = bandDistance(soundhole, band);
  const neckAngle = finite(neck?.angle, angle);
  const neckDifference = undirectedAngleDifference(angle, neckAngle);
  const bodyReady = Boolean(body?.center && finite(body?.confidence) >= 0.5);
  const geometryReady = Boolean(
    pose?.mode === 'full'
    && finite(pose?.confidence) >= 0.74
    && validPoint(soundhole)
    && radius >= 0.045 && radius <= 0.16
    && finite(soundhole?.confidence, finite(soundhole?.score)) >= 0.58
    && neck
    && finite(neck?.confidence, finite(neck?.score)) >= 0.62
    && band
    && width >= 0.018
    && width <= Math.min(0.18, Math.max(0.075, radius * 1.1))
    && supportLength >= 0.4
    && soundholeDistance <= Math.max(0.045, radius * 0.72, width * 0.72)
    && neckDifference <= 12
    && bodyContainsSoundhole(pose)
    && lineCheck.ready
  );
  if (!geometryReady) {
    return {
      valid: false,
      confidence: 0,
      width,
      supportLength,
      soundholeDistance,
      neckDifference,
      lineCheck,
      bodyReady,
    };
  }
  const confidence = clamp(
    finite(pose.confidence) * 0.28
    + finite(soundhole.confidence, soundhole.score) * 0.18
    + finite(neck.confidence, neck.score) * 0.2
    + clamp(lineCheck.medianLength / 0.75) * 0.12
    + clamp(1 - lineCheck.angleSpread / 6) * 0.1
    + (bodyReady ? 0.08 : 0.04)
    + clamp(1 - soundholeDistance / Math.max(0.045, radius * 0.72)) * 0.04,
  );
  return {
    valid: confidence >= 0.68,
    confidence,
    width,
    supportLength,
    soundholeDistance,
    neckDifference,
    lineCheck,
    bodyReady,
  };
}

function stablePose(previous, pose) {
  if (!previous || !pose) return false;
  const previousAngle = poseAngle(previous);
  const currentAngle = poseAngle(pose);
  const previousCenter = previous.soundhole || previous.body?.center || midpoint(previous.lines?.[0]);
  const currentCenter = pose.soundhole || pose.body?.center || midpoint(pose.lines?.[0]);
  return undirectedAngleDifference(previousAngle, currentAngle) <= 9
    && distance(previousCenter, currentCenter) <= 0.075
    && Math.abs(finite(previous.soundhole?.radius) - finite(pose.soundhole?.radius)) <= 0.035;
}

function consensusPose(pose, evaluation, timestamp, samples) {
  return {
    ...pose,
    confidence: clamp(Math.max(0.46, Math.min(0.72, evaluation.confidence * 0.86))),
    lines: pose.lines || [],
    stringBand: {
      ...pose.stringBand,
      geometryValidated: true,
      source: 'internal-pose-consensus',
    },
    guitarValidated: true,
    partialValidation: true,
    recoverySource: 'internal-pose-consensus',
    recoveryConfidence: evaluation.confidence,
    recoveryStableSamples: samples,
    recoveryRequiredSamples: 3,
    validationReason: '사운드홀·넥·6줄 내부 합의 확인',
    validatedAt: finite(timestamp),
    updatedAt: finite(timestamp),
  };
}

export class StrongGuitarConsensus {
  constructor({ holdMs = 1400 } = {}) {
    this.holdMs = holdMs;
    this.reset();
  }

  reset() {
    this.lastCandidate = null;
    this.lastCandidateAt = 0;
    this.stableSamples = 0;
    this.lastRecovered = null;
  }

  update({ pose = null, strictPose = null, previous = null, timestamp = 0 } = {}) {
    const now = finite(timestamp);
    if (strictPose?.guitarValidated && !strictPose.partialValidation) {
      this.reset();
      return strictPose;
    }

    const strictReason = String(strictPose?.validationReason || '');
    const evaluation = evaluateStrongInternalGuitarPose(pose);
    const allowedFailure = ALLOWED_STRICT_FAILURES.has(strictReason);
    if (evaluation.valid && allowedFailure) {
      const elapsed = now - this.lastCandidateAt;
      const stable = elapsed >= 0 && elapsed <= 700 && stablePose(this.lastCandidate, pose);
      this.stableSamples = stable ? this.stableSamples + 1 : 1;
      this.lastCandidate = pose;
      this.lastCandidateAt = now;
      if (this.stableSamples >= 3) {
        const recovered = consensusPose(pose, evaluation, now, this.stableSamples);
        this.lastRecovered = recovered;
        return recovered;
      }
    } else {
      this.lastCandidate = null;
      this.lastCandidateAt = 0;
      this.stableSamples = 0;
    }

    const retained = previous?.recoverySource === 'internal-pose-consensus' ? previous : this.lastRecovered;
    const retainedAt = finite(retained?.updatedAt, finite(retained?.validatedAt));
    const elapsed = now - retainedAt;
    if (retained?.guitarValidated && elapsed >= 0 && elapsed <= this.holdMs) {
      const confidence = clamp(finite(retained.confidence) * (1 - elapsed / (this.holdMs * 2.4)));
      return {
        ...retained,
        mode: 'tracking',
        confidence,
        recoveryConfidence: confidence,
        validationReason: '강한 기타 합의 일시 가림 유지',
        updatedAt: now,
      };
    }

    return strictPose || {
      mode: 'none',
      confidence: 0,
      guitarValidated: false,
      validationReason: '기타 형태 미확인',
      updatedAt: now,
    };
  }
}
