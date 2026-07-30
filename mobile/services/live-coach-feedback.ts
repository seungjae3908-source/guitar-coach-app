import type { PracticeCategoryId } from '../config/guitar-mode-profiles';
import {
  mergeFeedbackStack,
  pruneFeedbackStack,
} from './feedback-stack-core';

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

export type LiveCoachFeedbackSnapshot = {
  primary: LiveCoachFeedback | null;
  active: LiveCoachFeedback[];
  history: LiveCoachFeedback[];
};

type Listener = (feedback: LiveCoachFeedback | null) => void;
type StackListener = (snapshot: LiveCoachFeedbackSnapshot) => void;

let latestFeedback: LiveCoachFeedback | null = null;
let activeFeedbacks: LiveCoachFeedback[] = [];
let feedbackHistory: LiveCoachFeedback[] = [];
const listeners = new Set<Listener>();
const stackListeners = new Set<StackListener>();

function buildSnapshot(now = Date.now()): LiveCoachFeedbackSnapshot {
  activeFeedbacks = pruneFeedbackStack(activeFeedbacks, now);
  latestFeedback = activeFeedbacks[0] ?? null;
  return {
    primary: latestFeedback,
    active: [...activeFeedbacks],
    history: [...feedbackHistory],
  };
}

function notifyAll(now = Date.now()) {
  const snapshot = buildSnapshot(now);
  listeners.forEach((listener) => {
    try {
      listener(snapshot.primary);
    } catch {
      // 한 화면의 표시 오류가 음성·카메라 분석을 중단하지 않게 합니다.
    }
  });
  stackListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // 다중 피드백 화면 오류가 분석 스트림에 전파되지 않게 합니다.
    }
  });
}

export function publishLiveCoachFeedback(feedback: LiveCoachFeedback) {
  activeFeedbacks = mergeFeedbackStack(activeFeedbacks, feedback, feedback.capturedAt);
  latestFeedback = activeFeedbacks[0] ?? null;

  if (feedback.status !== 'waiting') {
    const previous = feedbackHistory[0];
    const repeatedImmediately = previous?.id === feedback.id
      && feedback.capturedAt - previous.capturedAt < 1_200;
    if (!repeatedImmediately) feedbackHistory = [feedback, ...feedbackHistory].slice(0, 20);
  }

  notifyAll(feedback.capturedAt);
}

export function getLatestLiveCoachFeedback(now = Date.now()) {
  return buildSnapshot(now).primary;
}

export function getActiveLiveCoachFeedbacks(now = Date.now()) {
  return buildSnapshot(now).active;
}

export function getLiveCoachFeedbackSnapshot(now = Date.now()) {
  return buildSnapshot(now);
}

export function clearLiveCoachFeedback() {
  latestFeedback = null;
  activeFeedbacks = [];
  feedbackHistory = [];
  notifyAll();
}

export function subscribeLiveCoachFeedback(listener: Listener) {
  listeners.add(listener);
  listener(getLatestLiveCoachFeedback());
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeLiveCoachFeedbackStack(listener: StackListener) {
  stackListeners.add(listener);
  listener(getLiveCoachFeedbackSnapshot());
  return () => {
    stackListeners.delete(listener);
  };
}
