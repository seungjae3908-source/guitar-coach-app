import { requireOptionalNativeModule } from 'expo';

import { getLatestLiveAnalysisFrames, publishLiveAnalysisFrame } from '../../services/analysis-stream';
import { getLivePracticeContext } from '../../services/practice-session-context';

export type HandLandmarkName =
  | 'wrist'
  | 'thumbCmc'
  | 'thumbMcp'
  | 'thumbIp'
  | 'thumbTip'
  | 'indexMcp'
  | 'indexPip'
  | 'indexDip'
  | 'indexTip'
  | 'middleMcp'
  | 'middlePip'
  | 'middleDip'
  | 'middleTip'
  | 'ringMcp'
  | 'ringPip'
  | 'ringDip'
  | 'ringTip'
  | 'pinkyMcp'
  | 'pinkyPip'
  | 'pinkyDip'
  | 'pinkyTip';

export type GuitarStringNumber = 1 | 2 | 3 | 4 | 5 | 6;
export type StringContactId = 'pick' | 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';
export type HandLandmarkPoint = { index: number; name: HandLandmarkName; x: number; y: number; z: number };
export type PickColor = 'none' | 'auto' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'white' | 'black';
export type PickAnalysisResult = {
  detected: boolean;
  color: PickColor | string;
  confidence: number;
  angleDegrees: number;
  exposure: number;
  centerX: number;
  centerY: number;
};
export type GuitarStringLine = {
  visualIndex: GuitarStringNumber;
  stringNumber: 0 | GuitarStringNumber;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  strength: number;
};
export type GuitarStringContact = {
  id: StringContactId;
  label: string;
  x: number;
  y: number;
  visualIndex: 0 | GuitarStringNumber;
  stringNumber: 0 | GuitarStringNumber;
  distanceRatio: number;
  confidence: number;
  source: 'vision' | 'vision-audio' | 'unresolved';
};
export type GuitarStringTrackingResult = {
  detected: boolean;
  confidence: number;
  angleDegrees: number;
  visibleLineCount: number;
  stringOrder: 'low-to-high' | 'high-to-low' | 'unknown' | string;
  numberingConfidence: number;
  stabilityConfidence?: number;
  nearestVisualIndex: number;
  nearestStringNumber: 0 | GuitarStringNumber;
  nearestDistanceRatio: number;
  primaryContactId?: StringContactId;
  contacts?: GuitarStringContact[];
  audioConfirmed?: boolean;
  audioCandidateStrings?: GuitarStringNumber[];
  audioFrequencyHz?: number;
  audioConfidence?: number;
  roiLeft?: number;
  roiTop?: number;
  roiRight?: number;
  roiBottom?: number;
  focusX?: number;
  focusY?: number;
  lines: GuitarStringLine[];
};
export type HandAnalysisResult = {
  hasHand: boolean;
  imageWidth: number;
  imageHeight: number;
  latencyMs: number;
  handedness: 'Left' | 'Right' | 'Unknown' | string;
  handednessScore: number;
  landmarks: HandLandmarkPoint[];
  pick: PickAnalysisResult;
  stringTracking?: GuitarStringTrackingResult;
};

type GuitarCoachHandModule = {
  androidHandCoachAvailable: boolean;
  analyzeHandAsync(uri: string, pickColor: PickColor): Promise<HandAnalysisResult>;
};
type GuitarCoachStringVisionModule = {
  androidStringVisionAvailable: boolean;
  androidAdaptiveStringRegionAvailable?: boolean;
  analyzeStringsAsync(uri: string): Promise<GuitarStringTrackingResult>;
  analyzeStringsInRegionAsync?: (
    uri: string,
    left: number,
    top: number,
    right: number,
    bottom: number,
    focusX: number,
    focusY: number,
  ) => Promise<GuitarStringTrackingResult>;
};

type TrackingHistoryEntry = { capturedAt: number; tracking: GuitarStringTrackingResult };
type StringVisionRegion = { left: number; top: number; right: number; bottom: number; focusX: number; focusY: number };

