import { requireOptionalNativeModule } from 'expo';

export type AudioChordSegment = {
  startSeconds: number;
  endSeconds: number;
  chord: string;
  confidence: number;
};

export type AudioFileAnalysisResult = {
  durationSeconds: number;
  sourceSampleRate: number;
  sourceChannels: number;
  analyzedSampleRate: number;
  bpm: number;
  bpmConfidence: number;
  key: string;
  keyConfidence: number;
  chords: AudioChordSegment[];
  notes: string[];
};

type GuitarCoachAudioFileModule = {
  androidAudioFileAnalysisAvailable: boolean;
  analyzeAudioFileAsync(uri: string, maxSeconds: number): Promise<AudioFileAnalysisResult>;
};

const NativeModule = requireOptionalNativeModule<GuitarCoachAudioFileModule>('GuitarCoachAudioFile');

export const isAudioFileAnalysisAvailable = Boolean(NativeModule?.androidAudioFileAnalysisAvailable);

export async function analyzeLocalAudioFileAsync(uri: string, maxSeconds = 120) {
  if (!NativeModule) throw new Error('로컬 음원 분석 모듈이 APK에 없습니다.');
  return NativeModule.analyzeAudioFileAsync(uri, Math.min(120, Math.max(10, Math.round(maxSeconds))));
}
