import AsyncStorage from '@react-native-async-storage/async-storage';

import type { GuitarModeId, PracticeCategoryId } from '../config/guitar-mode-profiles';

const STORAGE_KEY = 'guitar-coach:practice-sessions:v2';
const MAX_SESSIONS = 500;

export type SessionIssue = {
  id: string;
  title: string;
  count: number;
  severity: 'info' | 'warn' | 'high';
  confidencePercent: number;
};

export type PracticeSessionRecord = {
  id: string;
  guitarMode: GuitarModeId;
  category: PracticeCategoryId;
  presetId?: string;
  title: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  bpmStart: number;
  bpmEnd: number;
  averageScore: number | null;
  bestScore: number | null;
  averageConfidencePercent: number;
  manualMistakes: number;
  aiMistakes: number;
  stableSeconds: number;
  issues: SessionIssue[];
  nextAssignment: string;
  cameraMode: 'full-body' | 'right-hand' | 'left-hand' | 'none';
  microphoneUsed: boolean;
  metronomeUsed: boolean;
  notes?: string;
};

function parseStoredSessions(raw: string | null): PracticeSessionRecord[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is PracticeSessionRecord => {
      if (!value || typeof value !== 'object') return false;
      const record = value as Partial<PracticeSessionRecord>;
      return typeof record.id === 'string' &&
        (record.guitarMode === 'acoustic' || record.guitarMode === 'electric') &&
        typeof record.startedAt === 'string' &&
        typeof record.durationSeconds === 'number';
    });
  } catch {
    return [];
  }
}

export async function loadPracticeSessions(): Promise<PracticeSessionRecord[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return parseStoredSessions(raw).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function savePracticeSession(record: PracticeSessionRecord): Promise<void> {
  const current = await loadPracticeSessions();
  const next = [record, ...current.filter((item) => item.id !== record.id)]
    .slice(0, MAX_SESSIONS);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export async function deletePracticeSession(id: string): Promise<void> {
  const current = await loadPracticeSessions();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(current.filter((record) => record.id !== id)));
}

export async function clearPracticeSessions(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export type SessionSummary = {
  sessionCount: number;
  totalMinutes: number;
  averageScore: number | null;
  averageConfidencePercent: number;
  bpmGrowth: number;
  topIssues: SessionIssue[];
  bestSessionId: string | null;
  latestAssignment: string;
};

export function summarizePracticeSessions(
  sessions: PracticeSessionRecord[],
  mode?: GuitarModeId,
): SessionSummary {
  const filtered = mode ? sessions.filter((session) => session.guitarMode === mode) : sessions;
  const validScores = filtered.filter((session) => session.averageScore != null);
  const issueMap = new Map<string, SessionIssue>();

  filtered.forEach((session) => {
    session.issues.forEach((issue) => {
      const current = issueMap.get(issue.id);
      issueMap.set(issue.id, {
        ...issue,
        count: (current?.count ?? 0) + issue.count,
        severity: current?.severity === 'high' || issue.severity === 'high'
          ? 'high'
          : current?.severity === 'warn' || issue.severity === 'warn'
            ? 'warn'
            : 'info',
        confidencePercent: Math.round(((current?.confidencePercent ?? issue.confidencePercent) + issue.confidencePercent) / 2),
      });
    });
  });

  const chronological = [...filtered].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const firstBpm = chronological[0]?.bpmStart ?? 0;
  const lastBpm = chronological.at(-1)?.bpmEnd ?? firstBpm;
  const best = validScores.reduce<PracticeSessionRecord | null>((current, session) => {
    if (!current) return session;
    return (session.averageScore ?? 0) > (current.averageScore ?? 0) ? session : current;
  }, null);

  return {
    sessionCount: filtered.length,
    totalMinutes: Math.round(filtered.reduce((sum, session) => sum + session.durationSeconds, 0) / 60),
    averageScore: validScores.length
      ? Math.round(validScores.reduce((sum, session) => sum + (session.averageScore ?? 0), 0) / validScores.length)
      : null,
    averageConfidencePercent: filtered.length
      ? Math.round(filtered.reduce((sum, session) => sum + session.averageConfidencePercent, 0) / filtered.length)
      : 0,
    bpmGrowth: lastBpm - firstBpm,
    topIssues: [...issueMap.values()].sort((a, b) => b.count - a.count).slice(0, 3),
    bestSessionId: best?.id ?? null,
    latestAssignment: filtered[0]?.nextAssignment ?? '첫 연습을 완료하면 다음 과제가 표시됩니다.',
  };
}

export type SessionComparison = {
  scoreChange: number | null;
  confidenceChange: number;
  bpmChange: number;
  mistakeChange: number;
  improvedIssues: string[];
  repeatedIssues: string[];
};

export function comparePracticeSessions(
  previous: PracticeSessionRecord,
  current: PracticeSessionRecord,
): SessionComparison {
  const previousIssues = new Map(previous.issues.map((issue) => [issue.id, issue]));
  const currentIssues = new Map(current.issues.map((issue) => [issue.id, issue]));
  const improvedIssues = previous.issues
    .filter((issue) => !currentIssues.has(issue.id) || (currentIssues.get(issue.id)?.count ?? 0) < issue.count)
    .map((issue) => issue.title);
  const repeatedIssues = current.issues
    .filter((issue) => previousIssues.has(issue.id))
    .map((issue) => issue.title);

  return {
    scoreChange: previous.averageScore != null && current.averageScore != null
      ? current.averageScore - previous.averageScore
      : null,
    confidenceChange: current.averageConfidencePercent - previous.averageConfidencePercent,
    bpmChange: current.bpmEnd - previous.bpmEnd,
    mistakeChange: (current.manualMistakes + current.aiMistakes) - (previous.manualMistakes + previous.aiMistakes),
    improvedIssues,
    repeatedIssues,
  };
}

export type PracticeBackup = {
  schemaVersion: 2;
  exportedAt: string;
  sessions: PracticeSessionRecord[];
};

export async function exportPracticeBackup(): Promise<string> {
  const sessions = await loadPracticeSessions();
  const backup: PracticeBackup = {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    sessions,
  };
  return JSON.stringify(backup, null, 2);
}

export async function importPracticeBackup(raw: string): Promise<number> {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') throw new Error('백업 파일 형식이 올바르지 않습니다.');
  const backup = parsed as Partial<PracticeBackup>;
  if (backup.schemaVersion !== 2 || !Array.isArray(backup.sessions)) {
    throw new Error('지원하지 않는 백업 버전입니다.');
  }
  const valid = parseStoredSessions(JSON.stringify(backup.sessions));
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(valid.slice(0, MAX_SESSIONS)));
  return valid.length;
}
