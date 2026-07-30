import {
  analyzeRightHandTechniqueWindow,
  type RightHandFingerId,
  type RightHandTechniqueSample,
} from '../services/right-hand-technique-engine';

let checks = 0;

function assert(condition: unknown, message: string) {
  checks += 1;
  if (!condition) throw new Error(message);
}

const fingerIds: RightHandFingerId[] = ['thumb', 'index', 'middle', 'ring', 'pinky'];

function makeSample(options: {
  capturedAt: number;
  category?: RightHandTechniqueSample['category'];
  handConfidence?: number;
  palmSize?: number;
  pickX?: number;
  pickY?: number;
  wristX?: number;
  wristY?: number;
  palmAngle?: number;
  indexAngle?: number;
  thumbReach?: number;
  stringConfidence?: number;
  stringStability?: number;
  visibleStringCount?: number;
  pattern?: string;
  hits?: RightHandTechniqueSample['hits'];
}): RightHandTechniqueSample {
  const palmSize = options.palmSize ?? 0.28;
  const wrist = { x: options.wristX ?? 0.50, y: options.wristY ?? 0.52 };
  const fingers = Object.fromEntries(fingerIds.map((finger, index) => [finger, {
    tip: { x: 0.43 + index * 0.025, y: 0.40 + index * 0.012 },
    base: { x: 0.44 + index * 0.02, y: 0.53 },
    pip: { x: 0.44 + index * 0.022, y: 0.47 },
    jointAngle: finger === 'index' ? (options.indexAngle ?? 145) : 145,
    reach: finger === 'thumb' ? (options.thumbReach ?? 0.82) : 0.78,
  }])) as RightHandTechniqueSample['fingers'];

  return {
    capturedAt: options.capturedAt,
    category: options.category ?? 'strumming',
    pattern: options.pattern,
    handConfidence: options.handConfidence ?? 0.92,
    palmSize,
    wrist,
    palmAngle: options.palmAngle ?? 12,
    pick: {
      detected: true,
      confidence: 0.90,
      angleDegrees: 18,
      exposure: 0.34,
      center: { x: options.pickX ?? wrist.x, y: options.pickY ?? wrist.y },
    },
    stringAngle: 0,
    stringConfidence: options.stringConfidence ?? 0.90,
    stringStability: options.stringStability ?? 0.88,
    visibleStringCount: options.visibleStringCount ?? 6,
    fingers,
    contacts: [{ id: 'thumb', visualIndex: 1, stringNumber: 6, distanceRatio: 0.24, confidence: 0.88 }],
    hits: options.hits ?? [],
  };
}

{
  const feedback = analyzeRightHandTechniqueWindow([
    makeSample({ capturedAt: 1_000, handConfidence: 0.30 }),
  ]);
  assert(feedback[0]?.id === 'right-hand-unreliable', '낮은 손 추적 신뢰도는 판정 불가여야 합니다.');
  assert(feedback[0]?.status === 'cannot-judge', '근거가 부족한 손 프레임에 교정 점수를 만들면 안 됩니다.');
}

{
  const feedback = analyzeRightHandTechniqueWindow([
    makeSample({ capturedAt: 1_000, palmSize: 0.10 }),
  ]);
  assert(feedback[0]?.id === 'right-hand-too-small', '자동 줌 후에도 작은 손은 명확히 안내해야 합니다.');
}

{
  const samples = Array.from({ length: 14 }, (_, index) => makeSample({
    capturedAt: 1_000 + index * 80,
    pickX: 0.50,
    pickY: 0.36 + (index % 2 === 0 ? 0.00 : 0.07),
    wristX: 0.50,
    wristY: 0.50,
    palmAngle: 4 + (index % 6) * 4,
  }));
  const feedback = analyzeRightHandTechniqueWindow(samples);
  assert(feedback.some((item) => item.id === 'strum-path-good'), '줄 수직축을 따르는 스트럼에는 잘한 점을 표시해야 합니다.');
  assert(feedback.some((item) => item.status === 'success'), '오른손 분석은 문제뿐 아니라 성공 피드백도 반환해야 합니다.');
}

{
  const samples = Array.from({ length: 14 }, (_, index) => makeSample({
    capturedAt: 2_000 + index * 80,
    pickX: 0.38 + (index % 2 === 0 ? 0.00 : 0.07),
    pickY: 0.36 + (index % 2 === 0 ? 0.00 : 0.07),
    palmAngle: 12,
  }));
  const feedback = analyzeRightHandTechniqueWindow(samples);
  assert(feedback.some((item) => item.id === 'strum-path-diagonal'), '비스듬한 스트럼에는 방향 교정이 나와야 합니다.');
  assert(feedback.some((item) => item.instruction.includes('다운') && item.instruction.includes('업')), '스트럼 방향을 구체적인 다운·업 지시로 설명해야 합니다.');
}

{
  const samples = Array.from({ length: 12 }, (_, index) => makeSample({
    capturedAt: 4_000 + index * 90,
    category: 'arpeggio',
    pattern: 'P-i-m-a',
    indexAngle: 171,
    thumbReach: 0.48,
    hits: index % 3 === 0 ? [{
      capturedAt: 4_000 + index * 90,
      contactId: 'index',
      visualIndex: 3,
      stringNumber: 3,
      direction: 'up',
      confidence: 0.88,
    }] : [],
  }));
  const feedback = analyzeRightHandTechniqueWindow(samples);
  assert(feedback.some((item) => item.id === 'arpeggio-index-too-straight'), '검지가 과도하게 펴진 아르페지오는 구체적으로 교정해야 합니다.');
  assert(feedback.some((item) => item.id === 'arpeggio-thumb-hidden'), '엄지가 안쪽으로 말린 아르페지오는 엄지 위치를 교정해야 합니다.');
}

console.log(`right-hand technique quality gate: ${checks} checks passed`);
