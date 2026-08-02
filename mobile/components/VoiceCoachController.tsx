import { useEffect, useRef } from 'react';

import {
  isCoachSpeechAvailable,
  prepareCoachSpeechAsync,
  speakCoachPhraseAsync,
  stopCoachSpeechAsync,
} from '../modules/guitar-coach-speech';
import {
  LiveAnalysisFrame,
  subscribeLiveAnalysis,
} from '../services/analysis-stream';
import {
  clearLiveCoachFeedback,
  LiveCoachFeedbackStatus,
  LiveCoachMeasurement,
  publishLiveCoachFeedback,
} from '../services/live-coach-feedback';
import {
  getLivePracticeContext,
  subscribeLivePracticeContext,
} from '../services/practice-session-context';

const MIN_SPEAK_GAP_MS = 5_500;
const SAME_ISSUE_GAP_MS = 13_000;
const FEEDBACK_PRIORITY_HOLD_MS = 2_200;

type CoachCandidate = {
  id: string;
  status: Exclude<LiveCoachFeedbackStatus, 'waiting'>;
  title: string;
  instruction: string;
  evidence: string;
  nextGoal: string;
  confidencePercent: number;
  priority: number;
  measurements: LiveCoachMeasurement[];
  phrase?: string;
};

type HandMotionSample = {
  at: number;
  palmSize: number;
  pinch: number;
  palmAngle: number;
  wristX: number;
  wristY: number;
  thumb: number;
  index: number;
  middle: number;
  ring: number;
  pinky: number;
};

type AudioMotionSample = {
  at: number;
  attackIntervalMs: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

function range(values: number[]) {
  if (!values.length) return 0;
  return Math.max(...values) - Math.min(...values);
}

function deltas(values: number[]) {
  return values.slice(1).map((value, index) => value - values[index]);
}

function correlation(a: number[], b: number[]) {
  if (a.length !== b.length || a.length < 4) return 0;
  const meanA = mean(a);
  const meanB = mean(b);
  let numerator = 0;
  let denominatorA = 0;
  let denominatorB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const diffA = a[index] - meanA;
    const diffB = b[index] - meanB;
    numerator += diffA * diffB;
    denominatorA += diffA ** 2;
    denominatorB += diffB ** 2;
  }
  const denominator = Math.sqrt(denominatorA * denominatorB);
  return denominator > 0.000001 ? numerator / denominator : 0;
}

