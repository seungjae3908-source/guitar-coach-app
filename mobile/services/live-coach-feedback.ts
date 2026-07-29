import type { PracticeCategoryId } from '../config/guitar-mode-profiles';

export type LiveCoachFeedbackStatus =
  | 'waiting'
  | 'cannot-judge'
  | 'correction'
  | 'warning'
  | 'success';

export type LiveCoachMeasurement = {
  label: string;
  value: string;
};

export type LiveCoachFeedback = {
  id: string;
  capturedAt: number;
  status: LiveCoachFeedbackStatus;
  category: PracticeCategoryId;
  title: string;
  instruction: string;
  evidence: string;
  nextGoal: string;
  confidencePercent: number;
  stableCount: number;
  priority: number;
  measurements: LiveCoachMeasurement[];
};

type Listener = (feedback: LiveCoachFeedback | null) => void;

let latestFeedback: LiveCoachFeedback | null = null;
const listeners = new Set<Listener>();

export function publishLiveCoachFeedback(feedback: LiveCoachFeedback) {
  latestFeedback = feedback;
  listeners.forEach((listener) => {
    try {
      listener(feedback);
    } catch {
      // 한 화면의 표시 오류가 음성·카메라 분석을 중단하지 않게 합니다.
    }
  });
}

export function getLatestLiveCoachFeedback() {
  return latestFeedback;
}

export function clearLiveCoachFeedback() {
  latestFeedback = null;
  listeners.forEach((listener) => {
    try {
      listener(null);
    } catch {
      // 구독 오류는 다른 분석 모듈에 전파하지 않습니다.
    }
  });
}

export function subscribeLiveCoachFeedback(listener: Listener) {
  listeners.add(listener);
  listener(latestFeedback);
  return () => {
    listeners.delete(listener);
  };
}
