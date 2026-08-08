import { requireOptionalNativeModule } from 'expo';

import { publishLiveAnalysisFrame } from '../../services/analysis-stream';

export type VoicePreparationResult = {
  ready: boolean;
  language: string;
  engine?: string;
  message?: string;
};

export type MetronomeSoundPreset = 0 | 1 | 2 | 3 | 4;

export type MetronomeTimingState = {
  running: boolean;
  bpm: number;
  beatsPerBar: number;
  subdivision: number;
  intervalMs: number;
  lastTickElapsedRealtimeMs: number;
  lastTickUptimeMs: number;
  nextTickUptimeMs: number;
  lastTickPulseIndex: number;
  nextPulseIndex: number;
  absolutePulseCount: number;
  elapsedRealtimeNowMs: number;
  uptimeNowMs: number;
  schedulerJitterLastMs?: number;
  schedulerJitterMaxMs?: number;
  schedulerJitterRmsMs?: number;
  voiceLeadMs?: number;
};

type GuitarCoachMetronomeModule = {
  androidMetronomeAvailable: boolean;
  prepareVoiceAsync(): Promise<VoicePreparationResult>;
  startAsync(
    bpm: number,
    beatsPerBar: number,
    subdivision: number,
    soundEnabled: boolean,
    voiceEnabled: boolean,
    soundPreset: MetronomeSoundPreset,
  ): Promise<void>;
  updateAsync(
    bpm: number,
    beatsPerBar: number,
    subdivision: number,
    soundEnabled: boolean,
    voiceEnabled: boolean,
    soundPreset: MetronomeSoundPreset,
  ): Promise<void>;
  getTimingStateAsync(): Promise<MetronomeTimingState>;
  stopAsync(): Promise<void>;
  previewVoiceAsync(subdivision: number): Promise<void>;
  previewSoundAsync(soundPreset: MetronomeSoundPreset): Promise<void>;
};

const NativeModule = requireOptionalNativeModule<GuitarCoachMetronomeModule>('GuitarCoachMetronome');

export const isAdvancedMetronomeAvailable = Boolean(NativeModule?.androidMetronomeAvailable);

export async function prepareVoiceCountAsync() {
  if (!NativeModule) throw new Error('음성 카운트 모듈을 사용할 수 없습니다.');
  return NativeModule.prepareVoiceAsync();
}

export async function startAdvancedMetronomeAsync(
  bpm: number,
  beatsPerBar: number,
  subdivision: number,
  soundEnabled: boolean,
  voiceEnabled: boolean,
  soundPreset: MetronomeSoundPreset = 0,
) {
  if (!NativeModule) throw new Error('고급 메트로놈 모듈을 사용할 수 없습니다.');
  await NativeModule.startAsync(bpm, beatsPerBar, subdivision, soundEnabled, voiceEnabled, soundPreset);
}

export async function updateAdvancedMetronomeAsync(
  bpm: number,
  beatsPerBar: number,
  subdivision: number,
  soundEnabled: boolean,
  voiceEnabled: boolean,
  soundPreset: MetronomeSoundPreset = 0,
) {
  if (!NativeModule) throw new Error('고급 메트로놈 모듈을 사용할 수 없습니다.');
  await NativeModule.updateAsync(bpm, beatsPerBar, subdivision, soundEnabled, voiceEnabled, soundPreset);
}

export async function getAdvancedMetronomeTimingStateAsync() {
  if (!NativeModule) throw new Error('고급 메트로놈 모듈을 사용할 수 없습니다.');
  const result = await NativeModule.getTimingStateAsync();
  publishLiveAnalysisFrame({
    kind: 'metronome',
    capturedAt: Date.now(),
    result,
  });
  return result;
}

export async function stopAdvancedMetronomeAsync() {
  if (!NativeModule) return;
  await NativeModule.stopAsync();
}

export async function previewVoiceCountAsync(subdivision: number) {
  if (!NativeModule) throw new Error('음성 카운트 모듈을 사용할 수 없습니다.');
  await NativeModule.previewVoiceAsync(subdivision);
}

export async function previewMetronomeSoundAsync(soundPreset: MetronomeSoundPreset) {
  if (!NativeModule) throw new Error('메트로놈 음원 모듈을 사용할 수 없습니다.');
  await NativeModule.previewSoundAsync(soundPreset);
}