function confidenceLabel(value: number) {
  return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

function poseCandidate(frame: Extract<LiveAnalysisFrame, { kind: 'pose' }>): CoachCandidate | null {
  const result = frame.result;
  if (!result.hasPerson) {
    return {
      id: 'pose-missing',
      status: 'cannot-judge',
      title: '전신 자세 판정 불가',
      instruction: '머리부터 골반, 양쪽 팔꿈치가 보이도록 휴대폰 거리를 맞추세요.',
      evidence: '사람 관절이 검출되지 않았습니다.',
      nextGoal: '상체를 가이드 중앙에 맞춘 뒤 그대로 3회 연주하세요.',
      confidencePercent: 0,
      priority: 5,
      measurements: [],
      phrase: '전신 자세를 판정할 수 없습니다. 머리부터 골반과 양쪽 팔꿈치가 보이게 카메라 거리를 맞춰 주세요.',
    };
  }

  const points = new Map(result.landmarks.map((point) => [point.name, point]));
  const leftShoulder = points.get('leftShoulder');
  const rightShoulder = points.get('rightShoulder');
  if (!leftShoulder || !rightShoulder || leftShoulder.confidence < 0.45 || rightShoulder.confidence < 0.45) {
    return {
      id: 'shoulders-missing',
      status: 'cannot-judge',
      title: '어깨 균형 판정 불가',
      instruction: '양쪽 어깨가 가려지지 않도록 기타와 휴대폰 위치를 조정하세요.',
      evidence: '양쪽 어깨 중 하나 이상의 검출 신뢰도가 45% 미만입니다.',
      nextGoal: '양쪽 어깨와 팔꿈치를 한 화면에 유지하세요.',
      confidencePercent: Math.round(Math.max(leftShoulder?.confidence ?? 0, rightShoulder?.confidence ?? 0) * 100),
      priority: 5,
      measurements: [],
      phrase: '양쪽 어깨가 모두 보이도록 휴대폰 위치를 조정해 주세요.',
    };
  }

  const shoulderWidth = distance(leftShoulder, rightShoulder);
  const confidence = mean(result.landmarks.map((point) => point.confidence));
  const measurements: LiveCoachMeasurement[] = [
    { label: '자세 신뢰', value: confidenceLabel(confidence) },
    { label: '상체 크기', value: shoulderWidth.toFixed(2) },
  ];

  if (shoulderWidth < 0.15) {
    return {
      id: 'body-too-small',
      status: 'cannot-judge',
      title: '상체가 너무 작게 보입니다',
      instruction: '팔꿈치가 잘리지 않는 범위에서 휴대폰을 조금 가까이 두세요.',
      evidence: `화면 대비 어깨 폭이 ${shoulderWidth.toFixed(2)}로 자세 분석 기준보다 작습니다.`,
      nextGoal: '어깨 폭이 화면의 약 20~55%가 되도록 맞추세요.',
      confidencePercent: Math.round(confidence * 100),
      priority: 6,
      measurements,
      phrase: '상체가 너무 작습니다. 팔꿈치가 보이는 범위에서 카메라를 조금 가까이 두세요.',
    };
  }
  if (shoulderWidth > 0.68) {
    return {
      id: 'body-too-large',
      status: 'cannot-judge',
      title: '상체가 너무 크게 보입니다',
      instruction: '양쪽 팔꿈치와 골반이 보이도록 휴대폰을 조금 멀리 두세요.',
      evidence: `화면 대비 어깨 폭이 ${shoulderWidth.toFixed(2)}로 분석 범위를 넘었습니다.`,
      nextGoal: '팔꿈치와 골반이 프레임 안에서 유지되게 하세요.',
      confidencePercent: Math.round(confidence * 100),
      priority: 6,
      measurements,
      phrase: '상체가 너무 가깝습니다. 양쪽 팔꿈치와 골반이 보이게 조금 멀리 두세요.',
    };
  }

  const tilt = Math.abs(leftShoulder.y - rightShoulder.y) / Math.max(0.01, shoulderWidth);
  measurements.push({ label: '어깨 기울기', value: tilt.toFixed(2) });
  if (tilt > 0.16) {
    return {
      id: 'shoulder-tilt',
      status: 'correction',
      title: '한쪽 어깨가 올라가 있습니다',
      instruction: '목과 어깨 힘을 빼고 기타를 몸 쪽으로 당긴 뒤 양쪽 어깨 높이를 맞추세요.',
      evidence: `어깨 높이 차이 비율이 ${tilt.toFixed(2)}로 교정 기준 0.16을 넘었습니다.`,
      nextGoal: '어깨 높이를 맞춘 상태로 3회 연주하세요.',
      confidencePercent: Math.round(confidence * 100),
      priority: 10,
      measurements,
      phrase: '한쪽 어깨가 올라가 있습니다. 목과 어깨 힘을 빼고 기타를 몸 쪽으로 당겨 주세요.',
    };
  }

  const centerX = (leftShoulder.x + rightShoulder.x) / 2;
  measurements.push({ label: '상체 중심', value: centerX.toFixed(2) });
  if (Math.abs(centerX - 0.5) > 0.16) {
    return {
      id: 'body-center',
      status: 'correction',
      title: '상체 중심이 카메라에서 벗어났습니다',
      instruction: '어깨 중앙을 화면 가운데에 맞추고 기타 위치는 그대로 유지하세요.',
      evidence: `어깨 중앙이 화면 중심 0.50에서 ${Math.abs(centerX - 0.5).toFixed(2)}만큼 벗어났습니다.`,
      nextGoal: '상체 중심을 유지한 채 3회 연주하세요.',
      confidencePercent: Math.round(confidence * 100),
      priority: 7,
      measurements,
      phrase: '상체가 화면 중심에서 벗어났습니다. 어깨 중앙을 화면 가운데에 맞춰 주세요.',
    };
  }

  const nose = points.get('nose');
  if (nose && nose.confidence >= 0.4) {
    const headOffset = Math.abs(nose.x - centerX) / Math.max(0.01, shoulderWidth);
    measurements.push({ label: '머리 치우침', value: headOffset.toFixed(2) });
    if (headOffset > 0.4) {
      return {
        id: 'head-tilt',
        status: 'correction',
        title: '고개가 한쪽으로 많이 기울었습니다',
        instruction: '지판을 보더라도 턱을 어깨 중앙에 가깝게 두고 목 뒤 힘을 빼세요.',
        evidence: `코 위치가 어깨 중심에서 어깨 폭의 ${headOffset.toFixed(2)}만큼 벗어났습니다.`,
        nextGoal: '한 번 확인한 뒤 시선만 지판으로 보내며 3회 연주하세요.',
        confidencePercent: Math.round(confidence * 100),
        priority: 8,
        measurements,
        phrase: '고개를 너무 기울이지 말고 턱을 어깨 중앙에 가깝게 두세요.',
      };
    }
  }

  return null;
}

function handCandidate(
  frame: Extract<LiveAnalysisFrame, { kind: 'hand' }>,
  history: HandMotionSample[],
): CoachCandidate | null {
  const context = getLivePracticeContext();
  const result = frame.result;
  if (!context) return null;

  if (!result.hasHand || result.landmarks.length < 21) {
    return {
      id: 'hand-missing',
      status: 'cannot-judge',
      title: '손 동작 판정 불가',
      instruction: '손목과 다섯 손가락 끝이 보이도록 손을 화면 안에 맞추세요.',
      evidence: `검출된 손 관절이 ${result.landmarks.length}개로 21개 기준에 부족합니다.`,
      nextGoal: '손 하나가 화면 안에 들어오게 한 뒤 3회 연주하세요.',
      confidencePercent: Math.round(result.handednessScore * 100),
      priority: 6,
      measurements: [{ label: '검출 관절', value: `${result.landmarks.length}/21` }],
      phrase: '손 동작을 판정할 수 없습니다. 손목과 다섯 손가락 끝이 화면 안에 보이게 맞춰 주세요.',
    };
  }

  const points = new Map(result.landmarks.map((point) => [point.name, point]));
  const wrist = points.get('wrist');
  const middleMcp = points.get('middleMcp');
  const thumbTip = points.get('thumbTip');
  const thumbCmc = points.get('thumbCmc');
  const indexTip = points.get('indexTip');
  const indexMcp = points.get('indexMcp');
  const middleTip = points.get('middleTip');
  const ringTip = points.get('ringTip');
  const ringMcp = points.get('ringMcp');
  const pinkyTip = points.get('pinkyTip');
  const pinkyMcp = points.get('pinkyMcp');
  if (!wrist || !middleMcp || !thumbTip || !thumbCmc || !indexTip || !indexMcp || !middleTip || !ringTip || !ringMcp || !pinkyTip || !pinkyMcp) {
    return {
      id: 'hand-keypoints-missing',
      status: 'cannot-judge',
      title: '손가락 끝점 판정 불가',
      instruction: '손가락이 서로 겹치지 않도록 카메라 각도를 조금 옆으로 옮기세요.',
      evidence: '필수 손목·손가락 끝 관절 일부가 검출되지 않았습니다.',
      nextGoal: '손가락 끝 5개가 모두 보이는 각도를 유지하세요.',
      confidencePercent: Math.round(result.handednessScore * 100),
      priority: 5,
      measurements: [],
      phrase: '손가락이 겹쳐 보입니다. 다섯 손가락 끝이 모두 보이도록 카메라 각도를 조금 옮겨 주세요.',
    };
  }

  const palmSize = distance(wrist, middleMcp);
  const pinch = distance(thumbTip, indexTip) / Math.max(0.001, palmSize);
  const palmAngle = Math.atan2(middleMcp.y - wrist.y, middleMcp.x - wrist.x) * 180 / Math.PI;
  const sample: HandMotionSample = {
    at: frame.capturedAt,
    palmSize,
    pinch,
    palmAngle,
    wristX: wrist.x,
    wristY: wrist.y,
    thumb: distance(thumbTip, thumbCmc) / Math.max(0.001, palmSize),
    index: distance(indexTip, indexMcp) / Math.max(0.001, palmSize),
    middle: distance(middleTip, middleMcp) / Math.max(0.001, palmSize),
    ring: distance(ringTip, ringMcp) / Math.max(0.001, palmSize),
    pinky: distance(pinkyTip, pinkyMcp) / Math.max(0.001, palmSize),
  };
  history.push(sample);
  while (history.length > 24 || (history[0] && frame.capturedAt - history[0].at > 6_000)) history.shift();

  const measurements: LiveCoachMeasurement[] = [
    { label: '손 크기', value: palmSize.toFixed(2) },
    { label: '손 검출', value: confidenceLabel(result.handednessScore) },
  ];

  if (palmSize < 0.075) {
    return {
      id: 'hand-too-small',
      status: 'cannot-judge',
      title: '손이 너무 작게 보입니다',
      instruction: '손목과 손가락 끝이 보이도록 조명과 카메라 각도를 먼저 맞추세요.',
      evidence: `화면 대비 손바닥 길이가 ${palmSize.toFixed(2)}로 상세 분석 기준보다 작습니다.`,
      nextGoal: '손바닥 길이가 화면의 약 8~55%가 되게 맞추세요.',
      confidencePercent: Math.round(result.handednessScore * 100),
      priority: 6,
      measurements,
      phrase: '손이 흐리게 보입니다. 손목과 손가락 끝이 보이도록 조명과 각도를 맞춰 주세요.',
    };
  }
  if (palmSize > 0.68) {
    return {
      id: 'hand-too-large',
      status: 'cannot-judge',
      title: '손이 화면에 너무 가깝습니다',
      instruction: '손목과 다섯 손가락 끝이 모두 보일 때까지 휴대폰을 조금 멀리 두세요.',
      evidence: `화면 대비 손바닥 길이가 ${palmSize.toFixed(2)}로 분석 범위를 넘었습니다.`,
      nextGoal: '손 전체를 가이드 안에 유지하세요.',
      confidencePercent: Math.round(result.handednessScore * 100),
      priority: 6,
      measurements,
      phrase: '손이 화면에 너무 가깝습니다. 손목과 다섯 손가락 끝이 모두 보이게 조금 멀리 두세요.',
    };
  }

  const pickCategory = context.category === 'strumming'
    || context.category === 'alternatePicking'
    || context.category === 'downPicking'
    || context.category === 'palmMute';

  if (pickCategory) {
    measurements.push({ label: '피크', value: result.pick.detected ? confidenceLabel(result.pick.confidence) : '미검출' });
    if (result.pick.detected && result.pick.confidence >= 0.62) {
      measurements.push({ label: '피크 노출', value: result.pick.exposure.toFixed(2) });
      if (result.pick.exposure > 0.9) {
        return {
          id: 'pick-too-exposed',
          status: 'correction',
          title: '피크가 너무 많이 나와 있습니다',
          instruction: '줄에 걸리지 않도록 피크를 엄지 안쪽으로 조금 더 넣어 잡으세요.',
          evidence: `피크 노출 비율이 ${result.pick.exposure.toFixed(2)}로 권장 범위를 넘었습니다.`,
          nextGoal: '피크 끝을 줄에 필요한 만큼만 남기고 3회 연주하세요.',
          confidencePercent: Math.round(result.pick.confidence * 100),
          priority: 10,
          measurements,
          phrase: '피크가 너무 많이 나와 있습니다. 줄에 걸리지 않도록 피크를 조금 더 안쪽으로 잡으세요.',
        };
      }
      if (result.pick.exposure < 0.1) {
        return {
          id: 'pick-hidden',
          status: 'correction',
          title: '피크 끝이 손가락 안에 너무 숨었습니다',
          instruction: '피크 끝이 카메라에서 조금 더 보이도록 아주 조금만 빼세요.',
          evidence: `피크 노출 비율이 ${result.pick.exposure.toFixed(2)}로 분석 가능한 범위보다 작습니다.`,
          nextGoal: '그립을 세게 누르지 않고 같은 노출량으로 3회 연주하세요.',
          confidencePercent: Math.round(result.pick.confidence * 100),
          priority: 9,
          measurements,
          phrase: '피크가 손가락 안에 너무 많이 숨었습니다. 피크 끝이 조금 더 보이게 조정하세요.',
        };
      }
      if ((context.calibrationConfidencePercent ?? 0) >= 60) {
        measurements.push({ label: '영상 피크각', value: `${Math.round(result.pick.angleDegrees)}°` });
      }
    }

    measurements.push({ label: '그립 간격', value: pinch.toFixed(2) });
    if (pinch > 0.65) {
      return {
        id: 'pick-grip-wide',
        status: 'correction',
        title: '피크 그립이 크게 벌어집니다',
        instruction: '엄지와 검지 간격을 조금 줄이고 피크를 작은 동작으로 잡으세요.',
        evidence: `엄지·검지 간격이 손바닥 길이 대비 ${pinch.toFixed(2)}입니다.`,
        nextGoal: '같은 그립 간격을 유지하며 3회 연주하세요.',
        confidencePercent: Math.round(result.handednessScore * 100),
        priority: 8,
        measurements,
        phrase: '엄지와 검지 간격이 큽니다. 피크 그립을 조금 더 작고 편하게 유지하세요.',
      };
    }
    if (pinch < 0.045) {
      return {
        id: 'pick-grip-tight',
        status: 'correction',
        title: '피크를 너무 강하게 누르는 모양입니다',
        instruction: '엄지와 검지를 완전히 겹치지 말고 피크가 빠지지 않을 정도로만 잡으세요.',
        evidence: `엄지·검지 끝 간격이 손바닥 길이 대비 ${pinch.toFixed(3)}입니다.`,
        nextGoal: '힘을 줄인 그립으로 3회 연주하세요.',
        confidencePercent: Math.round(result.handednessScore * 100),
        priority: 9,
        measurements,
        phrase: '엄지와 검지가 너무 겹쳐 있습니다. 피크를 세게 누르지 말고 힘을 줄이세요.',
      };
    }
  }

  if (history.length >= 7) {
    const recent = history.slice(-10);
    const angleVariation = standardDeviation(recent.map((item) => item.palmAngle));
    const averagePalm = Math.max(0.001, mean(recent.map((item) => item.palmSize)));
    const wristTravel = Math.hypot(
      range(recent.map((item) => item.wristX)),
      range(recent.map((item) => item.wristY)),
    ) / averagePalm;
    measurements.push({ label: '손목각 흔들림', value: `${Math.round(angleVariation)}°` });
    measurements.push({ label: '손 전체 이동', value: wristTravel.toFixed(2) });

    if (angleVariation > 24) {
      return {
        id: 'wrist-angle-moving',
        status: 'correction',
        title: '손목 방향 변화가 너무 큽니다',
        instruction: pickCategory
          ? '팔 힘을 빼고 피크 이동 폭을 줄여 손목 방향을 일정하게 만드세요.'
          : '손 전체를 흔들지 말고 탄현하는 손가락만 짧게 움직이세요.',
        evidence: `최근 손목 방향 표준편차가 ${Math.round(angleVariation)}도로 기준 24도를 넘었습니다.`,
        nextGoal: '현재 속도를 유지하고 손목 방향을 고정한 채 3회 연주하세요.',
        confidencePercent: Math.round(result.handednessScore * 100),
        priority: 9,
        measurements,
        phrase: pickCategory
          ? '손목 방향 변화가 큽니다. 속도를 유지하고 피크 이동 폭을 더 작게 해 보세요.'
          : '손목이 손가락과 함께 흔들립니다. 손가락만 짧게 움직여 주세요.',
      };
    }

    if (wristTravel > 0.82) {
      return {
        id: 'whole-hand-travel',
        status: 'correction',
        title: '손가락보다 손 전체가 크게 움직입니다',
        instruction: '팔꿈치와 손목 위치는 유지하고 필요한 손가락 또는 피크만 움직이세요.',
        evidence: `최근 손목 이동 범위가 손바닥 길이의 ${wristTravel.toFixed(2)}배입니다.`,
        nextGoal: '손목 중심을 가이드 안에 유지하며 3회 연주하세요.',
        confidencePercent: Math.round(result.handednessScore * 100),
        priority: 8,
        measurements,
        phrase: '손 전체 움직임이 큽니다. 팔꿈치와 손목 위치를 유지하고 필요한 손가락만 움직여 주세요.',
      };
    }

    if (context.category === 'arpeggio') {
      const indexValues = recent.map((item) => item.index);
      const middleValues = recent.map((item) => item.middle);
      const ringValues = recent.map((item) => item.ring);
      const averageIndexLead = mean(indexValues.map((value, index) => value - middleValues[index]));
      const indexMiddleCorrelation = correlation(deltas(indexValues), deltas(middleValues));
      const ringMiddleCorrelation = correlation(deltas(ringValues), deltas(middleValues));
      measurements.push({ label: 'i-m 동반', value: indexMiddleCorrelation.toFixed(2) });

      if (context.presetId.includes('pim-return') && averageIndexLead > 0.34 && range(indexValues) < 0.22) {
        return {
          id: 'index-return-late',
          status: 'correction',
          title: '검지가 앞으로 나온 채 오래 남습니다',
          instruction: 'i 탄현 직후 검지 끝을 손바닥 쪽 중립 위치로 짧게 되돌리세요.',
          evidence: `최근 검지 길이 지표가 중지보다 평균 ${averageIndexLead.toFixed(2)} 크게 유지됐습니다.`,
          nextGoal: 'P-i-m 세 음마다 검지를 바로 복귀시키며 3회 반복하세요.',
          confidencePercent: Math.round(result.handednessScore * 100),
          priority: 10,
          measurements,
          phrase: '검지가 앞으로 나온 채 남아 있습니다. 아이 탄현 직후 손바닥 쪽으로 짧게 복귀시키세요.',
        };
      }

      if (context.presetId.includes('pami') && ringMiddleCorrelation > 0.82 && range(ringValues) > 0.12 && range(middleValues) > 0.12) {
        measurements.push({ label: 'a-m 동반', value: ringMiddleCorrelation.toFixed(2) });
        return {
          id: 'ring-middle-follow',
          status: 'correction',
          title: '약지와 중지가 같이 움직입니다',
          instruction: 'a를 움직일 때 m은 현재 위치에 남겨 두고 약지만 손바닥 쪽으로 짧게 움직이세요.',
          evidence: `최근 a와 m 움직임 상관값이 ${ringMiddleCorrelation.toFixed(2)}로 높게 측정됐습니다.`,
          nextGoal: 'a만 움직이는 느낌으로 p-a-m-i를 3회 반복하세요.',
          confidencePercent: Math.round(result.handednessScore * 100),
          priority: 10,
          measurements,
          phrase: '약지를 움직일 때 중지가 같이 움직입니다. 중지는 남겨 두고 약지만 짧게 움직이세요.',
        };
      }

      if (indexMiddleCorrelation > 0.88 && range(indexValues) > 0.12 && range(middleValues) > 0.12) {
        return {
          id: 'index-middle-follow',
          status: 'correction',
          title: '검지와 중지 독립성이 무너집니다',
          instruction: 'i를 움직일 때 m은 준비 위치에 남기고, m을 움직일 때 i는 바로 복귀시키세요.',
          evidence: `최근 i와 m 움직임 상관값이 ${indexMiddleCorrelation.toFixed(2)}로 높습니다.`,
          nextGoal: 'P-i-m을 느리게 3회 연주하며 한 손가락씩 분리하세요.',
          confidencePercent: Math.round(result.handednessScore * 100),
          priority: 9,
          measurements,
          phrase: '검지와 중지가 같이 움직입니다. 한 손가락이 움직일 때 다른 손가락은 준비 위치에 남겨 주세요.',
        };
      }
    }

    const leftHandCategory = context.category === 'chords'
      || context.category === 'powerChords'
      || context.category === 'fingering'
      || context.category === 'scales'
      || context.category === 'leadTechnique';
    if (leftHandCategory) {
      const fingerRanges = [
        { name: '검지', value: range(recent.map((item) => item.index)) },
        { name: '중지', value: range(recent.map((item) => item.middle)) },
        { name: '약지', value: range(recent.map((item) => item.ring)) },
        { name: '새끼', value: range(recent.map((item) => item.pinky)) },
      ].sort((a, b) => b.value - a.value);
      measurements.push({ label: '최대 이동', value: `${fingerRanges[0].name} ${fingerRanges[0].value.toFixed(2)}` });
      if ((context.category === 'chords' || context.category === 'powerChords')
        && fingerRanges[0].value > 0.36
        && fingerRanges[0].value > Math.max(0.12, fingerRanges[1].value * 1.8)) {
        return {
          id: `late-finger-${fingerRanges[0].name}`,
          status: 'correction',
          title: `${fingerRanges[0].name} 움직임만 크게 남습니다`,
          instruction: '코드 모양을 공중에서 먼저 만든 뒤 네 손가락을 한 덩어리처럼 내려놓으세요.',
          evidence: `${fingerRanges[0].name} 끝점 변화량 ${fingerRanges[0].value.toFixed(2)}가 다른 손가락보다 크게 측정됐습니다.`,
          nextGoal: '무박자로 코드 모양을 만든 뒤 동시에 착지하는 동작을 3회 하세요.',
          confidencePercent: Math.round(result.handednessScore * 100),
          priority: 8,
          measurements,
          phrase: `${fingerRanges[0].name} 움직임만 늦게 남습니다. 코드 모양을 공중에서 먼저 만들고 네 손가락을 함께 내려놓으세요.`,
        };
      }
    }
  }

  if (context.category === 'palmMute' && (context.calibrationConfidencePercent ?? 0) < 60) {
    return {
      id: 'palm-mute-calibration-required',
      status: 'cannot-judge',
      title: '팜뮤트 위치 판정 불가',
      instruction: '촬영보정에서 브리지 기준선을 저장해야 손날 위치를 실제로 비교할 수 있습니다.',
      evidence: `현재 브리지 촬영보정 신뢰도는 ${context.calibrationConfidencePercent ?? 0}%입니다.`,
      nextGoal: '촬영보정을 완료한 뒤 같은 각도로 다시 시작하세요.',
      confidencePercent: context.calibrationConfidencePercent ?? 0,
      priority: 4,
      measurements,
      phrase: '팜뮤트 위치는 브리지 촬영 보정이 없어 판정할 수 없습니다. 촬영 보정을 먼저 완료해 주세요.',
    };
  }

  return null;
}

function audioCandidate(
  frame: Extract<LiveAnalysisFrame, { kind: 'audio' }>,
  history: AudioMotionSample[],
): CoachCandidate | null {
  const context = getLivePracticeContext();
  if (!context?.microphoneEnabled) return null;
  const result = frame.result;

  if (result.clippingRatio > 0.015) {
    return {
      id: 'audio-clipping',
      status: 'warning',
      title: '마이크 입력이 찌그러집니다',
      instruction: '앰프 볼륨을 낮추거나 휴대폰을 기타·앰프에서 조금 멀리 두세요.',
      evidence: `클리핑 비율이 ${(result.clippingRatio * 100).toFixed(1)}%로 측정됐습니다.`,
      nextGoal: '클리핑 표시가 사라진 상태로 3회 연주하세요.',
      confidencePercent: Math.round(result.pitchConfidence * 100),
      priority: 10,
      measurements: [
        { label: '클리핑', value: `${(result.clippingRatio * 100).toFixed(1)}%` },
        { label: '어택 수', value: `${result.attackCount}` },
      ],
      phrase: '마이크 입력이 찌그러집니다. 앰프 볼륨을 낮추거나 휴대폰을 조금 멀리 두세요.',
    };
  }

  if (result.attackIntervalMs > 0 && result.attackCount >= 3) {
    history.push({ at: frame.capturedAt, attackIntervalMs: result.attackIntervalMs });
    while (history.length > 18 || (history[0] && frame.capturedAt - history[0].at > 6_000)) history.shift();
  }

  if (result.attackCount < 3 || result.attackIntervalMs <= 0) return null;

  const targetInterval = 60_000 / Math.max(35, context.bpm) / Math.max(1, context.pulsesPerBeat);
  const intervalError = (result.attackIntervalMs - targetInterval) / targetInterval;
  const measurements: LiveCoachMeasurement[] = [
    { label: '목표 간격', value: `${Math.round(targetInterval)}ms` },
    { label: '실제 간격', value: `${Math.round(result.attackIntervalMs)}ms` },
  ];

  if (Math.abs(intervalError) > 0.2) {
    const tooSlow = intervalError > 0;
    return {
      id: tooSlow ? 'attack-too-slow' : 'attack-too-fast',
      status: 'correction',
      title: tooSlow ? '탄현 간격이 목표보다 느립니다' : '탄현 간격이 목표보다 빠릅니다',
      instruction: tooSlow
        ? '다음 클릭을 기다리지 말고 분할 박 사이를 같은 간격으로 채우세요.'
        : '앞서 가지 말고 클릭 사이를 더 넓게 느끼며 손 동작을 줄이세요.',
      evidence: `목표 ${Math.round(targetInterval)}ms 대비 실제 ${Math.round(result.attackIntervalMs)}ms입니다.`,
      nextGoal: `각 탄현 간격을 ${Math.round(targetInterval)}ms 근처로 맞춰 3회 연주하세요.`,
      confidencePercent: Math.round(clamp(result.attackStrength * 100, 0, 100)),
      priority: 8,
      measurements,
      phrase: tooSlow
        ? '탄현 간격이 목표보다 느립니다. 분할 박 사이를 같은 간격으로 채워 주세요.'
        : '탄현 간격이 목표보다 빠릅니다. 클릭보다 앞서 가지 말고 손 동작을 줄여 주세요.',
    };
  }

  if (history.length >= 6) {
    const jitter = standardDeviation(history.slice(-10).map((item) => item.attackIntervalMs));
    measurements.push({ label: '간격 흔들림', value: `${Math.round(jitter)}ms` });
    if (jitter > targetInterval * 0.18) {
      return {
        id: 'attack-jitter',
        status: 'correction',
        title: '탄현 간격이 고르지 않습니다',
        instruction: '세게 치려 하지 말고 작은 동작으로 클릭 사이를 똑같이 나누세요.',
        evidence: `최근 어택 간격 표준편차가 ${Math.round(jitter)}ms로 목표 간격의 18%를 넘었습니다.`,
        nextGoal: '소리 크기보다 일정한 간격에 집중해 3회 연주하세요.',
        confidencePercent: Math.round(clamp(result.attackStrength * 100, 0, 100)),
        priority: 8,
        measurements,
        phrase: '탄현 간격이 고르지 않습니다. 작은 동작으로 클릭 사이를 똑같이 나눠 주세요.',
      };
    }
  }

  return null;
}

function successCandidate(frame: LiveAnalysisFrame): CoachCandidate {
  const context = getLivePracticeContext();
  const category = context?.category;
  const instruction = category === 'arpeggio'
    ? '좋아요. 손목을 유지하고 각 손가락을 짧게 복귀시키세요.'
    : category === 'strumming' || category === 'alternatePicking' || category === 'downPicking'
      ? '좋아요. 현재 피크 그립과 손목 범위를 그대로 유지하세요.'
      : category === 'chords' || category === 'powerChords'
        ? '좋아요. 손 모양을 흐트러뜨리지 말고 같은 착지를 반복하세요.'
        : '좋아요. 지금 자세와 움직임 크기를 그대로 유지하세요.';
  return {
    id: `stable-${category ?? frame.kind}`,
    status: 'success',
    title: '좋은 동작이 이어지고 있습니다',
    instruction,
    evidence: '현재 프레임에서 우선 교정할 항목이 검출되지 않았습니다.',
    nextGoal: '같은 동작을 3회 연속 유지한 뒤 속도를 판단하세요.',
    confidencePercent: 80,
    priority: 2,
    measurements: [],
    phrase: instruction,
  };
}

export default function VoiceCoachController({ enabled }: { enabled: boolean }) {
  const voiceReadyRef = useRef(false);
  const preparingRef = useRef(false);
  const speakingRef = useRef(false);
  const lastSpokenAtRef = useRef(0);
  const lastIssueIdRef = useRef('');
  const lastIssueSpokenAtRef = useRef(0);
  const pendingCandidateRef = useRef<CoachCandidate | null>(null);
  const handHistoryRef = useRef<HandMotionSample[]>([]);
  const audioHistoryRef = useRef<AudioMotionSample[]>([]);
  const stableCountRef = useRef(0);
  const lastPublishedRef = useRef<{ priority: number; capturedAt: number; id: string } | null>(null);

  useEffect(() => {
    if (!enabled) {
      pendingCandidateRef.current = null;
      void stopCoachSpeechAsync();
      return;
    }
    if (!isCoachSpeechAvailable || voiceReadyRef.current || preparingRef.current) return;
    preparingRef.current = true;
    void prepareCoachSpeechAsync()
      .then(() => {
        voiceReadyRef.current = true;
      })
      .catch(() => {
        voiceReadyRef.current = false;
      })
      .finally(() => {
        preparingRef.current = false;
      });
  }, [enabled]);

  useEffect(() => subscribeLivePracticeContext((context) => {
    handHistoryRef.current = [];
    audioHistoryRef.current = [];
    stableCountRef.current = 0;
    pendingCandidateRef.current = null;
    lastPublishedRef.current = null;
    if (!context) clearLiveCoachFeedback();
  }), []);

  useEffect(() => subscribeLiveAnalysis((frame) => {
    const context = getLivePracticeContext();
    if (!context?.active || frame.kind === 'metronome') return;

    let candidate: CoachCandidate | null = null;
    if (frame.kind === 'pose') candidate = poseCandidate(frame);
    else if (frame.kind === 'hand') candidate = handCandidate(frame, handHistoryRef.current);
    else if (frame.kind === 'audio') candidate = audioCandidate(frame, audioHistoryRef.current);

    if (candidate) {
      stableCountRef.current = 0;
    } else if (frame.kind === 'pose' || frame.kind === 'hand') {
      stableCountRef.current = Math.min(3, stableCountRef.current + 1);
      candidate = successCandidate(frame);
    } else {
      return;
    }

    const now = frame.capturedAt;
    const previous = lastPublishedRef.current;
    const shouldHoldPrevious = previous
      && now - previous.capturedAt < FEEDBACK_PRIORITY_HOLD_MS
      && candidate.priority < previous.priority
      && candidate.id !== previous.id;
    if (!shouldHoldPrevious) {
      publishLiveCoachFeedback({
        id: candidate.id,
        capturedAt: now,
        status: candidate.status,
        category: context.category,
        title: candidate.title,
        instruction: candidate.instruction,
        evidence: candidate.evidence,
        nextGoal: candidate.nextGoal,
        confidencePercent: candidate.confidencePercent,
        stableCount: stableCountRef.current,
        priority: candidate.priority,
        measurements: candidate.measurements,
      });
      lastPublishedRef.current = { priority: candidate.priority, capturedAt: now, id: candidate.id };
    }

    if (!enabled || !voiceReadyRef.current || speakingRef.current || !candidate.phrase) return;
    const pending = pendingCandidateRef.current;
    if (!pending || candidate.priority >= pending.priority) pendingCandidateRef.current = candidate;

    if (now - lastSpokenAtRef.current < MIN_SPEAK_GAP_MS) return;
    const selected = pendingCandidateRef.current;
    if (!selected?.phrase) return;
    if (selected.id === lastIssueIdRef.current && now - lastIssueSpokenAtRef.current < SAME_ISSUE_GAP_MS) return;
    if (selected.status === 'success' && stableCountRef.current < 3) return;

    pendingCandidateRef.current = null;
    speakingRef.current = true;
    void speakCoachPhraseAsync(selected.phrase, { interrupt: true, speechRate: 1.04 })
      .then(() => {
        lastSpokenAtRef.current = Date.now();
        lastIssueIdRef.current = selected.id;
        lastIssueSpokenAtRef.current = Date.now();
      })
      .catch(() => {
        voiceReadyRef.current = false;
      })
      .finally(() => {
        speakingRef.current = false;
      });
  }), [enabled]);

  useEffect(() => () => {
    clearLiveCoachFeedback();
    void stopCoachSpeechAsync();
  }, []);

  return null;
}
