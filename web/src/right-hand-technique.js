const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, finite(value)));

function validPoint(point, minimumVisibility = 0) {
  if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return false;
  const visibility = Math.max(finite(point.visibility, 1), finite(point.presence, 1));
  return visibility >= minimumVisibility;
}

function distance(left, right) {
  if (!validPoint(left) || !validPoint(right)) return Infinity;
  return Math.hypot(finite(left.x) - finite(right.x), finite(left.y) - finite(right.y));
}

function angle(left, right) {
  if (!validPoint(left) || !validPoint(right)) return null;
  return Math.atan2(finite(right.y) - finite(left.y), finite(right.x) - finite(left.x));
}

function angleDelta(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return 0;
  let delta = right - left;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return Math.abs(delta);
}

function median(values = []) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function coefficientOfVariation(values = []) {
  const usable = values.filter((value) => Number.isFinite(value) && value > 0);
  if (usable.length < 2) return 1;
  const mean = usable.reduce((sum, value) => sum + value, 0) / usable.length;
  const variance = usable.reduce((sum, value) => sum + (value - mean) ** 2, 0) / usable.length;
  return mean > 0 ? Math.sqrt(variance) / mean : 1;
}

function handContact(hand) {
  if (validPoint(hand?.pickPoint)) return hand.pickPoint;
  const landmarks = hand?.landmarks || [];
  if (validPoint(landmarks[4]) && validPoint(landmarks[8])) {
    return {
      x: (finite(landmarks[4].x) + finite(landmarks[8].x)) / 2,
      y: (finite(landmarks[4].y) + finite(landmarks[8].y)) / 2,
    };
  }
  return null;
}

function palmScale(landmarks = []) {
  return median([
    distance(landmarks[0], landmarks[5]),
    distance(landmarks[0], landmarks[9]),
    distance(landmarks[0], landmarks[17]),
    distance(landmarks[5], landmarks[17]),
  ]) || 0.12;
}

function palmCenter(landmarks = []) {
  const points = [0, 5, 9, 13, 17].map((index) => landmarks[index]).filter(validPoint);
  if (!points.length) return null;
  return {
    x: points.reduce((sum, point) => sum + finite(point.x), 0) / points.length,
    y: points.reduce((sum, point) => sum + finite(point.y), 0) / points.length,
  };
}

const SIDES = [
  { id: 'left', shoulder: 11, elbow: 13, wrist: 15 },
  { id: 'right', shoulder: 12, elbow: 14, wrist: 16 },
];

export function matchPoseArm(handWrist, poseLandmarks = [], previousSide = null) {
  if (!validPoint(handWrist) || poseLandmarks.length < 17) return null;
  const candidates = SIDES.map((side) => {
    const shoulder = poseLandmarks[side.shoulder];
    const elbow = poseLandmarks[side.elbow];
    const wrist = poseLandmarks[side.wrist];
    if (![shoulder, elbow, wrist].every((point) => validPoint(point, 0.35))) return null;
    const wristDistance = distance(handWrist, wrist);
    const continuityBonus = side.id === previousSide ? 0.035 : 0;
    return {
      side: side.id,
      shoulder,
      elbow,
      wrist,
      distance: wristDistance,
      score: wristDistance - continuityBonus,
    };
  }).filter(Boolean).sort((left, right) => left.score - right.score);
  const selected = candidates[0];
  if (!selected || selected.distance > 0.3) return null;
  return selected;
}

function bodyQuality(arm) {
  if (!arm) return 0;
  const points = [arm.shoulder, arm.elbow, arm.wrist];
  return clamp(points.reduce((sum, point) => sum + Math.max(finite(point.visibility, 1), finite(point.presence, 1)), 0) / 3);
}

function bandProjection(point, band) {
  if (!validPoint(point) || !band) return null;
  return finite(band.normalX) * finite(point.x) + finite(band.normalY, 1) * finite(point.y);
}

class FingerPluckTracker {
  constructor() { this.reset(); }

  reset() {
    this.states = new Map();
    this.events = [];
    this.recoveryTimes = [];
    this.independenceScores = [];
  }

  signal(landmarks, definition, scale) {
    const tip = landmarks?.[definition.tip];
    const mcp = landmarks?.[definition.mcp];
    if (!validPoint(tip) || !validPoint(mcp) || !(scale > 0)) return null;
    return distance(tip, mcp) / scale;
  }

