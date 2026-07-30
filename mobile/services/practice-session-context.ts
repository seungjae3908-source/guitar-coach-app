import type { GuitarModeId, PracticeCategoryId } from '../config/guitar-mode-profiles';
import type { PracticePreset } from '../config/personal-practice-presets';

export type LivePracticeContext = {
  active: boolean;
  guitarMode: GuitarModeId;
  presetId: string;
  title: string;
  goal: string;
  pattern?: string;
  category: PracticeCategoryId;
  cameraFocus: PracticePreset['cameraFocus'];
  bpm: number;
  targetBpm: number;
  pulsesPerBeat: 1 | 2 | 3 | 4;
  microphoneEnabled: boolean;
  calibrationConfidencePercent: number | null;
  startedAt: number;
};

type Listener = (context: LivePracticeContext | null) => void;

const PRESET_PATTERN_FALLBACKS: Record<string, string> = {
  'acoustic-d-to-g': 'D→G',
};
let currentContext: LivePracticeContext | null = null;
const listeners = new Set<Listener>();

export function setLivePracticeContext(context: LivePracticeContext) {
  currentContext = {
    ...context,
    pattern: context.pattern ?? PRESET_PATTERN_FALLBACKS[context.presetId],
  };
  listeners.forEach((listener) => {
    try {
      listener(currentContext);
    } catch {
      // 한 화면의 구독 오류가 실시간 분석 흐름을 중단하지 않게 합니다.
    }
  });
}

export function clearLivePracticeContext() {
  currentContext = null;
  listeners.forEach((listener) => {
    try {
      listener(null);
    } catch {
      // 구독 오류는 다른 분석 모듈에 전파하지 않습니다.
    }
  });
}

export function getLivePracticeContext() {
  return currentContext;
}

export function subscribeLivePracticeContext(listener: Listener) {
  listeners.add(listener);
  listener(currentContext);
  return () => {
    listeners.delete(listener);
  };
}
