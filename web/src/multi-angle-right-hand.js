import { RightHandTechniqueAnalyzer } from './right-hand-technique.js';

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, finite(value)));

function visibility(point) {
  if (!point) return 0;
  return Math.max(finite(point.visibility, 1), finite(point.presence, 1));
}

function valid(point, minimum = 0) {
  return Boolean(point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)) && visibility(point) >= minimum);
}

function average(points = []) {
  const usable = points.filter((point) => valid(point));
  if (!usable.length) return null;
  return {
    x: usable.reduce((sum, point) => sum + finite(point.x), 0) / usable.length,
    y: usable.reduce((sum, point) => sum + finite(point.y), 0) / usable.length,
    z: usable.reduce((sum, point) => sum + finite(point.z), 0) / usable.length,
  };
}

function vector(from, to) {
  if (!valid(from) || !valid(to)) return null;
  return { x: finite(to.x) - finite(from.x), y: finite(to.y) - finite(from.y), z: finite(to.z) - finite(from.z) };
}

function length(value) {
  return value ? Math.hypot(finite(value.x), finite(value.y), finite(value.z)) : 0;
}

function normalize(value) {
  const size = length(value);
  return size > 1e-6 ? { x: value.x / size, y: value.y / size, z: value.z / size } : null;
}

function dot(left, right) {
  return left && right ? finite(left.x) * finite(right.x) + finite(left.y) * finite(right.y) + finite(left.z) * finite(right.z) : 0;
}

function distance(left, right) {
  const value = vector(left, right);
  return value ? length(value) : Infinity;
}

function vectorAngle(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  return a && b ? Math.acos(clamp(dot(a, b), -1, 1)) : 0;
}

function median(values = []) {
  const usable = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!usable.length) return 0;
  const middle = Math.floor(usable.length / 2);
  return usable.length % 2 ? usable[middle] : (usable[middle - 1] + usable[middle]) / 2;
}

const ARM_SIDES = [
  { id: 'left', shoulder: 11, elbow: 13, wrist: 15 },
  { id: 'right', shoulder: 12, elbow: 14, wrist: 16 },
];

function contactPoint(hand) {
  if (valid(hand?.pickPoint)) return hand.pickPoint;
  const landmarks = hand?.landmarks || [];
  if (!valid(landmarks[4]) || !valid(landmarks[8])) return null;
  return average([landmarks[4], landmarks[8]]);
}

function palmScale(landmarks = []) {
  return median([
    distance(landmarks[0], landmarks[5]),
    distance(landmarks[0], landmarks[9]),
    distance(landmarks[0], landmarks[17]),
    distance(landmarks[5], landmarks[17]),
  ].filter((value) => Number.isFinite(value) && value < Infinity)) || 0.12;
}

function localContact(landmarks = [], contact = null) {
  const wrist = landmarks[0];
  const middle = landmarks[9];
  const index = landmarks[5];
  const pinky = landmarks[17];
  if (![wrist, middle, index, pinky, contact].every((point) => valid(point))) return null;
  const scale = palmScale(landmarks);
  const forward = normalize(vector(wrist, middle));
  const acrossRaw = normalize(vector(pinky, index));
  if (!forward || !acrossRaw || !(scale > 0)) return null;
  const projection = dot(acrossRaw, forward);
  const across = normalize({
    x: acrossRaw.x - forward.x * projection,
    y: acrossRaw.y - forward.y * projection,
    z: acrossRaw.z - forward.z * projection,
  }) || acrossRaw;
  const relative = vector(wrist, contact);
  return {
    x: dot(relative, across) / scale,
    y: dot(relative, forward) / scale,
    z: finite(relative?.z) / scale,
    forward,
    scale,
  };
}

