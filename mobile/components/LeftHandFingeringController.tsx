import { useEffect, useRef } from 'react';

import type { HandAnalysisResult } from '../modules/guitar-coach-hand';
import type { NativeAudioReading } from '../modules/guitar-coach-audio';
import { publishLiveAnalysisFrame, subscribeLiveAnalysis } from '../services/analysis-stream';
import { loadBestFretboardCalibration } from '../services/fretboard-calibration-store';
import {
  projectFingerToFretboard,
  type FretboardCalibration,
  type FrettingFingerId,
  type FrettingFingerObservation,
} from '../services/fretboard-chord-engine';
import {
  analyzeFingeringEvents,
  matchFingeringAttack,
  parseFingeringTarget,
  type FingeringAnalysisResult,
  type FingeringNoteEvent,
  type FingeringProjectedPosition,
} from '../services/left-hand-fingering-engine';
import { publishLiveCoachFeedback } from '../services/live-coach-feedback';
import {
  getLivePracticeContext,
  subscribeLivePracticeContext,
} from '../services/practice-session-context';

const FINGERING_CATEGORIES = new Set(['fingering', 'scales', 'leadTechnique']);
const FINGER_TIPS: Array<{ finger: FrettingFingerId; landmark: string }> = [
  { finger: 'index', landmark: 'indexTip' },
  { finger: 'middle', landmark: 'middleTip' },
  { finger: 'ring', landmark: 'ringTip' },
  { finger: 'pinky', landmark: 'pinkyTip' },
];
const FINGER_LABEL: Record<FrettingFingerId, string> = {
  index: '검지',
  middle: '중지',
  ring: '약지',
  pinky: '새끼',
};

type TipPoint = { x: number; y: number };
type ProjectedFrame = {
  capturedAt: number;
  positions: FingeringProjectedPosition[];
};

function observationsFromHand(hand: HandAnalysisResult) {
  const points = new Map(hand.landmarks.map((point) => [point.name, point]));
  const confidence = Math.max(0, Math.min(1, hand.handednessScore));
  return FINGER_TIPS.flatMap(({ finger, landmark }): FrettingFingerObservation[] => {
    const point = points.get(landmark);
    return point ? [{ finger, tip: { x: point.x, y: point.y }, confidence }] : [];
  });
}

function projectedFrame(
  hand: HandAnalysisResult,
  calibration: FretboardCalibration,
  capturedAt: number,
  previousTips: Map<FrettingFingerId, TipPoint>,
): ProjectedFrame {
  const observations = observationsFromHand(hand);
  const positions = observations.flatMap((observation): FingeringProjectedPosition[] => {
    const projected = projectFingerToFretboard(observation, calibration);
    const previous = previousTips.get(observation.finger);
    const motion = previous
      ? Math.hypot(observation.tip.x - previous.x, observation.tip.y - previous.y)
      : 0;
    previousTips.set(observation.finger, observation.tip);
    return projected ? [{ ...projected, motion }] : [];
  });
  return { capturedAt, positions };
}

function resultTitle(result: FingeringAnalysisResult) {
  if (result.status === 'confirmed') return `${result.targetLabel} 확인 · ${result.score}점`;
  if (result.status === 'candidate' && result.latestEvent) {
    return `${FINGER_LABEL[result.latestEvent.finger]} · ${result.latestEvent.stringNumber}번 줄 ${result.latestEvent.fret}프렛`;
  }
  return '왼손 핑거링 정밀 판정 불가';
}

