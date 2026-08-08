import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import LiveCoachDetailedAi from './LiveCoachDetailedAi';
import {
  isAdvancedMetronomeAvailable,
  MetronomeSoundPreset,
  prepareVoiceCountAsync,
  previewMetronomeSoundAsync,
  previewVoiceCountAsync,
  startAdvancedMetronomeAsync,
  stopAdvancedMetronomeAsync,
  updateAdvancedMetronomeAsync,
} from './modules/guitar-coach-metronome';

type MeterOption = { label: string; beats: number };
type SubdivisionOption = { value: 1 | 2 | 3 | 4; label: string; example: string };
type SoundOption = { value: MetronomeSoundPreset; label: string; detail: string };

const METER_OPTIONS: MeterOption[] = [
  { label: '2/4', beats: 2 },
  { label: '3/4', beats: 3 },
  { label: '4/4', beats: 4 },
  { label: '5/4', beats: 5 },
  { label: '6/8', beats: 6 },
  { label: '7/8', beats: 7 },
  { label: '9/8', beats: 9 },
  { label: '12/8', beats: 12 },
];

const SUBDIVISION_OPTIONS: SubdivisionOption[] = [
  { value: 1, label: '4분', example: '원 · 투 · 쓰리 · 포' },
  { value: 2, label: '8분', example: '원 앤 · 투 앤' },
  { value: 3, label: '셋잇단', example: '원 트립 렛 · 투 트립 렛' },
  { value: 4, label: '16분', example: '원 이 앤 어 · 투 이 앤 어' },
];

const SOUND_OPTIONS: SoundOption[] = [
  { value: 0, label: '클래식', detail: '기본 비프 클릭' },
  { value: 1, label: '높은 클릭', detail: '밝고 잘 들리는 고음' },
  { value: 2, label: '낮은 클릭', detail: '묵직한 저음 계열' },
  { value: 3, label: '디지털', detail: '짧고 선명한 전자음' },
  { value: 4, label: '부드러운', detail: '짧고 덜 자극적인 클릭' },
];

const NUMBER_LABELS = ['원', '투', '쓰리', '포', '파이브', '식스', '세븐', '에잇', '나인', '텐', '일레븐', '트웰브'];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function countToken(pulseIndex: number, beats: number, subdivision: number) {
  const safeSubdivision = clamp(Math.round(subdivision), 1, 4);
  const beatIndex = Math.floor(pulseIndex / safeSubdivision) % Math.max(1, beats);
  const subIndex = pulseIndex % safeSubdivision;
  const number = NUMBER_LABELS[beatIndex] ?? String(beatIndex + 1);
  if (safeSubdivision === 1) return number;
  if (safeSubdivision === 2) return subIndex === 0 ? number : '앤';
  if (safeSubdivision === 3) return subIndex === 0 ? number : subIndex === 1 ? '트립' : '렛';
  return subIndex === 0 ? number : subIndex === 1 ? '이' : subIndex === 2 ? '앤' : '어';
}

function OptionButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.optionButton, active && styles.optionButtonActive, pressed && styles.pressed]}
    >
      <Text style={[styles.optionButtonText, active && styles.optionButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

export default function LiveCoachTestAppV058() {
  const [expanded, setExpanded] = useState(true);
  const [bpm, setBpm] = useState(70);
  const [bpmInput, setBpmInput] = useState('70');
  const [meterLabel, setMeterLabel] = useState('4/4');
  const [subdivision, setSubdivision] = useState<1 | 2 | 3 | 4>(1);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [soundPreset, setSoundPreset] = useState<MetronomeSoundPreset>(0);
  const [voiceStatus, setVoiceStatus] = useState('사람 음성 꺼짐');
  const [running, setRunning] = useState(false);
  const [pulseIndex, setPulseIndex] = useState(0);
  const [error, setError] = useState('');
  const visualTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionBusyRef = useRef(false);

  const meter = useMemo(
    () => METER_OPTIONS.find((option) => option.label === meterLabel) ?? METER_OPTIONS[2],
    [meterLabel],
  );
  const subdivisionOption = useMemo(
    () => SUBDIVISION_OPTIONS.find((option) => option.value === subdivision) ?? SUBDIVISION_OPTIONS[0],
    [subdivision],
  );
  const soundOption = useMemo(
    () => SOUND_OPTIONS.find((option) => option.value === soundPreset) ?? SOUND_OPTIONS[0],
    [soundPreset],
  );

  useEffect(() => () => { void stopAdvancedMetronomeAsync(); }, []);

  useEffect(() => {
    if (!running) return;
    void updateAdvancedMetronomeAsync(
      bpm,
      meter.beats,
      subdivision,
      soundEnabled,
      voiceEnabled,
      soundPreset,
    ).catch((caught) => {
      setError(caught instanceof Error ? caught.message : '메트로놈 설정 변경에 실패했습니다.');
      setRunning(false);
    });
  }, [bpm, meter.beats, running, soundEnabled, soundPreset, subdivision, voiceEnabled]);

  useEffect(() => {
    if (visualTimerRef.current) clearTimeout(visualTimerRef.current);
    if (!running) {
      setPulseIndex(0);
      return;
    }

    let cancelled = false;
    let nextAt = Date.now() + 55;
    let nextPulse = 0;
    const intervalMs = 60000 / bpm / subdivision;
    const totalPulses = Math.max(1, meter.beats * subdivision);
    const tick = () => {
      if (cancelled) return;
      setPulseIndex(nextPulse);
      nextPulse = (nextPulse + 1) % totalPulses;
      nextAt += intervalMs;
      visualTimerRef.current = setTimeout(tick, Math.max(0, nextAt - Date.now()));
    };
    visualTimerRef.current = setTimeout(tick, 55);
    return () => {
      cancelled = true;
      if (visualTimerRef.current) clearTimeout(visualTimerRef.current);
      visualTimerRef.current = null;
    };
  }, [bpm, meter.beats, running, subdivision]);

  const setSafeBpm = (next: number) => {
    const safe = clamp(Math.round(next), 35, 220);
    setBpm(safe);
    setBpmInput(String(safe));
  };

  const commitBpm = () => {
    const parsed = Number(bpmInput);
    if (!Number.isFinite(parsed)) {
      setBpmInput(String(bpm));
      return;
    }
    setSafeBpm(parsed);
  };

  const prepareVoice = async () => {
    setVoiceStatus('사람 음성 준비 중…');
    const result = await prepareVoiceCountAsync();
    if (!result.ready) throw new Error(result.message || '사람 음성을 준비하지 못했습니다.');
    setVoiceStatus(`사람 음성 준비 완료 · ${result.language || '시스템 음성'}`);
  };

  const setVoice = (next: boolean) => {
    if (!next) {
      setVoiceEnabled(false);
      setVoiceStatus('사람 음성 꺼짐');
      return;
    }
    setError('');
    void prepareVoice()
      .then(() => setVoiceEnabled(true))
      .catch((caught) => {
        setVoiceEnabled(false);
        setVoiceStatus('사람 음성 준비 실패');
        setError(caught instanceof Error ? caught.message : '사람 음성을 준비하지 못했습니다.');
      });
  };

  const toggleRunning = async () => {
    if (actionBusyRef.current) return;
    actionBusyRef.current = true;
    setError('');
    try {
      if (running) {
        await stopAdvancedMetronomeAsync();
        setRunning(false);
        return;
      }
      if (!isAdvancedMetronomeAvailable) throw new Error('고급 메트로놈 모듈이 없습니다.');
      if (!soundEnabled && !voiceEnabled) throw new Error('클릭음 또는 사람 음성 중 하나를 켜 주세요.');
      if (voiceEnabled) await prepareVoice();
      await startAdvancedMetronomeAsync(
        bpm,
        meter.beats,
        subdivision,
        soundEnabled,
        voiceEnabled,
        soundPreset,
      );
      setRunning(true);
    } catch (caught) {
      setRunning(false);
      setError(caught instanceof Error ? caught.message : '메트로놈을 시작하지 못했습니다.');
    } finally {
      actionBusyRef.current = false;
    }
  };

  const previewVoice = async () => {
    if (actionBusyRef.current) return;
    actionBusyRef.current = true;
    setError('');
    try {
      await prepareVoice();
      await previewVoiceCountAsync(subdivision);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '사람 음성 미리듣기에 실패했습니다.');
    } finally {
      actionBusyRef.current = false;
    }
  };

  const previewSound = async () => {
    setError('');
    try {
      await previewMetronomeSoundAsync(soundPreset);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '선택한 클릭음을 재생하지 못했습니다.');
    }
  };

  const currentToken = countToken(pulseIndex, meter.beats, subdivision);
  const beatNumber = Math.floor(pulseIndex / subdivision) + 1;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle}>기타 코치 AI 0.5.8</Text>
          <Text style={styles.headerStatus}>
            {running ? `${meter.label} · ${bpm} BPM · ${soundOption.label} · ${currentToken}` : '음원 선택 · 손가락 21관절 · 피크 분석'}
          </Text>
        </View>
        <Pressable onPress={() => setExpanded((value) => !value)} style={({ pressed }) => [styles.expandButton, pressed && styles.pressed]}>
          <Text style={styles.expandButtonText}>{expanded ? '접기' : '열기'}</Text>
        </Pressable>
      </View>

      {expanded ? (
        <ScrollView style={styles.panelScroll} contentContainerStyle={styles.panel} nestedScrollEnabled>
          <View style={styles.liveRow}>
            <View>
              <Text style={styles.liveLabel}>현재 카운트</Text>
              <Text style={styles.liveCount}>{running ? currentToken : '대기'}</Text>
            </View>
            <View style={styles.liveMetaWrap}>
              <Text style={styles.liveMeta}>{running ? `${bpm} BPM 적용 중` : `${bpm} BPM 설정`}</Text>
              <Text style={styles.liveMeta}>{running ? `${beatNumber}박` : meter.label}</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>BPM · 실행 중 즉시 변경</Text>
          <View style={styles.bpmRow}>
            <OptionButton label="-10" active={false} onPress={() => setSafeBpm(bpm - 10)} />
            <OptionButton label="-1" active={false} onPress={() => setSafeBpm(bpm - 1)} />
            <TextInput
              accessibilityLabel="메트로놈 BPM"
              keyboardType="number-pad"
              maxLength={3}
              onBlur={commitBpm}
              onChangeText={setBpmInput}
              onSubmitEditing={commitBpm}
              selectTextOnFocus
              style={styles.bpmInput}
              value={bpmInput}
            />
            <OptionButton label="+1" active={false} onPress={() => setSafeBpm(bpm + 1)} />
            <OptionButton label="+10" active={false} onPress={() => setSafeBpm(bpm + 10)} />
          </View>

          <Text style={styles.sectionTitle}>박자</Text>
          <View style={styles.optionWrap}>
            {METER_OPTIONS.map((option) => <OptionButton key={option.label} label={option.label} active={meter.label === option.label} onPress={() => setMeterLabel(option.label)} />)}
          </View>

          <Text style={styles.sectionTitle}>음표 분할</Text>
          <View style={styles.optionWrap}>
            {SUBDIVISION_OPTIONS.map((option) => <OptionButton key={option.value} label={option.label} active={subdivision === option.value} onPress={() => setSubdivision(option.value)} />)}
          </View>
          <Text style={styles.exampleText}>{subdivisionOption.example}</Text>

          <Text style={styles.sectionTitle}>클릭 음원</Text>
          <View style={styles.optionWrap}>
            {SOUND_OPTIONS.map((option) => <OptionButton key={option.value} label={option.label} active={soundPreset === option.value} onPress={() => setSoundPreset(option.value)} />)}
          </View>
          <Text style={styles.exampleText}>{soundOption.detail}</Text>

          <View style={styles.switchRow}>
            <View style={styles.switchTextWrap}>
              <Text style={styles.switchTitle}>클릭음</Text>
              <Text style={styles.switchDetail}>선택한 음원으로 세부 박마다 재생</Text>
            </View>
            <Switch value={soundEnabled} onValueChange={setSoundEnabled} />
          </View>

          <View style={styles.switchRow}>
            <View style={styles.switchTextWrap}>
              <Text style={styles.switchTitle}>사람 음성 카운트</Text>
              <Text style={styles.switchDetail}>{voiceStatus}</Text>
            </View>
            <Switch value={voiceEnabled} onValueChange={setVoice} />
          </View>

          <View style={styles.actionRow}>
            <Pressable onPress={() => void toggleRunning()} style={({ pressed }) => [styles.primaryButton, running && styles.stopButton, pressed && styles.pressed]}>
              <Text style={styles.primaryButtonText}>{running ? '메트로놈 정지' : `${bpm} BPM 시작`}</Text>
            </Pressable>
            <Pressable onPress={() => void previewSound()} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
              <Text style={styles.secondaryButtonText}>클릭음 테스트</Text>
            </Pressable>
            <Pressable onPress={() => void previewVoice()} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
              <Text style={styles.secondaryButtonText}>음성 테스트</Text>
            </Pressable>
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <Text style={styles.compatText}>메트로놈을 접어도 아래 AI 분석과 함께 계속 작동합니다.</Text>
        </ScrollView>
      ) : null}

      <View style={styles.appWrap}>
        <LiveCoachDetailedAi />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#30363d', backgroundColor: '#161b22' },
  headerTextWrap: { flex: 1, paddingRight: 10 },
  headerTitle: { color: '#f0f6fc', fontSize: 18, fontWeight: '900' },
  headerStatus: { color: '#7ee787', fontSize: 10, fontWeight: '800', marginTop: 3 },
  expandButton: { minWidth: 54, minHeight: 38, borderRadius: 12, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  expandButtonText: { color: '#f0f6fc', fontSize: 11, fontWeight: '900' },
  panelScroll: { maxHeight: 500, backgroundColor: '#0d1117', borderBottomWidth: 1, borderBottomColor: '#30363d' },
  panel: { padding: 12, paddingBottom: 18 },
  liveRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 16, padding: 13 },
  liveLabel: { color: '#8b949e', fontSize: 10, fontWeight: '800' },
  liveCount: { color: '#7ee787', fontSize: 30, fontWeight: '900', marginTop: 2 },
  liveMetaWrap: { alignItems: 'flex-end', gap: 5 },
  liveMeta: { color: '#b1bac4', fontSize: 11, fontWeight: '900' },
  sectionTitle: { color: '#f0f6fc', fontSize: 13, fontWeight: '900', marginTop: 14, marginBottom: 8 },
  bpmRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  bpmInput: { flex: 1, minWidth: 70, height: 48, borderRadius: 13, borderWidth: 1, borderColor: '#2ea043', backgroundColor: '#161b22', color: '#7ee787', fontSize: 24, fontWeight: '900', textAlign: 'center' },
  optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  optionButton: { minHeight: 40, minWidth: 51, borderRadius: 12, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 8 },
  optionButtonActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  optionButtonText: { color: '#b1bac4', fontSize: 11, fontWeight: '900' },
  optionButtonTextActive: { color: '#ffffff' },
  exampleText: { color: '#79c0ff', fontSize: 11, fontWeight: '800', marginTop: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#30363d' },
  switchTextWrap: { flex: 1, paddingRight: 12 },
  switchTitle: { color: '#f0f6fc', fontSize: 12, fontWeight: '900' },
  switchDetail: { color: '#8b949e', fontSize: 10, lineHeight: 15, marginTop: 3 },
  actionRow: { flexDirection: 'row', gap: 6, marginTop: 12 },
  primaryButton: { flex: 1.2, minHeight: 47, borderRadius: 13, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  stopButton: { backgroundColor: '#da3633' },
  primaryButtonText: { color: '#ffffff', fontSize: 11, fontWeight: '900', textAlign: 'center' },
  secondaryButton: { flex: 1, minHeight: 47, borderRadius: 13, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  secondaryButtonText: { color: '#f0f6fc', fontSize: 10, fontWeight: '900', textAlign: 'center' },
  errorText: { color: '#ff7b72', fontSize: 11, lineHeight: 17, marginTop: 9 },
  compatText: { color: '#6e7681', fontSize: 9, textAlign: 'center', marginTop: 11 },
  appWrap: { flex: 1 },
  pressed: { opacity: 0.68, transform: [{ scale: 0.985 }] },
});