  update({ landmarks = [], timestamp }) {
    if (landmarks.length !== 21) return null;
    const scale = palmScale(landmarks);
    const definitions = [
      { id: 'p', tip: 4, mcp: 2 },
      { id: 'i', tip: 8, mcp: 5 },
      { id: 'm', tip: 12, mcp: 9 },
      { id: 'a', tip: 16, mcp: 13 },
    ];
    const signals = Object.fromEntries(definitions.map((definition) => [definition.id, this.signal(landmarks, definition, scale)]));
    const now = finite(timestamp);
    let emitted = null;

    for (const definition of definitions) {
      const current = signals[definition.id];
      if (!Number.isFinite(current)) continue;
      const state = this.states.get(definition.id) || {
        previous: current,
        maximum: current,
        minimum: current,
        armed: true,
        lastEventAt: -Infinity,
        eventStartSignal: current,
        waitingRecovery: false,
      };
      const contraction = state.previous - current;
      state.maximum = Math.max(state.maximum, current);
      state.minimum = Math.min(state.minimum, current);
      const range = state.maximum - state.minimum;

      if (state.waitingRecovery) {
        if (current >= state.eventStartSignal - 0.025) {
          state.waitingRecovery = false;
          state.armed = true;
          this.recoveryTimes.push(now - state.lastEventAt);
          this.recoveryTimes = this.recoveryTimes.slice(-24);
        }
      } else if (state.armed && now - state.lastEventAt >= 78 && contraction >= 0.032 && range >= 0.045) {
        const otherMotion = definitions
          .filter((other) => other.id !== definition.id)
          .map((other) => {
            const otherState = this.states.get(other.id);
            const otherSignal = signals[other.id];
            return otherState && Number.isFinite(otherSignal) ? Math.abs(otherState.previous - otherSignal) : 0;
          });
        const targetMotion = Math.max(0.001, Math.abs(contraction));
        const coMovement = Math.max(0, ...otherMotion) / targetMotion;
        const independence = clamp(1 - coMovement * 0.72);
        emitted = { finger: definition.id, at: now, independence, contraction };
        this.events.push(emitted);
        this.events = this.events.filter((event) => now - event.at <= 4000).slice(-48);
        this.independenceScores.push(independence);
        this.independenceScores = this.independenceScores.slice(-24);
        state.lastEventAt = now;
        state.eventStartSignal = state.previous;
        state.armed = false;
        state.waitingRecovery = true;
        state.maximum = current;
        state.minimum = current;
      }
      state.previous = current;
      this.states.set(definition.id, state);
    }
    return emitted;
  }

  summary(now) {
    const recent = this.events.filter((event) => now - event.at <= 3000);
    const threeFinger = recent.filter((event) => ['i', 'm', 'a'].includes(event.finger));
    const intervals = threeFinger.slice(1).map((event, index) => event.at - threeFinger[index].at);
    const threeFingerSps = intervals.length ? 1000 / Math.max(1, median(intervals)) : 0;
    const patterns = [
      ['p-i-m', ['p', 'i', 'm']],
      ['p-i-p-m', ['p', 'i', 'p', 'm']],
      ['p-a-m-i', ['p', 'a', 'm', 'i']],
      ['i-m-a', ['i', 'm', 'a']],
      ['a-m-i', ['a', 'm', 'i']],
    ];
    let detectedPattern = '자동 분석 중';
    let patternAccuracy = 0;
    for (const [name, pattern] of patterns) {
      if (recent.length < pattern.length) continue;
      const evaluated = recent.slice(-Math.min(recent.length, pattern.length * 3));
      let matches = 0;
      for (let index = 0; index < evaluated.length; index += 1) {
        if (evaluated[index].finger === pattern[index % pattern.length]) matches += 1;
      }
      const accuracy = matches / evaluated.length;
      if (accuracy > patternAccuracy) {
        patternAccuracy = accuracy;
        detectedPattern = name;
      }
    }
    return {
      fingerEventCount: recent.length,
      lastFinger: recent.at(-1)?.finger || null,
      recentSequence: recent.slice(-8).map((event) => event.finger).join('-'),
      detectedPattern,
      patternAccuracy: clamp(patternAccuracy),
      threeFingerSps,
      threeFingerNotesPerMinute: threeFingerSps * 60,
      independence: this.independenceScores.length ? median(this.independenceScores.slice(-10)) : 0,
      returnMs: this.recoveryTimes.length ? median(this.recoveryTimes.slice(-10)) : 0,
    };
  }
}

class MicroPickingTracker {
  constructor() { this.reset(); }