export default function LeftHandFingeringController() {
  const calibrationRef = useRef<FretboardCalibration | null>(null);
  const calibrationLoadingRef = useRef(false);
  const previousTipsRef = useRef(new Map<FrettingFingerId, TipPoint>());
  const latestProjectedRef = useRef<ProjectedFrame | null>(null);
  const eventsRef = useRef<FingeringNoteEvent[]>([]);
  const lastAttackCountRef = useRef(-1);
  const lastPublishedAtRef = useRef(0);
  const lastSignatureRef = useRef('');
  const unmatchedAttacksRef = useRef(0);

  const reset = () => {
    previousTipsRef.current.clear();
    latestProjectedRef.current = null;
    eventsRef.current = [];
    lastAttackCountRef.current = -1;
    lastPublishedAtRef.current = 0;
    lastSignatureRef.current = '';
    unmatchedAttacksRef.current = 0;
  };

  const reloadCalibration = async () => {
    const context = getLivePracticeContext();
    if (!context?.active || !FINGERING_CATEGORIES.has(context.category) || calibrationLoadingRef.current) {
      calibrationRef.current = null;
      return;
    }
    calibrationLoadingRef.current = true;
    try {
      calibrationRef.current = await loadBestFretboardCalibration({
        guitarMode: context.guitarMode,
        cameraFacing: 'back',
        mirrored: false,
      });
    } catch {
      calibrationRef.current = null;
    } finally {
      calibrationLoadingRef.current = false;
    }
  };

  const publishResult = (result: FingeringAnalysisResult, capturedAt: number) => {
    const context = getLivePracticeContext();
    if (!context?.active || !FINGERING_CATEGORIES.has(context.category)) return;

    publishLiveAnalysisFrame({ kind: 'fingering', capturedAt, result });
    const signature = `${result.status}:${result.score ?? 'none'}:${result.latestEvent?.finger ?? 'none'}:${result.latestEvent?.stringNumber ?? 0}:${result.latestEvent?.fret ?? 0}:${result.corrections.join('|')}`;
    const interval = result.status === 'confirmed' ? 1_300 : 650;
    if (signature === lastSignatureRef.current && capturedAt - lastPublishedAtRef.current < interval) return;
    lastSignatureRef.current = signature;
    lastPublishedAtRef.current = capturedAt;

    const instruction = result.corrections[0]
      ?? result.positives[0]
      ?? '한 음씩 분리해 같은 줄·프렛·손가락 순서를 유지하세요.';
    const nextGoal = result.corrections[1]
      ?? (result.status === 'confirmed'
        ? '같은 정확도로 두 세트를 더 반복하세요.'
        : '목표 패턴을 최소 두 세트 연속 연주하세요.');
    publishLiveCoachFeedback({
      id: `left-fingering-${result.targetLabel}-${result.status}`,
      capturedAt,
      status: result.status === 'confirmed'
        ? 'success'
        : result.status === 'cannot-judge'
          ? 'cannot-judge'
          : 'correction',
      category: context.category,
      title: resultTitle(result),
      instruction,
      evidence: result.evidence.join(' · '),
      nextGoal,
      confidencePercent: result.confidencePercent,
      stableCount: result.status === 'confirmed' ? 3 : 0,
      priority: result.status === 'confirmed' ? 7 : 13,
      measurements: [
        ...(result.latestEvent ? [
          { label: '최근 음', value: `${result.latestEvent.stringNumber}번·${result.latestEvent.fret}프렛` },
          { label: '손가락', value: FINGER_LABEL[result.latestEvent.finger] },
        ] : []),
        { label: '손가락 순서', value: `${result.fingerAccuracyPercent}%` },
        { label: '줄·프렛', value: `${result.positionAccuracyPercent}%` },
      ].slice(0, 4),
    });

    result.positives.slice(0, 2).forEach((positive, index) => {
      publishLiveCoachFeedback({
        id: `left-fingering-positive-${index}-${positive}`,
        capturedAt,
        status: 'success',
        category: context.category,
        title: positive,
        instruction: '현재 손가락 준비 위치와 움직임을 그대로 유지하세요.',
        evidence: result.evidence.join(' · '),
        nextGoal: '같은 동작을 두 세트 더 반복해 안정성을 확인하세요.',
        confidencePercent: result.confidencePercent,
        stableCount: 1,
        priority: 5,
        measurements: [
          { label: '순서', value: `${result.fingerAccuracyPercent}%` },
          { label: '위치', value: `${result.positionAccuracyPercent}%` },
        ],
      });
    });
  };

  useEffect(() => subscribeLivePracticeContext(() => {
    reset();
    void reloadCalibration();
  }), []);

  useEffect(() => subscribeLiveAnalysis((frame) => {
    const context = getLivePracticeContext();
    if (!context?.active || !FINGERING_CATEGORIES.has(context.category)) return;

    if (frame.kind === 'hand') {
      const hand = frame.result as HandAnalysisResult;
      if (!hand.hasHand || hand.landmarks.length < 21) return;
      if (!calibrationRef.current && !calibrationLoadingRef.current) void reloadCalibration();
      const calibration = calibrationRef.current;
      if (!calibration) {
        if (frame.capturedAt - lastPublishedAtRef.current >= 1_300) {
          const result = analyzeFingeringEvents({
            events: eventsRef.current,
            target: parseFingeringTarget(context.pattern, context.category),
            calibrationAvailable: false,
            microphoneEnabled: context.microphoneEnabled,
          });
          publishResult(result, frame.capturedAt);
        }
        return;
      }
      latestProjectedRef.current = projectedFrame(
        hand,
        calibration,
        frame.capturedAt,
        previousTipsRef.current,
      );
      return;
    }

    if (frame.kind !== 'audio') return;
    const audio = frame.result as NativeAudioReading;
    if (!audio.running || audio.attackCount <= 0 || audio.attackCount === lastAttackCountRef.current) return;
    if (audio.millisecondsSinceAttack > 500) return;
    lastAttackCountRef.current = audio.attackCount;
    const projected = latestProjectedRef.current;
    const target = parseFingeringTarget(context.pattern, context.category);

    if (!calibrationRef.current || !projected || frame.capturedAt - projected.capturedAt > 900) {
      const result = analyzeFingeringEvents({
        events: eventsRef.current,
        target,
        calibrationAvailable: Boolean(calibrationRef.current),
        microphoneEnabled: context.microphoneEnabled,
      });
      publishResult(result, frame.capturedAt);
      return;
    }

    const event = matchFingeringAttack({
      capturedAt: frame.capturedAt,
      frequencyHz: audio.frequencyHz,
      pitchConfidence: audio.pitchConfidence,
      signalToNoiseDb: audio.signalToNoiseDb,
      clippingRatio: audio.clippingRatio,
    }, projected.positions);

    if (event) {
      unmatchedAttacksRef.current = 0;
      eventsRef.current.push(event);
      eventsRef.current = eventsRef.current
        .filter((item) => frame.capturedAt - item.capturedAt <= 12_000)
        .slice(-32);
    } else {
      unmatchedAttacksRef.current += 1;
    }

    const result = analyzeFingeringEvents({
      events: eventsRef.current,
      target,
      calibrationAvailable: true,
      microphoneEnabled: context.microphoneEnabled,
    });
    if (!event && unmatchedAttacksRef.current >= 2) {
      result.status = 'candidate';
      result.score = null;
      result.corrections = [
        '소리는 감지됐지만 같은 순간의 손가락·줄·프렛이 일치하지 않습니다. 한 음만 누르고 다른 줄을 뮤트하세요.',
        ...result.corrections,
      ].slice(0, 5);
      result.evidence = [`연속 미해결 탄현 ${unmatchedAttacksRef.current}회`, ...result.evidence];
    }
    publishResult(result, frame.capturedAt);
  }), []);

  return null;
}