const NativeModule = requireOptionalNativeModule<GuitarCoachHandModule>('GuitarCoachHand');
const StringVisionModule = requireOptionalNativeModule<GuitarCoachStringVisionModule>('GuitarCoachStringVision');
export const isDetailedHandCoachAvailable = Boolean(NativeModule?.androidHandCoachAvailable);
export const isAutomaticStringVisionAvailable = Boolean(StringVisionModule?.androidStringVisionAvailable);

const trackingHistory: TrackingHistoryEntry[] = [];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function isGuitarStringNumber(value: number): value is GuitarStringNumber {
  return Number.isInteger(value) && value >= 1 && value <= 6;
}

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function pointToLineDistance(point: { x: number; y: number }, line: GuitarStringLine) {
  const abX = line.endX - line.startX;
  const abY = line.endY - line.startY;
  const denominator = Math.max(0.000001, abX * abX + abY * abY);
  const amount = Math.min(1, Math.max(0, ((point.x - line.startX) * abX + (point.y - line.startY) * abY) / denominator));
  return Math.hypot(point.x - (line.startX + abX * amount), point.y - (line.startY + abY * amount));
}

function averageLineSpacing(lines: GuitarStringLine[]) {
  const ordered = [...lines].sort((a, b) => a.visualIndex - b.visualIndex);
  const distances = ordered.slice(1).map((line, index) => {
    const previous = ordered[index];
    return Math.hypot(
      (line.startX + line.endX - previous.startX - previous.endX) / 2,
      (line.startY + line.endY - previous.startY - previous.endY) / 2,
    );
  }).filter((value) => value > 0.001);
  return distances.length ? mean(distances) : 0.03;
}

function palmSize(result: HandAnalysisResult) {
  if (!result.hasHand || result.landmarks.length < 10) return 0;
  return Math.hypot(
    result.landmarks[0].x - result.landmarks[9].x,
    result.landmarks[0].y - result.landmarks[9].y,
  );
}

function shouldPublishForCoach(result: HandAnalysisResult, pickColor: PickColor) {
  const context = getLivePracticeContext();
  if (!context?.active) return true;
  const rightHandCategory = context.category === 'arpeggio'
    || context.category === 'fingerstyle'
    || context.category === 'strumming'
    || context.category === 'downPicking'
    || context.category === 'alternatePicking'
    || context.category === 'palmMute';
  const leftHandCategory = context.category === 'chords'
    || context.category === 'fingering'
    || context.category === 'powerChords'
    || context.category === 'scales'
    || context.category === 'leadTechnique';

  if (pickColor === 'auto') return rightHandCategory;
  if (pickColor === 'none') return leftHandCategory && palmSize(result) >= 0.18;
  return rightHandCategory;
}

function buildStringRegion(hand: HandAnalysisResult): StringVisionRegion {
  const tips = [4, 8, 12, 16, 20]
    .map((index) => hand.landmarks[index])
    .filter((point): point is HandLandmarkPoint => Boolean(point));
  const ys = hand.landmarks.map((point) => point.y);
  const focusPoints = hand.pick.detected && hand.pick.confidence >= 0.38
    ? [{ x: hand.pick.centerX, y: hand.pick.centerY }]
    : tips;
  const focusX = focusPoints.length ? mean(focusPoints.map((point) => point.x)) : 0.5;
  const focusY = focusPoints.length ? mean(focusPoints.map((point) => point.y)) : 0.5;
  let top = clamp(Math.min(...ys, focusY) - 0.23, 0.01, 0.95);
  let bottom = clamp(Math.max(...ys, focusY) + 0.23, 0.05, 0.99);
  if (bottom - top < 0.42) {
    const center = (top + bottom) / 2;
    top = clamp(center - 0.21, 0.01, 0.57);
    bottom = clamp(center + 0.21, 0.43, 0.99);
  }
  return { left: 0.01, top, right: 0.99, bottom, focusX: clamp(focusX, 0, 1), focusY: clamp(focusY, 0, 1) };
}

