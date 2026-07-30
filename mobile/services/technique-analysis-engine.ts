import type { PracticeCategoryId } from '../config/guitar-mode-profiles';

export type TechniqueMeasurement = { label: string; value: string };

export type TechniqueHitSample = {
  capturedAt: number;
  contactId: string;
  label: string;
  visualIndex: number;
  stringNumber: number;
  direction: string;
  confidence: number;
};

export type TechniqueFrameSample = {
  capturedAt: number;
  category: PracticeCategoryId;
  handConfidence: number;
  palmSize: number;
  wristAngle: number;
  wristX: number;
  wristY: number;
  pickDetected: boolean;
  pickConfidence: number;
  pickExposure: number;
  fingerExtension: {
    thumb: number;
    index: number;
    middle: number;
    ring: number;
    pinky: number;
  };
  stringConfidence: number;
  stringStability: number;
  visibleStringCount: number;
  hits: TechniqueHitSample[];
};

export type TechniqueIssue = {
  id: string;
  status: 'cannot-judge' | 'correction' | 'warning';
  title: string;
  instruction: string;
  evidence: string;
  nextGoal: string;
  confidencePercent: number;
  priority: number;
  measurements: TechniqueMeasurement[];
};

const RIGHT_HAND_PICK_CATEGORIES = new Set<PracticeCategoryId>([
  'strumming',
  'downPicking',
  'alternatePicking',
  'palmMute',
]);
const RIGHT_HAND_FINGER_CATEGORIES = new Set<PracticeCategoryId>([
  'arpeggio',
  'fingerstyle',
]);
const LEFT_HAND_CATEGORIES = new Set<PracticeCategoryId>([
  'chords',
  'fingering',
  'powerChords',
  'scales',
  'leadTechnique',
]);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function range(values: number[]) {
  if (!values.length) return 0;
  return Math.max(...values) - Math.min(...values);
}

function deltas(values: number[]) {
  return values.slice(1).map((value, index) => value - values[index]);
}

function correlation(left: number[], right: number[]) {
  if (left.length !== right.length || left.length < 5) return 0;
  const leftMean = mean(left);
  const rightMean = mean(right);
  let numerator = 0;
  let leftPower = 0;
  let rightPower = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDiff = left[index] - leftMean;
    const rightDiff = right[index] - rightMean;
    numerator += leftDiff * rightDiff;
    leftPower += leftDiff ** 2;
    rightPower += rightDiff ** 2;
  }
  const denominator = Math.sqrt(leftPower * rightPower);
  return denominator > 0.000001 ? numerator / denominator : 0;
}

function confidencePercent(samples: TechniqueFrameSample[]) {
  return Math.round(clamp(mean(samples.map((sample) => sample.handConfidence)), 0, 1) * 100);
}

function recentWindow(samples: TechniqueFrameSample[]) {
  const latest = samples.at(-1);
  if (!latest) return [];
  return samples
    .filter((sample) => sample.category === latest.category && latest.capturedAt - sample.capturedAt <= 2_800)
    .slice(-32);
}

function sortIssues(issues: TechniqueIssue[]) {
  return [...issues]
    .sort((left, right) => right.priority - left.priority || right.confidencePercent - left.confidencePercent)
    .slice(0, 6);
}

