import {
  getGuitarModeProfile,
  type GuitarModeId,
  type PracticeCategoryId,
} from '../config/guitar-mode-profiles';
import { getPracticePresetsForMode } from '../config/personal-practice-presets';
import type { PracticeSessionRecord } from './practice-session-store';

export type MasteryGradeId =
  | 'unmeasured'
  | 'foundation'
  | 'developing'
  | 'solid'
  | 'advanced'
  | 'master';

export type MasterySkill = {
  category: PracticeCategoryId;
  title: string;
  grade: MasteryGradeId;
  gradeLabel: string;
  sampleStatus: 'unmeasured' | 'provisional' | 'measured';
  reliableSessions: number;
  totalSessions: number;
  score: number | null;
  confidencePercent: number;
  currentBpm: number | null;
  targetBpm: number;
  topIssue: string | null;
  strength: string;
  nextFocus: string;
};

export type MasteryProfile = {
  guitarMode: GuitarModeId;
  overallGrade: MasteryGradeId;
  overallLabel: string;
  measuredSkillCount: number;
  totalSkillCount: number;
  reliableSessionCount: number;
  overallScore: number | null;
  strongest: MasterySkill | null;
  priority: MasterySkill | null;
  skills: MasterySkill[];
};

export type TodayLesson = {
  title: string;
  reason: string;
  presetId: string | null;
  category: PracticeCategoryId;
  startBpm: number;
  targetBpm: number;
  totalMinutes: number;
  stages: Array<{
    id: 'setup' | 'control' | 'speed' | 'song' | 'review';
    minutes: number;
    title: string;
    instruction: string;
  }>;
};

