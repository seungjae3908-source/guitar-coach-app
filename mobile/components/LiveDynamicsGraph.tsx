import { StyleSheet, Text, View } from 'react-native';

import type { DynamicsSnapshot } from '../services/dynamics-accent-engine';

export default function LiveDynamicsGraph({
  snapshot,
  active,
}: {
  snapshot: DynamicsSnapshot;
  active: boolean;
}) {
  const points = snapshot.points.slice(-12);
  const maxSlots = Math.max(8, points.length);

  return (
    <View style={styles.container}>
      <View style={styles.headingRow}>
        <View>
          <Text style={styles.eyebrow}>강약·악센트</Text>
          <Text style={styles.title}>{active ? snapshot.title : '레슨 시작 후 실제 소리 비교'}</Text>
        </View>
        <View style={styles.scoreWrap}>
          <Text style={styles.scoreLabel}>악센트</Text>
          <Text style={styles.scoreValue}>{snapshot.accentMatchPercent == null ? '-' : `${snapshot.accentMatchPercent}%`}</Text>
        </View>
      </View>

      <View style={styles.graph}>
        {Array.from({ length: maxSlots }, (_, index) => {
          const point = points[index];
          const target = point?.target ?? (index % 4 === 0 ? 1 : index % 2 === 0 ? 0.76 : 0.60);
          const actual = point?.actual ?? 0;
          return (
            <View key={point?.id ?? `empty-${index}`} style={styles.slot}>
              <View style={styles.barArea}>
                <View style={[styles.targetMarker, { bottom: `${Math.min(100, target * 82)}%` }]} />
                <View
                  style={[
                    styles.actualBar,
                    point?.clipped && styles.clippedBar,
                    { height: `${Math.max(2, Math.min(100, actual * 82))}%` },
                  ]}
                />
              </View>
              <Text style={styles.slotLabel}>{point?.label ?? (index % 2 === 0 ? String(Math.floor(index / 2) + 1) : '&')}</Text>
            </View>
          );
        })}
      </View>

      <View style={styles.legendRow}>
        <View style={styles.legendItem}><View style={styles.legendActual} /><Text style={styles.legendText}>실제 어택</Text></View>
        <View style={styles.legendItem}><View style={styles.legendTarget} /><Text style={styles.legendText}>목표 강약</Text></View>
        <Text style={styles.summary} numberOfLines={1}>{active ? snapshot.observation : '카메라 궤적은 자동 분석 중이며, 강약 비교는 레슨에서 시작됩니다.'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#111820', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#30363d', paddingHorizontal: 9, paddingTop: 7, paddingBottom: 6 },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  eyebrow: { color: '#79c0ff', fontSize: 7, fontWeight: '900', letterSpacing: 0.6 },
  title: { color: '#f0f6fc', fontSize: 10, fontWeight: '900', marginTop: 1 },
  scoreWrap: { minWidth: 50, alignItems: 'flex-end' },
  scoreLabel: { color: '#8b949e', fontSize: 6, fontWeight: '800' },
  scoreValue: { color: '#7ee787', fontSize: 11, fontWeight: '900', marginTop: 1 },
  graph: { height: 74, flexDirection: 'row', alignItems: 'stretch', gap: 3, marginTop: 5 },
  slot: { flex: 1, minWidth: 13, alignItems: 'center' },
  barArea: { flex: 1, width: '100%', justifyContent: 'flex-end', borderBottomWidth: 1, borderBottomColor: '#484f58' },
  actualBar: { width: '68%', alignSelf: 'center', borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: '#58a6ff' },
  clippedBar: { backgroundColor: '#ff7b72' },
  targetMarker: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: '#f2cc60' },
  slotLabel: { color: '#8b949e', fontSize: 6, fontWeight: '900', marginTop: 2 },
  legendRow: { minHeight: 17, flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 3 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  legendActual: { width: 7, height: 7, borderRadius: 2, backgroundColor: '#58a6ff' },
  legendTarget: { width: 9, height: 2, backgroundColor: '#f2cc60' },
  legendText: { color: '#8b949e', fontSize: 6 },
  summary: { flex: 1, color: '#b1bac4', fontSize: 6, textAlign: 'right' },
});
