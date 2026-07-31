import { useEffect, useRef } from 'react';

import type { HandAnalysisResult, HandLandmarkPoint } from '../modules/guitar-coach-hand';
import { subscribeLiveAnalysis } from '../services/analysis-stream';
import { publishLiveCoachFeedback } from '../services/live-coach-feedback';
import {
  getLivePracticeContext,
  subscribeLivePracticeContext,
} from '../services/practice-session-context';
import {
  analyzeRightHandTechniqueWindow,
  type RightHandFingerId,
  type RightHandFingerSample,
  type RightHandTechniqueSample,
} from '../services/right-hand-technique-engine';
import { analyzeRightHandStringRoles } from '../services/right-hand-string-role-engine';
import { RightHandMotionTracker } from '../services/right-hand-motion-tracker';
import {
  analyzeTechniqueWindow,
  type TechniqueFrameSample,
  type TechniqueHitSample,
} from '../services/technique-analysis-engine';

const RIGHT_HAND_CATEGORIES = new Set([
  'arpeggio',
  'fingerstyle',
  'strumming',
  'downPicking',
  'alternatePicking',
  'palmMute',
]);

const distance = (left: { x: number; y: number }, right: { x: number; y: number }) => (
  Math.hypot(left.x - right.x, left.y - right.y)
);

function angleDegrees(
  first: { x: number; y: number },
  center: { x: number; y: number },
  third: { x: number; y: number },
) {
  const ax = first.x - center.x;
  const ay = first.y - center.y;
  const bx = third.x - center.x;
  const by = third.y - center.y;
  const denominator = Math.max(0.000001, Math.hypot(ax, ay) * Math.hypot(bx, by));
  const cosine = Math.min(1, Math.max(-1, (ax * bx + ay * by) / denominator));
  return Math.acos(cosine) * 180 / Math.PI;
}

type ContinuousHandResult = HandAnalysisResult & {
  continuous?: {
    newHits?: Array<{
      capturedAt: number;
      contactId: string;
      label: string;
      visualIndex: number;
      stringNumber: number;
      direction: string;
      confidence: number;
    }>;
  };
};

function fingerSample(
  points: Map<string, HandLandmarkPoint>,
  palmSize: number,
  names: { base: string; pip: string; dip: string; tip: string },
): RightHandFingerSample | null {
  const base = points.get(names.base);
  const pip = points.get(names.pip);
  const dip = points.get(names.dip);
  const tip = points.get(names.tip);
  if (!base || !pip || !dip || !tip) return null;
  return {
    tip: { x: tip.x, y: tip.y },
    base: { x: base.x, y: base.y },
    pip: { x: pip.x, y: pip.y },
    jointAngle: angleDegrees(base, pip, dip),
    reach: distance(tip, base) / Math.max(0.001, palmSize),
  };
}

