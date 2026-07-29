import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { PracticePreset } from '../config/personal-practice-presets';
import {
  getLatestLiveCoachFeedback,
  LiveCoachFeedback,
  subscribeLiveCoachFeedback,
} from '../services/live-coach-feedback';

function statusLabel(feedback: LiveCoachFeedback | null, running: boolean) {
  if (!running) return '시작 전';
  if (!feedback) return '판정 대기';
  if (feedback.status === 'cannot-judge') return '판정 불가';
  if (feedback.status === 'warning') return '즉시 확인';
  if (feedback.status === 'correction') return '지금 교정';
  if (feedback.status === 'success') return '좋아요';
  return '분석 중';
}

function fallbackFeedback(preset: PracticePreset): LiveCoachFeedback {
  return {
    id: 'analysis-waiting',
    capturedAt: Date.now(),
    status: 'cannot-judge',
    category: preset.category,
    title: '아직 신뢰 가능한 판정이 없습니다',
    instruction: preset.cameraFocus === 'full-body'
      ? '머리부터 골반과 양쪽 팔꿈치가 보이도록 휴대폰 거리를 맞추세요.'
      : '손목과 다섯 손가락 끝이 모두 보이도록 손을 가이드 안에 크게 맞추세요.',
    evidence: '카메라 프레임 또는 마이크 표본이 부족해 동작을 추측하지 않습니다.',
    nextGoal: '화면의 가이드가 맞으면 그대로 3회 연주하세요.',
    confidencePercent: 0,
    stableCount: 0,
    priority: 1,
    measurements: [],
  };
}

