import type { PracticeCategoryId } from '../config/guitar-mode-profiles';
import {
  analyzeTechniqueWindow,
  type TechniqueFrameSample,
  type TechniqueHitSample,
} from '../services/technique-analysis-engine';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`기술 분석 품질 게이트 실패: ${message}`);
}

function makeSample(
  index: number,
  category: PracticeCategoryId,
  overrides: Partial<TechniqueFrameSample> = {},
): TechniqueFrameSample {
  return {
    capturedAt: 1_000 + index * 80,
    category,
    handConfidence: 0.91,
    palmSize: 0.31,
    wristAngle: 8,
    wristX: 0.5,
    wristY: 0.5,
    pickDetected: true,
    pickConfidence: 0.88,
    pickExposure: 0.32,
    fingerExtension: {
      thumb: 0.85,
      index: 0.72,
      middle: 0.70,
      ring: 0.68,
      pinky: 0.60,
    },
    stringConfidence: 0.86,
    stringStability: 0.81,
    visibleStringCount: 6,
    hits: [],
    ...overrides,
  };
}

const multiIssueSamples = Array.from({ length: 10 }, (_, index) => makeSample(index, 'strumming', {
  wristAngle: index % 2 === 0 ? -44 : 48,
  wristX: index % 2 === 0 ? 0.39 : 0.65,
  pickExposure: 0.96,
  stringConfidence: 0.31,
  stringStability: 0.28,
  visibleStringCount: 3,
}));
const multiIssues = analyzeTechniqueWindow(multiIssueSamples);
assert(multiIssues.some((issue) => issue.id === 'wrist-angle-moving'), '손목 흔들림을 검출해야 합니다.');
assert(multiIssues.some((issue) => issue.id === 'pick-too-exposed'), '피크 과다 노출을 손목 문제와 동시에 검출해야 합니다.');
assert(multiIssues.some((issue) => issue.id === 'string-plane-unstable'), '줄 기준면 불안정을 다른 문제와 동시에 유지해야 합니다.');

const alternateDirections = ['down', 'down', 'up', 'up', 'down', 'down', 'up', 'up'];
const alternateSamples = Array.from({ length: 10 }, (_, index) => {
  const hit: TechniqueHitSample | undefined = index < alternateDirections.length
    ? {
      capturedAt: 3_000 + index * 70,
      contactId: 'pick',
      label: '피크',
      visualIndex: 3,
      stringNumber: 3,
      direction: alternateDirections[index],
      confidence: 0.9,
    }
    : undefined;
  return makeSample(index, 'alternatePicking', {
    capturedAt: 3_000 + index * 70,
    hits: hit ? [hit] : [],
  });
});
const alternateIssues = analyzeTechniqueWindow(alternateSamples);
assert(alternateIssues.some((issue) => issue.id === 'alternate-direction-break'), '같은 피킹 방향 반복을 검출해야 합니다.');

const fingerSamples = Array.from({ length: 12 }, (_, index) => {
  const movement = index % 2 === 0 ? 0.45 : -0.10;
  return makeSample(index, 'arpeggio', {
    capturedAt: 5_000 + index * 90,
    pickDetected: false,
    pickConfidence: 0,
    fingerExtension: {
      thumb: 0.84,
      index: 0.68 + movement,
      middle: 0.66 + movement,
      ring: 0.62 + movement * 0.95,
      pinky: 0.58,
    },
  });
});
const fingerIssues = analyzeTechniqueWindow(fingerSamples);
assert(fingerIssues.some((issue) => issue.id === 'index-middle-follow'), 'i와 m 동반 움직임을 검출해야 합니다.');
assert(fingerIssues.some((issue) => issue.id === 'ring-middle-follow'), 'a와 m 동반 움직임을 동시에 검출해야 합니다.');

const chordSamples = Array.from({ length: 10 }, (_, index) => makeSample(index, 'chords', {
  capturedAt: 7_000 + index * 100,
  pickDetected: false,
  pickConfidence: 0,
  fingerExtension: {
    thumb: 0.8,
    index: 0.70 + (index % 2) * 0.04,
    middle: 0.68 + (index % 2) * 0.05,
    ring: 0.66 + (index % 2) * 0.05,
    pinky: index % 2 === 0 ? 0.34 : 0.92,
  },
}));
const chordIssues = analyzeTechniqueWindow(chordSamples);
assert(chordIssues.some((issue) => issue.id === 'late-finger-pinky'), '코드에서 새끼손가락만 크게 늦는 현상을 검출해야 합니다.');

const unreliable = [makeSample(0, 'fingering', { handConfidence: 0.2, palmSize: 0 })];
const unreliableIssues = analyzeTechniqueWindow(unreliable);
assert(unreliableIssues.length === 1 && unreliableIssues[0]?.status === 'cannot-judge', '신뢰도가 낮으면 교정값을 꾸며내지 않아야 합니다.');

console.log('technique-analysis quality gate: 9 checks passed');
