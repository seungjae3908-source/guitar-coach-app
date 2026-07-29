import { useEffect, useRef } from 'react';

import {
  getCoachSpeechStatusAsync,
  isCoachSpeechAvailable,
  prepareCoachSpeechAsync,
  speakCoachPhraseAsync,
} from '../modules/guitar-coach-speech';
import { subscribeLiveAnalysis } from '../services/analysis-stream';
import {
  getLatestLiveCoachFeedback,
  publishLiveCoachFeedback,
} from '../services/live-coach-feedback';
import {
  getLivePracticeContext,
  subscribeLivePracticeContext,
} from '../services/practice-session-context';
import {
  addLiveSoundReading,
  resetLiveSoundConsistency,
  SoundConsistencySnapshot,
} from '../services/sound-consistency-engine';

const MIN_PUBLISH_GAP_MS = 2_800;
const MIN_SPEAK_GAP_MS = 8_500;
const SAME_ISSUE_GAP_MS = 16_000;

function measurements(snapshot: SoundConsistencySnapshot) {
  return [
    snapshot.score == null ? null : { label: '톤 일관성', value: `${snapshot.score}점` },
    snapshot.volumeVariationPercent == null ? null : { label: '음량 편차', value: `${snapshot.volumeVariationPercent}%` },
    snapshot.brightnessVariationPercent == null ? null : { label: '밝기 편차', value: `${snapshot.brightnessVariationPercent}%` },
    snapshot.sustainVariationPercent == null ? null : { label: '서스테인', value: `${snapshot.sustainVariationPercent}%` },
    snapshot.pitchVariationCents == null ? null : { label: '음정 흔들림', value: `${snapshot.pitchVariationCents}¢` },
    snapshot.averageSignalToNoiseDb == null ? null : { label: '신호대잡음', value: `${snapshot.averageSignalToNoiseDb}dB` },
  ].filter((value): value is { label: string; value: string } => value != null).slice(0, 4);
}

function shouldCoach(snapshot: SoundConsistencySnapshot) {
  return snapshot.judgeable
    && snapshot.confidencePercent >= 58
    && snapshot.mainIssue != null
    && snapshot.mainIssue !== 'stable';
}

export default function SoundConsistencyController({ enabled }: { enabled: boolean }) {
  const preparedRef = useRef(false);
  const preparingRef = useRef(false);
  const lastPublishedAtRef = useRef(0);
  const lastSpokenAtRef = useRef(0);
  const lastIssueRef = useRef('');
  const lastIssueSpokenAtRef = useRef(0);
  const persistenceRef = useRef<{ issue: string; count: number }>({ issue: '', count: 0 });

  useEffect(() => {
    if (!enabled || !isCoachSpeechAvailable || preparedRef.current || preparingRef.current) return;
    preparingRef.current = true;
    void prepareCoachSpeechAsync()
      .then(() => {
        preparedRef.current = true;
      })
      .catch(() => {
        preparedRef.current = false;
      })
      .finally(() => {
        preparingRef.current = false;
      });
  }, [enabled]);

  useEffect(() => subscribeLivePracticeContext((context) => {
    if (context?.active) {
      resetLiveSoundConsistency();
      lastPublishedAtRef.current = 0;
      persistenceRef.current = { issue: '', count: 0 };
    }
  }), []);

  useEffect(() => subscribeLiveAnalysis((frame) => {
    if (frame.kind !== 'audio') return;
    const context = getLivePracticeContext();
    if (!context?.active || !context.microphoneEnabled) return;

    const snapshot = addLiveSoundReading(frame.result, frame.capturedAt);
    const issue = snapshot.mainIssue ?? '';
    if (issue && issue === persistenceRef.current.issue) {
      persistenceRef.current.count = Math.min(20, persistenceRef.current.count + 1);
    } else {
      persistenceRef.current = { issue, count: issue ? 1 : 0 };
    }

    if (!shouldCoach(snapshot) || persistenceRef.current.count < 3) return;
    const now = frame.capturedAt;
    const latest = getLatestLiveCoachFeedback();
    const urgentVisualCoach = latest
      && now - latest.capturedAt < 2_400
      && latest.priority >= 9
      && !latest.id.startsWith('sound-');

    if (!urgentVisualCoach && now - lastPublishedAtRef.current >= MIN_PUBLISH_GAP_MS) {
      publishLiveCoachFeedback({
        id: `sound-${snapshot.mainIssue}`,
        capturedAt: now,
        status: snapshot.mainIssue === 'clipping' || snapshot.mainIssue === 'low-snr' ? 'warning' : 'correction',
        category: context.category,
        title: snapshot.title,
        instruction: snapshot.instruction,
        evidence: snapshot.evidence,
        nextGoal: snapshot.mode === 'same-note'
          ? `${snapshot.noteLabel ?? '같은 음'}을 같은 위치와 힘으로 4회 더 반복하세요.`
          : '같은 짧은 패턴을 같은 탄현 위치와 힘으로 6회 더 반복하세요.',
        confidencePercent: snapshot.confidencePercent,
        stableCount: 0,
        priority: snapshot.mainIssue === 'clipping' ? 10 : snapshot.mainIssue === 'pitch-variation' ? 9 : 8,
        measurements: measurements(snapshot),
      });
      lastPublishedAtRef.current = now;
    }

    if (!enabled || !preparedRef.current || now - lastSpokenAtRef.current < MIN_SPEAK_GAP_MS) return;
    if (issue === lastIssueRef.current && now - lastIssueSpokenAtRef.current < SAME_ISSUE_GAP_MS) return;

    void getCoachSpeechStatusAsync()
      .then((status) => {
        if (status.speaking) return;
        return speakCoachPhraseAsync(`${snapshot.title}. ${snapshot.instruction}`, {
          interrupt: false,
          speechRate: 1.02,
        });
      })
      .then((result) => {
        if (!result) return;
        lastSpokenAtRef.current = Date.now();
        lastIssueRef.current = issue;
        lastIssueSpokenAtRef.current = Date.now();
      })
      .catch(() => {
        preparedRef.current = false;
      });
  }), [enabled]);

  return null;
}
