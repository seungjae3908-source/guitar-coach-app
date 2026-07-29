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
import CameraCalibrationWizard from './components/CameraCalibrationWizard';
import PracticeSessionRunnerV2 from './components/PracticeSessionRunnerV2';
import TunerPanel from './components/TunerPanel';
import { useGuitarModePreference } from './hooks/use-guitar-mode-preference';

type GlobalTool = 'app' | 'session' | 'calibration' | 'tuner';

const TOOL_LABELS: Array<{ id: GlobalTool; label: string }> = [
  { id: 'app', label: '홈' },
  { id: 'session', label: '집중연습' },
  { id: 'calibration', label: '촬영보정' },
  { id: 'tuner', label: '튜너' },
];

function toolTitle(tool: GlobalTool) {
  if (tool === 'session') return 'AI 집중 연습과 자동 기록';
  if (tool === 'calibration') return '손·줄·브리지 촬영 보정';
  if (tool === 'tuner') return '실시간 기타 튜너';
  return '통기타 · 일렉기타 AI 코치';
}

export default function CompleteBetaAppV060Plus() {
  const [tool, setTool] = useState<GlobalTool>('app');
  const { mode, loading } = useGuitarModePreference();

  const needsMode = tool === 'session' || tool === 'calibration';

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.toolBar}>
        <View style={styles.toolTextWrap}>
          <Text style={styles.toolEyebrow}>0.6.0 COMPLETE BETA · {mode === 'acoustic' ? '통기타' : mode === 'electric' ? '일렉기타' : '모드 미선택'}</Text>
          <Text style={styles.toolTitle}>{toolTitle(tool)}</Text>
        </View>
      </View>

      <ScrollView
        horizontal
        style={styles.toolScroll}
        contentContainerStyle={styles.toolRow}
        showsHorizontalScrollIndicator={false}
      >
        {TOOL_LABELS.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            onPress={() => setTool(item.id)}
            style={({ pressed }) => [
              styles.toolButton,
              tool === item.id && styles.toolButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.toolButtonText, tool === item.id && styles.toolButtonTextActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.body}>
        {loading ? (
          <View style={styles.center}>
            <Text style={styles.infoText}>기타 모드를 불러오는 중입니다.</Text>
          </View>
        ) : needsMode && !mode ? (
          <View style={styles.center}>
            <Text style={styles.infoTitle}>먼저 통기타 또는 일렉기타를 선택하세요</Text>
            <Text style={styles.infoText}>홈 화면에서 모드를 선택하면 집중 연습과 촬영 보정이 해당 기준으로 실행됩니다.</Text>
            <Pressable onPress={() => setTool('app')} style={styles.modeButton}>
              <Text style={styles.modeButtonText}>홈에서 기타 선택</Text>
            </Pressable>
          </View>
        ) : tool === 'tuner' ? (
          <ScrollView style={styles.tunerScroll} contentContainerStyle={styles.tunerContent} showsVerticalScrollIndicator={false}>
            <TunerPanel />
            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>튜너 사용 순서</Text>
              <Text style={styles.infoText}>1. 시작을 누르고 마이크 권한을 허용합니다.</Text>
              <Text style={styles.infoText}>2. 원하는 튜닝과 A4 기준 주파수를 선택합니다.</Text>
              <Text style={styles.infoText}>3. 다른 줄을 뮤트하고 한 줄만 길게 튕깁니다.</Text>
              <Text style={styles.infoText}>4. 신뢰도가 낮거나 클리핑되면 음정 대신 개선 안내가 표시됩니다.</Text>
            </View>
          </ScrollView>
        ) : tool === 'session' && mode ? (
          <PracticeSessionRunnerV2 mode={mode} onClose={() => setTool('app')} />
        ) : tool === 'calibration' && mode ? (
          <CameraCalibrationWizard mode={mode} onSaved={() => setTool('session')} onClose={() => setTool('app')} />
        ) : (
          <CompleteBetaAppV060 />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  toolBar: { flexDirection: 'row', alignItems: 'center', minHeight: 51, paddingHorizontal: 13, paddingVertical: 7, backgroundColor: '#161b22', borderBottomWidth: 1, borderBottomColor: '#30363d' },
  toolTextWrap: { flex: 1 },
  toolEyebrow: { color: '#7ee787', fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  toolTitle: { color: '#f0f6fc', fontSize: 13, fontWeight: '900', marginTop: 3 },
  toolScroll: { maxHeight: 48, backgroundColor: '#0d1117', borderBottomWidth: 1, borderBottomColor: '#30363d' },
  toolRow: { paddingHorizontal: 9, paddingVertical: 6, gap: 6 },
  toolButton: { minWidth: 66, minHeight: 34, borderRadius: 11, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 11 },
  toolButtonActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  toolButtonText: { color: '#b1bac4', fontSize: 9, fontWeight: '900' },
  toolButtonTextActive: { color: '#ffffff' },
  body: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  tunerScroll: { flex: 1, backgroundColor: '#0d1117' },
  tunerContent: { padding: 14, paddingBottom: 50 },
  infoCard: { backgroundColor: '#111d2f', borderWidth: 1, borderColor: '#1f6feb', borderRadius: 16, padding: 14, marginTop: 12 },
  infoTitle: { color: '#79c0ff', fontSize: 12, fontWeight: '900', textAlign: 'center' },
  infoText: { color: '#b6d8ff', fontSize: 10, lineHeight: 17, marginTop: 5, textAlign: 'center' },
  modeButton: { minHeight: 43, borderRadius: 12, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 16 },
  modeButtonText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  pressed: { opacity: 0.7, transform: [{ scale: 0.985 }] },
});
