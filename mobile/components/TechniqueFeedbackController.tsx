import { useEffect, useRef } from 'react';

import type { HandAnalysisResult } from '../modules/guitar-coach-hand';
import { subscribeLiveAnalysis } from '../services/analysis-stream';
import { publishLiveCoachFeedback } from '../services/live-coach-feedback';
import {
  getLivePracticeContext,
  subscribeLivePracticeContext,
} from '../services/practice-session-context';
import {
  analyzeTechniqueWindow,
  type TechniqueFrameSample,
  type TechniqueHitSample,
} from '../services/technique-analysis-engine';

const distance = (left: { x: number; y: number }, right: { x: number; y: number }) => (
  Math.hypot(left.x - right.x, left.y - right.y)
);

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

function toTechniqueSample(
  result: ContinuousHandResult,
  capturedAt: number,
): TechniqueFrameSample | null {
  const context = getLivePracticeContext();
  if (!context?.active) return null;

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
    wrist,
    middleMcp,
    thumbCmc,
    thumbTip,
    indexMcp,
    indexTip,
    middleTip,
    ringMcp,
    ringTip,
    pinkyMcp,
    pinkyTip,
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
      stringConfidence: result.stringTracking?.confidence ?? 0,
      stringStability: result.stringTracking?.stabilityConfidence ?? 0,
      visibleStringCount: result.stringTracking?.visibleLineCount ?? 0,
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
    stringConfidence: result.stringTracking?.confidence ?? 0,
    stringStability: result.stringTracking?.stabilityConfidence ?? 0,
    visibleStringCount: result.stringTracking?.visibleLineCount ?? 0,
    hits,
  };
}

export default function TechniqueFeedbackController() {
  const samplesRef = useRef<TechniqueFrameSample[]>([]);
  const lastPublishedAtRef = useRef(new Map<string, number>());

  useEffect(() => subscribeLivePracticeContext(() => {
    samplesRef.current = [];
    lastPublishedAtRef.current.clear();
  }), []);

  useEffect(() => subscribeLiveAnalysis((frame) => {
    if (frame.kind !== 'hand') return;
    const context = getLivePracticeContext();
    if (!context?.active) return;

    const sample = toTechniqueSample(frame.result as ContinuousHandResult, frame.capturedAt);
    if (!sample) return;
    samplesRef.current.push(sample);
    while (
      samplesRef.current.length > 48
      || (samplesRef.current[0] && frame.capturedAt - samplesRef.current[0].capturedAt > 4_000)
    ) {
      samplesRef.current.shift();
    }

    const issues = analyzeTechniqueWindow(samplesRef.current);
    issues.forEach((issue) => {
      const previousAt = lastPublishedAtRef.current.get(issue.id) ?? 0;
      if (frame.capturedAt - previousAt < 450) return;
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
