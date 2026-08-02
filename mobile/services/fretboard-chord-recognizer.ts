import {
  ChordRecognitionTracker,
  OPEN_CHORD_TEMPLATES,
  projectFingerToFretboard,
  recognizeChord as recognizeChordBase,
  validateFretboardCalibration,
  type ChordAudioEvidence,
  type ChordRecognitionResult,
  type ChordStringState,
  type ChordTemplate,
  type FretboardCalibration,
  type FretboardPoint,
  type FrettedPosition,
  type FrettingFingerId,
  type FrettingFingerObservation,
  type GuitarStringNumber,
} from './fretboard-chord-engine';

export {
  ChordRecognitionTracker,
  OPEN_CHORD_TEMPLATES,
  projectFingerToFretboard,
  validateFretboardCalibration,
};

export type {
  ChordAudioEvidence,
  ChordRecognitionResult,
  ChordStringState,
  ChordTemplate,
  FretboardCalibration,
  FretboardPoint,
  FrettedPosition,
  FrettingFingerId,
  FrettingFingerObservation,
  GuitarStringNumber,
};

function positionKey(stringNumber: number, fret: number) {
  return `${stringNumber}:${fret}`;
}

function expectedFrettedPositions(strings: ChordTemplate['strings']) {
  return strings.flatMap((fret, index) => fret > 0
    ? [{ stringNumber: 6 - index, fret }]
    : []);
}

function correctionForMissing(key: string) {
  const [stringNumber, fret] = key.split(':');
  return `${stringNumber}번 줄 ${fret}프렛을 정확히 누르세요.`;
}

function correctionForExtra(key: string) {
  const [stringNumber, fret] = key.split(':');
  return `${stringNumber}번 줄 ${fret}프렛의 불필요한 손가락을 떼세요.`;
}

/**
 * Base recognition plus a strict final-position gate.
 * Audio evidence may identify the chord family, but it cannot excuse a missing
 * or extra fretted position. In that case the nearest candidate remains only
 * in the evidence text and no exact chord label or score is published.
 */
export function recognizeChord(
  observations: FrettingFingerObservation[],
  calibration: FretboardCalibration | null,
  audio?: ChordAudioEvidence | null,
  templates: ChordTemplate[] = OPEN_CHORD_TEMPLATES,
): ChordRecognitionResult {
  const result = recognizeChordBase(observations, calibration, audio, templates);
  if (!result.chordName || !result.expectedStrings) return result;

  const expected = expectedFrettedPositions(result.expectedStrings);
  const expectedKeys = new Set(expected.map((position) => positionKey(position.stringNumber, position.fret)));
  const observedKeys = new Set(result.positions.map((position) => positionKey(position.stringNumber, position.fret)));
  const missing = [...expectedKeys].filter((key) => !observedKeys.has(key));
  const extras = [...observedKeys].filter((key) => !expectedKeys.has(key));

  if (!missing.length && !extras.length) return result;

  const strictCorrections = [
    ...missing.map(correctionForMissing),
    ...extras.map(correctionForExtra),
    ...result.corrections,
  ];
  const matched = Math.max(0, expectedKeys.size - missing.length);

  return {
    ...result,
    status: 'candidate',
    chordName: null,
    aliases: [],
    score: null,
    confidencePercent: Math.min(89, result.confidencePercent),
    evidence: [
      `가장 가까운 코드 후보 ${result.chordName} · 필수 프렛이 완성되지 않아 코드명 확정 보류`,
      ...result.evidence,
      `필수 프렛 ${matched}/${expectedKeys.size}개 확인 · 누락 ${missing.length}개 · 추가 ${extras.length}개`,
      '소리가 비슷해도 손가락 위치가 완성되기 전에는 정확한 코드명으로 표시하지 않음',
    ],
    corrections: [...new Set(strictCorrections)].slice(0, 6),
    positives: matched > 0
      ? [`${matched}개 필수 프렛 위치는 가장 가까운 후보와 맞습니다.`]
      : [],
  };
}
