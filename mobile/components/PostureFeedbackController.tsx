import { useEffect, useRef } from 'react';

import { subscribeLiveAnalysis } from '../services/analysis-stream';
import { publishLiveCoachFeedback } from '../services/live-coach-feedback';
import { getLivePracticeContext, subscribeLivePracticeContext } from '../services/practice-session-context';
import { analyzePostureWindow, type PostureFrameSample } from '../services/posture-feedback-engine';

export default function PostureFeedbackController() {
  const samplesRef = useRef<PostureFrameSample[]>([]);
  const lastPublishedAtRef = useRef(new Map<string, number>());

  useEffect(() => subscribeLivePracticeContext(() => {
    samplesRef.current = [];
    lastPublishedAtRef.current.clear();
  }), []);

  useEffect(() => subscribeLiveAnalysis((frame) => {
    if (frame.kind !== 'pose') return;
    const context = getLivePracticeContext();
    if (!context?.active) return;

    samplesRef.current.push({ capturedAt: frame.capturedAt, result: frame.result });
    while (
      samplesRef.current.length > 48
      || (samplesRef.current[0] && frame.capturedAt - samplesRef.current[0].capturedAt > 4_000)
    ) samplesRef.current.shift();

    analyzePostureWindow(samplesRef.current).forEach((item) => {
      const previousAt = lastPublishedAtRef.current.get(item.id) ?? 0;
      const interval = item.status === 'success' ? 1_600 : 650;
      if (frame.capturedAt - previousAt < interval) return;
      lastPublishedAtRef.current.set(item.id, frame.capturedAt);
      publishLiveCoachFeedback({
        id: item.id,
        capturedAt: frame.capturedAt,
        status: item.status,
        category: context.category,
        title: item.title,
        instruction: item.instruction,
        evidence: item.evidence,
        nextGoal: item.nextGoal,
        confidencePercent: item.confidencePercent,
        stableCount: item.stableCount,
        priority: item.priority,
        measurements: item.measurements,
      });
    });
  }), []);

  return null;
}
