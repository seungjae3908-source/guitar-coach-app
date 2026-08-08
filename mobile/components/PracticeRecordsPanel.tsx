import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { GuitarModeId } from '../config/guitar-mode-profiles';
import {
  comparePracticeSessions,
  deletePracticeSession,
  loadPracticeSessions,
  PracticeSessionRecord,
  SessionComparison,
  summarizePracticeSessions,
} from '../services/practice-session-store';

type ModeFilter = 'all' | GuitarModeId;

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}분 ${remainder}초` : `${remainder}초`;
}

function signed(value: number, suffix = '') {
  if (value === 0) return `0${suffix}`;
  return `${value > 0 ? '+' : ''}${value}${suffix}`;
}

function timingFromNotes(notes?: string) {
  if (!notes) return null;
  const match = notes.match(/박오차 (정박|\d+ms 빠름|\d+ms 늦음) · 흔들림 (\d+)ms/);
  if (!match) return null;
  return { offset: match[1], jitter: `${match[2]}ms` };
}

function comparisonForSession(
  sessions: PracticeSessionRecord[],
  current: PracticeSessionRecord,
): { previous: PracticeSessionRecord; result: SessionComparison } | null {
  const chronological = sessions
    .filter((session) => session.id !== current.id)
    .filter((session) => session.guitarMode === current.guitarMode)
    .filter((session) => current.presetId ? session.presetId === current.presetId : session.category === current.category)
    .filter((session) => session.startedAt < current.startedAt)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const previous = chronological[0];
  return previous ? { previous, result: comparePracticeSessions(previous, current) } : null;
}

function StatCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {detail ? <Text style={styles.statDetail}>{detail}</Text> : null}
    </View>
  );
}

function FilterButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.filterButton, active && styles.filterButtonActive]}>
      <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
    </Pressable>
  );
}

export default function PracticeRecordsPanel({ initialMode }: { initialMode?: GuitarModeId | null }) {
  const [sessions, setSessions] = useState<PracticeSessionRecord[]>([]);
  const [filter, setFilter] = useState<ModeFilter>(initialMode ?? 'all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = await loadPracticeSessions();
      setSessions(next);
      setSelectedId((current) => current && next.some((session) => session.id === current)
        ? current
        : next[0]?.id ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '연습 기록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (initialMode) setFilter(initialMode);
  }, [initialMode]);

  const filtered = useMemo(
    () => filter === 'all' ? sessions : sessions.filter((session) => session.guitarMode === filter),
    [filter, sessions],
  );
  const summary = useMemo(
    () => summarizePracticeSessions(sessions, filter === 'all' ? undefined : filter),
    [filter, sessions],
  );
  const selected = filtered.find((session) => session.id === selectedId) ?? filtered[0] ?? null;
  const comparison = selected ? comparisonForSession(sessions, selected) : null;
  const timing = selected ? timingFromNotes(selected.notes) : null;

  const removeSelected = () => {
    if (!selected) return;
    Alert.alert(
      '연습 기록 삭제',
      `${selected.title} 기록 한 건을 삭제할까요?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => {
            void deletePracticeSession(selected.id)
              .then(reload)
              .catch((caught) => setError(caught instanceof Error ? caught.message : '기록을 삭제하지 못했습니다.'));
          },
        },
      ],
    );
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator /><Text style={styles.loadingText}>연습 기록 계산 중</Text></View>;
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.headerRow}>
        <View style={styles.headerTextWrap}>
          <Text style={styles.eyebrow}>PRACTICE HISTORY</Text>
          <Text style={styles.title}>세션별 상세 기록</Text>
          <Text style={styles.subtitle}>신뢰도가 낮은 세션은 점수를 만들지 않고 표본 부족으로 그대로 기록합니다.</Text>
        </View>
        <Pressable onPress={() => void reload()} style={styles.refreshButton}>
          <Text style={styles.refreshText}>새로고침</Text>
        </Pressable>
      </View>

      <View style={styles.filterRow}>
        <FilterButton label="전체" active={filter === 'all'} onPress={() => setFilter('all')} />
        <FilterButton label="통기타" active={filter === 'acoustic'} onPress={() => setFilter('acoustic')} />
        <FilterButton label="일렉기타" active={filter === 'electric'} onPress={() => setFilter('electric')} />
      </View>

      <View style={styles.summaryGrid}>
        <StatCard label="세션" value={`${summary.sessionCount}회`} detail={`${summary.totalMinutes}분`} />
        <StatCard label="평균 점수" value={summary.averageScore == null ? '-' : `${summary.averageScore}`} detail={`신뢰도 ${summary.averageConfidencePercent}%`} />
        <StatCard label="BPM 성장" value={signed(summary.bpmGrowth)} detail="첫 기록 대비" />
      </View>

      <View style={styles.assignmentCard}>
        <Text style={styles.assignmentLabel}>현재 다음 과제</Text>
        <Text style={styles.assignmentText}>{summary.latestAssignment}</Text>
        {summary.topIssues.length ? (
          <Text style={styles.assignmentIssues}>반복 문제 · {summary.topIssues.map((issue) => `${issue.title} ${issue.count}회`).join(' · ')}</Text>
        ) : null}
      </View>

      {!filtered.length ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>아직 저장된 연습이 없습니다</Text>
          <Text style={styles.emptyText}>집중연습에서 종료·자동 저장을 누르면 세션 결과가 여기에 쌓입니다.</Text>
        </View>
      ) : (
        <>
          <Text style={styles.sectionTitle}>최근 세션</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sessionChipRow}>
            {filtered.slice(0, 30).map((session) => (
              <Pressable
                key={session.id}
                onPress={() => setSelectedId(session.id)}
                style={[styles.sessionChip, selected?.id === session.id && styles.sessionChipActive]}
              >
                <Text style={[styles.sessionChipMode, selected?.id === session.id && styles.sessionChipTextActive]}>{session.guitarMode === 'acoustic' ? '통기타' : '일렉'}</Text>
                <Text style={[styles.sessionChipTitle, selected?.id === session.id && styles.sessionChipTextActive]} numberOfLines={1}>{session.title}</Text>
                <Text style={[styles.sessionChipMeta, selected?.id === session.id && styles.sessionChipTextActive]}>{formatDate(session.startedAt)}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {selected ? (
            <View style={styles.detailCard}>
              <View style={styles.detailHeader}>
                <View style={styles.detailHeaderText}>
                  <Text style={styles.detailMode}>{selected.guitarMode === 'acoustic' ? '통기타' : '일렉기타'} · {selected.category}</Text>
                  <Text style={styles.detailTitle}>{selected.title}</Text>
                  <Text style={styles.detailDate}>{formatDate(selected.startedAt)} · {formatDuration(selected.durationSeconds)}</Text>
                </View>
                <Pressable onPress={removeSelected} style={styles.deleteButton}>
                  <Text style={styles.deleteText}>삭제</Text>
                </Pressable>
              </View>

              <View style={styles.detailGrid}>
                <StatCard label="평균 / 최고" value={`${selected.averageScore ?? '-'} / ${selected.bestScore ?? '-'}`} detail={`신뢰도 ${selected.averageConfidencePercent}%`} />
                <StatCard label="BPM" value={selected.bpmStart === selected.bpmEnd ? `${selected.bpmEnd}` : `${selected.bpmStart}→${selected.bpmEnd}`} detail={`안정 ${selected.stableSeconds}초`} />
                <StatCard label="실수" value={`${selected.manualMistakes + selected.aiMistakes}`} detail={`수동 ${selected.manualMistakes} · AI ${selected.aiMistakes}`} />
              </View>

              {timing ? (
                <View style={styles.timingRow}>
                  <View style={styles.timingItem}><Text style={styles.timingValue}>{timing.offset}</Text><Text style={styles.timingLabel}>마지막 박 오차</Text></View>
                  <View style={styles.timingItem}><Text style={styles.timingValue}>{timing.jitter}</Text><Text style={styles.timingLabel}>최근 박자 흔들림</Text></View>
                </View>
              ) : null}

              <Text style={styles.detailSectionLabel}>반복 문제</Text>
              {selected.issues.length ? selected.issues.map((issue) => (
                <View key={issue.id} style={styles.issueRow}>
                  <View style={[styles.severityDot, issue.severity === 'high' ? styles.severityHigh : issue.severity === 'warn' ? styles.severityWarn : styles.severityInfo]} />
                  <View style={styles.issueTextWrap}>
                    <Text style={styles.issueName}>{issue.title}</Text>
                    <Text style={styles.issueMeta}>{issue.count}회 · 신뢰도 {issue.confidencePercent}%</Text>
                  </View>
                </View>
              )) : <Text style={styles.noIssueText}>신뢰 가능한 반복 문제가 기록되지 않았습니다.</Text>}

              <View style={styles.nextCard}>
                <Text style={styles.nextLabel}>다음 연습</Text>
                <Text style={styles.nextText}>{selected.nextAssignment}</Text>
              </View>

              {comparison ? (
                <View style={styles.compareCard}>
                  <Text style={styles.compareTitle}>같은 루틴 이전 세션과 비교</Text>
                  <Text style={styles.compareMeta}>{formatDate(comparison.previous.startedAt)} 기준</Text>
                  <View style={styles.compareGrid}>
                    <StatCard label="점수" value={comparison.result.scoreChange == null ? '-' : signed(comparison.result.scoreChange)} />
                    <StatCard label="BPM" value={signed(comparison.result.bpmChange)} />
                    <StatCard label="실수" value={signed(comparison.result.mistakeChange)} />
                  </View>
                  {comparison.result.improvedIssues.length ? <Text style={styles.improvedText}>좋아짐 · {comparison.result.improvedIssues.join(' · ')}</Text> : null}
                  {comparison.result.repeatedIssues.length ? <Text style={styles.repeatedText}>계속 발생 · {comparison.result.repeatedIssues.join(' · ')}</Text> : null}
                </View>
              ) : (
                <Text style={styles.firstSessionText}>같은 루틴의 첫 기록입니다.</Text>
              )}
            </View>
          ) : null}
        </>
      )}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  content: { padding: 12, paddingBottom: 70 },
  center: { flex: 1, backgroundColor: '#0d1117', alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: '#8b949e', fontSize: 10, marginTop: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerTextWrap: { flex: 1, paddingRight: 8 },
  eyebrow: { color: '#79c0ff', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  title: { color: '#f0f6fc', fontSize: 19, fontWeight: '900', marginTop: 3 },
  subtitle: { color: '#8b949e', fontSize: 9, lineHeight: 14, marginTop: 4 },
  refreshButton: { minWidth: 61, height: 37, borderRadius: 10, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  refreshText: { color: '#f0f6fc', fontSize: 8, fontWeight: '900' },
  filterRow: { flexDirection: 'row', gap: 6, marginTop: 12 },
  filterButton: { minHeight: 36, borderRadius: 11, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', justifyContent: 'center', paddingHorizontal: 13 },
  filterButtonActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  filterText: { color: '#b1bac4', fontSize: 9, fontWeight: '900' },
  filterTextActive: { color: '#ffffff' },
  summaryGrid: { flexDirection: 'row', gap: 6, marginTop: 10 },
  statCard: { flex: 1, minWidth: 75, backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 12, padding: 9 },
  statValue: { color: '#7ee787', fontSize: 16, fontWeight: '900' },
  statLabel: { color: '#b1bac4', fontSize: 8, fontWeight: '900', marginTop: 3 },
  statDetail: { color: '#6e7681', fontSize: 7, marginTop: 2 },
  assignmentCard: { backgroundColor: '#111d2f', borderWidth: 1, borderColor: '#1f6feb', borderRadius: 14, padding: 11, marginTop: 9 },
  assignmentLabel: { color: '#79c0ff', fontSize: 8, fontWeight: '900' },
  assignmentText: { color: '#f0f6fc', fontSize: 10, lineHeight: 15, fontWeight: '800', marginTop: 4 },
  assignmentIssues: { color: '#b6d8ff', fontSize: 8, lineHeight: 13, marginTop: 5 },
  emptyCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 16, alignItems: 'center', padding: 24, marginTop: 14 },
  emptyTitle: { color: '#f0f6fc', fontSize: 14, fontWeight: '900' },
  emptyText: { color: '#8b949e', fontSize: 9, lineHeight: 15, textAlign: 'center', marginTop: 6 },
  sectionTitle: { color: '#f0f6fc', fontSize: 13, fontWeight: '900', marginTop: 14, marginBottom: 7 },
  sessionChipRow: { gap: 6, paddingBottom: 3 },
  sessionChip: { width: 126, minHeight: 65, borderRadius: 12, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', padding: 8 },
  sessionChipActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  sessionChipMode: { color: '#79c0ff', fontSize: 7, fontWeight: '900' },
  sessionChipTitle: { color: '#f0f6fc', fontSize: 9, fontWeight: '900', marginTop: 3 },
  sessionChipMeta: { color: '#8b949e', fontSize: 7, marginTop: 5 },
  sessionChipTextActive: { color: '#ffffff' },
  detailCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 17, padding: 12, marginTop: 10 },
  detailHeader: { flexDirection: 'row', alignItems: 'center' },
  detailHeaderText: { flex: 1, paddingRight: 8 },
  detailMode: { color: '#79c0ff', fontSize: 8, fontWeight: '900' },
  detailTitle: { color: '#f0f6fc', fontSize: 16, fontWeight: '900', marginTop: 2 },
  detailDate: { color: '#8b949e', fontSize: 8, marginTop: 3 },
  deleteButton: { minWidth: 45, height: 34, borderRadius: 9, borderWidth: 1, borderColor: '#da3633', backgroundColor: '#2d1618', alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: '#ff7b72', fontSize: 8, fontWeight: '900' },
  detailGrid: { flexDirection: 'row', gap: 5, marginTop: 10 },
  timingRow: { flexDirection: 'row', gap: 6, marginTop: 7 },
  timingItem: { flex: 1, backgroundColor: '#0d1117', borderRadius: 10, padding: 8, alignItems: 'center' },
  timingValue: { color: '#f2cc60', fontSize: 12, fontWeight: '900' },
  timingLabel: { color: '#6e7681', fontSize: 7, marginTop: 2 },
  detailSectionLabel: { color: '#f0f6fc', fontSize: 10, fontWeight: '900', marginTop: 12, marginBottom: 5 },
  issueRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#30363d' },
  severityDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  severityHigh: { backgroundColor: '#da3633' },
  severityWarn: { backgroundColor: '#d29922' },
  severityInfo: { backgroundColor: '#1f6feb' },
  issueTextWrap: { flex: 1 },
  issueName: { color: '#f0f6fc', fontSize: 9, fontWeight: '900' },
  issueMeta: { color: '#8b949e', fontSize: 7, marginTop: 2 },
  noIssueText: { color: '#8b949e', fontSize: 8, lineHeight: 13 },
  nextCard: { backgroundColor: '#102418', borderWidth: 1, borderColor: '#2ea043', borderRadius: 11, padding: 9, marginTop: 10 },
  nextLabel: { color: '#7ee787', fontSize: 8, fontWeight: '900' },
  nextText: { color: '#f0f6fc', fontSize: 9, lineHeight: 14, fontWeight: '800', marginTop: 3 },
  compareCard: { backgroundColor: '#0d1117', borderRadius: 12, padding: 9, marginTop: 9 },
  compareTitle: { color: '#f0f6fc', fontSize: 10, fontWeight: '900' },
  compareMeta: { color: '#6e7681', fontSize: 7, marginTop: 2 },
  compareGrid: { flexDirection: 'row', gap: 5, marginTop: 7 },
  improvedText: { color: '#7ee787', fontSize: 8, lineHeight: 13, marginTop: 7 },
  repeatedText: { color: '#f2cc60', fontSize: 8, lineHeight: 13, marginTop: 4 },
  firstSessionText: { color: '#6e7681', fontSize: 8, textAlign: 'center', marginTop: 10 },
  errorText: { color: '#ff7b72', fontSize: 9, lineHeight: 14, marginTop: 10 },
});
