import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { PracticePreset } from '../config/personal-practice-presets';
import type { DynamicsSnapshot } from '../services/dynamics-accent-engine';
import {
  getLiveCoachFeedbackSnapshot,
  subscribeLiveCoachFeedbackStack,
  type LiveCoachFeedback,
  type LiveCoachFeedbackSnapshot,
} from '../services/live-coach-feedback';
import type { TrajectoryCoachResult } from '../services/trajectory-speed-engine';

function statusLabel(feedback: LiveCoachFeedback) {
  if (feedback.status === 'warning') return '즉시 교정';
  if (feedback.status === 'correction') return '교정';
  if (feedback.status === 'success') return '잘한 점';
  if (feedback.status === 'cannot-judge') return '판정 불가';
  return '분석';
}

function trajectoryTone(state: TrajectoryCoachResult['state']) {
  if (state === 'stable') return styles.goodCard;
  if (state === 'broken') return styles.badCard;
  if (state === 'cannot-judge') return styles.warnCard;
  return styles.neutralCard;
}

export default function DetailedCoachPanelV2({
  running,
  preset,
  trajectory,
  dynamics,
}: {
  running: boolean;
  preset: PracticePreset;
  trajectory: TrajectoryCoachResult | null;
  dynamics: DynamicsSnapshot;
}) {
  const [feedback, setFeedback] = useState<LiveCoachFeedbackSnapshot>(() => getLiveCoachFeedbackSnapshot());

  useEffect(() => subscribeLiveCoachFeedbackStack(setFeedback), []);

  const visual = useMemo(
    () => feedback.active.filter((item) => !item.id.startsWith('sound-')).slice(0, 3),
    [feedback.active],
  );
  const mainVisual = visual[0] ?? null;
  const positive = visual.find((item) => item.status === 'success') ?? null;
  const reinforcement = trajectory?.state === 'broken'
    ? trajectory.reinforcement
    : dynamics.issue !== 'waiting' && dynamics.issue !== 'stable'
      ? dynamics.reinforcement
      : mainVisual?.nextGoal
        ? `${mainVisual.nextGoal} 문제 구간만 느리게 6~8회 반복하세요.`
        : '현재 패턴을 느린 속도에서 3회 안정적으로 반복하세요.';

  if (!running) {
    return (
      <View style={styles.readyBar}>
        <Text style={styles.readyTitle}>AI 궤적 분석은 이미 작동 중</Text>
        <Text style={styles.readyText}>레슨 시작을 누르면 기준 궤적 저장, 속도 비교, 음성·상세 피드백과 보강훈련이 시작됩니다.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator>
      {trajectory ? (
        <View style={[styles.card, trajectoryTone(trajectory.state)]}>
          <View style={styles.cardHeading}>
            <Text style={styles.sectionLabel}>속도·궤적</Text>
            <Text style={styles.badge}>{trajectory.currentBpm} BPM · 안정 {trajectory.lastStableBpm}</Text>
          </View>
          <Text style={styles.title}>{trajectory.title}</Text>
          <Text style={styles.line}><Text style={styles.key}>관찰 </Text>{trajectory.observation}</Text>
          <Text style={styles.line}><Text style={styles.key}>원인 </Text>{trajectory.cause}</Text>
          <Text style={styles.line}><Text style={styles.key}>교정 </Text>{trajectory.correction}</Text>
        </View>
      ) : null}

      {mainVisual ? (
        <View style={[styles.card, mainVisual.status === 'success' ? styles.goodCard : mainVisual.status === 'warning' ? styles.badCard : styles.warnCard]}>
          <View style={styles.cardHeading}>
            <Text style={styles.sectionLabel}>카메라 세부 판정</Text>
            <Text style={styles.badge}>{statusLabel(mainVisual)} · {mainVisual.confidencePercent}%</Text>
          </View>
          <Text style={styles.title}>{mainVisual.title}</Text>
          <Text style={styles.line}><Text style={styles.key}>측정 근거 </Text>{mainVisual.evidence}</Text>
          <Text style={styles.line}><Text style={styles.key}>지금 수정 </Text>{mainVisual.instruction}</Text>
          <Text style={styles.line}><Text style={styles.key}>다음 3회 목표 </Text>{mainVisual.nextGoal}</Text>
        </View>
      ) : (
        <View style={[styles.card, styles.neutralCard]}>
          <Text style={styles.sectionLabel}>카메라 세부 판정</Text>
          <Text style={styles.title}>신뢰 가능한 반복 동작을 모으는 중</Text>
          <Text style={styles.line}>손목·손가락 끝과 {preset.cameraFocus === 'right-hand' ? '브리지·사운드홀' : '지판'}이 잘리지 않게 같은 동작을 반복하세요.</Text>
        </View>
      )}

      <View style={[styles.card, dynamics.issue === 'stable' ? styles.goodCard : dynamics.issue === 'waiting' ? styles.neutralCard : styles.warnCard]}>
        <View style={styles.cardHeading}>
          <Text style={styles.sectionLabel}>소리·강약</Text>
          <Text style={styles.badge}>{dynamics.accentMatchPercent == null ? '표본 수집' : `악센트 ${dynamics.accentMatchPercent}%`}</Text>
        </View>
        <Text style={styles.title}>{dynamics.title}</Text>
        <Text style={styles.line}><Text style={styles.key}>관찰 </Text>{dynamics.observation}</Text>
        <Text style={styles.line}><Text style={styles.key}>교정 </Text>{dynamics.correction}</Text>
      </View>

      {positive ? (
        <View style={styles.positiveBar}>
          <Text style={styles.positiveLabel}>유지할 점</Text>
          <Text style={styles.positiveText}>{positive.title} · {positive.nextGoal}</Text>
        </View>
      ) : null}

      <View style={styles.drillCard}>
        <Text style={styles.drillLabel}>지금 할 보강훈련</Text>
        <Text style={styles.drillText}>{reinforcement}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#0d1117' },
  content: { padding: 7, gap: 6, paddingBottom: 10 },
  readyBar: { minHeight: 48, backgroundColor: '#111820', borderTopWidth: 1, borderColor: '#30363d', paddingHorizontal: 10, paddingVertical: 8 },
  readyTitle: { color: '#7ee787', fontSize: 9, fontWeight: '900' },
  readyText: { color: '#b1bac4', fontSize: 7, lineHeight: 11, marginTop: 2 },
  card: { borderRadius: 11, borderWidth: 1, padding: 9 },
  neutralCard: { borderColor: '#30363d', backgroundColor: '#161b22' },
  goodCard: { borderColor: '#2ea043', backgroundColor: '#102418' },
  warnCard: { borderColor: '#d29922', backgroundColor: '#251f08' },
  badCard: { borderColor: '#f85149', backgroundColor: '#2b1618' },
  cardHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sectionLabel: { color: '#79c0ff', fontSize: 7, fontWeight: '900', letterSpacing: 0.5 },
  badge: { color: '#b1bac4', fontSize: 7, fontWeight: '900' },
  title: { color: '#ffffff', fontSize: 11, lineHeight: 15, fontWeight: '900', marginTop: 3 },
  line: { color: '#d0d7de', fontSize: 8, lineHeight: 13, marginTop: 3 },
  key: { color: '#7ee787', fontWeight: '900' },
  positiveBar: { flexDirection: 'row', gap: 7, borderRadius: 10, borderWidth: 1, borderColor: '#2ea043', backgroundColor: '#102418', padding: 8 },
  positiveLabel: { color: '#7ee787', fontSize: 8, fontWeight: '900' },
  positiveText: { flex: 1, color: '#d2f2da', fontSize: 8, lineHeight: 12 },
  drillCard: { borderRadius: 11, borderWidth: 1, borderColor: '#58a6ff', backgroundColor: '#101d2d', padding: 9 },
  drillLabel: { color: '#79c0ff', fontSize: 8, fontWeight: '900' },
  drillText: { color: '#ffffff', fontSize: 9, lineHeight: 14, fontWeight: '800', marginTop: 3 },
});
