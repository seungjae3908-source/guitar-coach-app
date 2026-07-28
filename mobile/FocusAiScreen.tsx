import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import {
  analyzeFocusSession,
  FOCUS_DRILLS,
  type FocusMode,
  type FocusSession,
} from './focus-engine';

const STORAGE_KEY = 'guitar-coach-focus-ai-v1';
const MODES: FocusMode[] = ['코드', '핑거링', '아르페지오', '스트럼', '피킹'];
const DURATIONS = [30, 60, 180, 300];

type Phase = 'idle' | 'countdown' | 'running' | 'analyzing' | 'result';
type Sensitivity = '낮음' | '보통' | '높음';

type StoredFocusState = {
  sessions: FocusSession[];
  voiceFeedback: boolean;
  haptics: boolean;
  sensitivity: Sensitivity;
};

const DEFAULT_STATE: StoredFocusState = {
  sessions: [],
  voiceFeedback: true,
  haptics: true,
  sensitivity: '보통',
};

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}`;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function normalizeMetering(db: number | undefined) {
  if (typeof db !== 'number' || !Number.isFinite(db)) return 0;
  return clamp01((db + 58) / 58);
}

function sensitivityThreshold(value: Sensitivity) {
  if (value === '높음') return 0.14;
  if (value === '낮음') return 0.34;
  return 0.23;
}

function Metric({ label, value, suffix = '점' }: { label: string; value: number; suffix?: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}{suffix}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function ModeChip({ mode, active, disabled, onPress }: { mode: FocusMode; active: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.chip, active && styles.chipActive, disabled && styles.disabled]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{mode}</Text>
    </Pressable>
  );
}

export default function FocusAiScreen({ onClose }: { onClose: () => void }) {
  const recordingOptions = useMemo(() => ({
    ...RecordingPresets.HIGH_QUALITY,
    numberOfChannels: 1,
    isMeteringEnabled: true,
  }), []);
  const recorder = useAudioRecorder(recordingOptions);
  const recorderState = useAudioRecorderState(recorder, 80);

  const [stored, setStored] = useState<StoredFocusState>(DEFAULT_STATE);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<FocusMode>('아르페지오');
  const [bpm, setBpm] = useState(60);
  const [durationSeconds, setDurationSeconds] = useState(60);
  const [phase, setPhase] = useState<Phase>('idle');
  const [countdown, setCountdown] = useState(3);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [beatIndex, setBeatIndex] = useState(0);
  const [liveLevel, setLiveLevel] = useState(0);
  const [detectedHits, setDetectedHits] = useState(0);
  const [result, setResult] = useState<FocusSession | null>(null);
  const [message, setMessage] = useState('연습 모드와 BPM을 고른 뒤 시작하세요.');

  const phaseRef = useRef<Phase>('idle');
  const startedAtRef = useRef(0);
  const hitTimesRef = useRef<number[]>([]);
  const hitLevelsRef = useRef<number[]>([]);
  const previousAboveRef = useRef(false);
  const lastPeakAtRef = useRef(-1000);
  const finishingRef = useRef(false);

  const drill = FOCUS_DRILLS[mode];
  const beatMs = 60000 / bpm;
  const inputIntervalMs = 60000 / (bpm * drill.subdivision);
  const remainingSeconds = Math.max(0, Math.ceil((durationSeconds * 1000 - elapsedMs) / 1000));

  const setCurrentPhase = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<StoredFocusState>;
        setStored({
          sessions: parsed.sessions ?? [],
          voiceFeedback: parsed.voiceFeedback ?? true,
          haptics: parsed.haptics ?? true,
          sensitivity: parsed.sensitivity ?? '보통',
        });
      })
      .catch(() => Alert.alert('기록 불러오기 실패', '집중 연습 기록을 읽지 못했습니다.'))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  }, [loaded, stored]);

  useEffect(() => {
    setBpm(FOCUS_DRILLS[mode].defaultBpm);
  }, [mode]);

  useEffect(() => {
    if (phase !== 'countdown') return;
    const timer = setTimeout(() => {
      if (stored.haptics) void Haptics.selectionAsync();
      if (countdown <= 1) {
        void beginRecording();
      } else {
        setCountdown((value) => value - 1);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdown, phase, stored.haptics]);

  useEffect(() => {
    if (phase !== 'running') return;
    const timer = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      setElapsedMs(elapsed);
      if (elapsed >= durationSeconds * 1000) void finishSession();
    }, 80);
    return () => clearInterval(timer);
  }, [durationSeconds, phase]);

  useEffect(() => {
    if (phase !== 'running') return;
    const timer = setInterval(() => {
      setBeatIndex((value) => (value + 1) % 4);
      if (stored.haptics) void Haptics.selectionAsync();
    }, beatMs);
    return () => clearInterval(timer);
  }, [beatMs, phase, stored.haptics]);

  useEffect(() => {
    if (phase !== 'running') return;
    const level = normalizeMetering(recorderState.metering);
    setLiveLevel(level);
    const elapsed = Date.now() - startedAtRef.current;
    const threshold = sensitivityThreshold(stored.sensitivity);
    const above = level >= threshold;
    const refractoryMs = Math.max(90, inputIntervalMs * 0.28);

    if (above && !previousAboveRef.current && elapsed - lastPeakAtRef.current >= refractoryMs) {
      hitTimesRef.current.push(elapsed);
      hitLevelsRef.current.push(level);
      lastPeakAtRef.current = elapsed;
      setDetectedHits(hitTimesRef.current.length);
    }
    previousAboveRef.current = above;
  }, [inputIntervalMs, phase, recorderState.metering, stored.sensitivity]);

  useEffect(() => () => {
    void Speech.stop();
    if (phaseRef.current === 'running') void recorder.stop().catch(() => undefined);
  }, [recorder]);

  const requestMicrophone = async () => {
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('마이크 권한 필요', '설정에서 기타 코치 AI의 마이크 권한을 허용해 주세요.');
      return false;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    return true;
  };

  const prepareSession = async () => {
    if (phase !== 'idle' && phase !== 'result') return;
    const granted = await requestMicrophone();
    if (!granted) return;
    try {
      await recorder.prepareToRecordAsync(recordingOptions);
      hitTimesRef.current = [];
      hitLevelsRef.current = [];
      previousAboveRef.current = false;
      lastPeakAtRef.current = -1000;
      finishingRef.current = false;
      setDetectedHits(0);
      setLiveLevel(0);
      setElapsedMs(0);
      setBeatIndex(0);
      setResult(null);
      setCountdown(3);
      setMessage('3초 뒤 마이크 분석과 메트로놈이 시작됩니다.');
      setCurrentPhase('countdown');
    } catch (error) {
      Alert.alert('마이크 준비 실패', error instanceof Error ? error.message : '마이크를 준비하지 못했습니다.');
    }
  };

  const beginRecording = async () => {
    try {
      startedAtRef.current = Date.now();
      recorder.record();
      setElapsedMs(0);
      setMessage('연주 중입니다. 초록 막대가 소리에 반응하는지 확인하세요.');
      setCurrentPhase('running');
    } catch (error) {
      setCurrentPhase('idle');
      Alert.alert('분석 시작 실패', error instanceof Error ? error.message : '녹음을 시작하지 못했습니다.');
    }
  };

  const finishSession = async () => {
    if (finishingRef.current || phaseRef.current !== 'running') return;
    finishingRef.current = true;
    setCurrentPhase('analyzing');
    setMessage('연주 데이터를 계산하고 있습니다.');
    const actualDuration = Math.max(1, Math.min(durationSeconds, Math.round((Date.now() - startedAtRef.current) / 1000)));

    try {
      await recorder.stop();
    } catch {
      // A session can still be scored from collected metering data.
    }

    const analysis = analyzeFocusSession({
      mode,
      bpm,
      durationSeconds: actualDuration,
      hitTimesMs: hitTimesRef.current,
      hitLevels: hitLevelsRef.current,
    });
    const session: FocusSession = {
      id: `focus-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
      mode,
      bpm,
      durationSeconds: actualDuration,
      metrics: analysis.metrics,
      feedback: analysis.feedback,
      analysisKind: 'device-rule-engine-v1',
    };

    setStored((current) => ({ ...current, sessions: [session, ...current.sessions].slice(0, 30) }));
    setResult(session);
    setElapsedMs(actualDuration * 1000);
    setMessage('기기 내 분석이 완료되었습니다.');
    setCurrentPhase('result');
    finishingRef.current = false;

    if (stored.haptics) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (stored.voiceFeedback) {
      void Speech.stop();
      Speech.speak(`점수 ${session.metrics.overallScore}점. ${session.feedback[0]}`, {
        language: 'ko-KR',
        rate: 0.92,
      });
    }
  };

  const reset = () => {
    setElapsedMs(0);
    setDetectedHits(0);
    setLiveLevel(0);
    setResult(null);
    setMessage('연습 모드와 BPM을 고른 뒤 시작하세요.');
    setCurrentPhase('idle');
  };

  const stopEarly = () => {
    if (elapsedMs < 3000) {
      void recorder.stop().catch(() => undefined);
      reset();
      return;
    }
    void finishSession();
  };

  if (!loaded) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator size="large" color="#7ee787" />
        <Text style={styles.loadingText}>집중 연습 기록 불러오는 중</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#080b10" />
      <View style={styles.header}>
        <Pressable style={styles.closeButton} onPress={phase === 'running' ? stopEarly : onClose}>
          <Text style={styles.closeText}>{phase === 'running' ? '중지' : '닫기'}</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerEyebrow}>DEVICE AI COACH · BETA</Text>
          <Text style={styles.headerTitle}>AI 집중 연습</Text>
        </View>
        <View style={styles.betaBadge}><Text style={styles.betaText}>규칙 기반</Text></View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>현재 분석 범위</Text>
          <Text style={styles.noticeText}>마이크 음량 피크와 메트로놈의 시간 차이를 이용해 박자·간격·음량 안정성을 분석합니다. 손 모양, 정확한 음정, 코드 이름을 판정하는 생성형 AI는 아직 아닙니다.</Text>
        </View>

        <Text style={styles.sectionTitle}>1. 연습 종류</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {MODES.map((item) => (
            <ModeChip key={item} mode={item} active={mode === item} disabled={phase === 'running' || phase === 'countdown' || phase === 'analyzing'} onPress={() => setMode(item)} />
          ))}
        </ScrollView>

        <View style={styles.drillCard}>
          <Text style={styles.drillMode}>{mode}</Text>
          <Text style={styles.drillTitle}>{drill.title}</Text>
          <Text style={styles.pattern}>{drill.pattern}</Text>
          <Text style={styles.instruction}>{drill.instruction}</Text>
        </View>

        <Text style={styles.sectionTitle}>2. 속도와 시간</Text>
        <View style={styles.controlCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.controlLabel}>BPM</Text>
            <View style={styles.stepper}>
              <Pressable disabled={phase === 'running'} style={styles.stepButton} onPress={() => setBpm((value) => Math.max(35, value - 5))}><Text style={styles.stepText}>−</Text></Pressable>
              <Text style={styles.bpmValue}>{bpm}</Text>
              <Pressable disabled={phase === 'running'} style={styles.stepButton} onPress={() => setBpm((value) => Math.min(180, value + 5))}><Text style={styles.stepText}>＋</Text></Pressable>
            </View>
          </View>
          <View style={styles.durationRow}>
            {DURATIONS.map((seconds) => (
              <Pressable key={seconds} disabled={phase === 'running'} onPress={() => setDurationSeconds(seconds)} style={[styles.durationButton, durationSeconds === seconds && styles.durationActive]}>
                <Text style={[styles.durationText, durationSeconds === seconds && styles.durationTextActive]}>{seconds < 60 ? `${seconds}초` : `${seconds / 60}분`}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Text style={styles.sectionTitle}>3. 마이크 감도</Text>
        <View style={styles.sensitivityRow}>
          {(['낮음', '보통', '높음'] as Sensitivity[]).map((value) => (
            <Pressable key={value} disabled={phase === 'running'} onPress={() => setStored((current) => ({ ...current, sensitivity: value }))} style={[styles.sensitivityButton, stored.sensitivity === value && styles.sensitivityActive]}>
              <Text style={styles.sensitivityText}>{value}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.helpText}>잡음이 많이 잡히면 낮음, 기타 소리가 잘 안 잡히면 높음을 선택하세요.</Text>

        <View style={[styles.liveCard, phase === 'running' && styles.liveCardActive]}>
          <View style={styles.rowBetween}>
            <Text style={styles.liveLabel}>{phase === 'countdown' ? '준비' : phase === 'running' ? '실시간 분석' : phase === 'analyzing' ? '분석 중' : '연습 대기'}</Text>
            <Text style={styles.timer}>{phase === 'countdown' ? countdown : formatDuration(phase === 'idle' ? durationSeconds : remainingSeconds)}</Text>
          </View>
          <View style={styles.beatRow}>
            {[0, 1, 2, 3].map((value) => <View key={value} style={[styles.beatDot, phase === 'running' && beatIndex === value && styles.beatDotActive]} />)}
          </View>
          <View style={styles.levelTrack}><View style={[styles.levelFill, { width: `${Math.max(2, liveLevel * 100)}%` }]} /></View>
          <View style={styles.liveStats}>
            <Metric label="감지 입력" value={detectedHits} suffix="회" />
            <Metric label="목표 간격" value={Math.round(inputIntervalMs)} suffix="ms" />
            <Metric label="현재 음량" value={Math.round(liveLevel * 100)} suffix="%" />
          </View>
          <Text style={styles.liveMessage}>{message}</Text>
          {phase === 'idle' || phase === 'result' ? (
            <Pressable style={styles.startButton} onPress={prepareSession}><Text style={styles.startText}>{phase === 'result' ? '같은 설정으로 다시 연습' : '3초 카운트 후 분석 시작'}</Text></Pressable>
          ) : phase === 'running' ? (
            <Pressable style={styles.stopButton} onPress={stopEarly}><Text style={styles.stopText}>중지하고 결과 보기</Text></Pressable>
          ) : null}
        </View>

        {result ? (
          <View>
            <Text style={styles.sectionTitle}>분석 결과</Text>
            <View style={styles.resultCard}>
              <View style={styles.scoreCircle}><Text style={styles.score}>{result.metrics.overallScore}</Text><Text style={styles.scoreUnit}>점</Text></View>
              <View style={styles.resultSummary}>
                <Text style={styles.resultTitle}>{result.mode} · {result.bpm} BPM</Text>
                <Text style={styles.resultMeta}>{formatDuration(result.durationSeconds)} · 입력 {result.metrics.detectedHits}/{result.metrics.expectedHits}회</Text>
                <Text style={styles.resultMeta}>평균 박자 오차 {result.metrics.averageTimingErrorMs}ms</Text>
              </View>
            </View>
            <View style={styles.metricGrid}>
              <Metric label="박자 정확도" value={result.metrics.timingScore} />
              <Metric label="간격 일관성" value={result.metrics.consistencyScore} />
              <Metric label="음량 안정성" value={result.metrics.volumeScore} />
              <Metric label="입력 완성도" value={result.metrics.activityScore} />
            </View>
            {result.feedback.map((feedback, index) => (
              <View key={`${result.id}-${index}`} style={styles.feedbackCard}>
                <Text style={styles.feedbackIndex}>{index + 1}</Text>
                <Text style={styles.feedbackText}>{feedback}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>코칭 설정</Text>
        <View style={styles.settingsCard}>
          <View style={styles.settingRow}><View style={styles.settingCopy}><Text style={styles.settingTitle}>결과 음성 읽기</Text><Text style={styles.settingDescription}>연습 종료 후 첫 번째 교정을 한국어로 읽습니다.</Text></View><Switch value={stored.voiceFeedback} onValueChange={(value) => setStored((current) => ({ ...current, voiceFeedback: value }))} trackColor={{ false: '#30363d', true: '#238636' }} /></View>
          <View style={styles.settingRow}><View style={styles.settingCopy}><Text style={styles.settingTitle}>박자 진동</Text><Text style={styles.settingDescription}>매 박마다 짧은 진동으로 메트로놈을 느낍니다.</Text></View><Switch value={stored.haptics} onValueChange={(value) => setStored((current) => ({ ...current, haptics: value }))} trackColor={{ false: '#30363d', true: '#238636' }} /></View>
        </View>

        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>최근 집중 연습</Text>
          {stored.sessions.length > 0 ? <Pressable onPress={() => Alert.alert('기록 삭제', '집중 연습 분석 기록을 모두 삭제할까요?', [{ text: '취소', style: 'cancel' }, { text: '삭제', style: 'destructive', onPress: () => setStored((current) => ({ ...current, sessions: [] })) }])}><Text style={styles.clearText}>전체 삭제</Text></Pressable> : null}
        </View>
        {stored.sessions.length === 0 ? <Text style={styles.emptyText}>완료한 집중 연습이 아직 없습니다.</Text> : stored.sessions.slice(0, 8).map((session) => (
          <View key={session.id} style={styles.historyCard}>
            <View><Text style={styles.historyTitle}>{session.mode} · {session.bpm} BPM</Text><Text style={styles.historyMeta}>{new Date(session.createdAt).toLocaleString('ko-KR')} · {formatDuration(session.durationSeconds)}</Text></View>
            <Text style={styles.historyScore}>{session.metrics.overallScore}점</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#080b10' },
  loading: { flex: 1, backgroundColor: '#080b10', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#8b949e', marginTop: 12 },
  header: { minHeight: 74, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#21262d' },
  closeButton: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 12, backgroundColor: '#21262d' },
  closeText: { color: '#f0f6fc', fontWeight: '800' },
  headerCenter: { flex: 1, marginLeft: 14 },
  headerEyebrow: { color: '#7ee787', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  headerTitle: { color: '#f0f6fc', fontSize: 23, fontWeight: '900', marginTop: 3 },
  betaBadge: { borderWidth: 1, borderColor: '#d29922', backgroundColor: '#332701', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 6 },
  betaText: { color: '#f2cc60', fontSize: 9, fontWeight: '900' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  noticeCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#d29922', borderRadius: 16, padding: 15 },
  noticeTitle: { color: '#f2cc60', fontWeight: '900', fontSize: 13 },
  noticeText: { color: '#b1bac4', fontSize: 12, lineHeight: 19, marginTop: 6 },
  sectionTitle: { color: '#f0f6fc', fontSize: 17, fontWeight: '900', marginTop: 22, marginBottom: 10 },
  chipRow: { paddingRight: 14 },
  chip: { paddingHorizontal: 15, paddingVertical: 10, borderRadius: 18, backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', marginRight: 8 },
  chipActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  chipText: { color: '#8b949e', fontWeight: '800' },
  chipTextActive: { color: '#ffffff' },
  disabled: { opacity: 0.55 },
  drillCard: { marginTop: 12, backgroundColor: '#0d1117', borderWidth: 1, borderColor: '#30363d', borderRadius: 20, padding: 18 },
  drillMode: { color: '#7ee787', fontSize: 11, fontWeight: '900' },
  drillTitle: { color: '#f0f6fc', fontSize: 20, fontWeight: '900', marginTop: 6 },
  pattern: { color: '#58a6ff', fontSize: 25, fontWeight: '900', letterSpacing: 2, textAlign: 'center', marginVertical: 20 },
  instruction: { color: '#b1bac4', fontSize: 13, lineHeight: 20 },
  controlCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 18, padding: 15 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  controlLabel: { color: '#f0f6fc', fontWeight: '900', fontSize: 15 },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  stepText: { color: '#f0f6fc', fontSize: 22, fontWeight: '900' },
  bpmValue: { color: '#7ee787', fontSize: 25, fontWeight: '900', minWidth: 72, textAlign: 'center' },
  durationRow: { flexDirection: 'row', marginTop: 15 },
  durationButton: { flex: 1, paddingVertical: 10, backgroundColor: '#21262d', marginRight: 6, borderRadius: 10, alignItems: 'center' },
  durationActive: { backgroundColor: '#1f6feb' },
  durationText: { color: '#8b949e', fontSize: 11, fontWeight: '800' },
  durationTextActive: { color: '#ffffff' },
  sensitivityRow: { flexDirection: 'row' },
  sensitivityButton: { flex: 1, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', paddingVertical: 11, marginRight: 8, borderRadius: 12, alignItems: 'center' },
  sensitivityActive: { borderColor: '#2ea043', backgroundColor: '#183b23' },
  sensitivityText: { color: '#f0f6fc', fontWeight: '800' },
  helpText: { color: '#6e7681', fontSize: 11, marginTop: 8, lineHeight: 16 },
  liveCard: { marginTop: 22, backgroundColor: '#0d1117', borderWidth: 1, borderColor: '#30363d', borderRadius: 22, padding: 18 },
  liveCardActive: { borderColor: '#2ea043' },
  liveLabel: { color: '#7ee787', fontSize: 13, fontWeight: '900' },
  timer: { color: '#f0f6fc', fontSize: 32, fontWeight: '900', fontVariant: ['tabular-nums'] },
  beatRow: { flexDirection: 'row', justifyContent: 'center', marginVertical: 18 },
  beatDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#30363d', marginHorizontal: 9 },
  beatDotActive: { backgroundColor: '#7ee787', transform: [{ scale: 1.35 }] },
  levelTrack: { height: 14, backgroundColor: '#21262d', borderRadius: 8, overflow: 'hidden' },
  levelFill: { height: '100%', backgroundColor: '#2ea043', borderRadius: 8 },
  liveStats: { flexDirection: 'row', marginTop: 15 },
  metric: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  metricValue: { color: '#f0f6fc', fontSize: 17, fontWeight: '900' },
  metricLabel: { color: '#8b949e', fontSize: 10, marginTop: 4 },
  liveMessage: { color: '#b1bac4', textAlign: 'center', fontSize: 12, lineHeight: 18, marginVertical: 9 },
  startButton: { backgroundColor: '#2ea043', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  startText: { color: '#ffffff', fontSize: 15, fontWeight: '900' },
  stopButton: { backgroundColor: '#da3633', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  stopText: { color: '#ffffff', fontSize: 15, fontWeight: '900' },
  resultCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 20, padding: 17 },
  scoreCircle: { width: 90, height: 90, borderRadius: 45, borderWidth: 8, borderColor: '#2ea043', alignItems: 'center', justifyContent: 'center' },
  score: { color: '#f0f6fc', fontSize: 30, fontWeight: '900' },
  scoreUnit: { color: '#8b949e', fontSize: 10 },
  resultSummary: { flex: 1, marginLeft: 16 },
  resultTitle: { color: '#f0f6fc', fontSize: 17, fontWeight: '900' },
  resultMeta: { color: '#8b949e', fontSize: 12, marginTop: 6 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#0d1117', borderWidth: 1, borderColor: '#30363d', borderRadius: 16, marginTop: 10 },
  feedbackCard: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#161b22', borderLeftWidth: 4, borderLeftColor: '#f2cc60', borderRadius: 14, padding: 14, marginTop: 9 },
  feedbackIndex: { width: 25, height: 25, borderRadius: 13, backgroundColor: '#332701', color: '#f2cc60', textAlign: 'center', textAlignVertical: 'center', fontWeight: '900' },
  feedbackText: { flex: 1, color: '#f0f6fc', fontSize: 13, lineHeight: 20, marginLeft: 10 },
  settingsCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 16, paddingHorizontal: 14 },
  settingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#21262d' },
  settingCopy: { flex: 1, paddingRight: 12 },
  settingTitle: { color: '#f0f6fc', fontWeight: '800' },
  settingDescription: { color: '#8b949e', fontSize: 11, lineHeight: 16, marginTop: 4 },
  clearText: { color: '#ff7b72', fontSize: 12, fontWeight: '800', marginTop: 13 },
  emptyText: { color: '#6e7681', textAlign: 'center', padding: 24 },
  historyCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 14, padding: 14, marginBottom: 8 },
  historyTitle: { color: '#f0f6fc', fontWeight: '800' },
  historyMeta: { color: '#8b949e', fontSize: 10, marginTop: 5 },
  historyScore: { color: '#7ee787', fontSize: 19, fontWeight: '900' },
});
