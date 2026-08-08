const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, finite(value)));

function validPoint(point) {
  return Boolean(point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)));
}

function visibility(point) {
  if (!validPoint(point)) return 0;
  return clamp(point.visibility ?? point.presence ?? 1);
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

function dot(point, axis) {
  return finite(point?.x) * finite(axis?.x) + finite(point?.y) * finite(axis?.y);
}

function midpoint(left, right) {
  if (!validPoint(left) || !validPoint(right)) return null;
  return { x: (finite(left.x) + finite(right.x)) / 2, y: (finite(left.y) + finite(right.y)) / 2 };
}

function average(points = []) {
  const usable = points.filter(validPoint);
  if (!usable.length) return null;
  return {
    x: usable.reduce((sum, point) => sum + finite(point.x), 0) / usable.length,
    y: usable.reduce((sum, point) => sum + finite(point.y), 0) / usable.length,
  };
}

function median(values = []) {
  const usable = values.filter((value) => Number.isFinite(value) && value > 0).sort((left, right) => left - right);
  if (!usable.length) return 0;
  const middle = Math.floor(usable.length / 2);
  return usable.length % 2 ? usable[middle] : (usable[middle - 1] + usable[middle]) / 2;
}

function undirectedAngleDifference(left, right) {
  let raw = Math.abs(finite(left) - finite(right)) % 180;
  if (raw > 90) raw = 180 - raw;
  return raw;
}

function handSummary(hand) {
  const landmarks = hand?.landmarks || [];
  if (landmarks.length < 18) return null;
  const wrist = hand?.wrist || landmarks[0];
  const indexMcp = landmarks[5];
  const middleMcp = landmarks[9];
  const pinkyMcp = landmarks[17];
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const center = average([wrist, indexMcp, middleMcp, pinkyMcp]);
  const contact = midpoint(thumbTip, indexTip) || hand?.pickPoint || center;
  const palmScale = median([
    distance(wrist, indexMcp),
    distance(wrist, middleMcp),
    distance(wrist, pinkyMcp),
    distance(indexMcp, pinkyMcp),
  ]);
  const qualityPoints = [wrist, indexMcp, middleMcp, pinkyMcp, thumbTip, indexTip].filter(validPoint);
  const quality = qualityPoints.length
    ? qualityPoints.reduce((sum, point) => sum + visibility(point), 0) / qualityPoints.length
    : 0;
  if (!center || !contact || !(palmScale > 0.018)) return null;
  return {
    hand,
    trackId: hand.trackId ?? hand.id ?? null,
    role: hand.role || 'unknown',
    center,
    contact,
    palmScale,
    quality: clamp(quality),
  };
}

function bodyFrame(landmarks = []) {
  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];
  const leftHip = landmarks[23];
  const rightHip = landmarks[24];
  const shoulderCenter = midpoint(leftShoulder, rightShoulder);
  const hipCenter = midpoint(leftHip, rightHip);
  const shoulderWidth = distance(leftShoulder, rightShoulder);
  const torsoHeight = distance(shoulderCenter, hipCenter);
  const ready = Boolean(
    shoulderCenter && hipCenter
    && shoulderWidth > 0.08 && shoulderWidth < 0.75
    && torsoHeight > 0.08 && torsoHeight < 0.8
    && visibility(leftShoulder) >= 0.35
    && visibility(rightShoulder) >= 0.35
  );
  return {
    ready,
    shoulderCenter,
    hipCenter,
    torsoCenter: ready ? midpoint(shoulderCenter, hipCenter) : null,
    shoulderWidth: ready ? shoulderWidth : 0,
    torsoHeight: ready ? torsoHeight : 0,
  };
}

function distinctHandPairs(hands = []) {
  const summaries = hands.map(handSummary).filter(Boolean);
  const pairs = [];
  for (let leftIndex = 0; leftIndex < summaries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < summaries.length; rightIndex += 1) {
      const left = summaries[leftIndex];
      const right = summaries[rightIndex];
      if (left.trackId != null && right.trackId != null && left.trackId === right.trackId) continue;
      pairs.push({ left, right, separation: distance(left.center, right.center) });
    }
  }
  return pairs.sort((a, b) => b.separation - a.separation);
}

function chooseRoles(pair, body) {
  const summaries = [pair.left, pair.right];
  const explicitStrum = summaries.find((entry) => entry.role === 'strum');
  const explicitFret = summaries.find((entry) => entry.role === 'fret');
  if (explicitStrum && explicitFret && explicitStrum !== explicitFret) {
    return { strum: explicitStrum, fret: explicitFret, explicit: true };
  }
  if (body.ready) {
    const ranked = summaries
      .map((entry) => ({ entry, torsoDistance: distance(entry.center, body.torsoCenter) }))
      .sort((a, b) => a.torsoDistance - b.torsoDistance);
    return { strum: ranked[0].entry, fret: ranked[1].entry, explicit: false };
  }
  const center = { x: 0.5, y: 0.56 };
  const ranked = summaries
    .map((entry) => ({ entry, centerDistance: distance(entry.center, center) }))
    .sort((a, b) => a.centerDistance - b.centerDistance);
  return { strum: ranked[0].entry, fret: ranked[1].entry, explicit: false };
}

