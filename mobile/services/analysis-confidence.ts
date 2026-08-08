export type AnalysisSource = 'pose' | 'hand' | 'pick' | 'microphone' | 'timing';

export type QualitySignal = {
  source: AnalysisSource;
  confidence: number;
  brightness?: number;
  sharpness?: number;
  subjectSize?: number;
  fps?: number;
  noiseFloor?: number;
  clippingRatio?: number;
  sampleCount?: number;
};

export type QualityGateReason =
  | 'low-confidence'
  | 'too-dark'
  | 'too-bright'
  | 'too-blurry'
  | 'subject-too-small'
  | 'subject-too-large'
  | 'fps-too-low'
  | 'too-noisy'
  | 'audio-clipping'
  | 'not-enough-samples';

export type QualityGateResult = {
  allowed: boolean;
  scoreWeight: number;
  confidencePercent: number;
  reasons: QualityGateReason[];
  primaryMessage: string;
  actions: string[];
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function thresholdForSource(source: AnalysisSource) {
  switch (source) {
    case 'pick':
      return 0.62;
    case 'microphone':
      return 0.66;
    case 'hand':
      return 0.58;
    case 'pose':
      return 0.52;
    case 'timing':
      return 0.6;
  }
}

export function evaluateAnalysisQuality(signal: QualitySignal): QualityGateResult {
  const reasons: QualityGateReason[] = [];
  const actions: string[] = [];
  const baseConfidence = clamp01(signal.confidence);

  if (baseConfidence < thresholdForSource(signal.source)) {
    reasons.push('low-confidence');
    actions.push('카메라 또는 마이크 위치를 다시 맞춘 뒤 분석을 재시작하세요.');
  }

  if (signal.brightness != null) {
    if (signal.brightness < 0.18) {
      reasons.push('too-dark');
      actions.push('손과 기타 앞쪽에 조명을 추가하세요.');
    } else if (signal.brightness > 0.94) {
      reasons.push('too-bright');
      actions.push('직사광선과 강한 반사를 피하세요.');
    }
  }

  if (signal.sharpness != null && signal.sharpness < 0.32) {
    reasons.push('too-blurry');
    actions.push('휴대폰을 고정하고 렌즈를 닦은 뒤 손을 조금 천천히 움직이세요.');
  }

  if (signal.subjectSize != null) {
    const minSize = signal.source === 'pose' ? 0.15 : 0.2;
    const maxSize = signal.source === 'pose' ? 0.68 : 0.72;
    if (signal.subjectSize < minSize) {
      reasons.push('subject-too-small');
      actions.push(signal.source === 'pose' ? '상체가 화면의 절반 정도가 되도록 가까이 두세요.' : '분석할 손이 화면의 절반 이상 보이도록 가까이 두세요.');
    } else if (signal.subjectSize > maxSize) {
      reasons.push('subject-too-large');
      actions.push('손목과 손가락 끝 또는 상체 관절이 모두 보이도록 조금 멀리 두세요.');
    }
  }

  if (signal.fps != null && signal.fps < 3.5) {
    reasons.push('fps-too-low');
    actions.push('저전력 모드를 끄거나 다른 앱을 닫고 분석 해상도를 낮추세요.');
  }

  if (signal.noiseFloor != null && signal.noiseFloor > 0.36) {
    reasons.push('too-noisy');
    actions.push('TV·선풍기·대화 소음을 줄이고 기타 또는 앰프를 휴대폰 가까이에 두세요.');
  }

  if (signal.clippingRatio != null && signal.clippingRatio > 0.025) {
    reasons.push('audio-clipping');
    actions.push('앰프 또는 기타 음량을 낮춰 마이크 찌그러짐을 줄이세요.');
  }

  if (signal.sampleCount != null && signal.sampleCount < 4) {
    reasons.push('not-enough-samples');
    actions.push('같은 패턴을 최소 4회 이상 반복하세요.');
  }

  const hardFailure = reasons.some((reason) =>
    reason === 'low-confidence' ||
    reason === 'too-dark' ||
    reason === 'too-blurry' ||
    reason === 'subject-too-small' ||
    reason === 'fps-too-low' ||
    reason === 'too-noisy' ||
    reason === 'audio-clipping' ||
    reason === 'not-enough-samples',
  );

  const penalties = reasons.length * 0.12;
  const scoreWeight = hardFailure ? 0 : clamp01(baseConfidence - penalties);

  const primaryMessage = reasons.length === 0
    ? '분석 품질이 안정적입니다.'
    : hardFailure
      ? '현재 영상 또는 소리로는 정확한 판정이 어렵습니다.'
      : '분석은 가능하지만 결과 신뢰도가 낮을 수 있습니다.';

  return {
    allowed: !hardFailure,
    scoreWeight,
    confidencePercent: Math.round(baseConfidence * 100),
    reasons,
    primaryMessage,
    actions: [...new Set(actions)],
  };
}

export type WeightedMetricInput = {
  id: string;
  score: number;
  weight: number;
  quality: QualityGateResult;
};

export type WeightedMetricResult = {
  score: number | null;
  usedMetricIds: string[];
  excludedMetricIds: string[];
  confidencePercent: number;
};

export function combineQualityWeightedMetrics(metrics: WeightedMetricInput[]): WeightedMetricResult {
  const usable = metrics.filter((metric) => metric.quality.allowed && metric.quality.scoreWeight > 0 && Number.isFinite(metric.score));
  const excludedMetricIds = metrics.filter((metric) => !usable.includes(metric)).map((metric) => metric.id);
  const totalWeight = usable.reduce((sum, metric) => sum + metric.weight * metric.quality.scoreWeight, 0);

  if (totalWeight <= 0) {
    return { score: null, usedMetricIds: [], excludedMetricIds, confidencePercent: 0 };
  }

  const weightedScore = usable.reduce(
    (sum, metric) => sum + metric.score * metric.weight * metric.quality.scoreWeight,
    0,
  ) / totalWeight;
  const confidence = usable.reduce(
    (sum, metric) => sum + metric.quality.confidencePercent * metric.weight,
    0,
  ) / Math.max(0.0001, usable.reduce((sum, metric) => sum + metric.weight, 0));

  return {
    score: Math.round(Math.min(100, Math.max(0, weightedScore))),
    usedMetricIds: usable.map((metric) => metric.id),
    excludedMetricIds,
    confidencePercent: Math.round(confidence),
  };
}