export default function LiveTeacherPanel({
  preset,
  running,
  voiceEnabled,
}: {
  preset: PracticePreset;
  running: boolean;
  voiceEnabled: boolean;
}) {
  const [feedback, setFeedback] = useState<LiveCoachFeedback | null>(() => getLatestLiveCoachFeedback());
  const [recent, setRecent] = useState<LiveCoachFeedback[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => subscribeLiveCoachFeedback((next) => {
    setFeedback(next);
    if (!next || next.status === 'waiting') return;
    setRecent((items) => {
      const first = items[0];
      if (first?.id === next.id && next.capturedAt - first.capturedAt < 2_500) return items;
      return [next, ...items].slice(0, 4);
    });
  }), []);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 700);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!running) setRecent([]);
  }, [preset.id, running]);

  const visibleFeedback = useMemo(() => {
    if (!running) return null;
    if (!feedback || now - feedback.capturedAt > 3_500) return fallbackFeedback(preset);
    return feedback;
  }, [feedback, now, preset, running]);

  const stableCount = Math.min(3, visibleFeedback?.stableCount ?? 0);
  const cardStyle = visibleFeedback?.status === 'success'
    ? styles.successCard
    : visibleFeedback?.status === 'warning'
      ? styles.warningCard
      : visibleFeedback?.status === 'correction'
        ? styles.correctionCard
        : styles.unavailableCard;

  return (
    <View style={[styles.card, cardStyle]}>
      <View style={styles.topRow}>
        <View style={styles.titleWrap}>
          <Text style={styles.eyebrow}>REAL-TIME AI TEACHER</Text>
          <Text style={styles.title}>{running ? visibleFeedback?.title : preset.goal}</Text>
        </View>
        <View style={styles.badgeWrap}>
          <Text style={styles.badge}>{statusLabel(visibleFeedback, running)}</Text>
          <Text style={styles.voiceBadge}>음성 {voiceEnabled ? '켜짐' : '꺼짐'}</Text>
        </View>
      </View>

      {running && visibleFeedback ? (
        <>
          <View style={styles.instructionBox}>
            <Text style={styles.instructionLabel}>선생님 지시</Text>
            <Text style={styles.instruction}>{visibleFeedback.instruction}</Text>
          </View>
          <Text style={styles.evidence}>판정 근거 · {visibleFeedback.evidence}</Text>
          <Text style={styles.nextGoal}>다음 3회 목표 · {visibleFeedback.nextGoal}</Text>

          <View style={styles.holdRow}>
            {[0, 1, 2].map((index) => (
              <View key={index} style={[styles.holdDot, index < stableCount && styles.holdDotActive]} />
            ))}
            <Text style={styles.holdText}>{stableCount >= 3 ? '교정 유지 성공' : `좋은 동작 ${stableCount}/3`}</Text>
            <Text style={styles.confidence}>{visibleFeedback.confidencePercent}% 신뢰</Text>
          </View>

          {visibleFeedback.measurements.length ? (
            <View style={styles.measurementRow}>
              {visibleFeedback.measurements.slice(0, 4).map((item) => (
                <View key={`${item.label}-${item.value}`} style={styles.measurementChip}>
                  <Text style={styles.measurementLabel}>{item.label}</Text>
                  <Text style={styles.measurementValue}>{item.value}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : (
        <>
          <Text style={styles.readyText}>시작하면 카메라·마이크에서 실제로 확인된 문제 한 가지를 크게 지적하고, 고친 동작을 3회 연속 확인합니다.</Text>
          <View style={styles.checkpointBox}>
            <Text style={styles.checkpointTitle}>{preset.pattern ? `패턴 · ${preset.pattern}` : '이번 루틴 체크포인트'}</Text>
            {preset.checkpoints.slice(0, 4).map((item, index) => (
              <Text key={item} style={styles.checkpointText}>{index + 1}. {item}</Text>
            ))}
          </View>
        </>
      )}

      {running && recent.length > 1 ? (
        <View style={styles.recentBox}>
          <Text style={styles.recentTitle}>방금 받은 코칭</Text>
          {recent.slice(1, 4).map((item) => (
            <Text key={`${item.id}-${item.capturedAt}`} numberOfLines={1} style={styles.recentText}>• {item.instruction}</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 8, marginTop: 8, borderWidth: 1, borderRadius: 16, padding: 12 },
  unavailableCard: { backgroundColor: '#161b22', borderColor: '#30363d' },
  correctionCard: { backgroundColor: '#251f08', borderColor: '#d29922' },
  warningCard: { backgroundColor: '#2b1618', borderColor: '#f85149' },
  successCard: { backgroundColor: '#102418', borderColor: '#2ea043' },
  topRow: { flexDirection: 'row', alignItems: 'flex-start' },
  titleWrap: { flex: 1, paddingRight: 8 },
  eyebrow: { color: '#79c0ff', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  title: { color: '#f0f6fc', fontSize: 15, lineHeight: 20, fontWeight: '900', marginTop: 3 },
  badgeWrap: { alignItems: 'flex-end', gap: 4 },
  badge: { color: '#ffffff', backgroundColor: '#1f6feb', borderRadius: 9, paddingHorizontal: 7, paddingVertical: 4, fontSize: 7, fontWeight: '900' },
  voiceBadge: { color: '#8b949e', fontSize: 6, fontWeight: '800' },
  instructionBox: { borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.24)', padding: 10, marginTop: 10 },
  instructionLabel: { color: '#f2cc60', fontSize: 7, fontWeight: '900' },
  instruction: { color: '#ffffff', fontSize: 13, lineHeight: 19, fontWeight: '900', marginTop: 3 },
  evidence: { color: '#b1bac4', fontSize: 8, lineHeight: 13, marginTop: 8 },
  nextGoal: { color: '#79c0ff', fontSize: 9, lineHeight: 14, fontWeight: '800', marginTop: 5 },
  holdRow: { flexDirection: 'row', alignItems: 'center', marginTop: 9 },
  holdDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#30363d', marginRight: 4 },
  holdDotActive: { backgroundColor: '#7ee787' },
  holdText: { color: '#b1bac4', fontSize: 7, fontWeight: '800', marginLeft: 3 },
  confidence: { color: '#8b949e', fontSize: 7, marginLeft: 'auto' },
  measurementRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 9 },
  measurementChip: { minWidth: 66, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.25)', paddingHorizontal: 8, paddingVertical: 6 },
  measurementLabel: { color: '#8b949e', fontSize: 6 },
  measurementValue: { color: '#f0f6fc', fontSize: 8, fontWeight: '900', marginTop: 2 },
  readyText: { color: '#b1bac4', fontSize: 9, lineHeight: 15, marginTop: 9 },
  checkpointBox: { borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.2)', padding: 10, marginTop: 9 },
  checkpointTitle: { color: '#7ee787', fontSize: 8, fontWeight: '900', marginBottom: 5 },
  checkpointText: { color: '#b1bac4', fontSize: 8, lineHeight: 14 },
  recentBox: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)', marginTop: 10, paddingTop: 8 },
  recentTitle: { color: '#8b949e', fontSize: 7, fontWeight: '900', marginBottom: 3 },
  recentText: { color: '#b1bac4', fontSize: 7, lineHeight: 12 },
});
