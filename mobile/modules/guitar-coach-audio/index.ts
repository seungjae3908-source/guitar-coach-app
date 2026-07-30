import { requireOptionalNativeModule } from 'expo';

import { publishLiveAnalysisFrame } from '../../services/analysis-stream';

export type NativeAudioStartResult = {
  started: boolean;
  sampleRate: number;
  referenceA4: number;
  inputSource: 'UNPROCESSED' | 'DEFAULT' | 'UNKNOWN' | string;
  automaticGainControlLikely: boolean;
};

export type NativeAudioReading = {
  timestampMs: number;
  frequencyHz: number;
  pitchConfidence: number;
  rms: number;
  peakAmplitude: number;
  noiseFloor: number;
  signalToNoiseDb: number;
  clippingRatio: number;
  zeroCrossingRate: number;
  spectralCentroidHz: number;
  brightnessRatio: number;
  spectralFlatness: number;
  attackCount: number;
  lastAttackAtMs: number;
  attackIntervalMs: number;
  attackStrength: number;
  millisecondsSinceAttack: number;
  envelopeRatio: number;
  sampleCount: number;
  referenceA4: number;
  hasPitch: boolean;
  inputSource: 'UNPROCESSED' | 'DEFAULT' | 'UNKNOWN' | string;
  automaticGainControlLikely: boolean;
  running: boolean;
};

type GuitarCoachAudioModule = {
  androidAudioAnalysisAvailable: boolean;
  startAudioAnalysisAsync(referenceA4: number): Promise<NativeAudioStartResult>;
  updateAudioReferenceAsync(referenceA4: number): Promise<void>;
  getLatestAudioReadingAsync(): Promise<NativeAudioReading>;
  stopAudioAnalysisAsync(): Promise<void>;
};

const NativeModule = requireOptionalNativeModule<GuitarCoachAudioModule>('GuitarCoachAudio');

export const isNativeAudioAnalysisAvailable = Boolean(NativeModule?.androidAudioAnalysisAvailable);

export async function startNativeAudioAnalysisAsync(referenceA4 = 440) {
  if (!NativeModule) throw new Error('마이크 튜너 모듈을 사용할 수 없습니다.');
  return NativeModule.startAudioAnalysisAsync(referenceA4);
}

export async function updateNativeAudioReferenceAsync(referenceA4: number) {
  if (!NativeModule) throw new Error('마이크 튜너 모듈을 사용할 수 없습니다.');
  await NativeModule.updateAudioReferenceAsync(referenceA4);
}

export async function getLatestNativeAudioReadingAsync() {
  if (!NativeModule) throw new Error('마이크 튜너 모듈을 사용할 수 없습니다.');
  const result = await NativeModule.getLatestAudioReadingAsync();
  const readAt = Date.now();
  const attackAge = Number.isFinite(result.millisecondsSinceAttack)
    ? Math.max(0, Math.min(2_000, result.millisecondsSinceAttack))
    : 0;
  const capturedAt = result.lastAttackAtMs > 0 ? Math.round(readAt - attackAge) : readAt;
  publishLiveAnalysisFrame({
    kind: 'audio',
    capturedAt,
    result,
  });
  return result;
}

export async function stopNativeAudioAnalysisAsync() {
  if (!NativeModule) return;
  await NativeModule.stopAudioAnalysisAsync();
}
