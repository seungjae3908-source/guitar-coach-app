import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { PracticePreset } from '../config/personal-practice-presets';
import type { DynamicsSnapshot } from '../services/dynamics-accent-engine';
import {
  audioFeedbackReady,
  MIN_VISUAL_EVIDENCE_FRAMES,
  visualFeedbackReady,
} from '../services/feedback-evidence-gate';
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
  acceptedFrameCount,
  sessionStartedAt,
  microphoneActive,
}: {
  running: boolean;
  preset: PracticePreset;
  trajectory: TrajectoryCoachResult | null;
  dynamics: DynamicsSnapshot;
  acceptedFrameCount: number;
  sessionStartedAt: number | null;
  microphoneActive: boolean;
}) {
  const [feedback, setFeedback] = useState<LiveCoachFeedbackSnapshot>(() => getLiveCoachFeedbackSnapshot());

  useEffect(() => subscribeLiveCoachFeedbackStack(setFeedback), []);

  const visualReady = visualFeedbackReady({
    running,
    acceptedFrames: acceptedFrameCount,
    sessionStartedAt,
  });
  const soundReady = audioFeedbackReady({
    microphoneActive,
    completedCycles: dynamics.completedCycles,
    acceptedAttacks: dynamics.acceptedAttacks,
  });

  const visual = useMemo(
    () => feedback.active
      .filter((item) => (
        !item.id.startsWith('sound-')
        && item.category === preset.category
        && Boolean(sessionStartedAt && item.capturedAt >= sessionStartedAt)
      ))
      .slice(0, 3),
    [feedback.active, preset.category, sessionStartedAt],
  );
  const mainVisual = visual[0] ?? null;
  const positive = visual.find((item) => item.status === 'success') ?? null;
  const reinforcement = trajectory?.state === 'broken'
    ? trajectory.reinforcement
    : soundReady && dynamics.issue !== 'stable' && dynamics.issue !== 'waiting'
      ? dynamics.reinforcement
      : mainVisual?.nextGoal
        ? `${mainVisual.nextGoal} 문제 구간만 느리게 6~8회 반복하세요.`
        : '현재 패턴을 느린 속도에서 3회 안정적으로 반복하세요.';

  if (!running) {
    return (
      <View style={styles.readyBar}>
        <Text style={styles.readyTitle}>카메라 관절 오버레이만 자동 작동 중</Text>
        <Text style={styles.readyText}>레슨 시작 전에는 점수나 교정 판정을 만들지 않습니다. 레슨 시작 후 현재 세션의 연속 표본이 쌓여야 피드백이 열립니다.</Text>
      </View>
    );
  }

  if (!visualReady) {
    return (
      <View style={[styles.card, styles.neutralCard]}>
        <View style={styles.cardHeading}>
          <Text style={styles.sectionLabel}>카메라 판정 대기</Text>
          <Text style={styles.badge}>{acceptedFrameCount}/{MIN_VISUAL_EVIDENCE_FRAMES} 프레임</Text>
        </View>
        <Text style={styles.title}>손·자세를 연속으로 확인하는 중</Text>
        <Text style={styles.line}>현재 세션에서 손목과 손가락 또는 자세 관절이 충분히 잡히기 전에는 간격·궤적·자세 문제를 판단하지 않습니다.</Text>
        <Text style={styles.line}><Text style={styles.key}>촬영 위치 </Text>{preset.cameraFocus === 'right-hand' ? '브리지~사운드홀 안에 오른손 전체를 맞추세요.' : preset.cameraFocus === 'left-hand' ? '지판과 왼손 네 손가락을 함께 맞추세요.' : '머리부터 골반까지 상체가 보이게 맞추세요.'}</Text>
      </View>
    );
  }

  return (
    <View style={styles.content}>
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
          <Text style={styles.title}>현재 세션의 반복 동작을 비교하는 중</Text>
          <Text style={styles.line}>연속 표본은 확보됐지만 같은 동작의 반복 근거가 아직 부족합니다. 근거가 생길 때까지 문제를 만들어내지 않습니다.</Text>
        </View>
      )}

      {soundReady ? (
        <View style={[styles.card, dynamics.issue === 'stable' ? styles.goodCard : dynamics.issue === 'waiting' ? styles.neutralCard : styles.warnCard]}>
          <View style={styles.cardHeading}>
            <Text style={styles.sectionLabel}>소리·강약</Text>
            <Text style={styles.badge}>{dynamics.accentMatchPercent == null ? '표본 수집' : `악센트 ${dynamics.accentMatchPercent}%`}</Text>
          </View>
          <Text style={styles.title}>{dynamics.title}</Text>
          <Text style={styles.line}><Text style={styles.key}>관찰 </Text>{dynamics.observation}</Text>
          <Text style={styles.line}><Text style={styles.key}>교정 </Text>{dynamics.correction}</Text>
        </View>
      ) : null}

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
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 8 },
  readyBar: { minHeight: 58, backgroundColor: '#111820', borderWidth: 1, borderColor: '#30363d', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  readyTitle: { color: '#7ee787', fontSize: 10, fontWeight: '900' },
  readyText: { color: '#b1bac4', fontSize: 8, lineHeight: 13, marginTop: 3 },
  card: { borderRadius: 14, borderWidth: 1, padding: 11 },
  neutralCard: { borderColor: '#30363d', backgroundColor: '#161b22' },
  goodCard: { borderColor: '#2ea043', backgroundColor: '#102418' },
  warnCard: { borderColor: '#d29922', backgroundColor: '#251f08' },
  badCard: { borderColor: '#f85149', backgroundColor: '#2b1618' },
  cardHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sectionLabel: { color: '#79c0ff', fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  badge: { color: '#b1bac4', fontSize: 8, fontWeight: '900' },
  title: { color: '#ffffff', fontSize: 12, lineHeight: 17, fontWeight: '900', marginTop: 4 },
  line: { color: '#d0d7de', fontSize: 9, lineHeight: 15, marginTop: 4 },
  key: { color: '#7ee787', fontWeight: '900' },
  positiveBar: { flexDirection: 'row', gap: 7, borderRadius: 12, borderWidth: 1, borderColor: '#2ea043', backgroundColor: '#102418', padding: 9 },
  positiveLabel: { color: '#7ee787', fontSize: 9, fontWeight: '900' },
  positiveText: { flex: 1, color: '#d2f2da', fontSize: 9, lineHeight: 13 },
  drillCard: { borderRadius: 14, borderWidth: 1, borderColor: '#58a6ff', backgroundColor: '#101d2d', padding: 11 },
  drillLabel: { color: '#79c0ff', fontSize: 9, fontWeight: '900' },
  drillText: { color: '#ffffff', fontSize: 10, lineHeight: 15, fontWeight: '800', marginTop: 4 },
});
