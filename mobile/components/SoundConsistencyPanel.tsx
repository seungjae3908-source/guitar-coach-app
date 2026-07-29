import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  emptySoundConsistencySnapshot,
  getLatestSoundConsistency,
  SoundConsistencySnapshot,
  subscribeSoundConsistency,
} from '../services/sound-consistency-engine';

function metricValue(value: number | null, suffix: string) {
  return value == null ? '-' : `${value}${suffix}`;
}

function modeLabel(snapshot: SoundConsistencySnapshot) {
  if (snapshot.mode === 'same-note') return `${snapshot.noteLabel ?? '동일 음'} 정밀 비교`;
  if (snapshot.mode === 'pattern') return '패턴 전체 비교';
  return '표본 수집 중';
}

function scoreLabel(snapshot: SoundConsistencySnapshot) {
  if (!snapshot.judgeable || snapshot.score == null) return '판정 대기';
  if (snapshot.score >= 90) return '매우 일정';
  if (snapshot.score >= 80) return '안정';
  if (snapshot.score >= 68) return '조금 흔들림';
  return '집중 교정 필요';
}

export default function SoundConsistencyPanel({ running }: { running: boolean }) {
  const [snapshot, setSnapshot] = useState<SoundConsistencySnapshot>(() => getLatestSoundConsistency());

  useEffect(() => {
    const unsubscribe = subscribeSoundConsistency(setSnapshot);
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!running && snapshot.capturedAt === 0) setSnapshot(emptySoundConsistencySnapshot());
  }, [running, snapshot.capturedAt]);

  const statusStyle = useMemo(() => {
    if (!snapshot.judgeable || snapshot.score == null) return styles.waitingCard;
    if (snapshot.score >= 82) return styles.goodCard;
    if (snapshot.score >= 68) return styles.cautionCard;
    return styles.problemCard;
  }, [snapshot.judgeable, snapshot.score]);

  return (
    <View style={[styles.card, statusStyle]}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>LIVE SOUND CONSISTENCY</Text>
          <Text style={styles.title}>소리 품질·톤 일관성</Text>
          <Text style={styles.mode}>{modeLabel(snapshot)} · 표본 {snapshot.sampleCount}회 · 신뢰 {snapshot.confidencePercent}%</Text>
        </View>
        <View style={styles.scoreBox}>
          <Text style={styles.score}>{snapshot.score == null ? '-' : snapshot.score}</Text>
          <Text style={styles.scoreText}>{scoreLabel(snapshot)}</Text>
        </View>
      </View>

      <View style={styles.metricGrid}>
        <Metric label="음량 편차" value={metricValue(snapshot.volumeVariationPercent, '%')} />
        <Metric label="어택 편차" value={metricValue(snapshot.attackVariationPercent, '%')} />
        <Metric label="밝기 편차" value={metricValue(snapshot.brightnessVariationPercent, '%')} />
        <Metric label="서스테인" value={metricValue(snapshot.sustainVariationPercent, '%')} />
        <Metric label="음정 흔들림" value={metricValue(snapshot.pitchVariationCents, '¢')} />
        <Metric label="신호대잡음" value={metricValue(snapshot.averageSignalToNoiseDb, 'dB')} />
      </View>

      <View style={styles.coachBox}>
        <Text style={styles.coachTitle}>{snapshot.title}</Text>
        <Text style={styles.instruction}>{snapshot.instruction}</Text>
        <Text style={styles.evidence}>{snapshot.evidence}</Text>
      </View>

      <Text style={styles.notice}>
        동일 음은 4회 이상, 스트럼·코드·리프는 6회 이상에서만 판단합니다. 다른 음의 자연스러운 밝기 차이는 동일 톤 불량으로 계산하지 않습니다.
      </Text>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 8, marginTop: 8, borderWidth: 1, borderRadius: 16, padding: 12 },
  waitingCard: { backgroundColor: '#161b22', borderColor: '#30363d' },
  goodCard: { backgroundColor: '#102418', borderColor: '#2ea043' },
  cautionCard: { backgroundColor: '#251f08', borderColor: '#d29922' },
  problemCard: { backgroundColor: '#2b1618', borderColor: '#f85149' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start' },
  headerText: { flex: 1, paddingRight: 10 },
  eyebrow: { color: '#79c0ff', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  title: { color: '#f0f6fc', fontSize: 15, fontWeight: '900', marginTop: 3 },
  mode: { color: '#8b949e', fontSize: 7, lineHeight: 12, marginTop: 3 },
  scoreBox: { minWidth: 68, alignItems: 'center', borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.24)', paddingVertical: 7, paddingHorizontal: 8 },
  score: { color: '#7ee787', fontSize: 22, fontWeight: '900' },
  scoreText: { color: '#b1bac4', fontSize: 7, fontWeight: '800', marginTop: 1 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 10 },
  metricCard: { width: '31.8%', minHeight: 48, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.22)', alignItems: 'center', justifyContent: 'center', padding: 5 },
  metricValue: { color: '#f0f6fc', fontSize: 10, fontWeight: '900' },
  metricLabel: { color: '#8b949e', fontSize: 6, marginTop: 3 },
  coachBox: { borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)', padding: 10, marginTop: 9 },
  coachTitle: { color: '#f2cc60', fontSize: 10, fontWeight: '900' },
  instruction: { color: '#ffffff', fontSize: 10, lineHeight: 16, fontWeight: '800', marginTop: 4 },
  evidence: { color: '#b1bac4', fontSize: 7, lineHeight: 12, marginTop: 5 },
  notice: { color: '#8b949e', fontSize: 7, lineHeight: 12, marginTop: 8 },
});
