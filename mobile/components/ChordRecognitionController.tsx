import { useEffect, useRef } from 'react';

import { POWER_CHORD_TEMPLATES } from '../config/power-chord-templates';
import type { HandAnalysisResult } from '../modules/guitar-coach-hand';
import type { NativeAudioReading } from '../modules/guitar-coach-audio';
import { publishLiveAnalysisFrame, subscribeLiveAnalysis } from '../services/analysis-stream';
import { ChordTransitionTracker } from '../services/chord-transition-engine';
import {
  ChordRecognitionTracker,
  recognizeChord,
  type ChordAudioEvidence,
  type FretboardCalibration,
  type FrettingFingerObservation,
} from '../services/fretboard-chord-recognizer';
import { loadBestFretboardCalibration } from '../services/fretboard-calibration-store';
import { publishLiveCoachFeedback } from '../services/live-coach-feedback';
import {
  getLivePracticeContext,
  subscribeLivePracticeContext,
} from '../services/practice-session-context';
import LeftHandFingeringController from './LeftHandFingeringController';

const CHORD_CATEGORIES = new Set(['chords', 'powerChords']);

type AudioPitchSample = {
  capturedAt: number;
  pitchClass: number;
  confidence: number;
  signalToNoiseDb: number;
  clippingRatio: number;
};

function pitchClassFromFrequency(frequencyHz: number) {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) return null;
  const midi = Math.round(69 + 12 * Math.log2(frequencyHz / 440));
  return ((midi % 12) + 12) % 12;
}

function fingerObservations(result: HandAnalysisResult): FrettingFingerObservation[] {
  const points = new Map(result.landmarks.map((point) => [point.name, point]));
  const confidence = Math.max(0, Math.min(1, result.handednessScore));
  return [
    { finger: 'index' as const, point: points.get('indexTip') },
    { finger: 'middle' as const, point: points.get('middleTip') },
    { finger: 'ring' as const, point: points.get('ringTip') },
    { finger: 'pinky' as const, point: points.get('pinkyTip') },
  ].flatMap((entry) => entry.point ? [{
    finger: entry.finger,
    tip: { x: entry.point.x, y: entry.point.y },
    confidence,
  }] : []);
}

function buildAudioEvidence(samples: AudioPitchSample[], now: number): ChordAudioEvidence | null {
  const recent = samples.filter((sample) => now - sample.capturedAt <= 950);
  const strong = recent.filter((sample) => (
    sample.confidence >= 0.52
    && sample.signalToNoiseDb >= 10
    && sample.clippingRatio < 0.03
  ));
  const pitchClasses = [...new Set(strong.map((sample) => sample.pitchClass))];
  if (pitchClasses.length < 2) return null;
  return {
    pitchClasses,
    confidence: strong.reduce((sum, sample) => sum + sample.confidence, 0) / strong.length,
    signalToNoiseDb: strong.reduce((sum, sample) => sum + sample.signalToNoiseDb, 0) / strong.length,
    clippingRatio: strong.reduce((sum, sample) => sum + sample.clippingRatio, 0) / strong.length,
  };
}