function dominantStringOrder(samples: GuitarStringTrackingResult[]) {
  const scores = new Map<string, number>();
  samples.forEach((sample) => {
    if (sample.stringOrder === 'unknown') return;
    scores.set(sample.stringOrder, (scores.get(sample.stringOrder) ?? 0) + sample.confidence * sample.numberingConfidence);
  });
  const winner = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!winner || winner[1] < 0.72) return 'unknown';
  return winner[0] as 'low-to-high' | 'high-to-low';
}

function stabilizeTracking(next: GuitarStringTrackingResult): GuitarStringTrackingResult {
  const now = Date.now();
  while (trackingHistory[0] && now - trackingHistory[0].capturedAt > 1_900) trackingHistory.shift();
  if (!next.detected || next.lines.length < 4) {
    return { ...next, stabilityConfidence: 0, contacts: [] };
  }

  trackingHistory.push({ capturedAt: now, tracking: { ...next, contacts: undefined } });
  while (trackingHistory.length > 7) trackingHistory.shift();
  const compatible = trackingHistory
    .filter((entry) => now - entry.capturedAt <= 1_900 && Math.abs(entry.tracking.angleDegrees - next.angleDegrees) <= 13)
    .slice(-5)
    .map((entry) => entry.tracking);
  const angleValues = compatible.map((sample) => sample.angleDegrees);
  const angleDegrees = median(angleValues);
  const lines: GuitarStringLine[] = [];

  for (let visualIndex = 1 as GuitarStringNumber; visualIndex <= 6; visualIndex = (visualIndex + 1) as GuitarStringNumber) {
    const matching = compatible
      .map((sample) => sample.lines.find((line) => line.visualIndex === visualIndex))
      .filter((line): line is GuitarStringLine => Boolean(line));
    if (!matching.length) continue;
    lines.push({
      visualIndex,
      stringNumber: 0,
      startX: median(matching.map((line) => line.startX)),
      startY: median(matching.map((line) => line.startY)),
      endX: median(matching.map((line) => line.endX)),
      endY: median(matching.map((line) => line.endY)),
      strength: median(matching.map((line) => line.strength)),
    });
  }

  const stringOrder = dominantStringOrder(compatible);
  const orderSamples = compatible.filter((sample) => sample.stringOrder === stringOrder);
  const numberingConfidence = stringOrder === 'unknown' ? 0 : mean(orderSamples.map((sample) => sample.numberingConfidence));
  const normalizedLines = lines.map((line) => ({
    ...line,
    stringNumber: numberingConfidence >= 0.62
      ? (stringOrder === 'low-to-high' ? 7 - line.visualIndex : line.visualIndex) as GuitarStringNumber
      : 0,
  }));
  const confidence = mean(compatible.map((sample) => sample.confidence));
  const stabilityConfidence = clamp(
    compatible.length / 5 * 0.46
      + (1 - clamp(standardDeviation(angleValues) / 11, 0, 1)) * 0.24
      + confidence * 0.30,
    0,
    1,
  );
  const visibleLineCount = normalizedLines.filter((line) => line.strength >= 0.28).length;

  return {
    ...next,
    detected: normalizedLines.length >= 5 && visibleLineCount >= 4 && confidence >= 0.38,
    confidence,
    angleDegrees,
    visibleLineCount,
    stringOrder,
    numberingConfidence,
    stabilityConfidence,
    nearestVisualIndex: 0,
    nearestStringNumber: 0,
    nearestDistanceRatio: 1,
    contacts: [],
    lines: normalizedLines,
  };
}

function liveAudioCandidates() {
  const frame = getLatestLiveAnalysisFrames().audio;
  if (!frame || Date.now() - frame.capturedAt > 850) return null;
  const audio = frame.result;
  if (!audio.hasPitch || audio.pitchConfidence < 0.58 || audio.frequencyHz <= 0) return null;
  const midi = 69 + 12 * Math.log2(audio.frequencyHz / 440);
  const openMidi: Array<{ stringNumber: GuitarStringNumber; midi: number }> = [
    { stringNumber: 6, midi: 40 },
    { stringNumber: 5, midi: 45 },
    { stringNumber: 4, midi: 50 },
    { stringNumber: 3, midi: 55 },
    { stringNumber: 2, midi: 59 },
    { stringNumber: 1, midi: 64 },
  ];
  const candidates: GuitarStringNumber[] = openMidi
    .filter((item) => midi >= item.midi - 0.45 && midi <= item.midi + 24.45)
    .map((item) => item.stringNumber);
  return { candidates, frequencyHz: audio.frequencyHz, confidence: audio.pitchConfidence };
}

