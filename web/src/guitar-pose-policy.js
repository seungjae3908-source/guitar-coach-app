const DEFAULT_MAX_STEP_DEGREES = 28;
const DEFAULT_PENDING_TOLERANCE_DEGREES = 12;
const DEFAULT_CONFIRMATION_FRAMES = 3;

export function normalizeUndirectedAngle(angle) {
  const value = Number(angle);
  if (!Number.isFinite(value)) return null;
  let normalized = ((value % 180) + 180) % 180;
  if (normalized >= 90) normalized -= 180;
  return normalized;
}

export function undirectedAngleDifference(a, b) {
  const first = normalizeUndirectedAngle(a);
  const second = normalizeUndirectedAngle(b);
  if (first === null || second === null) return Number.POSITIVE_INFINITY;
  const raw = Math.abs(first - second);
  return Math.min(raw, 180 - raw);
}

function poseAngle(pose) {
  return pose?.stringBand?.angle ?? pose?.neck?.angle ?? null;
}

function hasFullShapeEvidence(pose) {
  return Boolean(pose?.soundhole && pose?.neck && Array.isArray(pose?.lines) && pose.lines.length === 6);
}

function retainPreviousPose(previous, timestamp, reason) {
  return {
    ...previous,
    mode: 'tracking',
    confidence: Math.max(0, Number(previous?.confidence || 0) * 0.985),
    updatedAt: timestamp,
    stabilityReason: reason,
  };
}

export function stabilizeGuitarPose({
  previous = null,
  candidate = null,
  state = {},
  timestamp = 0,
  force = false,
  maxStepDegrees = DEFAULT_MAX_STEP_DEGREES,
  pendingToleranceDegrees = DEFAULT_PENDING_TOLERANCE_DEGREES,
  confirmationFrames = DEFAULT_CONFIRMATION_FRAMES,
} = {}) {
  const cleanState = {
    pendingAngle: Number.isFinite(Number(state?.pendingAngle)) ? Number(state.pendingAngle) : null,
    pendingCount: Math.max(0, Number(state?.pendingCount || 0)),
  };

  if (!candidate) {
    return {
      pose: previous ? retainPreviousPose(previous, timestamp, '후보 없음 · 이전 기타 축 유지') : null,
      state: cleanState,
      accepted: false,
      reason: 'candidate-missing',
    };
  }

  const candidateAngle = poseAngle(candidate);
  const previousAngle = poseAngle(previous);
  const candidateConfidence = Number(candidate?.confidence || 0);
  const previousConfidence = Number(previous?.confidence || 0);

  if (force || !previous || previousAngle === null || previousConfidence < 0.22) {
    return {
      pose: { ...candidate, stabilityReason: force ? '사용자 보정 즉시 적용' : '초기 기타 축 적용' },
      state: { pendingAngle: null, pendingCount: 0 },
      accepted: true,
      reason: force ? 'forced' : 'initial',
    };
  }

  const difference = undirectedAngleDifference(previousAngle, candidateAngle);
  if (difference <= maxStepDegrees) {
    return {
      pose: { ...candidate, stabilityReason: `연속 각도 적용 · 변화 ${difference.toFixed(1)}°` },
      state: { pendingAngle: null, pendingCount: 0 },
      accepted: true,
      reason: 'continuous',
    };
  }

  const strongOverride = hasFullShapeEvidence(candidate)
    && candidateConfidence >= 0.82
    && candidateConfidence >= previousConfidence + 0.18;
  if (strongOverride) {
    return {
      pose: { ...candidate, stabilityReason: `강한 전체 기타 증거로 새 각도 적용 · 변화 ${difference.toFixed(1)}°` },
      state: { pendingAngle: null, pendingCount: 0 },
      accepted: true,
      reason: 'strong-override',
    };
  }

  const normalizedCandidate = normalizeUndirectedAngle(candidateAngle);
  const pendingMatches = cleanState.pendingAngle !== null
    && undirectedAngleDifference(cleanState.pendingAngle, normalizedCandidate) <= pendingToleranceDegrees;
  const nextState = {
    pendingAngle: normalizedCandidate,
    pendingCount: pendingMatches ? cleanState.pendingCount + 1 : 1,
  };

  if (nextState.pendingCount >= confirmationFrames) {
    return {
      pose: { ...candidate, stabilityReason: `새 각도 ${nextState.pendingCount}회 연속 확인 후 적용` },
      state: { pendingAngle: null, pendingCount: 0 },
      accepted: true,
      reason: 'confirmed-change',
    };
  }

  return {
    pose: retainPreviousPose(previous, timestamp, `각도 급변 보류 ${nextState.pendingCount}/${confirmationFrames}`),
    state: nextState,
    accepted: false,
    reason: 'pending-change',
  };
}