const GRADE_LABELS: Record<MasteryGradeId, string> = {
  unmeasured: '미측정',
  foundation: '기초 형성',
  developing: '성장 중',
  solid: '안정 단계',
  advanced: '상급',
  master: '마스터 도전',
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function gradeFor(score: number): MasteryGradeId {
  if (score >= 92) return 'master';
  if (score >= 84) return 'advanced';
  if (score >= 74) return 'solid';
  if (score >= 60) return 'developing';
  return 'foundation';
}

function weightedAverage(values: number[]) {
  if (!values.length) return 0;
  let weighted = 0;
  let weightSum = 0;
  values.forEach((value, index) => {
    const weight = index + 1;
    weighted += value * weight;
    weightSum += weight;
  });
  return weighted / Math.max(1, weightSum);
}

function issueFrequency(sessions: PracticeSessionRecord[]) {
  const map = new Map<string, number>();
  sessions.forEach((session) => {
    session.issues.forEach((issue) => {
      map.set(issue.title, (map.get(issue.title) ?? 0) + issue.count);
    });
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function skillFromSessions(
  mode: GuitarModeId,
  category: PracticeCategoryId,
  title: string,
  minBpm: number,
  maxBpm: number,
  sessions: PracticeSessionRecord[],
): MasterySkill {
  const all = sessions
    .filter((session) => session.guitarMode === mode && session.category === category)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const reliable = all
    .filter((session) => session.averageScore != null && session.averageConfidencePercent >= 65)
    .slice(-8);
  const currentBpm = reliable.at(-1)?.bpmEnd ?? null;
  const targetBpm = currentBpm == null
    ? minBpm
    : clamp(currentBpm + (currentBpm < 80 ? 5 : currentBpm < 120 ? 3 : 2), minBpm, maxBpm);

  if (!reliable.length) {
    return {
      category,
      title,
      grade: 'unmeasured',
      gradeLabel: GRADE_LABELS.unmeasured,
      sampleStatus: 'unmeasured',
      reliableSessions: 0,
      totalSessions: all.length,
      score: null,
      confidencePercent: all.length
        ? Math.round(all.reduce((sum, session) => sum + session.averageConfidencePercent, 0) / all.length)
        : 0,
      currentBpm,
      targetBpm,
      topIssue: null,
      strength: '신뢰 가능한 연주 표본이 아직 없습니다.',
      nextFocus: '진단 세션을 2회 완료해 현재 수준부터 정확히 측정하세요.',
    };
  }

  const movementScore = weightedAverage(reliable.map((session) => session.averageScore ?? 0));
  const bpmRatio = currentBpm == null ? 0 : clamp((currentBpm - minBpm) / Math.max(1, maxBpm - minBpm), 0, 1);
  const mistakePenalty = reliable.reduce(
    (sum, session) => sum + session.manualMistakes + session.aiMistakes,
    0,
  ) / reliable.length;
  const tensionPenalty = reliable.some((session) => session.notes?.includes('긴장 보고')) ? 5 : 0;
  const combined = clamp(movementScore * 0.82 + bpmRatio * 18 - Math.min(9, mistakePenalty * 0.8) - tensionPenalty, 0, 100);
  const score = Math.round(combined);
  const grade = gradeFor(score);
  const topIssue = issueFrequency(reliable);
  const confidencePercent = Math.round(
    reliable.reduce((sum, session) => sum + session.averageConfidencePercent, 0) / reliable.length,
  );

  return {
    category,
    title,
    grade,
    gradeLabel: GRADE_LABELS[grade],
    sampleStatus: reliable.length >= 3 ? 'measured' : 'provisional',
    reliableSessions: reliable.length,
    totalSessions: all.length,
    score,
    confidencePercent,
    currentBpm,
    targetBpm,
    topIssue,
    strength: score >= 84
      ? `${currentBpm ?? minBpm} BPM에서 동작과 박자 안정성이 상급 기준에 가깝습니다.`
      : score >= 70
        ? '기본 동작은 연결되며 반복 안정성을 더 확보하면 빠르게 성장할 수 있습니다.'
        : '속도보다 정확한 움직임과 힘 조절을 먼저 고정해야 합니다.',
    nextFocus: topIssue
      ? `${topIssue} 문제를 먼저 없애고 ${targetBpm} BPM에 도전하세요.`
      : `${targetBpm} BPM에서도 같은 움직임 크기와 박자를 유지하세요.`,
  };
}

export function buildMasteryProfile(
  sessions: PracticeSessionRecord[],
  mode: GuitarModeId,
): MasteryProfile {
  const profile = getGuitarModeProfile(mode);
  const skills = profile.practiceDefinitions
    .filter((definition) => definition.id !== 'songPractice')
    .map((definition) => skillFromSessions(
      mode,
      definition.id,
      definition.title,
      definition.minBpm,
      definition.maxBpm,
      sessions,
    ));
  const measured = skills.filter((skill) => skill.score != null);
  const reliableSessionCount = measured.reduce((sum, skill) => sum + skill.reliableSessions, 0);
  const overallScore = measured.length >= 3
    ? Math.round(measured.reduce((sum, skill) => sum + (skill.score ?? 0), 0) / measured.length)
    : null;
  const overallGrade = overallScore == null ? 'unmeasured' : gradeFor(overallScore);
  const sorted = [...measured].sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  const unmeasured = skills.find((skill) => skill.sampleStatus === 'unmeasured') ?? null;

  return {
    guitarMode: mode,
    overallGrade,
    overallLabel: overallScore == null
      ? `진단 진행 중 · ${measured.length}/${skills.length}개 기술 측정`
      : GRADE_LABELS[overallGrade],
    measuredSkillCount: measured.length,
    totalSkillCount: skills.length,
    reliableSessionCount,
    overallScore,
    strongest: sorted.at(-1) ?? null,
    priority: unmeasured ?? sorted[0] ?? null,
    skills,
  };
}

export function buildTodayLesson(profile: MasteryProfile): TodayLesson {
  const presets = getPracticePresetsForMode(profile.guitarMode);
  const priority = profile.priority ?? profile.skills[0];
  const preset = presets.find((item) => item.category === priority?.category) ?? presets[0];
  const category = priority?.category ?? preset?.category ?? 'songPractice';
  const startBpm = priority?.currentBpm ?? preset?.startBpm ?? 60;
  const targetBpm = priority?.targetBpm ?? preset?.targetBpm ?? startBpm;
  const unmeasured = priority?.sampleStatus === 'unmeasured';

  return {
    title: unmeasured ? `${priority?.title ?? '핵심 기술'} 수준 진단 수업` : `${priority?.title ?? '핵심 기술'} 집중 교정 수업`,
    reason: unmeasured
      ? '현재 수준을 추측하지 않고 카메라·마이크 신뢰도가 확보된 진단 표본부터 만듭니다.'
      : priority?.nextFocus ?? '가장 약한 기술을 먼저 교정합니다.',
    presetId: preset?.id ?? null,
    category,
    startBpm,
    targetBpm,
    totalMinutes: 20,
    stages: [
      {
        id: 'setup',
        minutes: 2,
        title: '촬영·힘 점검',
        instruction: '카메라 가이드와 마이크 신뢰도를 맞추고 어깨·손목 힘을 먼저 뺍니다.',
      },
      {
        id: 'control',
        minutes: 6,
        title: '정확도 교정',
        instruction: `${Math.max(35, startBpm - 10)} BPM에서 AI가 지적한 한 가지 문제만 고쳐 3회 연속 성공시킵니다.`,
      },
      {
        id: 'speed',
        minutes: 5,
        title: '속도 연결',
        instruction: `${startBpm} BPM부터 자세가 무너지지 않을 때만 1~3 BPM씩 올립니다.`,
      },
      {
        id: 'song',
        minutes: 5,
        title: '추천곡 적용',
        instruction: '같은 기술이 들어간 곡의 짧은 구간을 반복해 연습이 음악으로 연결되게 합니다.',
      },
      {
        id: 'review',
        minutes: 2,
        title: '복습·숙제',
        instruction: '세션 전후 점수와 반복 문제를 비교해 다음 수업 BPM과 과제를 자동 저장합니다.',
      },
    ],
  };
}