function nearestLine(point: { x: number; y: number }, lines: GuitarStringLine[]) {
  return lines
    .map((line) => ({ line, distance: pointToLineDistance(point, line) }))
    .sort((a, b) => a.distance - b.distance)[0];
}

function estimatedPickTip(hand: HandAnalysisResult, lines: GuitarStringLine[]) {
  const center = { x: hand.pick.centerX, y: hand.pick.centerY };
  if (!hand.pick.detected || hand.pick.confidence < 0.36) return center;
  const radians = hand.pick.angleDegrees * Math.PI / 180;
  const length = clamp(palmSize(hand) * 0.34 + hand.pick.exposure * 0.025, 0.025, 0.085);
  const candidates = [
    center,
    { x: clamp(center.x + Math.cos(radians) * length, 0, 1), y: clamp(center.y + Math.sin(radians) * length, 0, 1) },
    { x: clamp(center.x - Math.cos(radians) * length, 0, 1), y: clamp(center.y - Math.sin(radians) * length, 0, 1) },
  ];
  return candidates.sort((a, b) => (nearestLine(a, lines)?.distance ?? 1) - (nearestLine(b, lines)?.distance ?? 1))[0];
}

function buildContacts(tracking: GuitarStringTrackingResult, hand: HandAnalysisResult) {
  const spacing = Math.max(0.004, averageLineSpacing(tracking.lines));
  const specifications: Array<{ id: StringContactId; label: string; point: { x: number; y: number } | null; baseConfidence: number }> = [
    {
      id: 'pick',
      label: '피크',
      point: hand.pick.detected ? estimatedPickTip(hand, tracking.lines) : null,
      baseConfidence: hand.pick.confidence,
    },
    { id: 'thumb', label: 'P', point: hand.landmarks[4] ?? null, baseConfidence: hand.handednessScore },
    { id: 'index', label: 'i', point: hand.landmarks[8] ?? null, baseConfidence: hand.handednessScore },
    { id: 'middle', label: 'm', point: hand.landmarks[12] ?? null, baseConfidence: hand.handednessScore },
    { id: 'ring', label: 'a', point: hand.landmarks[16] ?? null, baseConfidence: hand.handednessScore },
    { id: 'pinky', label: '새끼', point: hand.landmarks[20] ?? null, baseConfidence: hand.handednessScore },
  ];

  return specifications.flatMap<GuitarStringContact>((specification) => {
    if (!specification.point) return [];
    const nearest = nearestLine(specification.point, tracking.lines);
    const distanceRatio = nearest ? nearest.distance / spacing : 2;
    const visualIndex: 0 | GuitarStringNumber = nearest && distanceRatio <= 1.18 ? nearest.line.visualIndex : 0;
    const stringNumber: 0 | GuitarStringNumber = nearest
      && distanceRatio <= 0.78
      && tracking.confidence >= 0.50
      && (tracking.stabilityConfidence ?? 0) >= 0.38
      && tracking.numberingConfidence >= 0.62
      && isGuitarStringNumber(nearest.line.stringNumber)
      ? nearest.line.stringNumber
      : 0;
    const proximity = clamp(1 - distanceRatio / 1.22, 0, 1);
    const confidence = clamp(
      specification.baseConfidence * 0.38
        + tracking.confidence * 0.24
        + (tracking.stabilityConfidence ?? 0) * 0.18
        + proximity * 0.20,
      0,
      1,
    );
    return [{
      id: specification.id,
      label: specification.label,
      x: specification.point.x,
      y: specification.point.y,
      visualIndex,
      stringNumber,
      distanceRatio: Math.round(distanceRatio * 100) / 100,
      confidence,
      source: stringNumber > 0 ? 'vision' : 'unresolved',
    }];
  });
}