  reset() {
    this.lastProjection = null;
    this.lastAt = 0;
    this.direction = 0;
    this.extreme = null;
    this.events = [];
  }

  update({ point, band, timestamp, fullStrokeEvent = null }) {
    const projection = bandProjection(point, band);
    const now = finite(timestamp);
    if (projection == null || !band) return null;
    if (this.lastAt && now - this.lastAt > 260) this.reset();
    const previous = this.lastProjection;
    this.lastProjection = projection;
    this.lastAt = now;
    if (previous == null) {
      this.extreme = projection;
      return null;
    }
    const delta = projection - previous;
    const sign = Math.abs(delta) < 0.0015 ? 0 : Math.sign(delta);
    if (!sign) return null;
    if (!this.direction) {
      this.direction = sign;
      this.extreme = previous;
      return null;
    }
    if (sign === this.direction) {
      this.extreme = this.direction > 0 ? Math.min(this.extreme, projection) : Math.max(this.extreme, projection);
      return null;
    }
    const excursion = Math.abs(previous - this.extreme);
    const centerDistance = Math.abs(projection - finite(band.center));
    const bandWidth = Math.max(0.012, finite(band.bottom) - finite(band.top));
    this.direction = sign;
    this.extreme = previous;
    if (fullStrokeEvent || excursion < Math.max(0.0055, bandWidth * 0.16) || excursion > 0.09 || centerDistance > Math.max(0.06, bandWidth * 2.8)) return null;
    const event = { direction: sign > 0 ? 'down' : 'up', at: now, excursion };
    this.events.push(event);
    this.events = this.events.filter((entry) => now - entry.at <= 3500).slice(-50);
    return event;
  }

  summary(now) {
    const recent = this.events.filter((event) => now - event.at <= 2500);
    const intervals = recent.slice(1).map((event, index) => event.at - recent[index].at);
    const sps = intervals.length ? 1000 / Math.max(1, median(intervals)) : 0;
    let alternating = 0;
    for (let index = 1; index < recent.length; index += 1) {
      if (recent[index].direction !== recent[index - 1].direction) alternating += 1;
    }
    const alternation = recent.length > 1 ? alternating / (recent.length - 1) : 0;
    const consistency = clamp(1 - coefficientOfVariation(intervals) / 0.45);
    return {
      pickingCount: recent.length,
      pickingSps: sps,
      pickingNotesPerMinute: sps * 60,
      pickingAlternation: alternation,
      pickingConsistency: consistency,
      pickingAccuracy: clamp(alternation * 0.55 + consistency * 0.45),
    };
  }
}

export function classifyRightHandMotion(samples = []) {
  const usable = samples.filter((sample) => Number.isFinite(sample.armEnergy) && Number.isFinite(sample.wristEnergy));
  if (usable.length < 2) return { type: 'unjudgeable', armRatio: 0, wristRatio: 0, confidence: 0 };
  const armEnergy = usable.reduce((sum, sample) => sum + sample.armEnergy, 0);
  const wristEnergy = usable.reduce((sum, sample) => sum + sample.wristEnergy, 0);
  const total = armEnergy + wristEnergy;
  if (total < 0.004) return { type: 'still', armRatio: 0, wristRatio: 0, confidence: 0.3 };
  const armRatio = armEnergy / total;
  const wristRatio = wristEnergy / total;
  const quality = usable.reduce((sum, sample) => sum + sample.quality, 0) / usable.length;
  const separation = Math.abs(armRatio - wristRatio);
  const confidence = clamp(quality * (0.52 + separation * 0.75));
  const type = wristRatio >= 0.62 ? 'wrist' : armRatio >= 0.62 ? 'arm' : 'mixed';
  return { type, armRatio, wristRatio, confidence, armEnergy, wristEnergy };
}

export class RightHandTechniqueAnalyzer {
  constructor() { this.reset(); }

  reset() {
    this.previous = null;
    this.side = null;
    this.samples = [];
    this.strokeEvents = [];
    this.maxStableSps = 0;
    this.fingers = new FingerPluckTracker();
    this.picking = new MicroPickingTracker();
    this.lastResult = null;
  }

