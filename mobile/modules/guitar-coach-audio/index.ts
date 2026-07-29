import { requireOptionalNativeModule } from 'expo';

export type NativeAudioStartResult = {
  started: boolean;
  sampleRate: number;
  referenceA4: number;
};

export type NativeAudioReading = {
  timestampMs: number;
  frequencyHz: number;
  pitchConfidence: number;
  rms: number;
  noiseFloor: number;
  clippingRatio: number;
  attackCount: number;
  lastAttackAtMs: number;
  attackIntervalMs: number;
  attackStrength: number;
  sampleCount: number;
  referenceA4: number;
  hasPitch: boolean;
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
  return NativeModule.getLatestAudioReadingAsync();
}

export async function stopNativeAudioAnalysisAsync() {
  if (!NativeModule) return;
  await NativeModule.stopAudioAnalysisAsync();
}