function fuseContacts(tracking: GuitarStringTrackingResult, hand: HandAnalysisResult): GuitarStringTrackingResult {
  if (!tracking.detected || tracking.lines.length < 4 || !hand.hasHand) return tracking;
  let contacts = buildContacts(tracking, hand);
  const pickContact = contacts.find((contact) => contact.id === 'pick' && contact.distanceRatio <= 1.18);
  let primary = pickContact ?? [...contacts]
    .filter((contact) => contact.visualIndex > 0)
    .sort((a, b) => a.distanceRatio - b.distanceRatio)[0];
  const audio = liveAudioCandidates();
  let audioConfirmed = false;

  if (audio?.candidates.length === 1) {
    const closeContacts = contacts.filter((contact) => contact.visualIndex > 0 && contact.distanceRatio <= 0.58);
    const audioTarget = pickContact?.distanceRatio && pickContact.distanceRatio <= 0.58
      ? pickContact
      : closeContacts.length === 1
        ? closeContacts[0]
        : null;
    if (audioTarget && (audioTarget.stringNumber === 0 || audioTarget.stringNumber === audio.candidates[0])) {
      contacts = contacts.map((contact) => contact.id === audioTarget.id
        ? { ...contact, stringNumber: audio.candidates[0], source: 'vision-audio' as const, confidence: clamp(contact.confidence + 0.08, 0, 1) }
        : contact);
      primary = contacts.find((contact) => contact.id === audioTarget.id) ?? primary;
      audioConfirmed = true;
    }
  }

  return {
    ...tracking,
    nearestVisualIndex: primary?.visualIndex ?? 0,
    nearestStringNumber: primary?.stringNumber ?? 0,
    nearestDistanceRatio: primary?.distanceRatio ?? 1,
    primaryContactId: primary?.id,
    contacts,
    audioConfirmed,
    audioCandidateStrings: audio?.candidates ?? [],
    audioFrequencyHz: audio?.frequencyHz,
    audioConfidence: audio?.confidence,
  };
}

async function analyzeHandRawAsync(uri: string, pickColor: PickColor) {
  if (!NativeModule) throw new Error('손가락 상세 분석 모듈을 사용할 수 없습니다.');
  return NativeModule.analyzeHandAsync(uri, pickColor);
}

async function analyzeStringsForHandAsync(uri: string, hand: HandAnalysisResult) {
  if (!StringVisionModule?.androidStringVisionAvailable || !hand.hasHand) return null;
  const region = buildStringRegion(hand);
  if (StringVisionModule.androidAdaptiveStringRegionAvailable && StringVisionModule.analyzeStringsInRegionAsync) {
    return StringVisionModule.analyzeStringsInRegionAsync(
      uri,
      region.left,
      region.top,
      region.right,
      region.bottom,
      region.focusX,
      region.focusY,
    );
  }
  return StringVisionModule.analyzeStringsAsync(uri);
}

function finish(result: HandAnalysisResult, pickColor: PickColor) {
  if (shouldPublishForCoach(result, pickColor)) {
    publishLiveAnalysisFrame({ kind: 'hand', capturedAt: Date.now(), result });
  }
  return result;
}

export async function analyzeHandWithStringsAsync(uri: string, pickColor: PickColor) {
  const hand = await analyzeHandRawAsync(uri, pickColor);
  if (pickColor === 'none') return finish(hand, pickColor);

  let tracking: GuitarStringTrackingResult | null = null;
  try {
    const rawTracking = await analyzeStringsForHandAsync(uri, hand);
    tracking = rawTracking ? stabilizeTracking(rawTracking) : null;
  } catch {
    tracking = null;
  }
  const result = tracking ? { ...hand, stringTracking: fuseContacts(tracking, hand) } : hand;
  return finish(result, pickColor);
}

export async function analyzeHandAsync(uri: string, pickColor: PickColor) {
  return analyzeHandWithStringsAsync(uri, pickColor);
}