  update({ timestamp, hand = null, bodyLandmarks = [], band = null, strokeEvent = null } = {}) {
    const now = finite(timestamp);
    const landmarks = hand?.landmarks || [];
    const handWrist = hand?.wrist || landmarks[0];
    const contact = handContact(hand);
    const arm = matchPoseArm(handWrist, bodyLandmarks, this.side);
    if (arm) this.side = arm.side;
    const palmAngle = landmarks.length === 21 ? angle(landmarks[5], landmarks[17]) : null;
    const forearmAngle = arm ? angle(arm.elbow, arm.wrist) : null;
    const upperArmAngle = arm ? angle(arm.shoulder, arm.elbow) : null;
    const relativeContact = validPoint(contact) && validPoint(handWrist) ? {
      x: contact.x - handWrist.x,
      y: contact.y - handWrist.y,
    } : null;
    const current = { now, relativeContact, palmAngle, arm, forearmAngle, upperArmAngle };

    if (this.previous && arm && this.previous.arm && this.previous.arm.side === arm.side && now - this.previous.now <= 260) {
      const shoulderTravel = distance(this.previous.arm.shoulder, arm.shoulder);
      const elbowTravel = distance(this.previous.arm.elbow, arm.elbow);
      const poseWristTravel = distance(this.previous.arm.wrist, arm.wrist);
      const relativeTravel = this.previous.relativeContact && relativeContact
        ? Math.hypot(relativeContact.x - this.previous.relativeContact.x, relativeContact.y - this.previous.relativeContact.y)
        : 0;
      const palmRotation = angleDelta(this.previous.palmAngle, palmAngle);
      const forearmRotation = angleDelta(this.previous.forearmAngle, forearmAngle);
      const upperArmRotation = angleDelta(this.previous.upperArmAngle, upperArmAngle);
      const armEnergy = shoulderTravel * 0.7
        + elbowTravel * 1.75
        + poseWristTravel * 0.9
        + forearmRotation * 0.035
        + upperArmRotation * 0.06;
      const wristEnergy = relativeTravel * 2.65 + palmRotation * 0.055;
      this.samples.push({
        at: now,
        armEnergy,
        wristEnergy,
        shoulderTravel,
        elbowTravel,
        poseWristTravel,
        relativeTravel,
        quality: bodyQuality(arm),
      });
      this.samples = this.samples.filter((sample) => now - sample.at <= 900).slice(-36);
    }
    this.previous = current;

    const fingerEvent = this.fingers.update({ landmarks, timestamp: now });
    const pickingEvent = this.picking.update({ point: contact, band, timestamp: now, fullStrokeEvent: strokeEvent });
    if (strokeEvent) {
      this.strokeEvents.push({ direction: strokeEvent, at: now });
      this.strokeEvents = this.strokeEvents.filter((event) => now - event.at <= 5000).slice(-40);
    }

    const motion = classifyRightHandMotion(this.samples);
    const recentStrokes = this.strokeEvents.filter((event) => now - event.at <= 3000);
    const strokeIntervals = recentStrokes.slice(1).map((event, index) => event.at - recentStrokes[index].at);
    const strumSps = strokeIntervals.length ? 1000 / Math.max(1, median(strokeIntervals)) : 0;
    let alternating = 0;
    for (let index = 1; index < recentStrokes.length; index += 1) {
      if (recentStrokes[index].direction !== recentStrokes[index - 1].direction) alternating += 1;
    }
    const alternation = recentStrokes.length > 1 ? alternating / (recentStrokes.length - 1) : 0;
    const consistency = clamp(1 - coefficientOfVariation(strokeIntervals) / 0.42);
    if (recentStrokes.length >= 6 && consistency >= 0.72) this.maxStableSps = Math.max(this.maxStableSps, strumSps);
    const fastStrumAccuracy = clamp(alternation * 0.42 + consistency * 0.36 + motion.wristRatio * 0.22);
    const picking = this.picking.summary(now);
    const fingerstyle = this.fingers.summary(now);
    const labels = {
      wrist: '손목 주도',
      arm: '팔 주도',
      mixed: '팔·손목 혼합',
      still: '동작 대기',
      unjudgeable: '자세 관절 판정 불가',
    };
    const result = {
      movementType: motion.type,
      movementLabel: labels[motion.type] || labels.unjudgeable,
      movementConfidence: motion.confidence,
      armRatio: motion.armRatio,
      wristRatio: motion.wristRatio,
      poseSide: this.side,
      poseReady: Boolean(arm),
      strumSps,
      strumNotesPerMinute: strumSps * 60,
      maxStableSps: this.maxStableSps,
      maxStableNotesPerMinute: this.maxStableSps * 60,
      strumAlternation: alternation,
      strumConsistency: consistency,
      fastStrumAccuracy,
      fingerEvent,
      pickingEvent,
      ...picking,
      ...fingerstyle,
    };
    this.lastResult = result;
    return result;
  }
}
