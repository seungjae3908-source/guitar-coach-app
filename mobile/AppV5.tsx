import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useState } from 'react';
import { Alert, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';

import AppV4 from './AppV4';
import SafeFocusAiScreen from './SafeFocusAiScreen';

const STORAGE_KEY = 'guitar-coach-ai-state-v2';

type FocusAiRecord = {
  id: string;
  createdAt: string;
  mode: '코드' | '핑거링' | '아르페지오' | '스트럼' | '피킹';
  durationSeconds: number;
  source: '집중 코치';
  bpm: number;
  mistakes: number;
  coachScore: number;
  feedback: string;
  analysis?: {
    rhythmAccuracy: number;
    timingConsistency: number;
    dynamicStability: number;
    noiseControl: number;
    detectedAttacks: number;
    matchedBeats: number;
    expectedBeats: number;
    averageOffsetMs: number;
    confidence: number;
  };
};

type StoredState = {
  records?: FocusAiRecord[];
  [key: string]: unknown;
};

export default function AppV5() {
  const [focusOpen, setFocusOpen] = useState(false);
  const [appRevision, setAppRevision] = useState(0);
  const [saving, setSaving] = useState(false);

  const saveFocusRecord = useCallback(async (record: FocusAiRecord) => {
    setSaving(true);
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const current = raw ? (JSON.parse(raw) as StoredState) : {};
      const records = Array.isArray(current.records) ? current.records : [];
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ...current,
          records: [record, ...records].slice(0, 100),
        }),
      );
    } catch (error) {
      Alert.alert('기록 저장 실패', error instanceof Error ? error.message : 'AI 분석 결과를 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }, []);

  const closeFocus = () => {
    if (saving) return;
    setFocusOpen(false);
    setAppRevision((value) => value + 1);
  };

  if (focusOpen) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" backgroundColor="#0d1117" />
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={closeFocus} disabled={saving}>
            <Text style={styles.backText}>‹</Text>
          </Pressable>
          <View style={styles.headerTextBox}>
            <Text style={styles.brand}>GUITAR COACH AI</Text>
            <Text style={styles.title}>집중 연습 AI 분석</Text>
          </View>
          <View style={styles.versionBadge}>
            <Text style={styles.versionText}>0.5</Text>
          </View>
        </View>
        <ScrollView style={styles.focusBody} contentContainerStyle={styles.focusContent} showsVerticalScrollIndicator={false}>
          <SafeFocusAiScreen
            settings={{ haptics: true, voiceFeedback: false }}
            onSaveRecord={(record) => void saveFocusRecord(record)}
          />
        </ScrollView>
        {saving ? (
          <View style={styles.savingBar}>
            <Text style={styles.savingText}>AI 분석 기록 저장 중</Text>
          </View>
        ) : null}
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <AppV4 key={appRevision} />
      <Pressable style={styles.floatingButton} onPress={() => setFocusOpen(true)}>
        <Text style={styles.floatingIcon}>AI</Text>
        <View>
          <Text style={styles.floatingTitle}>집중 분석</Text>
          <Text style={styles.floatingSub}>소리·박자 측정</Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  safeArea: { flex: 1, backgroundColor: '#0d1117' },
  header: {
    height: 68,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#21262d',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#21262d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { color: '#f0f6fc', fontSize: 32, lineHeight: 34 },
  headerTextBox: { flex: 1, marginLeft: 11 },
  brand: { color: '#7ee787', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: '#f0f6fc', fontSize: 20, fontWeight: '900', marginTop: 2 },
  versionBadge: { backgroundColor: '#238636', borderRadius: 13, paddingHorizontal: 10, paddingVertical: 6 },
  versionText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  focusBody: { flex: 1 },
  focusContent: { padding: 14, paddingBottom: 72 },
  floatingButton: {
    position: 'absolute',
    right: 16,
    bottom: 86,
    minWidth: 142,
    backgroundColor: '#2ea043',
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  floatingIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    textAlign: 'center',
    textAlignVertical: 'center',
    color: '#0d1117',
    backgroundColor: '#7ee787',
    fontSize: 13,
    fontWeight: '900',
    marginRight: 9,
  },
  floatingTitle: { color: '#fff', fontSize: 13, fontWeight: '900' },
  floatingSub: { color: '#d8ffe0', fontSize: 9, marginTop: 2 },
  savingBar: { position: 'absolute', left: 14, right: 14, bottom: 14, backgroundColor: '#21262d', borderRadius: 13, paddingVertical: 11, alignItems: 'center' },
  savingText: { color: '#f2cc60', fontSize: 12, fontWeight: '900' },
});