function poseHintScore(pose, observedStrings) {
  const poseEvidence = Boolean(
    pose && (
      pose.mode && pose.mode !== 'none'
      || pose.soundhole
      || pose.body?.center
      || pose.neck
      || finite(pose.confidence) >= 0.1
    )
  );
  const lineCount = finite(observedStrings?.count, observedStrings?.lines?.length || 0);
  const stringEvidence = lineCount >= 2 || finite(observedStrings?.confidence) >= 0.12;
  return (poseEvidence ? 0.55 : 0) + (stringEvidence ? 0.45 : 0);
}

function estimateCandidate({ pose, observedStrings, hands, bodyLandmarks }) {
  const body = bodyFrame(bodyLandmarks);
  const pair = distinctHandPairs(hands)[0];
  if (!pair || !(pair.separation >= 0.23 && pair.separation <= 0.86)) return null;
  const roles = chooseRoles(pair, body);
  const fret = roles.fret;
  const strum = roles.strum;
  const tangent = normalize({ x: strum.center.x - fret.center.x, y: strum.center.y - fret.center.y });
  const horizontalStrength = Math.abs(tangent.x);
  if (horizontalStrength < 0.27) return null;
  let normal = { x: -tangent.y, y: tangent.x };
  if (normal.y < 0) normal = { x: -normal.x, y: -normal.y };

  const handQuality = (fret.quality + strum.quality) / 2;
  const separationScore = clamp((pair.separation - 0.2) / 0.36);
  const axisScore = clamp((horizontalStrength - 0.24) / 0.52);
  const palmRatio = Math.min(fret.palmScale, strum.palmScale) / Math.max(fret.palmScale, strum.palmScale);
  const palmScore = clamp((palmRatio - 0.28) / 0.48);
  const hintScore = poseHintScore(pose, observedStrings);

  let bodyScore = 0.55;
  if (body.ready) {
    const strumTorsoDistance = distance(strum.center, body.torsoCenter);
    const fretTorsoDistance = distance(fret.center, body.torsoCenter);
    const strumNearTorso = clamp(1 - strumTorsoDistance / Math.max(0.24, body.shoulderWidth * 1.2));
    const fretFarther = clamp((fretTorsoDistance - strumTorsoDistance + 0.04) / 0.22);
    const verticalLow = body.shoulderCenter.y - 0.12;
    const verticalHigh = body.hipCenter.y + body.torsoHeight * 0.45;
    const verticalReady = strum.center.y >= verticalLow && strum.center.y <= verticalHigh
      && fret.center.y >= verticalLow - 0.12 && fret.center.y <= verticalHigh;
    bodyScore = clamp(strumNearTorso * 0.58 + fretFarther * 0.3 + (verticalReady ? 0.12 : 0));
    if (bodyScore < 0.32) return null;
  }

  const score = clamp(
    handQuality * 0.22
    + separationScore * 0.22
    + axisScore * 0.18
    + palmScore * 0.1
    + bodyScore * 0.2
    + hintScore * 0.08,
  );
  const minimumScore = body.ready ? 0.52 : (hintScore > 0 ? 0.58 : 0.66);
  if (score < minimumScore) return null;

  const fretProjection = dot(fret.contact, tangent);
  const strumProjection = dot(strum.contact, tangent);
  const supportMin = Math.min(fretProjection, strumProjection) - clamp(pair.separation * 0.12, 0.035, 0.09);
  const supportMax = Math.max(fretProjection, strumProjection) + clamp(pair.separation * 0.18, 0.055, 0.12);
  const centerNormal = dot(strum.contact, normal);
  const bandHalf = clamp(strum.palmScale * 0.17, 0.011, 0.03);
  const soundholeRadius = clamp(strum.palmScale * 0.62, 0.042, 0.105);
  const bodyCenter = {
    x: clamp(strum.contact.x + tangent.x * clamp(pair.separation * 0.1, 0.025, 0.07)),
    y: clamp(strum.contact.y + tangent.y * clamp(pair.separation * 0.1, 0.025, 0.07)),
  };
  const angle = Math.atan2(tangent.y, tangent.x) * 180 / Math.PI;
  const band = {
    top: centerNormal - bandHalf,
    bottom: centerNormal + bandHalf,
    center: centerNormal,
    tangentX: tangent.x,
    tangentY: tangent.y,
    normalX: normal.x,
    normalY: normal.y,
    angle,
    supportMin,
    supportMax,
    supportLength: supportMax - supportMin,
    geometryValidated: true,
    source: 'two-hand-axis',
    synthetic: true,
  };
  const soundhole = {
    x: strum.contact.x,
    y: strum.contact.y,
    radius: soundholeRadius,
    confidence: clamp(score * 0.78),
    synthetic: true,
  };
  const bodyPose = {
    center: bodyCenter,
    radiusAlong: clamp(pair.separation * 0.48, 0.22, 0.42),
    radiusAcross: clamp(Math.max(strum.palmScale * 2.35, body.ready ? body.shoulderWidth * 0.42 : 0.16), 0.15, 0.3),
    confidence: clamp(score * 0.72),
    synthetic: true,
  };
  return {
    score,
    bodyReady: body.ready,
    explicitRoles: roles.explicit,
    strum,
    fret,
    tangent,
    normal,
    angle,
    separation: pair.separation,
    center: midpoint(fret.center, strum.center),
    band,
    soundhole,
    body: bodyPose,
    neck: {
      leftEdge: { start: fret.center, end: strum.center },
      confidence: clamp(score * 0.68),
      synthetic: true,
    },
  };
}

