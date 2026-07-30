import {
  ChordRecognitionTracker,
  recognizeChord,
  type FretboardCalibration,
  type FrettingFingerId,
  type FrettingFingerObservation,
  type GuitarStringNumber,
} from '../services/fretboard-chord-recognizer';

let checks = 0;

function assert(condition: unknown, message: string) {
  checks += 1;
  if (!condition) throw new Error(message);
}

const calibration: FretboardCalibration = {
  id: 'test-fretboard',
  guitarMode: 'acoustic',
  cameraFacing: 'back',
  mirrored: false,
  createdAt: new Date(0).toISOString(),
  nutSixth: { x: 0.20, y: 0.20 },
  nutFirst: { x: 0.20, y: 0.80 },
  referenceSixth: { x: 0.80, y: 0.30 },
  referenceFirst: { x: 0.80, y: 0.70 },
  referenceFret: 5,
  maxVisibleFret: 12,
  confidencePercent: 96,
};

const fretDistance = (fret: number) => 1 - 2 ** (-Math.max(0, fret) / 12);

function pointFor(stringNumber: GuitarStringNumber, fret: number) {
  const referenceDistance = fretDistance(calibration.referenceFret);
  const amount = fretDistance(fret - 0.48) / referenceDistance;
  const x = calibration.nutSixth.x + (calibration.referenceSixth.x - calibration.nutSixth.x) * amount;
  const sixthY = calibration.nutSixth.y + (calibration.referenceSixth.y - calibration.nutSixth.y) * amount;
  const firstY = calibration.nutFirst.y + (calibration.referenceFirst.y - calibration.nutFirst.y) * amount;
  const stringAmount = (6 - stringNumber) / 5;
  return { x, y: sixthY + (firstY - sixthY) * stringAmount };
}

function observation(
  finger: FrettingFingerId,
  stringNumber: GuitarStringNumber,
  fret: number,
): FrettingFingerObservation {
  return {
    finger,
    tip: pointFor(stringNumber, fret),
    confidence: 0.96,
  };
}

const cObservations: FrettingFingerObservation[] = [
  observation('ring', 5, 3),
  observation('middle', 4, 2),
  observation('index', 2, 1),
];

const cAudio = {
  pitchClasses: [0, 4, 7],
  confidence: 0.92,
  signalToNoiseDb: 24,
  clippingRatio: 0.001,
};

{
  const result = recognizeChord(cObservations, null, null);
  assert(result.status === 'cannot-judge', '지판 보정 없이 코드 이름이나 점수를 만들면 안 됩니다.');
  assert(result.score == null, '지판 보정 없는 결과는 점수가 없어야 합니다.');
}

{
  const result = recognizeChord(cObservations, calibration, null);
  assert(result.chordName === 'C', 'C 운지의 영상 후보는 C로 인식해야 합니다.');
  assert(result.status === 'candidate', '소리 검증 전에는 코드 후보로만 표시해야 합니다.');
  assert(result.score == null, '오픈현·뮤트현 소리 검증 전에는 점수를 확정하면 안 됩니다.');
}

{
  const result = recognizeChord(cObservations, calibration, cAudio);
  assert(result.chordName === 'C', 'C 운지와 C 음군이 일치하면 C 코드여야 합니다.');
  assert(result.status === 'confirmed', '영상과 소리가 일치하면 확인 상태여야 합니다.');
  assert(result.score != null && result.score >= 75, '확인된 C 코드는 근거 기반 점수가 있어야 합니다.');
  assert(result.positives.length > 0, '확인된 코드에는 잘한 점도 알려야 합니다.');
}

{
  const incomplete = [
    observation('middle', 4, 2),
    observation('index', 2, 1),
  ];
  const result = recognizeChord(incomplete, calibration, cAudio);
  assert(result.chordName === 'C', 'C 음군과 두 개의 C 프렛이 일치하면 가장 가까운 후보를 C로 표시해야 합니다.');
  assert(result.status === 'candidate', '필수 프렛이 누락되면 소리가 맞아도 코드를 확정하면 안 됩니다.');
  assert(result.score == null, '필수 프렛이 누락된 코드는 점수가 없어야 합니다.');
  assert(result.corrections.some((item) => item.includes('5번 줄 3프렛')), '누락된 C 코드 위치를 구체적으로 알려야 합니다.');
}

{
  const tracker = new ChordRecognitionTracker();
  const candidate = recognizeChord(cObservations, calibration, null);
  const first = tracker.process(candidate, 1_000);
  const second = tracker.process(candidate, 1_180);
  const third = tracker.process(candidate, 1_360);
  assert(first.status === 'candidate' && second.status === 'candidate', '한두 프레임만으로 확정하면 안 됩니다.');
  assert(third.status === 'candidate', '소리 근거가 없으면 여러 프레임이어도 점수를 확정하면 안 됩니다.');
}

console.log(`fretboard-chord quality gate: ${checks} checks passed`);
