import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { PracticePreset } from '../config/personal-practice-presets';
import {
  getLiveCoachFeedbackSnapshot,
  type LiveCoachFeedback,
  type LiveCoachFeedbackSnapshot,
  subscribeLiveCoachFeedbackStack,
} from '../services/live-coach-feedback';

function emptySnapshot(): LiveCoachFeedbackSnapshot {
  return getLiveCoachFeedbackSnapshot();
}

function statusLabel(feedback: LiveCoachFeedback | null) {
  if (!feedback) return '판정 대기';
  if (feedback.status === 'warning') return '즉시 교정';
  if (feedback.status === 'correction') return '교정';
  if (feedback.status === 'success') return '잘하고 있음';
  if (feedback.status === 'cannot-judge') return '판정 불가';
  return '분석 중';
}

function fallbackFeedback(preset: PracticePreset): LiveCoachFeedback {
  return {
    id: 'camera-first-waiting',
    capturedAt: Date.now(),
    status: 'cannot-judge',
    category: preset.category,
    title: '손과 자세를 화면에 맞추는 중입니다',
    instruction: preset.cameraFocus === 'full-body'
      ? '머리·양쪽 어깨·팔꿈치·손목이 한 화면에 들어오게 휴대폰 거리를 맞추세요.'
      : '손목과 손가락 끝, 피크 또는 기타줄이 잘리지 않게 카메라를 맞추세요.',
    evidence: '신뢰 가능한 카메라 표본이 모이기 전에는 동작을 추측하지 않습니다.',
    nextGoal: '같은 동작을 천천히 3회 반복하세요.',
    confidencePercent: 0,
    stableCount: 0,
    priority: 1,
    measurements: [],
  };
}

export default function CameraFirstTeacherPanel({
  preset,
  running,
}: {
  preset: PracticePreset;
  running: boolean;
}) {
  const [snapshot, setSnapshot] = useState<LiveCoachFeedbackSnapshot>(emptySnapshot);

  useEffect(() => subscribeLiveCoachFeedbackStack(setSnapshot), []);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setSnapshot(getLiveCoachFeedbackSnapshot()), 450);
    return () => clearInterval(timer);
  }, [running]);

  const visualFeedbacks = useMemo(
    () => snapshot.active.filter((item) => !item.id.startsWith('sound-')),
    [snapshot.active],
  );
  const visualProblems = visualFeedbacks.filter((item) => (
    item.status === 'warning'
    || item.status === 'correction'
    || item.status === 'cannot-judge'
  ));
  const visualSuccesses = visualFeedbacks.filter((item) => item.status === 'success');
  const primary = running
    ? visualProblems[0] ?? visualSuccesses[0] ?? fallbackFeedback(preset)
    : null;
  const positive = visualSuccesses.find((item) => item.id !== primary?.id) ?? null;
  const soundSupport = snapshot.active.find((item) => item.id.startsWith('sound-')) ?? null;

  if (!running) {
    return (
      <View style={styles.readyCard}>
        <Text style={styles.readyTitle}>카메라 코치</Text>
        <Text style={styles.readyText}>시작하면 화면에서 실제로 확인된 손목·피크·손가락·줄·자세만 우선 지적합니다.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[
        styles.primaryCard,
        primary?.status === 'success' && styles.successCard,
        primary?.status === 'warning' && styles.warningCard,
        primary?.status === 'correction' && styles.correctionCard,
      ]}>
        <View style={styles.headingRow}>
          <View style={styles.headingText}>
            <Text style={styles.eyebrow}>CAMERA COACH · 최우선 피드백</Text>
            <Text style={styles.title}>{primary?.title}</Text>
          </View>
          <Text style={styles.statusBadge}>{statusLabel(primary)}</Text>
        </View>
        <Text style={styles.instruction}>{primary?.instruction}</Text>
        <Text style={styles.evidence}>근거 · {primary?.evidence}</Text>
        <View style={styles.goalRow}>
          <Text style={styles.nextGoal}>다음 동작 · {primary?.nextGoal}</Text>
          <Text style={styles.confidence}>{primary?.confidencePercent ?? 0}%</Text>
        </View>
      </View>

      {positive ? (
        <View style={styles.positiveBar}>
          <Text style={styles.positiveLabel}>잘한 점</Text>
          <Text style={styles.positiveText} numberOfLines={2}>{positive.title} · {positive.nextGoal}</Text>
        </View>
      ) : null}

      {soundSupport ? (
        <View style={styles.soundBar}>
          <Text style={styles.soundLabel}>소리 보조</Text>
          <Text style={styles.soundText} numberOfLines={1}>{soundSupport.title}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginHorizontal: 8, marginTop: 8, gap: 6 },
  readyCard: { marginHorizontal: 8, marginTop: 8, borderRadius: 13, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', padding: 10 },
  readyTitle: { color: '#79c0ff', fontSize: 10, fontWeight: '900' },
  readyText: { color: '#b1bac4', fontSize: 8, lineHeight: 13, marginTop: 3 },
  primaryCard: { borderRadius: 15, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', padding: 11 },
  warningCard: { borderColor: '#f85149', backgroundColor: '#2b1618' },
  correctionCard: { borderColor: '#d29922', backgroundColor: '#251f08' },
  successCard: { borderColor: '#2ea043', backgroundColor: '#102418' },
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  headingText: { flex: 1 },
  eyebrow: { color: '#79c0ff', fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  title: { color: '#ffffff', fontSize: 14, lineHeight: 19, fontWeight: '900', marginTop: 2 },
  statusBadge: { color: '#ffffff', backgroundColor: '#1f6feb', borderRadius: 9, paddingHorizontal: 7, paddingVertical: 4, fontSize: 7, fontWeight: '900' },
  instruction: { color: '#f0f6fc', fontSize: 11, lineHeight: 17, fontWeight: '800', marginTop: 8 },
  evidence: { color: '#b1bac4', fontSize: 8, lineHeight: 13, marginTop: 5 },
  goalRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 6 },
  nextGoal: { flex: 1, color: '#79c0ff', fontSize: 8, lineHeight: 13, fontWeight: '800' },
  confidence: { color: '#8b949e', fontSize: 7, fontWeight: '800' },
  positiveBar: { flexDirection: 'row', alignItems: 'center', borderRadius: 11, borderWidth: 1, borderColor: '#2ea043', backgroundColor: '#102418', paddingHorizontal: 9, paddingVertical: 7, gap: 8 },
  positiveLabel: { color: '#7ee787', fontSize: 8, fontWeight: '900' },
  positiveText: { flex: 1, color: '#d2f2da', fontSize: 8, lineHeight: 12 },
  soundBar: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, backgroundColor: '#161b22', paddingHorizontal: 9, paddingVertical: 6, gap: 8 },
  soundLabel: { color: '#8b949e', fontSize: 7, fontWeight: '900' },
  soundText: { flex: 1, color: '#b1bac4', fontSize: 7 },
});