function matchArm(handWrist, pose = [], world = [], previousSide = null) {
  if (!valid(handWrist) || pose.length < 17) return null;
  const candidates = ARM_SIDES.map((definition) => {
    const shoulder = pose[definition.shoulder];
    const elbow = pose[definition.elbow];
    const wrist = pose[definition.wrist];
    if (![shoulder, elbow, wrist].every((point) => valid(point, 0.28))) return null;
    const armLength = Math.max(0.08, distance(shoulder, elbow) + distance(elbow, wrist));
    const normalizedDistance = distance(handWrist, wrist) / armLength;
    return {
      side: definition.id,
      shoulder,
      elbow,
      wrist,
      worldShoulder: valid(world[definition.shoulder]) ? world[definition.shoulder] : null,
      worldElbow: valid(world[definition.elbow]) ? world[definition.elbow] : null,
      worldWrist: valid(world[definition.wrist]) ? world[definition.wrist] : null,
      normalizedDistance,
      score: normalizedDistance - (definition.id === previousSide ? 0.18 : 0),
    };
  }).filter(Boolean).sort((left, right) => left.score - right.score);
  const selected = candidates[0];
  return selected && selected.normalizedDistance <= 0.48 ? selected : null;
}

function cameraView(pose = [], world = []) {
  const leftShoulder = pose[11];
  const rightShoulder = pose[12];
  const leftHip = pose[23];
  const rightHip = pose[24];
  const qualityPoints = [leftShoulder, rightShoulder, leftHip, rightHip].filter((point) => valid(point));
  const quality = qualityPoints.length ? qualityPoints.reduce((sum, point) => sum + visibility(point), 0) / qualityPoints.length : 0;
  const roll = valid(leftShoulder) && valid(rightShoulder)
    ? Math.atan2(rightShoulder.y - leftShoulder.y, rightShoulder.x - leftShoulder.x)
    : 0;
  const worldLeft = world[11];
  const worldRight = world[12];
  const shoulderWidth = distance(worldLeft, worldRight);
  const hasWorld = world.length >= 25 && Number.isFinite(shoulderWidth) && shoulderWidth < Infinity && shoulderWidth > 0.04;
  const yaw = hasWorld ? (finite(worldRight.z) - finite(worldLeft.z)) / shoulderWidth : 0;
  const worldShoulders = average([worldLeft, worldRight]);
  const worldHips = average([world[23], world[24]]);
  const torsoLength = distance(worldShoulders, worldHips);
  const pitch = hasWorld && Number.isFinite(torsoLength) && torsoLength < Infinity && torsoLength > 0.05
    ? (finite(worldHips.z) - finite(worldShoulders.z)) / torsoLength
    : 0;
  const absYaw = Math.abs(yaw);
  const absPitch = Math.abs(pitch);
  const absRoll = Math.abs(roll);
  let type = 'front';
  let label = '정면';
  if (absYaw >= 0.82) {
    type = yaw > 0 ? 'right-side' : 'left-side';
    label = yaw > 0 ? '오른쪽 측면' : '왼쪽 측면';
  } else if (absYaw >= 0.28) {
    type = yaw > 0 ? 'right-oblique' : 'left-oblique';
    label = yaw > 0 ? '오른쪽 사선' : '왼쪽 사선';
  } else if (absPitch >= 0.48) {
    type = pitch > 0 ? 'high' : 'low';
    label = pitch > 0 ? '위쪽 촬영' : '아래쪽 촬영';
  } else if (absRoll >= 0.35) {
    type = 'rolled';
    label = '기울어진 카메라';
  }
  const severity = clamp(Math.max(absYaw / 1.25, absPitch / 0.9, absRoll / 0.8));
  const correctionConfidence = clamp(quality * (hasWorld ? 0.96 : 0.7) * (1 - severity * 0.18));
  return {
    type,
    label,
    yaw,
    pitch,
    rollDegrees: roll * 180 / Math.PI,
    severity,
    hasWorld,
    correctionConfidence,
    supported: quality >= 0.28 && correctionConfidence >= 0.28,
  };
}