function candidateStable(previous, current) {
  if (!previous || !current) return false;
  return undirectedAngleDifference(previous.angle, current.angle) <= 16
    && distance(previous.center, current.center) <= 0.085
    && Math.abs(previous.separation - current.separation) <= 0.11
    && distance(previous.soundhole, current.soundhole) <= 0.1;
}

function recoveredPose(candidate, timestamp, stableSamples, requiredSamples, observedStrings) {
  const progress = clamp(stableSamples / requiredSamples);
  const observedLines = Array.isArray(observedStrings?.lines) && observedStrings.lines.length >= 2
    ? observedStrings.lines
    : [];
  const confidence = clamp(0.31 + candidate.score * 0.3 + progress * 0.16, 0, 0.67);
  return {
    mode: 'soundhole-partial',
    confidence,
    soundhole: candidate.soundhole,
    neck: candidate.neck,
    body: candidate.body,
    lines: observedLines,
    stringBand: candidate.band,
    axis: {
      tangent: candidate.tangent,
      normal: candidate.normal,
    },
    zones: {
      strum: {
        center: { x: candidate.soundhole.x, y: candidate.soundhole.y },
        alongRadius: clamp(candidate.body.radiusAlong * 0.46, 0.11, 0.2),
        acrossRadius: clamp(candidate.body.radiusAcross * 0.45, 0.075, 0.14),
      },
      fret: {
        center: { x: candidate.fret.center.x, y: candidate.fret.center.y },
        alongRadius: clamp(candidate.separation * 0.34, 0.11, 0.22),
        acrossRadius: clamp(candidate.fret.palmScale * 1.35, 0.065, 0.14),
      },
    },
    guitarValidated: true,
    partialValidation: true,
    recoverySource: 'two-hand-axis',
    recoveryConfidence: confidence,
    recoveryStableSamples: stableSamples,
    recoveryRequiredSamples: requiredSamples,
    validationReason: '역광·기울기 양손 축 부분 확인',
    validatedAt: finite(timestamp),
    updatedAt: finite(timestamp),
  };
}

export class BacklitGuitarRecovery {
  constructor({ holdMs = 900 } = {}) {
    this.holdMs = holdMs;
    this.reset();
  }

  reset() {
    this.lastCandidate = null;
    this.stableSamples = 0;
    this.lastCandidateAt = 0;
    this.lastRecovered = null;
  }

  update({
    pose = null,
    observedStrings = null,
    strictPose = null,
    hands = [],
    bodyLandmarks = [],
    previous = null,
    timestamp = 0,
  } = {}) {
    const now = finite(timestamp);
    if (strictPose?.guitarValidated && !strictPose.partialValidation) {
      this.reset();
      return strictPose;
    }

    const candidate = estimateCandidate({ pose, observedStrings, hands, bodyLandmarks });
    if (candidate) {
      const elapsed = now - this.lastCandidateAt;
      const stable = elapsed >= 0 && elapsed <= 700 && candidateStable(this.lastCandidate, candidate);
      this.stableSamples = stable ? this.stableSamples + 1 : 1;
      this.lastCandidate = candidate;
      this.lastCandidateAt = now;
      const requiredSamples = candidate.bodyReady || candidate.explicitRoles ? 5 : 9;
      if (this.stableSamples >= requiredSamples) {
        const recovered = recoveredPose(candidate, now, this.stableSamples, requiredSamples, observedStrings);
        this.lastRecovered = recovered;
        return recovered;
      }
    } else {
      this.lastCandidate = null;
      this.stableSamples = 0;
      this.lastCandidateAt = 0;
    }

    const retained = previous?.partialValidation ? previous : this.lastRecovered;
    const retainedAt = finite(retained?.updatedAt, finite(retained?.validatedAt));
    const elapsed = now - retainedAt;
    if (retained?.partialValidation && elapsed >= 0 && elapsed <= this.holdMs) {
      const confidence = clamp(finite(retained.confidence) * (1 - elapsed / (this.holdMs * 2.2)));
      return {
        ...retained,
        mode: 'tracking',
        confidence,
        recoveryConfidence: confidence,
        validationReason: '양손 축 일시 가림 유지',
        updatedAt: now,
      };
    }

    return strictPose || {
      mode: 'none',
      confidence: 0,
      guitarValidated: false,
      partialValidation: false,
      validationReason: '기타 형태 미확인',
      updatedAt: now,
    };
  }
}

export { estimateCandidate as estimateBacklitGuitarCandidate };
