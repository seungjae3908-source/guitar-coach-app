import type { PracticeCategoryId } from '../config/guitar-mode-profiles';
import type {
  GuitarStringLine,
  HandAnalysisResult,
  HandLandmarkPoint,
  StringContactId,
} from '../modules/guitar-coach-hand';

export type InferredRightHandHit = {
  capturedAt: number;
  contactId: StringContactId;
  label: string;
  visualIndex: number;
  stringNumber: number;
  direction: 'down' | 'up' | 'unknown';
  confidence: number;
};

type Point = { x: number; y: number };
type ContactState = {
  capturedAt: number;
  point: Point;
  signedDistance: number;
  distanceRatio: number;
  visualIndex: number;
  stringNumber: number;
};

type MotionPolicy = {
  minimumElapsedMs: number;
  minimumMovement: number;
  minimumSideDistanceRatio: number;
  minimumSideDistance: number;
  cooldownMs: number;
};

const PICK_CATEGORIES = new Set<PracticeCategoryId>([
  'strumming',
  'downPicking',
  'alternatePicking',
  'palmMute',
]);
const FINGER_CATEGORIES = new Set<PracticeCategoryId>(['arpeggio', 'fingerstyle']);

const LABELS: Record<StringContactId, string> = {
  pick: '피크',
  thumb: 'P',
  index: 'i',
  middle: 'm',
  ring: 'a',
  pinky: '새끼',
};

const TIP_NAMES: Partial<Record<StringContactId, HandLandmarkPoint['name']>> = {
  thumb: 'thumbTip',
  index: 'indexTip',
  middle: 'middleTip',
  ring: 'ringTip',
  pinky: 'pinkyTip',
};

const PICK_MOTION_POLICY: MotionPolicy = {
  minimumElapsedMs: 35,
  minimumMovement: 0.035,
  minimumSideDistanceRatio: 0,
  minimumSideDistance: 0,
  cooldownMs: 75,
};