function bodyFrame(pose = [], arm = null) {
  if (!arm) return null;
  const leftShoulder = pose[11];
  const rightShoulder = pose[12];
  const shoulders = average([leftShoulder, rightShoulder]);
  const hips = average([pose[23], pose[24]]);
  const torsoReady = valid(shoulders) && valid(hips) && valid(leftShoulder, 0.25) && valid(rightShoulder, 0.25);
  const origin = torsoReady ? shoulders : { x: 0, y: 0, z: 0 };
  const horizontal = torsoReady ? normalize(vector(leftShoulder, rightShoulder)) : { x: 1, y: 0, z: 0 };
  const verticalRaw = torsoReady ? normalize(vector(shoulders, hips)) : { x: 0, y: 1, z: 0 };
  const projection = dot(verticalRaw, horizontal);
  const vertical = normalize({
    x: verticalRaw.x - horizontal.x * projection,
    y: verticalRaw.y - horizontal.y * projection,
    z: verticalRaw.z - horizontal.z * projection,
  }) || verticalRaw;
  const scale = median([
    distance(leftShoulder, rightShoulder),
    distance(shoulders, hips) * 0.85,
    (distance(arm.shoulder, arm.elbow) + distance(arm.elbow, arm.wrist)) * 0.72,
  ].filter((value) => Number.isFinite(value) && value < Infinity && value > 0.03)) || 0.22;
  return { origin, horizontal, vertical, scale, torsoReady };
}

function project(point, frame) {
  if (!valid(point) || !frame) return null;
  const relative = vector(frame.origin, point);
  return {
    x: dot(relative, frame.horizontal) / frame.scale,
    y: dot(relative, frame.vertical) / frame.scale,
    z: finite(relative?.z) / frame.scale,
  };
}

function travel(previous, current) {
  if (!previous || !current) return 0;
  return Math.hypot(current.x - previous.x, current.y - previous.y, (current.z - previous.z) * 0.55);
}

function invariantState({ hand, pose, world, arm, view }) {
  const landmarks = hand?.landmarks || [];
  const contact = contactPoint(hand);
  const frame = bodyFrame(pose, arm);
  const worldReady = arm?.worldShoulder && arm?.worldElbow && arm?.worldWrist;
  const upper = worldReady ? vector(arm.worldShoulder, arm.worldElbow) : vector(arm?.shoulder, arm?.elbow);
  const forearm = worldReady ? vector(arm.worldElbow, arm.worldWrist) : vector(arm?.elbow, arm?.wrist);
  const palm = vector(landmarks[0], landmarks[9]);
  return {
    localContact: localContact(landmarks, contact),
    shoulder: project(arm?.shoulder, frame),
    elbow: project(arm?.elbow, frame),
    wrist: project(arm?.wrist, frame),
    upper,
    forearm,
    elbowAngle: vectorAngle(vector(arm?.elbow, arm?.shoulder), vector(arm?.elbow, arm?.wrist)),
    wristAngle: vectorAngle(forearm, palm),
    armSide: arm?.side || null,
    view,
    quality: arm ? clamp([arm.shoulder, arm.elbow, arm.wrist].reduce((sum, point) => sum + visibility(point), 0) / 3) : 0,
  };
}

function classify(samples = []) {
  const usable = samples.filter((sample) => Number.isFinite(sample.armEnergy) && Number.isFinite(sample.wristEnergy));
  if (usable.length < 2) return { type: 'unjudgeable', armRatio: 0, wristRatio: 0, confidence: 0 };
  const armEnergy = usable.reduce((sum, sample) => sum + sample.armEnergy, 0);
  const wristEnergy = usable.reduce((sum, sample) => sum + sample.wristEnergy, 0);
  const total = armEnergy + wristEnergy;
  if (total < 0.004) return { type: 'still', armRatio: 0, wristRatio: 0, confidence: 0.3 };
  const armRatio = armEnergy / total;
  const wristRatio = wristEnergy / total;
  const quality = usable.reduce((sum, sample) => sum + sample.quality, 0) / usable.length;
  const severity = usable.reduce((sum, sample) => sum + sample.severity, 0) / usable.length;
  const confidence = clamp(quality * (0.52 + Math.abs(armRatio - wristRatio) * 0.75) * (1 - severity * 0.28));
  return {
    type: wristRatio >= 0.62 ? 'wrist' : armRatio >= 0.62 ? 'arm' : 'mixed',
    armRatio,
    wristRatio,
    confidence,
  };
}

