import type { GuitarModeId, PracticeCategoryId } from '../config/guitar-mode-profiles';
import type { PracticePreset } from '../config/personal-practice-presets';

export type PracticeAttempt = {
  id: string;
  presetId: string;
  guitarMode: GuitarModeId;
  category: PracticeCategoryId;
  startedAt: string;
  durationSeconds: number;
  bpm: number;
  score: number | null;
  confidencePercent: number;
  manualMistakes: number;
  aiMistakes: number;
  stableStreak: number;
  painOrTensionReported: boolean;
  repeatedIssueTags: string[];
};

export type ProgressionDecision = {
  nextBpm: number;
  change: number;
  status: 'increase' | 'hold' | 'decrease' | 'stop';
  reason: string;
  nextFocus: string;
  restSeconds: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function decideNextPracticeStep(
  preset: PracticePreset,
  recentAttempts: PracticeAttempt[],
): ProgressionDecision {
  const attempts = recentAttempts
    .filter((attempt) => attempt.presetId === preset.id)
    .slice(-5);
  const latest = attempts.at(-1);

  if (!latest) {
    return {
      nextBpm: preset.startBpm,
      change: 0,
      status: 'hold',
      reason: '첫 측정 전에는 시작 BPM을 유지합니다.',
      nextFocus: preset.checkpoints[0] ?? preset.goal,
      restSeconds: 20,
    };
  }

  if (latest.painOrTensionReported) {
    return {
      nextBpm: Math.max(preset.startBpm, latest.bpm - 10),
      change: -Math.min(10, latest.bpm - preset.startBpm),
      status: 'stop',
      reason: '통증 또는 과도한 긴장이 보고되어 속도 증가를 중단합니다.',
      nextFocus: '손과 손목 힘을 풀고 1분 이상 쉬세요. 통증이 지속되면 연습을 종료하세요.',
      restSeconds: 60,
    };
  }

  const valid = attempts.filter((attempt) => attempt.score != null && attempt.confidencePercent >= 65);
  if (valid.length === 0) {
    return {
      nextBpm: latest.bpm,
      change: 0,
      status: 'hold',
      reason: 'AI 신뢰도가 낮아 속도를 자동 변경하지 않습니다.',
      nextFocus: '카메라·조명·마이크 배치를 먼저 개선하세요.',
      restSeconds: 20,
    };
  }

  const averageScore = valid.reduce((sum, attempt) => sum + (attempt.score ?? 0), 0) / valid.length;
  const averageMistakes = valid.reduce(
    (sum, attempt) => sum + attempt.manualMistakes + attempt.aiMistakes,
    0,
  ) / valid.length;
  const stableStreak = latest.stableStreak;
  const repeatedIssues = latest.repeatedIssueTags;

  if (averageScore >= 88 && averageMistakes <= 1 && stableStreak >= 3) {
    const step = latest.bpm < 80 ? 3 : latest.bpm < 120 ? 2 : 1;
    const next = clamp(latest.bpm + step, preset.startBpm, preset.targetBpm);
    return {
      nextBpm: next,
      change: next - latest.bpm,
      status: next > latest.bpm ? 'increase' : 'hold',
      reason: next > latest.bpm
        ? '점수·실수·연속 안정 구간이 모두 기준을 통과했습니다.'
        : '목표 BPM에 도달했습니다.',
      nextFocus: repeatedIssues[0] ?? '같은 자세와 움직임 크기를 유지하세요.',
      restSeconds: 15,
    };
  }

  if (averageScore < 62 || averageMistakes >= 5) {
    const step = latest.bpm > 100 ? 5 : 3;
    const next = clamp(latest.bpm - step, preset.startBpm, preset.targetBpm);
    return {
      nextBpm: next,
      change: next - latest.bpm,
      status: next < latest.bpm ? 'decrease' : 'hold',
      reason: '점수 또는 실수 횟수가 안정 기준보다 낮아 정확도를 우선합니다.',
      nextFocus: repeatedIssues[0] ?? preset.checkpoints[0] ?? preset.goal,
      restSeconds: 25,
    };
  }

  return {
    nextBpm: latest.bpm,
    change: 0,
    status: 'hold',
    reason: '현재 속도에서 한 번 더 안정 구간을 확보해야 합니다.',
    nextFocus: repeatedIssues[0] ?? preset.checkpoints[0] ?? preset.goal,
    restSeconds: 20,
  };
}

export type WeeklyPracticeBlock = {
  dayIndex: number;
  title: string;
  presetIds: string[];
  totalMinutes: number;
  focus: string;
};

export function buildWeeklyPracticePlan(
  mode: GuitarModeId,
  presets: PracticePreset[],
  recentAttempts: PracticeAttempt[],
): WeeklyPracticeBlock[] {
  const modePresets = presets.filter((preset) => preset.guitarMode === mode);
  const issueFrequency = new Map<string, number>();
  recentAttempts
    .filter((attempt) => attempt.guitarMode === mode)
    .forEach((attempt) => {
      attempt.repeatedIssueTags.forEach((issue) => {
        issueFrequency.set(issue, (issueFrequency.get(issue) ?? 0) + 1);
      });
    });
  const topIssue = [...issueFrequency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const priorityPreset = modePresets.find((preset) => topIssue && (
    preset.goal.includes(topIssue) ||
    preset.checkpoints.some((checkpoint) => checkpoint.includes(topIssue))
  ));

  const cycle = priorityPreset
    ? [priorityPreset, ...modePresets.filter((preset) => preset.id !== priorityPreset.id)]
    : modePresets;

  return Array.from({ length: 7 }, (_, dayIndex) => {
    const primary = cycle[dayIndex % Math.max(1, cycle.length)];
    const secondary = cycle[(dayIndex + 1) % Math.max(1, cycle.length)];
    const recoveryDay = dayIndex === 3 || dayIndex === 6;
    return {
      dayIndex,
      title: recoveryDay ? `${dayIndex + 1}일차 · 저속 정확도` : `${dayIndex + 1}일차 · 핵심 훈련`,
      presetIds: [primary?.id, recoveryDay ? undefined : secondary?.id].filter((value): value is string => Boolean(value)),
      totalMinutes: recoveryDay ? 8 : 12,
      focus: recoveryDay
        ? '목표 BPM보다 10~20 낮게 두고 힘과 자세를 점검합니다.'
        : topIssue ?? primary?.goal ?? '기본 자세와 박자 안정성을 유지합니다.',
    };
  });
}