const FINGER_MOTION_POLICY: MotionPolicy = {
  minimumElapsedMs: 20,
  minimumMovement: 0.014,
  minimumSideDistanceRatio: 0.035,
  minimumSideDistance: 0.0012,
  cooldownMs: 105,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function distance(left: Point, right: Point) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function lineLength(line: GuitarStringLine) {
  return Math.max(0.000001, Math.hypot(line.endX - line.startX, line.endY - line.startY));
}

function signedDistance(point: Point, line: GuitarStringLine) {
  const dx = line.endX - line.startX;
  const dy = line.endY - line.startY;
  return ((point.x - line.startX) * -dy + (point.y - line.startY) * dx) / lineLength(line);
}

function lineCenter(line: GuitarStringLine) {
  return { x: (line.startX + line.endX) / 2, y: (line.startY + line.endY) / 2 };
}

function averageLineSpacing(lines: GuitarStringLine[]) {
  const ordered = [...lines].sort((left, right) => left.visualIndex - right.visualIndex);
  const gaps = ordered.slice(1).map((line, index) => distance(lineCenter(line), lineCenter(ordered[index])));
  return gaps.length ? gaps.reduce((sum, value) => sum + value, 0) / gaps.length : 0.035;
}

function nearestLine(point: Point, lines: GuitarStringLine[]) {
  return lines
    .map((line) => ({ line, signed: signedDistance(point, line) }))
    .sort((left, right) => Math.abs(left.signed) - Math.abs(right.signed))[0] ?? null;
}

function pointForContact(
  id: StringContactId,
  result: HandAnalysisResult,
  landmarks: Map<HandLandmarkPoint['name'], HandLandmarkPoint>,
): Point | null {
  if (id === 'pick') {
    if (!result.pick.detected || result.pick.confidence < 0.34) return null;
    return { x: result.pick.centerX, y: result.pick.centerY };
  }
  const name = TIP_NAMES[id];
  const point = name ? landmarks.get(name) : null;
  return point ? { x: point.x, y: point.y } : null;
}

function contactIds(category: PracticeCategoryId): StringContactId[] {
  if (PICK_CATEGORIES.has(category)) return ['pick'];
  if (FINGER_CATEGORIES.has(category)) return ['thumb', 'index', 'middle', 'ring'];
  return [];
}

function motionPolicy(category: PracticeCategoryId) {
  return FINGER_CATEGORIES.has(category) ? FINGER_MOTION_POLICY : PICK_MOTION_POLICY;
}

function directionFromMotion(previous: ContactState, point: Point, signed: number): 'down' | 'up' | 'unknown' {
  const signedChange = signed - previous.signedDistance;
  if (Math.abs(signedChange) >= 0.0025) return signedChange > 0 ? 'down' : 'up';
  const yChange = point.y - previous.point.y;
  if (Math.abs(yChange) >= 0.004) return yChange > 0 ? 'down' : 'up';
  return 'unknown';
}

function crossedVisualIndexes(previous: number, current: number) {
  if (previous <= 0 || current <= 0 || previous === current) return [current].filter((value) => value > 0);
  const direction = current > previous ? 1 : -1;
  const result: number[] = [];
  for (let value = previous + direction; direction > 0 ? value <= current : value >= current; value += direction) {
    result.push(value);
  }
  return result;
}

export class RightHandMotionTracker {
  private readonly states = new Map<StringContactId, ContactState>();
  private readonly lastHitAt = new Map<StringContactId, number>();

  reset() {
    this.states.clear();
    this.lastHitAt.clear();
  }

  update(result: HandAnalysisResult, capturedAt: number, category: PracticeCategoryId): InferredRightHandHit[] {
    const tracking = result.stringTracking;
    if (!result.hasHand || !tracking?.detected || tracking.lines.length < 4) {
      this.states.clear();
      return [];
    }

    const spacing = Math.max(0.006, averageLineSpacing(tracking.lines));
    const landmarks = new Map(result.landmarks.map((point) => [point.name, point]));
    const palmWrist = landmarks.get('wrist');
    const middleMcp = landmarks.get('middleMcp');
    const palmSize = palmWrist && middleMcp ? distance(palmWrist, middleMcp) : 0;
    if (palmSize < 0.045 || result.handednessScore < 0.32) return [];

    const policy = motionPolicy(category);
    const isFingerCategory = FINGER_CATEGORIES.has(category);
    const minimumSideDistance = Math.max(
      policy.minimumSideDistance,
      spacing * policy.minimumSideDistanceRatio,
    );
    const hits: InferredRightHandHit[] = [];
    contactIds(category).forEach((id) => {
      const point = pointForContact(id, result, landmarks);
      if (!point) {
        this.states.delete(id);
        return;
      }
      const nearest = nearestLine(point, tracking.lines);
      if (!nearest) return;
      const ratio = Math.abs(nearest.signed) / spacing;
      const visualIndex = nearest.line.visualIndex;
      const stringNumber = nearest.line.stringNumber;
      const current: ContactState = {
        capturedAt,
        point,
        signedDistance: nearest.signed,
        distanceRatio: ratio,
        visualIndex,
        stringNumber,
      };
      const previous = this.states.get(id);
      this.states.set(id, current);
      if (!previous) return;

      const elapsedMs = capturedAt - previous.capturedAt;
      if (elapsedMs < policy.minimumElapsedMs || elapsedMs > 650) return;
      const movement = distance(previous.point, point) / Math.max(0.001, palmSize);
      const crossedSide = previous.signedDistance * nearest.signed <= 0
        && Math.abs(previous.signedDistance) <= spacing * 1.15
        && Math.abs(nearest.signed) <= spacing * 1.15
        && (!isFingerCategory || (
          Math.abs(previous.signedDistance) >= minimumSideDistance
          && Math.abs(nearest.signed) >= minimumSideDistance
        ));
      const changedLine = previous.visualIndex > 0
        && visualIndex > 0
        && previous.visualIndex !== visualIndex
        && (previous.distanceRatio <= 1.35 || ratio <= 1.35);
      if ((!crossedSide && !changedLine) || movement < policy.minimumMovement) return;

      const lastHit = this.lastHitAt.get(id) ?? 0;
      if (capturedAt - lastHit < policy.cooldownMs) return;
      const direction = directionFromMotion(previous, point, nearest.signed);
      const handConfidence = clamp(result.handednessScore, 0, 1);
      const stringConfidence = clamp(
        tracking.confidence * 0.46
          + (tracking.stabilityConfidence ?? 0) * 0.24
          + tracking.numberingConfidence * 0.12
          + clamp(1 - Math.min(previous.distanceRatio, ratio) / 1.35, 0, 1) * 0.18,
        0,
        1,
      );
      const sourceConfidence = id === 'pick' ? result.pick.confidence : handConfidence;
      const confidence = clamp(sourceConfidence * 0.48 + stringConfidence * 0.42 + clamp(movement / 0.34, 0, 1) * 0.10, 0, 1);
      if (confidence < 0.48) return;

      const indexes = crossedVisualIndexes(previous.visualIndex, visualIndex);
      indexes.forEach((index) => {
        const line = tracking.lines.find((item) => item.visualIndex === index) ?? nearest.line;
        hits.push({
          capturedAt,
          contactId: id,
          label: LABELS[id],
          visualIndex: line.visualIndex,
          stringNumber: line.stringNumber,
          direction,
          confidence,
        });
      });
      this.lastHitAt.set(id, capturedAt);
    });

    return hits;
  }
}
