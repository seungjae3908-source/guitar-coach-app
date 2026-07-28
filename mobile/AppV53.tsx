import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraType, CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

type Screen = 'home' | 'camera' | 'focus' | 'records' | 'settings';
type FocusMode = '코드' | '핑거링' | '아르페지오' | '스트럼' | '피킹';
type FocusPhase = 'idle' | 'countdown' | 'running' | 'paused' | 'result';

type PracticeRecord = {
  id: string;
  createdAt: string;
  mode: FocusMode | '카메라';
  durationSeconds: number;
  bpm?: number;
  mistakes?: number;
  score?: number;
  feedback?: string;
};

type AppState = {
  records: PracticeRecord[];
  haptics: boolean;
  autoSaveVideo: boolean;
};

type FocusConfig = {
  pattern: string[];
  goal: string;
  tip: string;
  defaultBpm: number;
};

const STORAGE_KEY = 'guitar-coach-ai-v053-state';
const AI_ANALYZER_URL = 'https://seungjae3908-source.github.io/guitar-coach-app/?focus=1';

const DEFAULT_STATE: AppState = {
  records: [],
  haptics: true,
  autoSaveVideo: true,
};

const FOCUS_MODES: FocusMode[] = ['코드', '핑거링', '아르페지오', '스트럼', '피킹'];

const FOCUS_CONFIG: Record<FocusMode, FocusConfig> = {
  코드: {
    pattern: ['C', 'G', 'Am', 'F'],
    goal: '코드를 박자 안에서 한 번에 잡기',
    tip: '손가락을 하나씩 놓지 말고 공중에서 코드 모양을 먼저 만드세요.',
    defaultBpm: 55,
  },
  핑거링: {
    pattern: ['1', '2', '3', '4'],
    goal: '손가락 독립과 프렛 정확도 만들기',
    tip: '누르지 않는 손가락도 줄 가까이에 낮게 유지하세요.',
    defaultBpm: 60,
  },
  아르페지오: {
    pattern: ['P', 'I', 'P', 'M'],
    goal: '엄지·검지·중지 간격을 일정하게 만들기',
    tip: '검지를 앞으로 밀지 말고 접어서 연주한 뒤 바로 복귀하세요.',
    defaultBpm: 65,
  },
  스트럼: {
    pattern: ['↓', '↓↑', '↑', '↓↑'],
    goal: '다운·업 깊이와 손목 속도를 일정하게 만들기',
    tip: '피크는 줄 안쪽으로 2~3mm만 넣고 업스트로크는 얕게 스치세요.',
    defaultBpm: 70,
  },
  피킹: {
    pattern: ['D', 'U', 'D', 'U'],
    goal: '다운·업 이동 거리를 같게 만들기',
    tip: '팔이 아니라 손목의 작은 회전으로 피크 끝만 줄에 닿게 하세요.',
    defaultBpm: 70,
  },
};

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  const min = Math.floor(safe / 60);
  const sec = safe % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function dateLabel(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function PrimaryButton({ label, onPress, danger = false }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [styles.primaryButton, danger && styles.dangerButton, pressed && styles.buttonPressed]}
      onPress={onPress}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={({ pressed }) => [styles.secondaryButton, disabled && styles.disabledButton, pressed && !disabled && styles.buttonPressed]}
      onPress={onPress}
    >
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function HomeScreen({ state, onOpen, onOpenAi }: { state: AppState; onOpen: (screen: Screen) => void; onOpenAi: () => void }) {
  const totalSeconds = state.records.reduce((sum, item) => sum + item.durationSeconds, 0);
  const latest = state.records[0];

  return (
    <View>
      <Card>
        <Text style={styles.version}>0.5.3 직접 실행판</Text>
        <Text style={styles.heroTitle}>모든 버튼을 앱 시작 화면에 직접 연결했습니다.</Text>
        <Text style={styles.bodyText}>별도 덮개 화면 없이 카메라, 집중 연습, AI 분석, 기록이 각각 실제 동작으로 연결됩니다.</Text>
        <PrimaryButton label="집중 연습 시작" onPress={() => onOpen('focus')} />
        <Pressable style={({ pressed }) => [styles.aiHeroButton, pressed && styles.buttonPressed]} onPress={onOpenAi}>
          <Text style={styles.aiHeroTitle}>AI 소리·박자 분석 시작</Text>
          <Text style={styles.aiHeroSubtitle}>Chrome에서 마이크 분석 · 앱은 종료되지 않음</Text>
        </Pressable>
      </Card>

      <Text style={styles.sectionTitle}>기능</Text>
      <View style={styles.menuGrid}>
        <Pressable style={({ pressed }) => [styles.menuCard, pressed && styles.buttonPressed]} onPress={() => onOpen('camera')}>
          <Text style={styles.menuIcon}>◉</Text>
          <Text style={styles.menuTitle}>카메라 연습</Text>
          <Text style={styles.menuSubtitle}>전후면 전환·녹화·저장</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.menuCard, pressed && styles.buttonPressed]} onPress={() => onOpen('focus')}>
          <Text style={styles.menuIcon}>◎</Text>
          <Text style={styles.menuTitle}>집중 연습</Text>
          <Text style={styles.menuSubtitle}>패턴·BPM·박자·점수</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.menuCard, pressed && styles.buttonPressed]} onPress={onOpenAi}>
          <Text style={styles.menuIcon}>AI</Text>
          <Text style={styles.menuTitle}>AI 분석</Text>
          <Text style={styles.menuSubtitle}>마이크로 소리·박자 측정</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.menuCard, pressed && styles.buttonPressed]} onPress={() => onOpen('records')}>
          <Text style={styles.menuIcon}>▥</Text>
          <Text style={styles.menuTitle}>연습 기록</Text>
          <Text style={styles.menuSubtitle}>시간·BPM·실수·점수</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>연습 요약</Text>
      <Card>
        <View style={styles.summaryRow}>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryValue}>{state.records.length}</Text>
            <Text style={styles.summaryLabel}>저장 기록</Text>
          </View>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryValue}>{Math.round(totalSeconds / 60)}</Text>
            <Text style={styles.summaryLabel}>누적 분</Text>
          </View>
        </View>
        <Text style={styles.cardTitle}>최근 연습</Text>
        <Text style={styles.bodyText}>
          {latest ? `${latest.mode} · ${formatTime(latest.durationSeconds)}${latest.score !== undefined ? ` · ${latest.score}점` : ''}` : '아직 저장된 기록이 없습니다.'}
        </Text>
      </Card>
    </View>
  );
}