export default function ChordRecognitionController() {
  const calibrationRef = useRef<FretboardCalibration | null>(null);
  const calibrationLoadingRef = useRef(false);
  const audioSamplesRef = useRef<AudioPitchSample[]>([]);
  const trackerRef = useRef(new ChordRecognitionTracker());
  const transitionTrackerRef = useRef(new ChordTransitionTracker());
  const lastPublishedAtRef = useRef(0);
  const lastSignatureRef = useRef('');

  const reloadCalibration = async () => {
    const context = getLivePracticeContext();
    if (!context?.active || !CHORD_CATEGORIES.has(context.category) || calibrationLoadingRef.current) {
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

  useEffect(() => subscribeLivePracticeContext(() => {
    trackerRef.current.reset();
    transitionTrackerRef.current.reset();
    audioSamplesRef.current = [];
    lastPublishedAtRef.current = 0;
    lastSignatureRef.current = '';
    void reloadCalibration();
  }), []);

  useEffect(() => subscribeLiveAnalysis((frame) => {
    const context = getLivePracticeContext();
    if (!context?.active || !CHORD_CATEGORIES.has(context.category)) return;

    if (frame.kind === 'audio') {
      const audio = frame.result as NativeAudioReading;
      const pitchClass = audio.hasPitch ? pitchClassFromFrequency(audio.frequencyHz) : null;
      if (
        pitchClass != null
        && audio.pitchConfidence >= 0.42
        && audio.signalToNoiseDb >= 8
        && audio.clippingRatio < 0.05
        && audio.millisecondsSinceAttack <= 900
      ) {
        audioSamplesRef.current.push({
          capturedAt: frame.capturedAt,
          pitchClass,
          confidence: audio.pitchConfidence,
          signalToNoiseDb: audio.signalToNoiseDb,
          clippingRatio: audio.clippingRatio,
        });
      }
      audioSamplesRef.current = audioSamplesRef.current
        .filter((sample) => frame.capturedAt - sample.capturedAt <= 1_200)
        .slice(-20);
      return;
    }

    if (frame.kind !== 'hand') return;
    const hand = frame.result as HandAnalysisResult;
    if (!hand.hasHand || hand.landmarks.length < 21) return;
    if (!calibrationRef.current && !calibrationLoadingRef.current) void reloadCalibration();

    const audio = buildAudioEvidence(audioSamplesRef.current, frame.capturedAt);
    const templates = context.category === 'powerChords' ? POWER_CHORD_TEMPLATES : undefined;
    const result = trackerRef.current.process(
      recognizeChord(
        fingerObservations(hand),
        calibrationRef.current,
        audio,
        templates,
      ),
      frame.capturedAt,
    );

    publishLiveAnalysisFrame({
      kind: 'chord',
      capturedAt: frame.capturedAt,
      result,
    });

    const transition = transitionTrackerRef.current.process(result, context.pattern, frame.capturedAt);
    if (transition && transition.status !== 'waiting') {
      publishLiveCoachFeedback({
        id: `chord-transition-${transition.fromChord}-${transition.toChord}`,
        capturedAt: frame.capturedAt,
        status: transition.status === 'success' ? 'success' : 'correction',
        category: context.category,
        title: transition.title,
        instruction: transition.instruction,
        evidence: transition.evidence,
        nextGoal: transition.nextGoal,
        confidencePercent: transition.confidencePercent,
        stableCount: transition.status === 'success' ? 3 : 0,
        priority: transition.status === 'success' ? 7 : 14,
        measurements: transition.transitionMs == null
          ? []
          : [{ label: '전환 시간', value: `${transition.transitionMs}ms` }],
      });
    }

    const signature = `${result.status}:${result.chordName ?? 'none'}:${result.score ?? 'none'}:${result.corrections.join('|')}`;
    const interval = result.status === 'confirmed' ? 1_250 : 700;
    if (signature === lastSignatureRef.current && frame.capturedAt - lastPublishedAtRef.current < interval) return;
    lastSignatureRef.current = signature;
    lastPublishedAtRef.current = frame.capturedAt;

    if (result.status === 'cannot-judge') {
      publishLiveCoachFeedback({
        id: 'chord-recognition-unavailable',
        capturedAt: frame.capturedAt,
        status: 'cannot-judge',
        category: context.category,
        title: '코드 이름 정밀 판정 불가',
        instruction: result.corrections[0] ?? '왼손과 지판이 모두 보이도록 촬영 위치를 맞추세요.',
        evidence: result.evidence.join(' · '),
        nextGoal: '지판 보정 후 같은 코드를 1초 유지하고 한 번 스트럼하세요.',
        confidencePercent: result.confidencePercent,
        stableCount: 0,
        priority: 13,
        measurements: result.positions.map((position) => ({
          label: position.finger,
          value: `${position.stringNumber}번 줄 ${position.fret}프렛`,
        })),
      });
      return;
    }

    const confirmed = result.status === 'confirmed';
    publishLiveCoachFeedback({
      id: `chord-recognition-${result.chordName ?? 'candidate'}`,
      capturedAt: frame.capturedAt,
      status: confirmed ? 'success' : 'correction',
      category: context.category,
      title: confirmed
        ? `${result.chordName} 코드 확인${result.score != null ? ` · ${result.score}점` : ''}`
        : `영상 코드 후보 · ${result.chordName}`,
      instruction: result.corrections[0]
        ?? (confirmed ? '현재 손가락 위치와 힘을 유지하세요.' : '코드를 유지하고 한 번 스트럼해 오픈현·뮤트현을 확인하세요.'),
      evidence: result.evidence.join(' · '),
      nextGoal: result.corrections[1]
        ?? (confirmed ? '같은 코드가 깨끗하게 울리도록 3회 반복하세요.' : '같은 손 모양을 3프레임 이상 유지하세요.'),
      confidencePercent: result.confidencePercent,
      stableCount: confirmed ? 3 : 1,
      priority: confirmed ? 8 : 12,
      measurements: [
        { label: '코드', value: result.chordName ?? '-' },
        { label: '점수', value: result.score == null ? '소리 확인 전' : `${result.score}` },
        ...result.positions.slice(0, 4).map((position) => ({
          label: position.finger,
          value: `${position.stringNumber}번·${position.fret}프렛`,
        })),
      ],
    });
  }), []);

  return <LeftHandFingeringController />;
}