export function analyzeTechniqueWindow(samples: TechniqueFrameSample[]): TechniqueIssue[] {
  const recent = recentWindow(samples);
  const latest = recent.at(-1);
  if (!latest) return [];

  const confidence = confidencePercent(recent);
  if (latest.handConfidence < 0.42 || latest.palmSize <= 0) {
    return [{
      id: 'technique-hand-unreliable',
      status: 'cannot-judge',
      title: '손 동작 정밀 판정 불가',
      instruction: '손목과 다섯 손가락 끝이 모두 보이도록 밝기와 카메라 거리를 조정하세요.',
      evidence: `현재 손 검출 신뢰도가 ${Math.round(latest.handConfidence * 100)}%입니다.`,
      nextGoal: '손 전체가 1초 이상 안정적으로 잡힌 뒤 같은 동작을 반복하세요.',
      confidencePercent: Math.round(latest.handConfidence * 100),
      priority: 7,
      measurements: [{ label: '손 검출', value: `${Math.round(latest.handConfidence * 100)}%` }],
    }];
  }

  if (latest.palmSize < 0.13 || latest.palmSize > 0.68) {
    const tooSmall = latest.palmSize < 0.13;
    return [{
      id: tooSmall ? 'technique-hand-too-small' : 'technique-hand-too-large',
      status: 'cannot-judge',
      title: tooSmall ? '손이 정밀 분석하기에 너무 작습니다' : '손가락 끝이 잘릴 정도로 너무 가깝습니다',
      instruction: tooSmall
        ? '손목과 손가락 끝이 모두 들어오는 범위에서 휴대폰을 더 가까이 두세요.'
        : '손목과 다섯 손가락 끝이 모두 들어오도록 휴대폰을 조금 멀리 두세요.',
      evidence: `화면 대비 손바닥 길이가 ${latest.palmSize.toFixed(2)}입니다.`,
      nextGoal: '손바닥 길이를 화면의 약 18~55%로 유지하세요.',
      confidencePercent: confidence,
      priority: 7,
      measurements: [{ label: '손 크기', value: latest.palmSize.toFixed(2) }],
    }];
  }

  if (recent.length < 7) return [];

  const issues: TechniqueIssue[] = [];
  const averagePalm = Math.max(0.001, mean(recent.map((sample) => sample.palmSize)));
  const angleVariation = standardDeviation(recent.map((sample) => sample.wristAngle));
  const wristTravel = Math.hypot(
    range(recent.map((sample) => sample.wristX)),
    range(recent.map((sample) => sample.wristY)),
  ) / averagePalm;
  const wristThreshold = latest.category === 'strumming' ? 32 : 23;

  if (angleVariation > wristThreshold) {
    issues.push({
      id: 'wrist-angle-moving',
      status: 'correction',
      title: '손목 방향이 반복마다 달라집니다',
      instruction: latest.category === 'strumming'
        ? '팔 전체를 흔들기보다 전완 회전과 작은 손목 움직임을 같은 궤도로 반복하세요.'
        : '손목 중심을 유지하고 필요한 손가락이나 피크만 짧게 움직이세요.',
      evidence: `최근 손목 방향 표준편차가 ${Math.round(angleVariation)}°로 기준 ${wristThreshold}°를 넘었습니다.`,
      nextGoal: '같은 손목 각도를 유지한 채 3회 연속 반복하세요.',
      confidencePercent: confidence,
      priority: 10,
      measurements: [
        { label: '손목 흔들림', value: `${Math.round(angleVariation)}°` },
        { label: '손 전체 이동', value: wristTravel.toFixed(2) },
      ],
    });
  }

  const travelThreshold = latest.category === 'strumming' ? 1.15 : 0.78;
  if (wristTravel > travelThreshold) {
    issues.push({
      id: 'whole-hand-travel',
      status: 'correction',
      title: '필요한 범위보다 손 전체 이동이 큽니다',
      instruction: latest.category === 'strumming'
        ? '스트럼 폭은 유지하되 손목 중심이 좌우로 밀리지 않게 같은 축에서 움직이세요.'
        : '손목과 팔꿈치 위치를 유지하고 필요한 손가락이나 피크만 움직이세요.',
      evidence: `최근 손목 이동 범위가 손바닥 길이의 ${wristTravel.toFixed(2)}배입니다.`,
      nextGoal: '손목 중심을 같은 위치에 두고 3회 반복하세요.',
      confidencePercent: confidence,
      priority: 8,
      measurements: [{ label: '손 전체 이동', value: wristTravel.toFixed(2) }],
    });
  }

  if (RIGHT_HAND_PICK_CATEGORIES.has(latest.category)) {
    const pickSamples = recent.filter((sample) => sample.pickDetected && sample.pickConfidence >= 0.48);
    if (pickSamples.length < Math.max(4, Math.floor(recent.length * 0.45))) {
      issues.push({
        id: 'pick-tracking-unstable',
        status: 'cannot-judge',
        title: '피크 추적이 연속으로 유지되지 않습니다',
        instruction: '피크와 줄 사이에 그림자가 겹치지 않게 조명을 옆에서 비추고 피크 색상을 배경과 구분되게 하세요.',
        evidence: `최근 ${recent.length}개 표본 중 신뢰 가능한 피크 표본이 ${pickSamples.length}개입니다.`,
        nextGoal: '피크 끝이 1초 이상 끊기지 않고 표시되게 촬영 위치를 맞추세요.',
        confidencePercent: Math.round(mean(recent.map((sample) => sample.pickConfidence)) * 100),
        priority: 9,
        measurements: [{ label: '피크 유지', value: `${pickSamples.length}/${recent.length}` }],
      });
    } else {
      const exposureAverage = mean(pickSamples.map((sample) => sample.pickExposure));
      const exposureVariation = standardDeviation(pickSamples.map((sample) => sample.pickExposure));
      if (exposureAverage > 0.88) {
        issues.push({
          id: 'pick-too-exposed',
          status: 'correction',
          title: '피크 노출량이 커서 줄에 걸릴 가능성이 높습니다',
          instruction: '피크 끝을 엄지 안쪽으로 조금 넣어 필요한 길이만 남기세요.',
          evidence: `최근 평균 피크 노출량이 ${exposureAverage.toFixed(2)}입니다.`,
          nextGoal: '노출량을 일정하게 유지하며 다운·업을 3회 반복하세요.',
          confidencePercent: Math.round(mean(pickSamples.map((sample) => sample.pickConfidence)) * 100),
          priority: 10,
          measurements: [
            { label: '평균 노출', value: exposureAverage.toFixed(2) },
            { label: '노출 흔들림', value: exposureVariation.toFixed(2) },
          ],
        });
      } else if (exposureAverage < 0.09) {
        issues.push({
          id: 'pick-hidden',
          status: 'correction',
          title: '피크 끝이 너무 숨겨져 있습니다',
          instruction: '피크를 세게 누르지 말고 끝이 조금 보이도록 아주 조금만 빼세요.',
          evidence: `최근 평균 피크 노출량이 ${exposureAverage.toFixed(2)}입니다.`,
          nextGoal: '같은 노출량으로 다운·업을 3회 반복하세요.',
          confidencePercent: Math.round(mean(pickSamples.map((sample) => sample.pickConfidence)) * 100),
          priority: 9,
          measurements: [{ label: '평균 노출', value: exposureAverage.toFixed(2) }],
        });
      }
      if (exposureVariation > 0.20) {
        issues.push({
          id: 'pick-exposure-unstable',
          status: 'correction',
          title: '피크 그립 깊이가 연주 중 계속 변합니다',
          instruction: '엄지와 검지 압력을 줄이고 피크가 손가락 사이에서 미끄러지지 않게 같은 지점을 잡으세요.',
          evidence: `피크 노출량 표준편차가 ${exposureVariation.toFixed(2)}입니다.`,
          nextGoal: '피크 노출량을 바꾸지 않고 8회 연속 피킹하세요.',
          confidencePercent: Math.round(mean(pickSamples.map((sample) => sample.pickConfidence)) * 100),
          priority: 8,
          measurements: [{ label: '노출 흔들림', value: exposureVariation.toFixed(2) }],
        });
      }
    }

    const stringReady = latest.stringConfidence >= 0.46
      && latest.stringStability >= 0.42
      && latest.visibleStringCount >= 5;
    if (!stringReady) {
      issues.push({
        id: 'string-plane-unstable',
        status: 'cannot-judge',
        title: '기타줄 기준면이 안정적으로 잡히지 않습니다',
        instruction: '브리지 근처 여섯 줄이 화면을 가로지르게 하고 반사광이 줄과 같은 방향으로 생기지 않게 조명을 바꾸세요.',
        evidence: `줄 신뢰 ${Math.round(latest.stringConfidence * 100)}%, 안정도 ${Math.round(latest.stringStability * 100)}%, 보이는 줄 ${latest.visibleStringCount}개입니다.`,
        nextGoal: '여섯 줄이 1초 이상 흔들리지 않고 표시되게 맞추세요.',
        confidencePercent: Math.round(Math.min(latest.stringConfidence, latest.stringStability) * 100),
        priority: 9,
        measurements: [
          { label: '줄 신뢰', value: `${Math.round(latest.stringConfidence * 100)}%` },
          { label: '줄 안정', value: `${Math.round(latest.stringStability * 100)}%` },
          { label: '보이는 줄', value: `${latest.visibleStringCount}/6` },
        ],
      });
    }

    const hits = recent.flatMap((sample) => sample.hits);
    const pickHits = hits.filter((hit) => hit.contactId === 'pick' && hit.confidence >= 0.48);
    const usableHits = pickHits.length >= 4 ? pickHits : hits.filter((hit) => hit.confidence >= 0.55);
    const directions = usableHits.map((hit) => hit.direction).filter((value) => value === 'down' || value === 'up');

    if (latest.category === 'alternatePicking' && directions.length >= 6) {
      let repeated = 0;
      for (let index = 1; index < directions.length; index += 1) {
        if (directions[index] === directions[index - 1]) repeated += 1;
      }
      const repeatedRatio = repeated / Math.max(1, directions.length - 1);
      if (repeatedRatio > 0.34) {
        issues.push({
          id: 'alternate-direction-break',
          status: 'correction',
          title: '얼터네이트 피킹 방향이 중간에 반복됩니다',
          instruction: '다운 다음에는 반드시 업이 나오도록 피크 이동 폭을 줄이고 한 줄에서 천천히 교대하세요.',
          evidence: `최근 방향 전환 중 같은 방향 반복 비율이 ${Math.round(repeatedRatio * 100)}%입니다.`,
          nextGoal: 'D-U를 8회 끊기지 않고 반복하세요.',
          confidencePercent: Math.round(mean(usableHits.map((hit) => hit.confidence)) * 100),
          priority: 10,
          measurements: [
            { label: '방향 표본', value: `${directions.length}` },
            { label: '반복 비율', value: `${Math.round(repeatedRatio * 100)}%` },
          ],
        });
      }
    }

    if (latest.category === 'strumming' && usableHits.length >= 7) {
      const visualIndices = usableHits.map((hit) => hit.visualIndex).filter((value) => value >= 1 && value <= 6);
      const stringSpan = visualIndices.length ? range(visualIndices) : 0;
      const downCount = directions.filter((direction) => direction === 'down').length;
      const upCount = directions.filter((direction) => direction === 'up').length;
      const directionBalance = directions.length ? Math.min(downCount, upCount) / directions.length : 0.5;
      if (visualIndices.length >= 5 && stringSpan < 2) {
        issues.push({
          id: 'strum-width-narrow',
          status: 'correction',
          title: '스트럼이 한두 줄 근처에만 머뭅니다',
          instruction: '다운은 저음줄부터 필요한 범위까지, 업은 고음줄 중심으로 자연스럽게 통과시키세요.',
          evidence: `최근 탄현 후보의 줄 범위가 ${stringSpan.toFixed(0)}칸입니다.`,
          nextGoal: '다운과 업의 목표 줄 범위를 나눠 4회 반복하세요.',
          confidencePercent: Math.round(mean(usableHits.map((hit) => hit.confidence)) * 100),
          priority: 8,
          measurements: [{ label: '줄 이동 폭', value: `${stringSpan.toFixed(0)}칸` }],
        });
      }
      if (directions.length >= 6 && directionBalance < 0.18) {
        issues.push({
          id: 'strum-direction-imbalance',
          status: 'correction',
          title: '다운과 업 스트럼 비율이 한쪽으로 치우칩니다',
          instruction: '다운 뒤 손을 멈추지 말고 같은 경로로 돌아오며 업스트로크를 연결하세요.',
          evidence: `최근 다운 ${downCount}회, 업 ${upCount}회로 측정됐습니다.`,
          nextGoal: 'D-U를 같은 크기로 4세트 반복하세요.',
          confidencePercent: Math.round(mean(usableHits.map((hit) => hit.confidence)) * 100),
          priority: 8,
          measurements: [
            { label: '다운', value: `${downCount}` },
            { label: '업', value: `${upCount}` },
          ],
        });
      }
    }
  }

  if (RIGHT_HAND_FINGER_CATEGORIES.has(latest.category)) {
    const indexValues = recent.map((sample) => sample.fingerExtension.index);
    const middleValues = recent.map((sample) => sample.fingerExtension.middle);
    const ringValues = recent.map((sample) => sample.fingerExtension.ring);
    const indexMiddleCorrelation = correlation(deltas(indexValues), deltas(middleValues));
    const ringMiddleCorrelation = correlation(deltas(ringValues), deltas(middleValues));

    if (indexMiddleCorrelation > 0.84 && range(indexValues) > 0.11 && range(middleValues) > 0.11) {
      issues.push({
        id: 'index-middle-follow',
        status: 'correction',
        title: '검지와 중지가 같이 움직입니다',
        instruction: 'i가 움직일 때 m은 준비 위치에 남기고, m이 움직일 때 i는 바로 중립 위치로 복귀시키세요.',
        evidence: `최근 i와 m 움직임 상관값이 ${indexMiddleCorrelation.toFixed(2)}입니다.`,
        nextGoal: 'P-i-m을 느리게 3회 연주하며 한 손가락씩 분리하세요.',
        confidencePercent: confidence,
        priority: 10,
        measurements: [{ label: 'i-m 동반', value: indexMiddleCorrelation.toFixed(2) }],
      });
    }

    if (ringMiddleCorrelation > 0.82 && range(ringValues) > 0.11 && range(middleValues) > 0.11) {
      issues.push({
        id: 'ring-middle-follow',
        status: 'correction',
        title: '약지와 중지가 같이 따라 움직입니다',
        instruction: 'a를 움직일 때 m은 준비 위치에 남겨 두고 약지만 손바닥 쪽으로 짧게 움직이세요.',
        evidence: `최근 a와 m 움직임 상관값이 ${ringMiddleCorrelation.toFixed(2)}입니다.`,
        nextGoal: 'a만 움직이는 느낌으로 p-a-m-i를 3회 반복하세요.',
        confidencePercent: confidence,
        priority: 10,
        measurements: [{ label: 'a-m 동반', value: ringMiddleCorrelation.toFixed(2) }],
      });
    }
  }

  if (LEFT_HAND_CATEGORIES.has(latest.category)) {
    const fingerRanges = [
      { name: '검지', id: 'index', value: range(recent.map((sample) => sample.fingerExtension.index)) },
      { name: '중지', id: 'middle', value: range(recent.map((sample) => sample.fingerExtension.middle)) },
      { name: '약지', id: 'ring', value: range(recent.map((sample) => sample.fingerExtension.ring)) },
      { name: '새끼', id: 'pinky', value: range(recent.map((sample) => sample.fingerExtension.pinky)) },
    ].sort((left, right) => right.value - left.value);
    const largest = fingerRanges[0];
    const second = fingerRanges[1];
    if ((latest.category === 'chords' || latest.category === 'powerChords')
      && largest.value > 0.34
      && largest.value > Math.max(0.13, second.value * 1.75)) {
      issues.push({
        id: `late-finger-${largest.id}`,
        status: 'correction',
        title: `${largest.name} 움직임만 늦게 남습니다`,
        instruction: '코드 모양을 공중에서 먼저 만든 뒤 네 손가락을 가능한 한 함께 내려놓으세요.',
        evidence: `${largest.name} 변화량 ${largest.value.toFixed(2)}가 다음 손가락 ${second.value.toFixed(2)}보다 큽니다.`,
        nextGoal: '무박자로 코드 모양을 만든 뒤 동시 착지를 3회 반복하세요.',
        confidencePercent: confidence,
        priority: 9,
        measurements: [
          { label: '최대 이동', value: `${largest.name} ${largest.value.toFixed(2)}` },
          { label: '다음 이동', value: second.value.toFixed(2) },
        ],
      });
    }
  }

  return sortIssues(issues);
}
