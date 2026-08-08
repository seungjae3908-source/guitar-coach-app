import type {
  GuitarStringLine,
  HandAnalysisResult,
  HandLandmarkName,
  HandLandmarkPoint,
} from '../modules/guitar-coach-hand';
import { RightHandMotionTracker } from '../services/right-hand-motion-tracker';

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

const names: HandLandmarkName[] = [
  'wrist', 'thumbCmc', 'thumbMcp', 'thumbIp', 'thumbTip',
  'indexMcp', 'indexPip', 'indexDip', 'indexTip',
  'middleMcp', 'middlePip', 'middleDip', 'middleTip',
  'ringMcp', 'ringPip', 'ringDip', 'ringTip',
  'pinkyMcp', 'pinkyPip', 'pinkyDip', 'pinkyTip',
];

const lines: GuitarStringLine[] = [1, 2, 3, 4, 5, 6].map((visualIndex) => {
  const y = 0.35 + (visualIndex - 1) * 0.06;
  return {
    visualIndex: visualIndex as 1 | 2 | 3 | 4 | 5 | 6,
    stringNumber: (7 - visualIndex) as 1 | 2 | 3 | 4 | 5 | 6,
    startX: 0.1,
    startY: y,
    endX: 0.9,
    endY: y,
    strength: 0.9,
  };
});

function landmarks(indexTipY: number): HandLandmarkPoint[] {
  return names.map((name, index) => {
    let x = 0.5 + (index % 4) * 0.008;
    let y = 0.62 - Math.floor(index / 4) * 0.018;
    if (name === 'wrist') {
      x = 0.5;
      y = 0.78;
    }
    if (name === 'middleMcp') {
      x = 0.5;
      y = 0.58;
    }
    if (name === 'indexTip') {
      x = 0.5;
      y = indexTipY;
    }
    return { index, name, x, y, z: 0 };
  });
}

function frame(pickY: number, indexTipY: number): HandAnalysisResult {
  return {
    hasHand: true,
    imageWidth: 960,
    imageHeight: 720,
    latencyMs: 40,
    handedness: 'Right',
    handednessScore: 0.92,
    landmarks: landmarks(indexTipY),
    pick: {
      detected: true,
      color: 'auto',
      confidence: 0.88,
      angleDegrees: 12,
      exposure: 0.48,
      centerX: 0.5,
      centerY: pickY,
    },
    stringTracking: {
      detected: true,
      confidence: 0.9,
      angleDegrees: 0,
      visibleLineCount: 6,
      stringOrder: 'low-to-high',
      numberingConfidence: 0.9,
      stabilityConfidence: 0.9,
      nearestVisualIndex: 0,
      nearestStringNumber: 0,
      nearestDistanceRatio: 1,
      lines,
    },
  };
}

const pickTracker = new RightHandMotionTracker();
assert(pickTracker.update(frame(0.455, 0.455), 1_000, 'alternatePicking').length === 0, 'first picking frame should arm tracker');
const pickHits = pickTracker.update(frame(0.545, 0.545), 1_180, 'alternatePicking');
assert(pickHits.length >= 1, 'pick crossing should create a real hit');
assert(pickHits.every((hit) => hit.contactId === 'pick'), 'picking hit must belong to pick');
assert(pickHits.every((hit) => hit.confidence >= 0.48), 'picking hit must pass confidence gate');

const fingerTracker = new RightHandMotionTracker();
assert(fingerTracker.update(frame(0.2, 0.455), 2_000, 'arpeggio').length === 0, 'first arpeggio frame should arm tracker');
const fingerHits = fingerTracker.update(frame(0.2, 0.545), 2_190, 'arpeggio');
assert(fingerHits.some((hit) => hit.contactId === 'index'), 'index crossing should create i hit');
assert(!fingerHits.some((hit) => hit.contactId === 'pick'), 'arpeggio must not fabricate pick hits');

const compactFingerTracker = new RightHandMotionTracker();
assert(compactFingerTracker.update(frame(0.2, 0.3475), 2_500, 'arpeggio').length === 0, 'compact pluck first frame should arm tracker');
const compactFingerHits = compactFingerTracker.update(frame(0.2, 0.3525), 2_580, 'arpeggio');
assert(compactFingerHits.some((hit) => hit.contactId === 'index'), 'five-pixel-equivalent index pluck should be recognized');

const jitterTracker = new RightHandMotionTracker();
assert(jitterTracker.update(frame(0.2, 0.3494), 2_800, 'arpeggio').length === 0, 'jitter first frame should arm tracker');
assert(jitterTracker.update(frame(0.2, 0.3506), 2_880, 'arpeggio').length === 0, 'sub-threshold center jitter must not create a finger hit');

const staleTracker = new RightHandMotionTracker();
staleTracker.update(frame(0.455, 0.455), 3_000, 'strumming');
assert(staleTracker.update(frame(0.545, 0.545), 3_900, 'strumming').length === 0, 'stale frames must not create hits');

console.log('Right-hand motion tracker tests passed: 11');
