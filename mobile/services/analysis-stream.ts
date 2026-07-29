import type { HandAnalysisResult } from '../modules/guitar-coach-hand';
import type { NativeAudioReading } from '../modules/guitar-coach-audio';
import type { MetronomeTimingState } from '../modules/guitar-coach-metronome';
import type { PoseAnalysisResult } from '../modules/guitar-coach-native';

export type PoseAnalysisFrame = {
  kind: 'pose';
  capturedAt: number;
  result: PoseAnalysisResult;
};

export type HandAnalysisFrame = {
  kind: 'hand';
  capturedAt: number;
  result: HandAnalysisResult;
};

export type AudioAnalysisFrame = {
  kind: 'audio';
  capturedAt: number;
  result: NativeAudioReading;
};

export type MetronomeAnalysisFrame = {
  kind: 'metronome';
  capturedAt: number;
  result: MetronomeTimingState;
};

export type LiveAnalysisFrame =
  | PoseAnalysisFrame
  | HandAnalysisFrame
  | AudioAnalysisFrame
  | MetronomeAnalysisFrame;
export type LiveAnalysisListener = (frame: LiveAnalysisFrame) => void;

const listeners = new Set<LiveAnalysisListener>();
let latestPoseFrame: PoseAnalysisFrame | null = null;
let latestHandFrame: HandAnalysisFrame | null = null;
let latestAudioFrame: AudioAnalysisFrame | null = null;
let latestMetronomeFrame: MetronomeAnalysisFrame | null = null;

export function publishLiveAnalysisFrame(frame: LiveAnalysisFrame) {
  if (frame.kind === 'pose') latestPoseFrame = frame;
  else if (frame.kind === 'hand') latestHandFrame = frame;
  else if (frame.kind === 'audio') latestAudioFrame = frame;
  else latestMetronomeFrame = frame;

  listeners.forEach((listener) => {
    try {
      listener(frame);
    } catch {
      // 한 화면의 구독 오류가 카메라·마이크·메트로놈 분석 자체를 중단하지 않게 합니다.
    }
  });
}

export function subscribeLiveAnalysis(listener: LiveAnalysisListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLatestLiveAnalysisFrames() {
  return {
    pose: latestPoseFrame,
    hand: latestHandFrame,
    audio: latestAudioFrame,
    metronome: latestMetronomeFrame,
  };
}

export function clearLatestLiveAnalysisFrames() {
  latestPoseFrame = null;
  latestHandFrame = null;
  latestAudioFrame = null;
  latestMetronomeFrame = null;
}
