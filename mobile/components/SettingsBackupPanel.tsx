import { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { MetronomeSoundPreset } from '../modules/guitar-coach-metronome';
import {
  clearGuitarCoachLocalData,
  createGuitarCoachBackup,
  parseGuitarCoachBackup,
  restoreGuitarCoachBackup,
  stringifyGuitarCoachBackup,
  summarizeGuitarCoachBackup,
} from '../services/app-backup';
import { useGuitarCoachAppSettings } from '../services/app-settings';
import { useGuitarModePreference } from '../hooks/use-guitar-mode-preference';

const SOUND_OPTIONS: Array<{ value: MetronomeSoundPreset; label: string }> = [
  { value: 0, label: '클래식' },
  { value: 1, label: '높은 클릭' },
  { value: 2, label: '낮은 클릭' },
  { value: 3, label: '디지털' },
  { value: 4, label: '부드러운' },
];

function SettingRow({
  title,
  detail,
  value,
  onValueChange,
}: {
  title: string;
  detail: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingTextWrap}>
        <Text style={styles.settingTitle}>{title}</Text>
        <Text style={styles.settingDetail}>{detail}</Text>
      </View>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

export default function SettingsBackupPanel() {
  const { settings, updateSettings, refreshSettings, resetSettings } = useGuitarCoachAppSettings();
  const { mode, refreshMode } = useGuitarModePreference();
  const [backupText, setBackupText] = useState('');
  const [importText, setImportText] = useState('');
  const [status, setStatus] = useState('설정은 이 휴대폰에 자동 저장됩니다.');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const importSummary = useMemo(() => {
    if (!importText.trim()) return null;
    try {
      return summarizeGuitarCoachBackup(parseGuitarCoachBackup(importText));
    } catch {
      return null;
    }
  }, [importText]);

  const makeBackup = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const backup = await createGuitarCoachBackup();
      const text = stringifyGuitarCoachBackup(backup);
      setBackupText(text);
      const summary = summarizeGuitarCoachBackup(backup);
      setStatus(`백업 생성 완료 · 세션 ${summary.practiceSessionCount} · 곡 ${summary.songProjectCount} · 보정 ${summary.cameraCalibrationCount}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '백업을 만들지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const shareBackup = async () => {
    if (!backupText) {
      await makeBackup();
      return;
    }
    try {
      await Share.share({
        title: '기타 코치 AI 0.6.0 백업',
        message: backupText,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '백업 공유창을 열지 못했습니다.');
    }
  };

  const restore = () => {
    setError('');
    let backup;
    try {
      backup = parseGuitarCoachBackup(importText);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '백업을 확인하지 못했습니다.');
      return;
    }
    const summary = summarizeGuitarCoachBackup(backup);
    Alert.alert(
      '백업 복원',
      `현재 데이터를 백업 내용으로 덮어씁니다.\n연습 ${summary.practiceSessionCount}회 · 곡 ${summary.songProjectCount}개 · 촬영보정 ${summary.cameraCalibrationCount}개`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '복원',
          onPress: () => {
            setBusy(true);
            void restoreGuitarCoachBackup(backup, { clearMissing: false })
              .then(async () => {
                await Promise.all([refreshSettings(), refreshMode()]);
                setStatus('백업 복원 완료 · 각 화면을 다시 열면 복원된 데이터가 표시됩니다.');
                setImportText('');
              })
              .catch((caught) => setError(caught instanceof Error ? caught.message : '백업을 복원하지 못했습니다.'))
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  };

  const clearAll = () => {
    Alert.alert(
      '앱 데이터 초기화',
      '연습 기록, 곡 악보, 촬영 보정, 최근 영상 목록과 설정을 모두 지웁니다. 갤러리 영상 원본은 삭제하지 않습니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '모두 초기화',
          style: 'destructive',
          onPress: () => {
            setBusy(true);
            void clearGuitarCoachLocalData()
              .then(async () => {
                await Promise.all([refreshSettings(), refreshMode()]);
                setBackupText('');
                setImportText('');
                setStatus('로컬 앱 데이터를 초기화했습니다. 갤러리 영상은 유지됩니다.');
              })
              .catch((caught) => setError(caught instanceof Error ? caught.message : '데이터를 초기화하지 못했습니다.'))
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.eyebrow}>SETTINGS & LOCAL BACKUP</Text>
      <Text style={styles.title}>설정·백업</Text>
      <Text style={styles.subtitle}>모든 설정과 분석 기록은 휴대폰에 저장합니다. 백업 JSON에는 보안 키나 서버 계정 정보가 들어가지 않습니다.</Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>공통 연습 설정</Text>
        <SettingRow
          title="AI 사람 음성 코칭"
          detail="중요한 문제 한 개만 간격을 두고 한국어로 안내"
          value={settings.voiceCoachEnabled}
          onValueChange={(value) => void updateSettings({ voiceCoachEnabled: value })}
        />
        <SettingRow
          title="저전력 카메라 AI"
          detail="분석 간격을 늘리고 촬영 품질을 낮춰 발열 감소"
          value={settings.lowPowerMode}
          onValueChange={(value) => void updateSettings({ lowPowerMode: value })}
        />

        <Text style={styles.settingTitleStandalone}>튜너 기준 A4</Text>
        <View style={styles.stepRow}>
          <Pressable onPress={() => void updateSettings({ defaultReferenceA4: settings.defaultReferenceA4 - 1 })} style={styles.stepButton}><Text style={styles.stepText}>-1</Text></Pressable>
          <Text style={styles.referenceValue}>{settings.defaultReferenceA4} Hz</Text>
          <Pressable onPress={() => void updateSettings({ defaultReferenceA4: settings.defaultReferenceA4 + 1 })} style={styles.stepButton}><Text style={styles.stepText}>+1</Text></Pressable>
        </View>

        <Text style={styles.settingTitleStandalone}>기본 클릭 음원</Text>
        <View style={styles.optionWrap}>
          {SOUND_OPTIONS.map((item) => (
            <Pressable
              key={item.value}
              onPress={() => void updateSettings({ defaultMetronomeSound: item.value })}
              style={[styles.optionButton, settings.defaultMetronomeSound === item.value && styles.optionButtonActive]}
            >
              <Text style={[styles.optionText, settings.defaultMetronomeSound === item.value && styles.optionTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={() => void resetSettings()} style={styles.resetSettingsButton}>
          <Text style={styles.resetSettingsText}>공통 설정 기본값 복원</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>현재 상태</Text>
        <Text style={styles.summaryText}>기타 모드 · {mode === 'acoustic' ? '통기타' : mode === 'electric' ? '일렉기타' : '미선택'}</Text>
        <Text style={styles.summaryText}>사람 음성 · {settings.voiceCoachEnabled ? '켜짐' : '꺼짐'}</Text>
        <Text style={styles.summaryText}>카메라 AI · {settings.lowPowerMode ? '저전력' : '정밀'}</Text>
        <Text style={styles.summaryText}>튜너 · A4 {settings.defaultReferenceA4}Hz</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>전체 백업 내보내기</Text>
        <Text style={styles.helpText}>연습 기록·곡 악보·촬영 보정·앱 설정·영상 목록 메타데이터를 하나의 JSON으로 만듭니다.</Text>
        <View style={styles.actionRow}>
          <Pressable disabled={busy} onPress={() => void makeBackup()} style={[styles.primaryButton, busy && styles.disabled]}><Text style={styles.primaryText}>{busy ? '처리 중…' : '백업 만들기'}</Text></Pressable>
          <Pressable disabled={busy} onPress={() => void shareBackup()} style={[styles.secondaryButton, busy && styles.disabled]}><Text style={styles.secondaryText}>공유하기</Text></Pressable>
        </View>
        {backupText ? (
          <TextInput
            value={backupText}
            editable={false}
            multiline
            selectTextOnFocus
            style={styles.backupText}
          />
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>백업 붙여넣기·복원</Text>
        <Text style={styles.helpText}>이전에 공유해 둔 JSON 전체를 아래 칸에 붙여넣으세요.</Text>
        <TextInput
          value={importText}
          onChangeText={setImportText}
          editable={!busy}
          multiline
          placeholder="여기에 기타 코치 AI 백업 JSON 붙여넣기"
          placeholderTextColor="#6e7681"
          style={styles.importText}
        />
        {importSummary ? (
          <View style={styles.importSummaryCard}>
            <Text style={styles.importSummaryText}>연습 {importSummary.practiceSessionCount}회 · 곡 {importSummary.songProjectCount}개 · 촬영보정 {importSummary.cameraCalibrationCount}개 · 영상목록 {importSummary.recordingMetadataCount}개</Text>
          </View>
        ) : null}
        <Pressable disabled={!importText.trim() || busy} onPress={restore} style={[styles.restoreButton, (!importText.trim() || busy) && styles.disabled]}>
          <Text style={styles.restoreText}>백업 복원</Text>
        </Pressable>
      </View>

      <View style={styles.dangerCard}>
        <Text style={styles.dangerTitle}>로컬 데이터 초기화</Text>
        <Text style={styles.dangerDetail}>앱 내부 기록만 지우며 휴대폰 갤러리의 영상 원본은 유지합니다.</Text>
        <Pressable disabled={busy} onPress={clearAll} style={[styles.dangerButton, busy && styles.disabled]}><Text style={styles.dangerButtonText}>앱 데이터 모두 초기화</Text></Pressable>
      </View>

      <View style={styles.statusCard}><Text style={styles.statusText}>{status}</Text></View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  content: { padding: 12, paddingBottom: 90 },
  eyebrow: { color: '#79c0ff', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  title: { color: '#f0f6fc', fontSize: 20, fontWeight: '900', marginTop: 3 },
  subtitle: { color: '#8b949e', fontSize: 9, lineHeight: 15, marginTop: 5 },
  card: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 16, padding: 11, marginTop: 10 },
  sectionTitle: { color: '#f0f6fc', fontSize: 12, fontWeight: '900', marginBottom: 6 },
  settingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#30363d' },
  settingTextWrap: { flex: 1, paddingRight: 8 },
  settingTitle: { color: '#f0f6fc', fontSize: 9, fontWeight: '900' },
  settingDetail: { color: '#8b949e', fontSize: 7, lineHeight: 12, marginTop: 3 },
  settingTitleStandalone: { color: '#f0f6fc', fontSize: 9, fontWeight: '900', marginTop: 11, marginBottom: 6 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  stepButton: { width: 43, height: 35, borderRadius: 9, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  stepText: { color: '#f0f6fc', fontSize: 9, fontWeight: '900' },
  referenceValue: { color: '#7ee787', fontSize: 18, fontWeight: '900', minWidth: 92, textAlign: 'center' },
  optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  optionButton: { minHeight: 34, borderRadius: 9, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', justifyContent: 'center', paddingHorizontal: 10 },
  optionButtonActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  optionText: { color: '#b1bac4', fontSize: 8, fontWeight: '900' },
  optionTextActive: { color: '#ffffff' },
  resetSettingsButton: { minHeight: 38, borderRadius: 10, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', marginTop: 11 },
  resetSettingsText: { color: '#b1bac4', fontSize: 8, fontWeight: '900' },
  summaryText: { color: '#b1bac4', fontSize: 9, lineHeight: 16 },
  helpText: { color: '#8b949e', fontSize: 8, lineHeight: 13 },
  actionRow: { flexDirection: 'row', gap: 6, marginTop: 9 },
  primaryButton: { flex: 1.2, minHeight: 42, borderRadius: 11, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  secondaryButton: { flex: 0.8, minHeight: 42, borderRadius: 11, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#f0f6fc', fontSize: 8, fontWeight: '900' },
  backupText: { maxHeight: 180, minHeight: 100, borderRadius: 10, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#0d1117', color: '#8b949e', fontSize: 7, lineHeight: 11, padding: 9, marginTop: 8, textAlignVertical: 'top' },
  importText: { minHeight: 130, maxHeight: 220, borderRadius: 10, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#0d1117', color: '#f0f6fc', fontSize: 8, lineHeight: 12, padding: 9, marginTop: 8, textAlignVertical: 'top' },
  importSummaryCard: { backgroundColor: '#111d2f', borderRadius: 10, padding: 8, marginTop: 7 },
  importSummaryText: { color: '#79c0ff', fontSize: 8, lineHeight: 13 },
  restoreButton: { minHeight: 42, borderRadius: 11, backgroundColor: '#1f6feb', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  restoreText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  dangerCard: { backgroundColor: '#2d1618', borderWidth: 1, borderColor: '#da3633', borderRadius: 15, padding: 11, marginTop: 10 },
  dangerTitle: { color: '#ff7b72', fontSize: 11, fontWeight: '900' },
  dangerDetail: { color: '#b1bac4', fontSize: 8, lineHeight: 13, marginTop: 4 },
  dangerButton: { minHeight: 40, borderRadius: 10, backgroundColor: '#da3633', alignItems: 'center', justifyContent: 'center', marginTop: 9 },
  dangerButtonText: { color: '#ffffff', fontSize: 8, fontWeight: '900' },
  statusCard: { backgroundColor: '#111d2f', borderWidth: 1, borderColor: '#1f6feb', borderRadius: 12, padding: 9, marginTop: 10 },
  statusText: { color: '#b6d8ff', fontSize: 8, lineHeight: 13 },
  errorText: { color: '#ff7b72', fontSize: 8, lineHeight: 13, marginTop: 7 },
  disabled: { opacity: 0.42 },
});