function toRightHandSample(
  result: ContinuousHandResult,
  capturedAt: number,
): RightHandTechniqueSample | null {
  const context = getLivePracticeContext();
  if (!context?.active || !RIGHT_HAND_CATEGORIES.has(context.category)) return null;
  const points = new Map(result.landmarks.map((point) => [point.name, point]));
  const wrist = points.get('wrist');
  const middleMcp = points.get('middleMcp');
  if (!result.hasHand || !wrist || !middleMcp) return null;
  const palmSize = distance(wrist, middleMcp);

  const specifications: Record<RightHandFingerId, { base: string; pip: string; dip: string; tip: string }> = {
    thumb: { base: 'thumbCmc', pip: 'thumbMcp', dip: 'thumbIp', tip: 'thumbTip' },
    index: { base: 'indexMcp', pip: 'indexPip', dip: 'indexDip', tip: 'indexTip' },
    middle: { base: 'middleMcp', pip: 'middlePip', dip: 'middleDip', tip: 'middleTip' },
    ring: { base: 'ringMcp', pip: 'ringPip', dip: 'ringDip', tip: 'ringTip' },
    pinky: { base: 'pinkyMcp', pip: 'pinkyPip', dip: 'pinkyDip', tip: 'pinkyTip' },
  };
  const fingers = Object.fromEntries(
    (Object.keys(specifications) as RightHandFingerId[]).map((finger) => [
      finger,
      fingerSample(points, palmSize, specifications[finger]),
    ]),
  ) as Record<RightHandFingerId, RightHandFingerSample | null>;
  if (Object.values(fingers).some((finger) => !finger)) return null;

  return {
    capturedAt,
    category: context.category,
    pattern: context.pattern,
    handConfidence: result.handednessScore,
    wristConfidence: Math.min(
      1,
      result.handednessScore
        * Math.min(1, Math.min(wrist.x, 1 - wrist.x, wrist.y, 1 - wrist.y) / 0.07)
        * Math.min(1, palmSize / 0.16),
    ),
    palmSize,
    wrist: { x: wrist.x, y: wrist.y },
    palmAngle: Math.atan2(middleMcp.y - wrist.y, middleMcp.x - wrist.x) * 180 / Math.PI,
    pick: {
      detected: result.pick.detected,
      confidence: result.pick.confidence,
      angleDegrees: result.pick.angleDegrees,
      exposure: result.pick.exposure,
      center: { x: result.pick.centerX, y: result.pick.centerY },
    },
    stringAngle: result.stringTracking?.detected ? result.stringTracking.angleDegrees : null,
    stringConfidence: result.stringTracking?.confidence ?? 0,
    stringStability: result.stringTracking?.stabilityConfidence ?? 0,
    visibleStringCount: result.stringTracking?.visibleLineCount ?? 0,
    fingers: fingers as Record<RightHandFingerId, RightHandFingerSample>,
    contacts: (result.stringTracking?.contacts ?? []).map((contact) => ({
      id: contact.id,
      visualIndex: contact.visualIndex,
      stringNumber: contact.stringNumber,
      distanceRatio: contact.distanceRatio,
      confidence: contact.confidence,
    })),
    hits: (result.continuous?.newHits ?? []).map((hit) => ({
      capturedAt: hit.capturedAt,
      contactId: hit.contactId,
      visualIndex: hit.visualIndex,
      stringNumber: hit.stringNumber,
      direction: hit.direction,
      confidence: hit.confidence,
    })),
  };
}

function toGenericTechniqueSample(
  result: ContinuousHandResult,
  capturedAt: number,
): TechniqueFrameSample | null {
  const context = getLivePracticeContext();
  if (!context?.active || RIGHT_HAND_CATEGORIES.has(context.category)) return null;

  const points = new Map(result.landmarks.map((point) => [point.name, point]));
  const wrist = points.get('wrist');
  const middleMcp = points.get('middleMcp');
  const thumbCmc = points.get('thumbCmc');
  const thumbTip = points.get('thumbTip');
  const indexMcp = points.get('indexMcp');
  const indexTip = points.get('indexTip');
  const middleTip = points.get('middleTip');
  const ringMcp = points.get('ringMcp');
  const ringTip = points.get('ringTip');
  const pinkyMcp = points.get('pinkyMcp');
  const pinkyTip = points.get('pinkyTip');
  const required = [
    wrist, middleMcp, thumbCmc, thumbTip, indexMcp, indexTip,
    middleTip, ringMcp, ringTip, pinkyMcp, pinkyTip,
  ];

  if (!result.hasHand || required.some((point) => !point)) {
    return {
      capturedAt,
      category: context.category,
      handConfidence: result.handednessScore,
      palmSize: 0,
      wristAngle: 0,
      wristX: 0,
      wristY: 0,
      pickDetected: result.pick.detected,
      pickConfidence: result.pick.confidence,
      pickExposure: result.pick.exposure,
      fingerExtension: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 },
      stringConfidence: 0,
      stringStability: 0,
      visibleStringCount: 0,
      hits: [],
    };
  }

  const safeWrist = wrist!;
  const safeMiddleMcp = middleMcp!;
  const palmSize = distance(safeWrist, safeMiddleMcp);
  const safePalm = Math.max(0.001, palmSize);
  const hits: TechniqueHitSample[] = (result.continuous?.newHits ?? []).map((hit) => ({
    capturedAt: hit.capturedAt,
    contactId: hit.contactId,
    label: hit.label,
    visualIndex: hit.visualIndex,
    stringNumber: hit.stringNumber,
    direction: hit.direction,
    confidence: hit.confidence,
  }));

  return {
    capturedAt,
    category: context.category,
    handConfidence: result.handednessScore,
    palmSize,
    wristAngle: Math.atan2(safeMiddleMcp.y - safeWrist.y, safeMiddleMcp.x - safeWrist.x) * 180 / Math.PI,
    wristX: safeWrist.x,
    wristY: safeWrist.y,
    pickDetected: result.pick.detected,
    pickConfidence: result.pick.confidence,
    pickExposure: result.pick.exposure,
    fingerExtension: {
      thumb: distance(thumbTip!, thumbCmc!) / safePalm,
      index: distance(indexTip!, indexMcp!) / safePalm,
      middle: distance(middleTip!, safeMiddleMcp) / safePalm,
      ring: distance(ringTip!, ringMcp!) / safePalm,
      pinky: distance(pinkyTip!, pinkyMcp!) / safePalm,
    },
    stringConfidence: 0,
    stringStability: 0,
    visibleStringCount: 0,
    hits,
  };
}

