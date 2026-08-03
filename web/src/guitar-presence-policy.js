function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function undirectedAngleDifference(left, right) {
  const raw = Math.abs((Number(left) || 0) - (Number(right) || 0)) % 180;
  return Math.min(raw, 180 - raw);
}

function midpoint(line) {
  if (!line?.start || !line?.end) return null;
  return {
    x: (Number(line.start.x) + Number(line.end.x)) / 2,
    y: (Number(line.start.y) + Number(line.end.y)) / 2,
  };
}

function poseAnchor(pose) {
  if (pose?.soundhole) return { x: pose.soundhole.x, y: pose.soundhole.y };
  const lines = Array.isArray(pose?.lines) ? pose.lines : [];
  return midpoint(lines[Math.floor(lines.length / 2)]) || pose?.neck?.leftEdge?.start || null;
}

function distanceToBand(point, band) {
  if (!point || !band) return Number.POSITIVE_INFINITY;
  const projection =
    (Number(band.normalX) || 0) * Number(point.x) +
    (Number(band.normalY) || 0) * Number(point.y);
  return Math.abs(projection - Number(band.center));
}

function invalidPose(timestamp, reason, detectedPose = null) {
  return {
    mode: 'none',
    confidence: 0,
    soundhole: null,
    neck: null,
    body: null,
    lines: [],
    stringBand: null,
    axis: null,
    zones: null,
    guitarValidated: false,
    validationReason: reason,
    detectedPose,
    updatedAt: Number(timestamp) || 0,
  };
}

export function evaluateGuitarPresence({ pose, observedStrings } = {}) {
  const band = observedStrings?.band || null;
  const stringCount = Number(observedStrings?.count || observedStrings?.lines?.length || 0);
  const stringConfidence = clamp(observedStrings?.confidence);
  const supportLength = Number(band?.supportLength || 0);
  const poseReady = Boolean(pose && pose.mode !== 'none' && pose.confidence >= 0.28 && pose.stringBand);
  const minimumStrings = pose?.mode === 'neck-partial' || pose?.mode === 'soundhole-partial' ? 3 : 4;
  const stringsReady = Boolean(
    band &&
    stringCount >= minimumStrings &&
    stringConfidence >= 0.28 &&
    supportLength >= 0.2,
  );

  if (!poseReady) {
    return { valid: false, reason: '기타 형태 미확인', angleDifference: 180, bandDistance: Infinity };
  }
  if (!stringsReady) {
    return { valid: false, reason: '실제 기타 줄 미확인', angleDifference: 180, bandDistance: Infinity };
  }

  const poseAngle = Number(pose.stringBand?.angle || 0);
  const observedAngle = Number(band.angle || 0);
  const angleDifference = undirectedAngleDifference(poseAngle, observedAngle);
  const anchor = poseAnchor(pose);
  const bandDistance = distanceToBand(anchor, band);
  const observedWidth = Math.abs(Number(band.bottom) - Number(band.top));
  const poseWidth = Math.abs(Number(pose.stringBand.bottom) - Number(pose.stringBand.top));
  const soundholeRadius = Number(pose.soundhole?.radius || 0);
  const maximumBandDistance = Math.max(
    0.09,
    observedWidth * 2.4,
    poseWidth * 1.8,
    soundholeRadius * 1.1,
  );

  if (angleDifference > 22) {
    return { valid: false, reason: '기타 방향과 실제 줄 불일치', angleDifference, bandDistance };
  }
  if (bandDistance > maximumBandDistance) {
    return { valid: false, reason: '사운드홀·넥과 실제 줄 위치 불일치', angleDifference, bandDistance };
  }

  return {
    valid: true,
    reason: '실제 기타 줄 확인',
    angleDifference,
    bandDistance,
    confidence: clamp(pose.confidence * 0.58 + stringConfidence * 0.42),
  };
}

export function validateGuitarPresence({
  pose,
  observedStrings,
  previous = null,
  timestamp = 0,
  holdMs = 900,
} = {}) {
  const now = Number(timestamp) || 0;
  const evaluation = evaluateGuitarPresence({ pose, observedStrings });

  if (evaluation.valid) {
    const band = observedStrings.band;
    return {
      ...pose,
      confidence: evaluation.confidence,
      lines: observedStrings.lines || [],
      stringBand: band,
      axis: {
        tangent: { x: Number(band.tangentX) || 1, y: Number(band.tangentY) || 0 },
        normal: { x: Number(band.normalX) || 0, y: Number(band.normalY) || 1 },
      },
      guitarValidated: true,
      validationReason: evaluation.reason,
      validatedAt: now,
      updatedAt: now,
    };
  }

  const previousValidatedAt = Number(previous?.validatedAt || 0);
  const elapsed = now - previousValidatedAt;
  if (previous?.guitarValidated && previousValidatedAt > 0 && elapsed >= 0 && elapsed <= holdMs) {
    const retainedConfidence = clamp(Number(previous.confidence) * (1 - elapsed / (holdMs * 2)));
    return {
      ...previous,
      mode: 'tracking',
      confidence: retainedConfidence,
      validationReason: `${evaluation.reason} · 일시 가림 유지`,
      updatedAt: now,
    };
  }

  return invalidPose(now, evaluation.reason, pose || null);
}
