import { requireOptionalNativeModule } from 'expo';

export type CoachSpeechPreparation = {
  ready: boolean;
  language: string;
  message?: string;
};

export type CoachSpeechResult = {
  spoken: boolean;
  phrase: string;
  language: string;
  spokenAtMs: number;
};

export type CoachSpeechStatus = {
  ready: boolean;
  initializing: boolean;
  language: string;
  speaking: boolean;
  lastPhrase: string;
  lastSpokenAtMs: number;
};

type GuitarCoachSpeechModule = {
  androidCoachSpeechAvailable: boolean;
  prepareAsync(): Promise<CoachSpeechPreparation>;
  speakAsync(
    phrase: string,
    interrupt: boolean,
    speechRate: number,
    pitch: number,
  ): Promise<CoachSpeechResult>;
  stopAsync(): Promise<void>;
  getStatusAsync(): Promise<CoachSpeechStatus>;
};

const NativeModule = requireOptionalNativeModule<GuitarCoachSpeechModule>('GuitarCoachSpeech');

export const isCoachSpeechAvailable = Boolean(NativeModule?.androidCoachSpeechAvailable);

export async function prepareCoachSpeechAsync() {
  if (!NativeModule) throw new Error('사람 음성 코칭 모듈이 APK에 없습니다.');
  return NativeModule.prepareAsync();
}

export async function speakCoachPhraseAsync(
  phrase: string,
  options: { interrupt?: boolean; speechRate?: number; pitch?: number } = {},
) {
  if (!NativeModule) throw new Error('사람 음성 코칭 모듈이 APK에 없습니다.');
  return NativeModule.speakAsync(
    phrase,
    options.interrupt ?? true,
    options.speechRate ?? 1.08,
    options.pitch ?? 1,
  );
}

export async function stopCoachSpeechAsync() {
  if (!NativeModule) return;
  await NativeModule.stopAsync();
}

export async function getCoachSpeechStatusAsync() {
  if (!NativeModule) throw new Error('사람 음성 코칭 모듈이 APK에 없습니다.');
  return NativeModule.getStatusAsync();
}