export default function TechniqueFeedbackController() {
  const genericSamplesRef = useRef<TechniqueFrameSample[]>([]);
  const rightHandSamplesRef = useRef<RightHandTechniqueSample[]>([]);
  const lastPublishedAtRef = useRef(new Map<string, number>());
  const motionTrackerRef = useRef(new RightHandMotionTracker());

  useEffect(() => subscribeLivePracticeContext(() => {
    genericSamplesRef.current = [];
    rightHandSamplesRef.current = [];
    lastPublishedAtRef.current.clear();
    motionTrackerRef.current.reset();
  }), []);

  useEffect(() => subscribeLiveAnalysis((frame) => {
    if (frame.kind !== 'hand') return;
    const context = getLivePracticeContext();
    if (!context?.active) return;
    const rawResult = frame.result as ContinuousHandResult;
    const inferredHits = RIGHT_HAND_CATEGORIES.has(context.category)
      ? motionTrackerRef.current.update(rawResult, frame.capturedAt, context.category)
      : [];
    const result: ContinuousHandResult = inferredHits.length
      ? {
          ...rawResult,
          continuous: {
            ...rawResult.continuous,
            newHits: [...(rawResult.continuous?.newHits ?? []), ...inferredHits],
          },
        }
      : rawResult;

    const rightHandSample = toRightHandSample(result, frame.capturedAt);
    if (rightHandSample) {
      rightHandSamplesRef.current.push(rightHandSample);
      while (
        rightHandSamplesRef.current.length > 90
        || (rightHandSamplesRef.current[0] && frame.capturedAt - rightHandSamplesRef.current[0].capturedAt > 4_000)
      ) rightHandSamplesRef.current.shift();

      const rightHandFeedback = [
        ...analyzeRightHandTechniqueWindow(rightHandSamplesRef.current),
        ...analyzeRightHandStringRoles(rightHandSamplesRef.current),
      ];
      const uniqueFeedback = [...new Map(rightHandFeedback.map((item) => [item.id, item])).values()];
      uniqueFeedback.forEach((issue) => {
        const previousAt = lastPublishedAtRef.current.get(issue.id) ?? 0;
        const interval = issue.status === 'success' ? 1_500 : 550;
        if (frame.capturedAt - previousAt < interval) return;
        lastPublishedAtRef.current.set(issue.id, frame.capturedAt);
        publishLiveCoachFeedback({
          id: issue.id,
          capturedAt: frame.capturedAt,
          status: issue.status,
          category: context.category,
          title: issue.title,
          instruction: issue.instruction,
          evidence: issue.evidence,
          nextGoal: issue.nextGoal,
          confidencePercent: issue.confidencePercent,
          stableCount: issue.status === 'success' ? 1 : 0,
          priority: issue.priority,
          measurements: issue.measurements,
        });
      });
      return;
    }

    const genericSample = toGenericTechniqueSample(result, frame.capturedAt);
    if (!genericSample) return;
    genericSamplesRef.current.push(genericSample);
    while (
      genericSamplesRef.current.length > 48
      || (genericSamplesRef.current[0] && frame.capturedAt - genericSamplesRef.current[0].capturedAt > 4_000)
    ) genericSamplesRef.current.shift();

    analyzeTechniqueWindow(genericSamplesRef.current).forEach((issue) => {
      const previousAt = lastPublishedAtRef.current.get(issue.id) ?? 0;
      if (frame.capturedAt - previousAt < 550) return;
      lastPublishedAtRef.current.set(issue.id, frame.capturedAt);
      publishLiveCoachFeedback({
        id: issue.id,
        capturedAt: frame.capturedAt,
        status: issue.status,
        category: context.category,
        title: issue.title,
        instruction: issue.instruction,
        evidence: issue.evidence,
        nextGoal: issue.nextGoal,
        confidencePercent: issue.confidencePercent,
        stableCount: 0,
        priority: issue.priority,
        measurements: issue.measurements,
      });
    });
  }), []);

  return null;
}
