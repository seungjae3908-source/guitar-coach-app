import { useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import CompleteBetaAppV060 from './CompleteBetaAppV060';
import TunerPanel from './components/TunerPanel';

export default function CompleteBetaAppV060Plus() {
  const [tool, setTool] = useState<'app' | 'tuner'>('app');

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.toolBar}>
        <View style={styles.toolTextWrap}>
          <Text style={styles.toolEyebrow}>0.6.0 COMPLETE BETA</Text>
          <Text style={styles.toolTitle}>{tool === 'tuner' ? '실시간 기타 튜너' : '통기타 · 일렉기타 AI 코치'}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => setTool((current) => current === 'tuner' ? 'app' : 'tuner')}
          style={({ pressed }) => [styles.toolButton, tool === 'tuner' && styles.toolButtonActive, pressed && styles.pressed]}
        >
          <Text style={styles.toolButtonText}>{tool === 'tuner' ? '연습으로' : '튜너'}</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        {tool === 'tuner' ? (
          <ScrollView style={styles.tunerScroll} contentContainerStyle={styles.tunerContent} showsVerticalScrollIndicator={false}>
            <TunerPanel />
            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>튜너 사용 순서</Text>
              <Text style={styles.infoText}>1. 시작을 누르고 마이크 권한을 허용합니다.</Text>
              <Text style={styles.infoText}>2. 원하는 튜닝과 A4 기준 주파수를 선택합니다.</Text>
              <Text style={styles.infoText}>3. 다른 줄을 뮤트하고 한 줄만 길게 튕깁니다.</Text>
              <Text style={styles.infoText}>4. 신뢰도가 낮거나 클리핑되면 음정 대신 촬영·소리 개선 안내가 표시됩니다.</Text>
            </View>
          </ScrollView>
        ) : (
          <CompleteBetaAppV060 />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  toolBar: { flexDirection: 'row', alignItems: 'center', minHeight: 58, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: '#161b22', borderBottomWidth: 1, borderBottomColor: '#30363d' },
  toolTextWrap: { flex: 1, paddingRight: 10 },
  toolEyebrow: { color: '#7ee787', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  toolTitle: { color: '#f0f6fc', fontSize: 14, fontWeight: '900', marginTop: 3 },
  toolButton: { minWidth: 64, minHeight: 39, borderRadius: 12, borderWidth: 1, borderColor: '#1f6feb', backgroundColor: '#111d2f', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  toolButtonActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  toolButtonText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  body: { flex: 1 },
  tunerScroll: { flex: 1, backgroundColor: '#0d1117' },
  tunerContent: { padding: 14, paddingBottom: 50 },
  infoCard: { backgroundColor: '#111d2f', borderWidth: 1, borderColor: '#1f6feb', borderRadius: 16, padding: 14, marginTop: 12 },
  infoTitle: { color: '#79c0ff', fontSize: 12, fontWeight: '900' },
  infoText: { color: '#b6d8ff', fontSize: 10, lineHeight: 17, marginTop: 5 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.985 }] },
});
