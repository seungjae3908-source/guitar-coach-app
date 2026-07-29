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

const MIN_SPEAK_GAP_MS = 8_000;
const SAME_ISSUE_GAP_MS = 18_000;
const ACTIVE_METRONOME_WINDOW_MS = 1_200;

type CoachCandidate = {
  id: string;
  phrase: string;
  priority: number;
};

type HandMotionSample = {
  at: number;
  pinch: number;
  palmAngle: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function poseCandidate(frame: Extract<LiveAnalysisFrame, { kind: 'pose' }>): CoachCandidate | null {
  const result = frame.result;
  if (!result.hasPerson) {
    return { id: 'pose-missing', phrase: '상체가 화면에 보이도록 카메라 거리를 맞춰 주세요.', priority: 8 };
  }
  const points = new Map(result.landmarks.map((point) => [point.name, point]));
  const leftShoulder = points.get('leftShoulder');
  const rightShoulder = points.get('rightShoulder');
  if (!leftShoulder || !rightShoulder || leftShoulder.confidence < 0.45 || rightShoulder.confidence < 0.45) {
    return { id: 'shoulders-missing', phrase: '양쪽 어깨가 모두 보이도록 휴대폰 위치를 조정하세요.', priority: 7 };
  }
  const shoulderWidth = distance(leftShoulder, rightShoulder);
  if (shoulderWidth < 0.15) {
    return { id: 'body-too-small', phrase: '상체가 너무 작습니다. 팔꿈치가 보이는 범위에서 카메라를 조금 가까이 두세요.', priority: 8 };
  }
  if (shoulderWidth > 0.68) {
    return { id: 'body-too-large', phrase: '상체가 너무 가깝습니다. 양쪽 팔꿈치와 골반이 보이게 조금 멀리 두세요.', priority: 8 };
  }
  const tilt = Math.abs(leftShoulder.y - rightShoulder.y) / Math.max(0.01, shoulderWidth);
  if (tilt > 0.16) {
    return { id: 'shoulder-tilt', phrase: '한쪽 어깨가 올라가 있습니다. 목과 어깨 힘을 빼고 기타를 몸 쪽으로 당겨 주세요.', priority: 10 };
  }
  const centerX = (leftShoulder.x + rightShoulder.x) / 2;
  if (Math.abs(centerX - 0.5) > 0.16) {
    return { id: 'body-center', phrase: '상체가 화면 중심에서 벗어났습니다. 어깨 중앙을 화면 가운데에 맞춰 주세요.', priority: 6 };
  }
  const nose = points.get('nose');
  if (nose && Math.abs(nose.x - centerX) / Math.max(0.01, shoulderWidth) > 0.4) {
    return { id: 'head-tilt', phrase: '지판을 보더라도 고개를 너무 기울이지 말고 턱을 어깨 중앙에 가깝게 두세요.', priority: 7 };
  }
  return null;
}

function handCandidate(
  frame: Extract<LiveAnalysisFrame, { kind: 'hand' }>,
  history: HandMotionSample[],
): CoachCandidate | null {
  const result = frame.result;
  if (!result.hasHand || result.landmarks.length < 21) {
    return { id: 'hand-missing', phrase: '분석할 손을 화면의 절반 이상 보이게 가까이 두세요.', priority: 8 };
  }
  const points = new Map(result.landmarks.map((point) => [point.name, point]));
  const wrist = points.get('wrist');
  const middleMcp = points.get('middleMcp');
  const thumbTip = points.get('thumbTip');
  const indexTip = points.get('indexTip');
  if (!wrist || !middleMcp || !thumbTip || !indexTip) return null;

  const palmSize = distance(wrist, middleMcp);
  if (palmSize < 0.17) {
    return { id: 'hand-too-small', phrase: '손가락이 너무 작게 보입니다. 손목과 손가락 끝이 크게 보이도록 카메라를 가까이 두세요.', priority: 9 };
  }
  if (palmSize > 0.68) {
    return { id: 'hand-too-large', phrase: '손이 화면에 너무 가깝습니다. 손목과 다섯 손가락 끝이 모두 보이게 조금 멀리 두세요.', priority: 8 };
  }

  const pinch = distance(thumbTip, indexTip) / Math.max(0.001, palmSize);
  const palmAngle = Math.atan2(middleMcp.y - wrist.y, middleMcp.x - wrist.x) * 180 / Math.PI;
  history.push({ at: frame.capturedAt, pinch, palmAngle });
  while (history.length > 24 || (history[0] && frame.capturedAt - history[0].at > 6_000)) history.shift();

  if (result.pick.detected && result.pick.confidence >= 0.62) {
    if (result.pick.exposure > 0.9) {
      return { id: 'pick-too-exposed', phrase: '피크가 너무 많이 나와 있습니다. 줄에 걸리지 않도록 피크를 조금 더 안쪽으로 잡으세요.', priority: 10 };
    }
    if (result.pick.exposure < 0.1) {
      return { id: 'pick-hidden', phrase: '피크가 손가락 안에 너무 많이 숨었습니다. 피크 끝이 조금 더 보이게 조정하세요.', priority: 8 };
    }
  }
  if (pinch > 0.65) {
    return { id: 'pick-grip-wide', phrase: '엄지와 검지 간격이 큽니다. 피크 그립을 조금 더 작고 편하게 유지하세요.', priority: 9 };
  }
  if (pinch < 0.045) {
    return { id: 'pick-grip-tight', phrase: '엄지와 검지가 너무 겹쳐 있습니다. 피크를 세게 누르지 말고 힘을 줄이세요.', priority: 9 };
  }
  if (history.length >= 7) {
    const pinchVariation = standardDeviation(history.map((sample) => sample.pinch));
    const angleVariation = standardDeviation(history.map((sample) => sample.palmAngle));
    if (pinchVariation > 0.11) {
      return { id: 'pick-grip-moving', phrase: '연주 중 피크 그립 간격이 계속 바뀝니다. 속도를 낮추고 엄지와 검지 간격을 유지하세요.', priority: 8 };
    }
    if (angleVariation > 25) {
      return { id: 'wrist-angle-moving', phrase: '손목 방향 변화가 큽니다. 팔에 힘을 빼고 손목 움직임을 더 작게 해 보세요.', priority: 8 };
    }
  }
  return null;
}

export default function VoiceCoachController({ enabled }: { enabled: boolean }) {
  const metronomeActiveAtRef = useRef(0);
  const voiceReadyRef = useRef(false);
  const preparingRef = useRef(false);
  const speakingRef = useRef(false);
  const lastSpokenAtRef = useRef(0);
  const lastIssueIdRef = useRef('');
  const lastIssueSpokenAtRef = useRef(0);
  const pendingCandidateRef = useRef<CoachCandidate | null>(null);
  const handHistoryRef = useRef<HandMotionSample[]>([]);

  useEffect(() => {
    if (!enabled) {
      pendingCandidateRef.current = null;
      handHistoryRef.current = [];
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

  useEffect(() => subscribeLiveAnalysis((frame) => {
    if (!enabled) return;
    if (frame.kind === 'metronome') {
      if (frame.result.running) metronomeActiveAtRef.current = frame.capturedAt;
      return;
    }
    const metronomeActive = frame.capturedAt - metronomeActiveAtRef.current <= ACTIVE_METRONOME_WINDOW_MS;
    if (!metronomeActive || !voiceReadyRef.current || speakingRef.current) return;

    let candidate: CoachCandidate | null = null;
    if (frame.kind === 'pose') candidate = poseCandidate(frame);
    else if (frame.kind === 'hand') candidate = handCandidate(frame, handHistoryRef.current);
    if (!candidate) return;

    const pending = pendingCandidateRef.current;
    if (!pending || candidate.priority >= pending.priority) pendingCandidateRef.current = candidate;

    const now = Date.now();
    if (now - lastSpokenAtRef.current < MIN_SPEAK_GAP_MS) return;
    const selected = pendingCandidateRef.current;
    if (!selected) return;
    if (selected.id === lastIssueIdRef.current && now - lastIssueSpokenAtRef.current < SAME_ISSUE_GAP_MS) return;

    pendingCandidateRef.current = null;
    speakingRef.current = true;
    void speakCoachPhraseAsync(selected.phrase, { interrupt: true, speechRate: 1.05 })
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
    void stopCoachSpeechAsync();
  }, []);

  return null;
}
