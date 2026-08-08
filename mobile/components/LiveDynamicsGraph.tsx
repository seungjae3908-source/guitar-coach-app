import { StyleSheet, Text, View } from 'react-native';

import type { DynamicsSnapshot } from '../services/dynamics-accent-engine';
import {
  audioFeedbackReady,
  MIN_AUDIO_EVIDENCE_ATTACKS,
} from '../services/feedback-evidence-gate';

export default function LiveDynamicsGraph({
  snapshot,
  active,
}: {
  snapshot: DynamicsSnapshot;
  active: boolean;
}) {
  const ready = audioFeedbackReady({
    microphoneActive: active,
    completedCycles: snapshot.completedCycles,
    acceptedAttacks: snapshot.acceptedAttacks,
  });

  if (!ready) {
    return (
      <View style={styles.waitingContainer}>
        <View style={styles.waitingTextWrap}>
          <Text style={styles.eyebrow}>강약·악센트</Text>
          <Text style={styles.waitingTitle}>{active ? '실제 기타 어택 대기' : '레슨 시작 후 소리 분석'}</Text>
          <Text style={styles.waitingText}>
            {active
              ? `신뢰 가능한 기타 어택 ${snapshot.acceptedAttacks}/${MIN_AUDIO_EVIDENCE_ATTACKS}개 · 기준을 채우기 전에는 점수나 경고를 표시하지 않습니다.`
              : '카메라 분석과 별개로, 레슨 시작 후 실제 기타 소리가 충분히 감지될 때만 강약을 판정합니다.'}
          </Text>
        </View>
        <Text style={styles.waitingBadge}>판정 대기</Text>
      </View>
    );
  }

  const points = snapshot.points.slice(-12);

  return (
    <View style={styles.container}>
      <View style={styles.headingRow}>
        <View style={styles.headingText}>
          <Text style={styles.eyebrow}>강약·악센트</Text>
          <Text style={styles.title}>{snapshot.title}</Text>
        </View>
        <View style={styles.scoreWrap}>
          <Text style={styles.scoreLabel}>악센트</Text>
          <Text style={styles.scoreValue}>{snapshot.accentMatchPercent == null ? '-' : `${snapshot.accentMatchPercent}%`}</Text>
        </View>
      </View>

      <View style={styles.graph}>
        {points.map((point) => (
          <View key={point.id} style={styles.slot}>
            <View style={styles.barArea}>
              <View style={[styles.targetMarker, { bottom: `${Math.min(100, point.target * 82)}%` }]} />
              <View
                style={[
                  styles.actualBar,
                  point.clipped && styles.clippedBar,
                  { height: `${Math.max(2, Math.min(100, point.actual * 82))}%` },
                ]}
              />
            </View>
            <Text style={styles.slotLabel}>{point.label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.legendRow}>
        <View style={styles.legendItem}><View style={styles.legendActual} /><Text style={styles.legendText}>실제 어택</Text></View>
        <View style={styles.legendItem}><View style={styles.legendTarget} /><Text style={styles.legendText}>목표 강약</Text></View>
        <Text style={styles.summary} numberOfLines={2}>{snapshot.observation}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  waitingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 14,
    backgroundColor: '#111820',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  waitingTextWrap: { flex: 1 },
  waitingTitle: { color: '#f0f6fc', fontSize: 11, fontWeight: '900', marginTop: 2 },
  waitingText: { color: '#8b949e', fontSize: 8, lineHeight: 13, marginTop: 3 },
  waitingBadge: { color: '#f2cc60', fontSize: 8, fontWeight: '900', backgroundColor: '#251f08', borderRadius: 9, paddingHorizontal: 8, paddingVertical: 6, overflow: 'hidden' },
  container: { backgroundColor: '#111820', borderWidth: 1, borderColor: '#30363d', borderRadius: 14, paddingHorizontal: 10, paddingTop: 9, paddingBottom: 8 },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  headingText: { flex: 1 },
  eyebrow: { color: '#79c0ff', fontSize: 8, fontWeight: '900', letterSpacing: 0.6 },
  title: { color: '#f0f6fc', fontSize: 11, fontWeight: '900', marginTop: 2 },
  scoreWrap: { minWidth: 50, alignItems: 'flex-end' },
  scoreLabel: { color: '#8b949e', fontSize: 7, fontWeight: '800' },
  scoreValue: { color: '#7ee787', fontSize: 12, fontWeight: '900', marginTop: 1 },
  graph: { height: 82, flexDirection: 'row', alignItems: 'stretch', gap: 3, marginTop: 7 },
  slot: { flex: 1, minWidth: 13, alignItems: 'center' },
  barArea: { flex: 1, width: '100%', justifyContent: 'flex-end', borderBottomWidth: 1, borderBottomColor: '#484f58' },
  actualBar: { width: '68%', alignSelf: 'center', borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: '#58a6ff' },
  clippedBar: { backgroundColor: '#ff7b72' },
  targetMarker: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: '#f2cc60' },
  slotLabel: { color: '#8b949e', fontSize: 7, fontWeight: '900', marginTop: 2 },
  legendRow: { minHeight: 20, flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  legendActual: { width: 7, height: 7, borderRadius: 2, backgroundColor: '#58a6ff' },
  legendTarget: { width: 9, height: 2, backgroundColor: '#f2cc60' },
  legendText: { color: '#8b949e', fontSize: 7 },
  summary: { flex: 1, color: '#b1bac4', fontSize: 7, lineHeight: 11, textAlign: 'right' },
});