function CameraScreen({ state, onSave }: { state: AppState; onSave: (record: PracticeRecord) => void }) {
  const cameraRef = useRef<CameraView | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [cameraKey, setCameraKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  useEffect(() => () => cameraRef.current?.stopRecording(), []);

  const requestAllPermissions = async () => {
    const camera = await requestCameraPermission();
    const mic = await requestMicPermission();
    if (!camera.granted || !mic.granted) {
      Alert.alert('권한 필요', '카메라와 마이크 권한을 허용해야 녹화할 수 있습니다.');
    }
  };

  const switchCamera = () => {
    if (recording) return;
    setReady(false);
    setFacing((value) => (value === 'back' ? 'front' : 'back'));
    setCameraKey((value) => value + 1);
    if (state.haptics) void Haptics.selectionAsync();
  };

  const startRecording = async () => {
    if (!ready || !cameraRef.current) {
      Alert.alert('카메라 준비 중', '카메라 화면이 열린 뒤 다시 눌러 주세요.');
      return;
    }
    if (!cameraPermission?.granted || !micPermission?.granted) {
      await requestAllPermissions();
      return;
    }

    setElapsed(0);
    startedAt.current = Date.now();
    setRecording(true);

    try {
      const result = await cameraRef.current.recordAsync({ maxDuration: 600 });
      const duration = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
      if (result?.uri && state.autoSaveVideo) {
        const mediaPermission = await MediaLibrary.requestPermissionsAsync(true);
        if (mediaPermission.granted) await MediaLibrary.saveToLibraryAsync(result.uri);
      }
      onSave({ id: makeId('camera'), createdAt: new Date().toISOString(), mode: '카메라', durationSeconds: duration });
      Alert.alert('녹화 완료', state.autoSaveVideo ? '갤러리 저장을 완료했습니다.' : '연습 기록을 저장했습니다.');
    } catch (error) {
      Alert.alert('녹화 실패', error instanceof Error ? error.message : '영상을 저장하지 못했습니다.');
    } finally {
      setRecording(false);
    }
  };

  const stopRecording = () => {
    if (!recording) return;
    cameraRef.current?.stopRecording();
  };

  if (!cameraPermission || !micPermission) {
    return <ActivityIndicator color="#7ee787" size="large" />;
  }

  if (!cameraPermission.granted || !micPermission.granted) {
    return (
      <Card>
        <Text style={styles.cardTitle}>카메라·마이크 권한이 필요합니다.</Text>
        <Text style={styles.bodyText}>권한을 허용하면 실제 카메라 미리보기와 영상 녹화를 사용할 수 있습니다.</Text>
        <PrimaryButton label="권한 허용" onPress={() => void requestAllPermissions()} />
      </Card>
    );
  }

  return (
    <View>
      <View style={styles.cameraShell}>
        <CameraView
          key={`${facing}-${cameraKey}`}
          ref={cameraRef}
          style={styles.cameraView}
          facing={facing}
          mode="video"
          onCameraReady={() => setReady(true)}
        />
        <View style={styles.cameraTop}>
          <Text style={styles.cameraBadge}>{facing === 'back' ? '후면 카메라' : '전면 카메라'}</Text>
          <Text style={styles.cameraTimer}>{formatTime(elapsed)}</Text>
        </View>
        <View style={styles.cameraGuide}>
          <Text style={styles.cameraGuideText}>오른손·손목·기타 줄이 모두 보이게 맞추세요.</Text>
        </View>
      </View>
      <View style={styles.twoButtons}>
        <SecondaryButton label={facing === 'back' ? '전면으로 전환' : '후면으로 전환'} onPress={switchCamera} disabled={recording} />
        <PrimaryButton label={recording ? '녹화 종료' : '녹화 시작'} onPress={recording ? stopRecording : () => void startRecording()} danger={recording} />
      </View>
    </View>
  );
}

function FocusScreen({ state, onSave, onOpenAi }: { state: AppState; onSave: (record: PracticeRecord) => void; onOpenAi: () => void }) {
  const [mode, setMode] = useState<FocusMode>('아르페지오');
  const config = FOCUS_CONFIG[mode];
  const [bpm, setBpm] = useState(config.defaultBpm);
  const [targetSeconds, setTargetSeconds] = useState(30);
  const [remaining, setRemaining] = useState(30);
  const [phase, setPhase] = useState<FocusPhase>('idle');
  const [countdown, setCountdown] = useState(3);
  const [beatIndex, setBeatIndex] = useState(0);
  const [bars, setBars] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [result, setResult] = useState<{ score: number; feedback: string; practiced: number } | null>(null);

  useEffect(() => {
    if (phase !== 'countdown') return;
    const timer = setTimeout(() => {
      if (state.haptics) void Haptics.selectionAsync();
      if (countdown <= 1) {
        setPhase('running');
        setCountdown(3);
      } else {
        setCountdown((value) => value - 1);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdown, phase, state.haptics]);

  useEffect(() => {
    if (phase !== 'running') return;
    const timer = setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'running') return;
    const beatMs = Math.max(250, Math.round(60000 / bpm));
    const timer = setInterval(() => {
      setBeatIndex((value) => {
        const next = (value + 1) % config.pattern.length;
        if (next === 0) setBars((bar) => bar + 1);
        return next;
      });
      if (state.haptics) void Haptics.selectionAsync();
    }, beatMs);
    return () => clearInterval(timer);
  }, [bpm, config.pattern.length, phase, state.haptics]);

  useEffect(() => {
    if (phase === 'running' && remaining === 0) finish(true);
  }, [phase, remaining]);

  const changeMode = (nextMode: FocusMode) => {
    if (phase === 'running' || phase === 'paused' || phase === 'countdown') return;
    setMode(nextMode);
    setBpm(FOCUS_CONFIG[nextMode].defaultBpm);
    setResult(null);
    setPhase('idle');
    setBeatIndex(0);
  };

  const start = () => {
    setRemaining(targetSeconds);
    setCountdown(3);
    setBeatIndex(0);
    setBars(0);
    setMistakes(0);
    setResult(null);
    setPhase('countdown');
  };

  const finish = (completed: boolean) => {
    const practiced = completed ? targetSeconds : Math.max(0, targetSeconds - remaining);
    if (practiced < 3) {
      setPhase('idle');
      setRemaining(targetSeconds);
      return;
    }
    const completionPenalty = completed ? 0 : Math.round((1 - practiced / targetSeconds) * 30);
    const score = Math.max(0, Math.min(100, 100 - completionPenalty - mistakes * 7));
    const feedback = mistakes === 0
      ? `${bpm} BPM에서 안정적으로 유지했습니다. 다음 연습은 5 BPM만 올리세요.`
      : mistakes <= 2
        ? `${config.tip} 현재 속도로 무실수 8마디를 먼저 만드세요.`
        : `${config.tip} 속도를 ${Math.max(35, bpm - 10)} BPM으로 낮춰 다시 연습하세요.`;

    onSave({
      id: makeId('focus'),
      createdAt: new Date().toISOString(),
      mode,
      durationSeconds: practiced,
      bpm,
      mistakes,
      score,
      feedback,
    });
    setResult({ score, feedback, practiced });
    setPhase('result');
    if (state.haptics) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const progress = Math.min(1, Math.max(0, (targetSeconds - remaining) / targetSeconds));

  return (
    <View>
      <Pressable style={({ pressed }) => [styles.aiPanel, pressed && styles.buttonPressed]} onPress={onOpenAi}>
        <Text style={styles.aiPanelEyebrow}>실제 마이크 분석</Text>
        <Text style={styles.aiPanelTitle}>AI 소리·박자 분석 시작</Text>
        <Text style={styles.aiPanelText}>주변 소음 보정, 실시간 dB, 타격 감지, 박자 오차, 빠진 음, 음량 안정성, 종합 점수를 Chrome에서 측정합니다.</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>훈련 종류</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modeRow}>
        {FOCUS_MODES.map((item) => (
          <Pressable
            key={item}
            style={({ pressed }) => [styles.modeChip, item === mode && styles.modeChipActive, pressed && styles.buttonPressed]}
            onPress={() => changeMode(item)}
          >
            <Text style={[styles.modeChipText, item === mode && styles.modeChipTextActive]}>{item}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Card>
        <Text style={styles.cardTitle}>{config.goal}</Text>
        <Text style={styles.bodyText}>{config.tip}</Text>
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.controlLabel}>속도</Text>
          <Text style={styles.bpmText}>{bpm} BPM</Text>
        </View>
        <View style={styles.twoButtons}>
          <SecondaryButton label="−5 BPM" onPress={() => setBpm((value) => Math.max(35, value - 5))} disabled={phase === 'running' || phase === 'paused' || phase === 'countdown'} />
          <SecondaryButton label="+5 BPM" onPress={() => setBpm((value) => Math.min(180, value + 5))} disabled={phase === 'running' || phase === 'paused' || phase === 'countdown'} />
        </View>
        <View style={styles.durationRow}>
          {[30, 60, 180, 300].map((seconds) => (
            <Pressable
              key={seconds}
              disabled={phase === 'running' || phase === 'paused' || phase === 'countdown'}
              style={({ pressed }) => [styles.durationButton, targetSeconds === seconds && styles.durationButtonActive, pressed && styles.buttonPressed]}
              onPress={() => {
                setTargetSeconds(seconds);
                setRemaining(seconds);
              }}
            >
              <Text style={styles.durationText}>{seconds < 60 ? `${seconds}초` : `${seconds / 60}분`}</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card>
        <Text style={styles.phaseText}>{phase === 'countdown' ? '준비' : phase === 'running' ? '연습 중' : phase === 'paused' ? '일시정지' : phase === 'result' ? '결과' : '집중 코치'}</Text>
        <Text style={styles.timerLarge}>{phase === 'countdown' ? countdown : formatTime(remaining)}</Text>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} /></View>

        <View style={styles.patternRow}>
          {config.pattern.map((step, index) => {
            const active = (phase === 'running' || phase === 'paused') && index === beatIndex;
            return (
              <View key={`${step}-${index}`} style={[styles.patternCell, active && styles.patternCellActive]}>
                <Text style={[styles.patternText, active && styles.patternTextActive]}>{step}</Text>
                <Text style={styles.beatText}>{index + 1}</Text>
              </View>
            );
          })}
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCell}><Text style={styles.statValue}>{bars}</Text><Text style={styles.statLabel}>완료 마디</Text></View>
          <View style={styles.statCell}><Text style={[styles.statValue, mistakes > 0 && styles.mistakeText]}>{mistakes}</Text><Text style={styles.statLabel}>실수</Text></View>
        </View>

        {phase === 'idle' ? <PrimaryButton label="3초 카운트 후 시작" onPress={start} /> : null}
        {phase === 'running' || phase === 'paused' ? (
          <View>
            <View style={styles.twoButtons}>
              <SecondaryButton label={phase === 'paused' ? '계속' : '일시정지'} onPress={() => setPhase((value) => value === 'running' ? 'paused' : 'running')} />
              <SecondaryButton label="실수 +1" onPress={() => setMistakes((value) => value + 1)} />
            </View>
            <PrimaryButton label="중지하고 결과 저장" onPress={() => finish(false)} danger />
          </View>
        ) : null}
        {phase === 'result' && result ? (
          <View style={styles.resultBox}>
            <Text style={styles.resultScore}>{result.score}점</Text>
            <Text style={styles.bodyText}>{formatTime(result.practiced)} · {bpm} BPM · 실수 {mistakes}회</Text>
            <Text style={styles.feedbackText}>{result.feedback}</Text>
            <PrimaryButton label="같은 훈련 다시 하기" onPress={() => {
              setPhase('idle');
              setRemaining(targetSeconds);
              setResult(null);
            }} />
          </View>
        ) : null}
      </Card>
    </View>
  );
}

function RecordsScreen({ records, onClear }: { records: PracticeRecord[]; onClear: () => void }) {
  if (records.length === 0) {
    return <Card><Text style={styles.cardTitle}>아직 기록이 없습니다.</Text><Text style={styles.bodyText}>카메라 녹화나 집중 연습을 완료하면 자동 저장됩니다.</Text></Card>;
  }
  return (
    <View>
      <SecondaryButton label="기록 전체 삭제" onPress={onClear} />
      {records.map((record) => (
        <Card key={record.id}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>{record.mode}</Text>
            {record.score !== undefined ? <Text style={styles.scorePill}>{record.score}점</Text> : null}
          </View>
          <Text style={styles.bodyText}>{dateLabel(record.createdAt)} · {formatTime(record.durationSeconds)}</Text>
          {record.bpm !== undefined ? <Text style={styles.metaText}>BPM {record.bpm} · 실수 {record.mistakes ?? 0}회</Text> : null}
          {record.feedback ? <Text style={styles.feedbackText}>{record.feedback}</Text> : null}
        </Card>
      ))}
    </View>
  );
}

function SettingsScreen({ state, onChange }: { state: AppState; onChange: (next: AppState) => void }) {
  return (
    <Card>
      <View style={styles.settingRow}>
        <View style={styles.settingText}><Text style={styles.cardTitle}>박자 진동</Text><Text style={styles.bodyText}>집중 연습 박자마다 진동</Text></View>
        <Switch value={state.haptics} onValueChange={(value) => onChange({ ...state, haptics: value })} />
      </View>
      <View style={styles.settingRow}>
        <View style={styles.settingText}><Text style={styles.cardTitle}>갤러리 자동 저장</Text><Text style={styles.bodyText}>녹화 완료 후 휴대폰 갤러리에 저장</Text></View>
        <Switch value={state.autoSaveVideo} onValueChange={(value) => onChange({ ...state, autoSaveVideo: value })} />
      </View>
      <Text style={styles.noticeText}>AI 마이크 분석은 Chrome에서 실행되어 앱 네이티브 충돌과 분리됩니다.</Text>
    </Card>
  );
}

export default function AppV53() {
  const [screen, setScreen] = useState<Screen>('home');
  const [state, setState] = useState<AppState>(DEFAULT_STATE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) setState({ ...DEFAULT_STATE, ...(JSON.parse(raw) as Partial<AppState>) });
      })
      .catch(() => Alert.alert('저장 오류', '기본 설정으로 시작합니다.'))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (loaded) void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [loaded, state]);

  const title = useMemo(() => ({ home: '홈', camera: '카메라 연습', focus: '집중 연습', records: '연습 기록', settings: '설정' }[screen]), [screen]);

  const saveRecord = (record: PracticeRecord) => {
    setState((current) => ({ ...current, records: [record, ...current.records].slice(0, 100) }));
  };

  const openAi = async () => {
    try {
      const supported = await Linking.canOpenURL(AI_ANALYZER_URL);
      if (!supported) {
        Alert.alert('브라우저 실행 불가', 'Chrome에서 AI 분석 주소를 열 수 없습니다.');
        return;
      }
      await Linking.openURL(AI_ANALYZER_URL);
    } catch (error) {
      Alert.alert('AI 분석 실행 실패', error instanceof Error ? error.message : '브라우저를 열지 못했습니다.');
    }
  };

  if (!loaded) {
    return <SafeAreaView style={styles.loading}><ActivityIndicator size="large" color="#7ee787" /><Text style={styles.loadingText}>앱 준비 중</Text></SafeAreaView>;
  }

  const content = screen === 'home'
    ? <HomeScreen state={state} onOpen={setScreen} onOpenAi={() => void openAi()} />
    : screen === 'camera'
      ? <CameraScreen state={state} onSave={saveRecord} />
      : screen === 'focus'
        ? <FocusScreen state={state} onSave={saveRecord} onOpenAi={() => void openAi()} />
        : screen === 'records'
          ? <RecordsScreen records={state.records} onClear={() => Alert.alert('기록 삭제', '모든 기록을 삭제할까요?', [{ text: '취소', style: 'cancel' }, { text: '삭제', style: 'destructive', onPress: () => setState((current) => ({ ...current, records: [] })) }])} />
          : <SettingsScreen state={state} onChange={setState} />;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0d1117" />
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {screen !== 'home' ? (
            <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]} onPress={() => setScreen('home')}>
              <Text style={styles.backText}>‹</Text>
            </Pressable>
          ) : null}
          <View><Text style={styles.brand}>GUITAR COACH AI</Text><Text style={styles.pageTitle}>{title}</Text></View>
        </View>
        <Text style={styles.headerBadge}>0.5.3</Text>
      </View>
      <ScrollView key={screen} style={styles.content} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
        {content}
      </ScrollView>
      <View style={styles.bottomNav}>
        {[
          { key: 'home' as Screen, icon: '⌂', label: '홈' },
          { key: 'camera' as Screen, icon: '◉', label: '카메라' },
          { key: 'focus' as Screen, icon: '◎', label: '집중' },
          { key: 'records' as Screen, icon: '▥', label: '기록' },
          { key: 'settings' as Screen, icon: '⚙', label: '설정' },
        ].map((item) => (
          <Pressable key={item.key} style={({ pressed }) => [styles.navItem, pressed && styles.buttonPressed]} onPress={() => setScreen(item.key)}>
            <Text style={[styles.navIcon, screen === item.key && styles.navActive]}>{item.icon}</Text>
            <Text style={[styles.navLabel, screen === item.key && styles.navActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0d1117' },
  loading: { flex: 1, backgroundColor: '#0d1117', alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: '#8b949e', marginTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#30363d' },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  backButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  backText: { color: '#ffffff', fontSize: 31, lineHeight: 33 },
  brand: { color: '#7ee787', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  pageTitle: { color: '#f0f6fc', fontSize: 23, fontWeight: '900', marginTop: 2 },
  headerBadge: { color: '#ffffff', backgroundColor: '#238636', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 5, fontSize: 11, fontWeight: '900' },
  content: { flex: 1 },
  contentContainer: { padding: 16, paddingBottom: 110 },
  card: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 18, padding: 16, marginBottom: 12 },
  version: { color: '#7ee787', fontSize: 11, fontWeight: '900', marginBottom: 8 },
  heroTitle: { color: '#f0f6fc', fontSize: 22, lineHeight: 30, fontWeight: '900' },
  cardTitle: { color: '#f0f6fc', fontSize: 16, fontWeight: '900', marginBottom: 5 },
  bodyText: { color: '#b1bac4', fontSize: 13, lineHeight: 20 },
  primaryButton: { flex: 1, backgroundColor: '#2ea043', borderRadius: 14, minHeight: 48, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  dangerButton: { backgroundColor: '#da3633' },
  primaryButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '900', textAlign: 'center' },
  secondaryButton: { flex: 1, backgroundColor: '#21262d', borderWidth: 1, borderColor: '#30363d', borderRadius: 14, minHeight: 48, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  secondaryButtonText: { color: '#f0f6fc', fontSize: 13, fontWeight: '900', textAlign: 'center' },
  buttonPressed: { opacity: 0.68, transform: [{ scale: 0.98 }] },
  disabledButton: { opacity: 0.4 },
  aiHeroButton: { backgroundColor: '#0d419d', borderWidth: 1, borderColor: '#58a6ff', borderRadius: 15, padding: 14, alignItems: 'center', marginTop: 10 },
  aiHeroTitle: { color: '#ffffff', fontSize: 15, fontWeight: '900' },
  aiHeroSubtitle: { color: '#c9e3ff', fontSize: 10, marginTop: 4 },
  sectionTitle: { color: '#f0f6fc', fontSize: 18, fontWeight: '900', marginTop: 12, marginBottom: 10 },
  menuGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  menuCard: { width: '48%', minHeight: 125, backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 16, padding: 15 },
  menuIcon: { color: '#7ee787', fontSize: 25, fontWeight: '900', marginBottom: 10 },
  menuTitle: { color: '#f0f6fc', fontSize: 15, fontWeight: '900' },
  menuSubtitle: { color: '#8b949e', fontSize: 11, lineHeight: 16, marginTop: 5 },
  summaryRow: { flexDirection: 'row', marginBottom: 16 },
  summaryCell: { flex: 1, alignItems: 'center' },
  summaryValue: { color: '#7ee787', fontSize: 27, fontWeight: '900' },
  summaryLabel: { color: '#8b949e', fontSize: 11, marginTop: 3 },
  cameraShell: { height: 520, borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: '#30363d', backgroundColor: '#000000' },
  cameraView: { flex: 1 },
  cameraTop: { position: 'absolute', left: 12, right: 12, top: 12, flexDirection: 'row', justifyContent: 'space-between' },
  cameraBadge: { color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12, fontWeight: '900' },
  cameraTimer: { color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12, fontWeight: '900' },
  cameraGuide: { position: 'absolute', left: '12%', right: '12%', top: 130, height: 220, borderWidth: 2, borderColor: '#7ee787', borderStyle: 'dashed', borderRadius: 110, alignItems: 'center', justifyContent: 'center' },
  cameraGuideText: { color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.62)', borderRadius: 8, padding: 8, fontSize: 11, fontWeight: '800', textAlign: 'center' },
  twoButtons: { flexDirection: 'row', gap: 8 },
  aiPanel: { backgroundColor: '#0d419d', borderWidth: 1, borderColor: '#58a6ff', borderRadius: 18, padding: 17, marginBottom: 12 },
  aiPanelEyebrow: { color: '#9fcbff', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  aiPanelTitle: { color: '#ffffff', fontSize: 20, fontWeight: '900', marginTop: 5 },
  aiPanelText: { color: '#dcecff', fontSize: 12, lineHeight: 19, marginTop: 8 },
  modeRow: { paddingBottom: 12 },
  modeChip: { backgroundColor: '#21262d', borderWidth: 1, borderColor: '#30363d', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, marginRight: 8 },
  modeChipActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  modeChipText: { color: '#8b949e', fontWeight: '900' },
  modeChipTextActive: { color: '#ffffff' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  controlLabel: { color: '#b1bac4', fontSize: 13, fontWeight: '900' },
  bpmText: { color: '#7ee787', fontSize: 21, fontWeight: '900' },
  durationRow: { flexDirection: 'row', gap: 6, marginTop: 12 },
  durationButton: { flex: 1, backgroundColor: '#21262d', borderWidth: 1, borderColor: '#30363d', borderRadius: 11, paddingVertical: 10, alignItems: 'center' },
  durationButtonActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  durationText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  phaseText: { color: '#7ee787', fontSize: 11, fontWeight: '900', textAlign: 'center' },
  timerLarge: { color: '#ffffff', fontSize: 54, fontWeight: '900', textAlign: 'center', marginVertical: 10 },
  progressTrack: { height: 9, borderRadius: 5, backgroundColor: '#21262d', overflow: 'hidden', marginBottom: 18 },
  progressFill: { height: '100%', backgroundColor: '#2ea043' },
  patternRow: { flexDirection: 'row', gap: 7 },
  patternCell: { flex: 1, minHeight: 82, backgroundColor: '#0d1117', borderWidth: 1, borderColor: '#30363d', borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  patternCellActive: { backgroundColor: '#238636', borderColor: '#7ee787', borderWidth: 2 },
  patternText: { color: '#8b949e', fontSize: 23, fontWeight: '900' },
  patternTextActive: { color: '#ffffff', fontSize: 29 },
  beatText: { color: '#6e7681', fontSize: 9, marginTop: 4 },
  statsRow: { flexDirection: 'row', marginTop: 17, paddingTop: 15, borderTopWidth: 1, borderTopColor: '#30363d' },
  statCell: { flex: 1, alignItems: 'center' },
  statValue: { color: '#f0f6fc', fontSize: 23, fontWeight: '900' },
  statLabel: { color: '#8b949e', fontSize: 10, marginTop: 3 },
  mistakeText: { color: '#f85149' },
  resultBox: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#30363d', alignItems: 'center' },
  resultScore: { color: '#7ee787', fontSize: 47, fontWeight: '900' },
  feedbackText: { color: '#f2cc60', fontSize: 12, lineHeight: 19, marginTop: 10 },
  scorePill: { color: '#7ee787', backgroundColor: '#17251b', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 5, fontWeight: '900' },
  metaText: { color: '#8b949e', fontSize: 11, marginTop: 8 },
  settingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#30363d' },
  settingText: { flex: 1, paddingRight: 12 },
  noticeText: { color: '#7ee787', fontSize: 11, lineHeight: 18, marginTop: 14 },
  bottomNav: { height: 76, flexDirection: 'row', backgroundColor: '#161b22', borderTopWidth: 1, borderTopColor: '#30363d', paddingBottom: 5 },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  navIcon: { color: '#6e7681', fontSize: 20 },
  navLabel: { color: '#6e7681', fontSize: 10, fontWeight: '800', marginTop: 4 },
  navActive: { color: '#7ee787' },
});