export class MultiAngleRightHandTechniqueAnalyzer {
  constructor() {
    this.base = new RightHandTechniqueAnalyzer();
    this.reset();
  }

  reset() {
    this.base.reset();
    this.previous = null;
    this.previousSide = null;
    this.samples = [];
  }

  update({ timestamp, hand = null, bodyLandmarks = [], bodyWorldLandmarks = [], band = null, strokeEvent = null } = {}) {
    const now = finite(timestamp);
    const base = this.base.update({ timestamp, hand, bodyLandmarks, band, strokeEvent });
    const landmarks = hand?.landmarks || [];
    const handWrist = hand?.wrist || landmarks[0];
    const view = cameraView(bodyLandmarks, bodyWorldLandmarks);
    const arm = matchArm(handWrist, bodyLandmarks, bodyWorldLandmarks, this.previousSide);
    if (arm) this.previousSide = arm.side;
    const current = invariantState({ hand, pose: bodyLandmarks, world: bodyWorldLandmarks, arm, view });
    current.at = now;

    if (this.previous && current.armSide && this.previous.armSide === current.armSide && now - this.previous.at <= 280) {
      const relativeTravel = this.previous.localContact && current.localContact
        ? Math.hypot(
          current.localContact.x - this.previous.localContact.x,
          current.localContact.y - this.previous.localContact.y,
          (current.localContact.z - this.previous.localContact.z) * 0.45,
        )
        : 0;
      const armEnergy = travel(this.previous.shoulder, current.shoulder) * 0.55
        + travel(this.previous.elbow, current.elbow) * 1.45
        + travel(this.previous.wrist, current.wrist) * 0.82
        + vectorAngle(this.previous.upper, current.upper) * 0.24
        + vectorAngle(this.previous.forearm, current.forearm) * 0.1
        + Math.abs(current.elbowAngle - this.previous.elbowAngle) * 0.18;
      const wristEnergy = relativeTravel * 0.24 + Math.abs(current.wristAngle - this.previous.wristAngle) * 0.28;
      this.samples.push({ at: now, armEnergy, wristEnergy, quality: current.quality, severity: view.severity });
      this.samples = this.samples.filter((sample) => now - sample.at <= 1000).slice(-42);
    }
    this.previous = current;

    const motion = classify(this.samples);
    const poseReady = Boolean(arm && view.supported);
    const labels = {
      wrist: '손목 주도',
      arm: '팔 주도',
      mixed: '팔·손목 혼합',
      still: '동작 대기',
      unjudgeable: '자세 관절 판정 불가',
    };
    return {
      ...base,
      movementType: poseReady ? motion.type : 'unjudgeable',
      movementLabel: poseReady ? labels[motion.type] : labels.unjudgeable,
      movementConfidence: poseReady ? motion.confidence : 0,
      armRatio: motion.armRatio,
      wristRatio: motion.wristRatio,
      poseSide: arm?.side || this.previousSide,
      poseReady,
      cameraView: view.type,
      cameraViewLabel: view.label,
      cameraYaw: view.yaw,
      cameraPitch: view.pitch,
      cameraRollDegrees: view.rollDegrees,
      angleSeverity: view.severity,
      angleCorrectionConfidence: view.correctionConfidence,
      angleCorrectionReady: view.supported,
      worldPoseUsed: view.hasWorld,
    };
  }
}

export { cameraView as estimateCameraView };
