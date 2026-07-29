import { requireOptionalNativeModule } from 'expo';

export type VoicePreparationResult = {
  ready: boolean;
  language: string;
  engine?: string;
  message?: string;
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
  ): Promise<void>;
  updateAsync(
    bpm: number,
    beatsPerBar: number,
    subdivision: number,
    soundEnabled: boolean,
    voiceEnabled: boolean,
  ): Promise<void>;
  stopAsync(): Promise<void>;
  previewVoiceAsync(subdivision: number): Promise<void>;
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
) {
  if (!NativeModule) throw new Error('고급 메트로놈 모듈을 사용할 수 없습니다.');
  await NativeModule.startAsync(bpm, beatsPerBar, subdivision, soundEnabled, voiceEnabled);
}

export async function updateAdvancedMetronomeAsync(
  bpm: number,
  beatsPerBar: number,
  subdivision: number,
  soundEnabled: boolean,
  voiceEnabled: boolean,
) {
  if (!NativeModule) throw new Error('고급 메트로놈 모듈을 사용할 수 없습니다.');
  await NativeModule.updateAsync(bpm, beatsPerBar, subdivision, soundEnabled, voiceEnabled);
}

export async function stopAdvancedMetronomeAsync() {
  if (!NativeModule) return;
  await NativeModule.stopAsync();
}

export async function previewVoiceCountAsync(subdivision: number) {
  if (!NativeModule) throw new Error('음성 카운트 모듈을 사용할 수 없습니다.');
  await NativeModule.previewVoiceAsync(subdivision);
}
