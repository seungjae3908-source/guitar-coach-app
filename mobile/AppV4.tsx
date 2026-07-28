import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraType, CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
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
  TextInput,
  View,
} from 'react-native';

type ScreenKey =
  | 'home'
  | 'camera'
  | 'sheet'
  | 'focus'
  | 'tone'
  | 'study'
  | 'records'
  | 'videos'
  | 'web'
  | 'settings';

type FocusMode = '코드' | '핑거링' | '아르페지오' | '스트럼' | '피킹';
type PracticeMode = FocusMode | '카메라 연습';

type PracticeRecord = {
  id: string;
  createdAt: string;
  mode: PracticeMode;
  durationSeconds: number;
  source: '집중 코치' | '카메라';
  selfScore?: number;
  bpm?: number;
  mistakes?: number;
  coachScore?: number;
  feedback?: string;
};

type SavedVideo = {
  id: string;
  createdAt: string;
  durationSeconds: number;
  savedToGallery: boolean;
  facing?: CameraType;
};

type ToneSettings = {
  equipment: 'Yamaha THR30' | 'BOSS GT-1' | '일반 앰프';
  gain: number;
  bass: number;
  mid: number;
  treble: number;
  effect: number;
};

type AppSettings = {
  voiceFeedback: boolean;
  haptics: boolean;
  autoSaveVideo: boolean;
};

type PersistedState = {
  records: PracticeRecord[];
  videos: SavedVideo[];
  completedLessons: string[];
  tone: ToneSettings;
  settings: AppSettings;
};

type FocusConfig = {
  pattern: string[];
  goal: string;
  instruction: string;
  corrections: [string, string];
  defaultBpm: number;
};

const STORAGE_KEY = 'guitar-coach-ai-state-v2';

const DEFAULT_STATE: PersistedState = {
  records: [],
  videos: [],
  completedLessons: [],
  tone: {
    equipment: 'Yamaha THR30',
    gain: 40,
    bass: 50,
    mid: 55,
    treble: 50,
    effect: 12,
  },
  settings: {
    voiceFeedback: false,
    haptics: true,
    autoSaveVideo: true,
  },
};

const SCREEN_ITEMS: Array<{ key: ScreenKey; title: string; icon: string; subtitle: string }> = [
  { key: 'camera', title: '카메라 연습', icon: '◉', subtitle: '전후면 전환·녹화·갤러리 저장' },
  { key: 'focus', title: '집중 연습', icon: '◎', subtitle: '패턴·BPM·박자·점수·교정' },
  { key: 'sheet', title: '악보', icon: '♬', subtitle: '곡과 마디별 연습 패턴' },
  { key: 'tone', title: '톤메이킹', icon: '≋', subtitle: '장비별 노브 설정 저장' },
  { key: 'study', title: '공부하기', icon: '▤', subtitle: '기술 교정 항목 체크' },
  { key: 'records', title: '연습 기록', icon: '▥', subtitle: 'BPM·실수·코치 점수 확인' },
  { key: 'videos', title: '촬영 영상', icon: '▶', subtitle: '갤러리 저장 내역 확인' },
  { key: 'web', title: '웹 연결', icon: '⌁', subtitle: '연결 코드 생성' },
  { key: 'settings', title: '설정', icon: '⚙', subtitle: '진동·영상 저장 옵션' },
];

const FOCUS_MODES: FocusMode[] = ['코드', '핑거링', '아르페지오', '스트럼', '피킹'];

const FOCUS_CONFIG: Record<FocusMode, FocusConfig> = {
  코드: {
    pattern: ['C', 'G', 'Am', 'F'],
    goal: '박자 안에서 네 코드를 한 번에 잡기',
    instruction: '박자 표시가 바뀌는 순간 다음 코드를 누르고, 소리가 깨지면 실수 버튼을 누르세요.',
    corrections: ['손가락을 하나씩 두지 말고 코드 모양을 공중에서 먼저 만드세요.', '코드 전환 직전 손목 힘을 빼고 공통 손가락을 기준으로 이동하세요.'],
    defaultBpm: 55,
  },
  핑거링: {
    pattern: ['1', '2', '3', '4'],
    goal: '손가락 독립과 프렛 정확도 만들기',
    instruction: '1-2-3-4를 한 박에 하나씩 누르고, 손가락이 줄에서 멀리 뜨면 실수로 표시하세요.',
    corrections: ['누르지 않는 손가락도 프렛 가까이에 낮게 유지하세요.', '손가락 끝으로 누르고 엄지는 목 뒤 중앙에서 힘을 분산하세요.'],
    defaultBpm: 60,
  },
  아르페지오: {
    pattern: ['P', 'I', 'P', 'M'],
    goal: '엄지와 검지·중지의 간격을 일정하게 만들기',
    instruction: '강조된 손가락만 움직이고 나머지 손가락은 줄 가까이에서 기다리세요.',
    corrections: ['검지를 앞으로 밀지 말고 관절을 접어 연주한 뒤 바로 복귀하세요.', '엄지 음량이 끊기지 않도록 P 동작의 깊이를 일정하게 유지하세요.'],
    defaultBpm: 65,
  },
  스트럼: {
    pattern: ['↓', '↓↑', '↑', '↓↑'],
    goal: '다운·업 깊이와 손목 속도를 일정하게 만들기',
    instruction: '박자마다 표시된 방향을 연주하고 피크가 걸리면 실수 버튼을 누르세요.',
    corrections: ['피크는 줄 안쪽으로 2~3mm만 넣고 손목 힘을 빼세요.', '업스트로크에서는 피크 각도를 조금 열고 필요한 줄만 얕게 스치세요.'],
    defaultBpm: 70,
  },
  피킹: {
    pattern: ['D', 'U', 'D', 'U'],
    goal: '다운·업 교대와 피크 깊이를 일정하게 만들기',
    instruction: '강조된 D/U를 한 박에 하나씩 연주하며 손목 이동 폭을 작게 유지하세요.',
    corrections: ['피크 끝만 줄에 닿게 하고 팔이 아니라 손목의 작은 회전으로 연주하세요.', '다운과 업의 이동 거리를 같게 만들어 다음 줄로 넘어가는 시간을 줄이세요.'],
    defaultBpm: 70,
  },
};

const SONGS = [
  {
    id: 'photograph',
    title: 'Photograph',
    artist: 'Ed Sheeran',
    chords: ['G', 'Em', 'C', 'D'],
    measures: [
      { chord: 'G        Em', rhythm: '↓  ↓↑  ↑↓↑', note: '전환 전에 다음 코드 모양을 준비' },
      { chord: 'C         D', rhythm: '↓  ↓↑  ↑↓↑', note: '업스트로크는 1~3번 줄만 얕게' },
      { chord: 'G        Em', rhythm: '↓  ↓↑  ↑↓↑', note: '손목 속도를 일정하게 유지' },
    ],
  },
  {
    id: 'windsong',
    title: 'Windsong',
    artist: 'Acoustic practice',
    chords: ['Am', 'F', 'C', 'G'],
    measures: [
      { chord: 'Am        F', rhythm: 'P  I  M  I', note: '검지는 앞으로 밀지 않고 접어서 연주' },
      { chord: 'C         G', rhythm: 'P  I  P  M', note: '엄지 음량을 일정하게 유지' },
      { chord: 'Am        F', rhythm: 'P  I  M  I', note: '사용하지 않는 손가락은 줄 가까이 대기' },
    ],
  },
];

const LESSONS = [
  { id: 'index-return', title: '검지 복귀 속도', body: '앞으로 밀지 말고 관절을 접어 줄을 통과한 뒤 즉시 원위치합니다.' },
  { id: 'pick-depth', title: '피크 깊이', body: '피크가 줄 안쪽으로 2~3mm만 들어가도록 기준을 정합니다.' },
  { id: 'upstroke', title: '업스트로크 걸림', body: '업에서는 피크 각도를 조금 열고 손목 힘을 뺍니다.' },
  { id: 'rhythm', title: '4박 연속 안정화', body: '속도보다 8마디 연속 무실수를 먼저 목표로 합니다.' },
];

function nowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function Pill({ text, active = false }: { text: string; active?: boolean }) {
  return (
    <View style={[styles.pill, active && styles.pillActive]}>
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{text}</Text>
    </View>
  );
}

function HomeScreen({ onOpen, state }: { onOpen: (screen: ScreenKey) => void; state: PersistedState }) {
  const totalSeconds = state.records.reduce((sum, record) => sum + record.durationSeconds, 0);
  const latest = state.records[0];

  return (
    <View>
      <Card style={styles.heroCard}>
        <Text style={styles.eyebrow}>안정 버전 0.4</Text>
        <Text style={styles.heroTitle}>촬영과 집중 훈련을 실제 연습 흐름으로 연결했습니다.</Text>
        <Text style={styles.mutedText}>
          카메라 전환을 다시 열도록 수정했고, 집중 연습은 패턴·BPM·박자·실수·점수까지 진행합니다.
        </Text>
        <Pressable style={styles.primaryButton} onPress={() => onOpen('focus')}>
          <Text style={styles.primaryButtonText}>집중 연습 시작</Text>
        </Pressable>
      </Card>

      <Text style={styles.sectionTitle}>기능 화면</Text>
      <View style={styles.menuGrid}>
        {SCREEN_ITEMS.map((item) => (
          <Pressable key={item.key} style={styles.menuCard} onPress={() => onOpen(item.key)}>
            <Text style={styles.menuIcon}>{item.icon}</Text>
            <Text style={styles.menuTitle}>{item.title}</Text>
            <Text style={styles.menuSubtitle}>{item.subtitle}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionTitle}>내 연습 요약</Text>
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
          <View style={styles.summaryCell}>
            <Text style={styles.summaryValue}>{state.videos.length}</Text>
            <Text style={styles.summaryLabel}>촬영 영상</Text>
          </View>
        </View>
        <Text style={styles.cardTitle}>최근 연습</Text>
        <Text style={styles.cardText}>
          {latest
            ? `${latest.mode} · ${formatDuration(latest.durationSeconds)}${latest.coachScore !== undefined ? ` · 코치 ${latest.coachScore}점` : ''}`
            : '아직 저장된 연습이 없습니다.'}
        </Text>
      </Card>
    </View>
  );
}

function PermissionPanel({ onGrant }: { onGrant: () => void }) {
  return (
    <Card>
      <Text style={styles.cardTitle}>카메라와 마이크 권한이 필요합니다.</Text>
      <Text style={styles.cardText}>권한을 허용하면 실제 미리보기와 영상 녹화를 사용할 수 있습니다.</Text>
      <Pressable style={styles.primaryButton} onPress={onGrant}>
        <Text style={styles.primaryButtonText}>권한 허용</Text>
      </Pressable>
    </Card>
  );
}

function CameraPracticeScreen({
  settings,
  onSaveRecord,
  onSaveVideo,
}: {
  settings: AppSettings;
  onSaveRecord: (record: PracticeRecord) => void;
  onSaveVideo: (video: SavedVideo) => void;
}) {
  const cameraRef = useRef<CameraView | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [cameraInstance, setCameraInstance] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const recordingStartedAtRef = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState('후면 카메라 준비 중');

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  useEffect(() => () => cameraRef.current?.stopRecording(), []);

  const grantPermissions = async () => {
    const cameraResult = await requestCameraPermission();
    const micResult = await requestMicrophonePermission();
    if (!cameraResult.granted || !micResult.granted) {
      Alert.alert('권한 필요', '설정에서 카메라와 마이크 권한을 허용해 주세요.');
    }
  };

  const switchCamera = () => {
    if (recording) return;
    const nextFacing: CameraType = facing === 'back' ? 'front' : 'back';
    setCameraReady(false);
    setStatus(`${nextFacing === 'back' ? '후면' : '전면'} 카메라 전환 중`);
    setFacing(nextFacing);
    setCameraInstance((value) => value + 1);
    if (settings.haptics) void Haptics.selectionAsync();
  };

  const startRecording = async () => {
    if (!cameraReady || !cameraRef.current || recording) {
      if (!cameraReady) Alert.alert('카메라 준비 중', '카메라 화면이 열린 뒤 다시 눌러 주세요.');
      return;
    }
    if (!cameraPermission?.granted || !microphonePermission?.granted) {
      await grantPermissions();
      return;
    }

    setElapsed(0);
    recordingStartedAtRef.current = Date.now();
    setStatus('녹화 중');
    setRecording(true);
    if (settings.haptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const result = await cameraRef.current.recordAsync({ maxDuration: 600 });
      const durationSeconds = Math.max(1, Math.round((Date.now() - recordingStartedAtRef.current) / 1000));
      if (result?.uri) {
        let savedToGallery = false;
        if (settings.autoSaveVideo) {
          const mediaPermission = await MediaLibrary.requestPermissionsAsync(true);
          if (mediaPermission.granted) {
            await MediaLibrary.saveToLibraryAsync(result.uri);
            savedToGallery = true;
          }
        }
        onSaveVideo({
          id: nowId('video'),
          createdAt: new Date().toISOString(),
          durationSeconds,
          savedToGallery,
          facing,
        });
        onSaveRecord({
          id: nowId('practice'),
          createdAt: new Date().toISOString(),
          mode: '카메라 연습',
          durationSeconds,
          source: '카메라',
        });
        setStatus(savedToGallery ? '갤러리에 저장 완료' : '촬영 완료');
        Alert.alert('촬영 완료', savedToGallery ? '영상이 휴대폰 갤러리에 저장되었습니다.' : '촬영 기록을 저장했습니다.');
      }
    } catch (error) {
      setStatus('촬영 오류');
      Alert.alert('촬영 실패', error instanceof Error ? error.message : '영상을 저장하지 못했습니다.');
    } finally {
      setRecording(false);
    }
  };

  const stopRecording = () => {
    if (!recording) return;
    setStatus('영상 저장 중');
    cameraRef.current?.stopRecording();
  };

  if (!cameraPermission || !microphonePermission) {
    return <ActivityIndicator color="#7ee787" size="large" />;
  }

  if (!cameraPermission.granted || !microphonePermission.granted) {
    return <PermissionPanel onGrant={grantPermissions} />;
  }

  return (
    <View>
      <View style={styles.cameraShell}>
        <CameraView
          key={`${facing}-${cameraInstance}`}
          ref={cameraRef}
          style={styles.cameraView}
          facing={facing}
          mode="video"
          onCameraReady={() => {
            setCameraReady(true);
            setStatus(`${facing === 'back' ? '후면' : '전면'} 카메라 준비`);
          }}
        />
        <View style={styles.cameraOverlayTop}>
          <Pill text={recording ? '● 녹화 중' : status} active={recording} />
          <Text style={styles.timerText}>{formatDuration(elapsed)}</Text>
        </View>
        <View style={styles.handGuide}>
          <Text style={styles.handGuideText}>오른손·손목·기타 줄이 한 화면에 보이게 맞추세요.</Text>
        </View>
        <View style={styles.cameraOverlayBottom}>
          <Text style={styles.overlayTitle}>{facing === 'back' ? '후면 카메라' : '전면 카메라'} 사용 중</Text>
          <Text style={styles.overlayText}>전환할 때 카메라를 완전히 다시 열어 삼성 기기에서도 렌즈 변경이 적용되도록 수정했습니다.</Text>
        </View>
      </View>

      <View style={styles.buttonRow}>
        <Pressable
          style={[styles.secondaryButton, recording && styles.disabledButton]}
          disabled={recording}
          onPress={switchCamera}
        >
          <Text style={styles.secondaryButtonText}>↻ {facing === 'back' ? '전면으로 전환' : '후면으로 전환'}</Text>
        </Pressable>
        <Pressable style={[styles.recordButton, recording && styles.stopButton]} onPress={recording ? stopRecording : startRecording}>
          <Text style={styles.recordButtonText}>{recording ? '녹화 종료' : '녹화 시작'}</Text>
        </Pressable>
      </View>
      <Text style={styles.infoText}>카메라 전환은 녹화 중에는 잠깁니다. 최대 10분 촬영합니다.</Text>
    </View>
  );
}

function FocusPracticeScreen({
  settings,
  onSaveRecord,
}: {
  settings: AppSettings;
  onSaveRecord: (record: PracticeRecord) => void;
}) {
  const [mode, setMode] = useState<FocusMode>('아르페지오');
  const config = FOCUS_CONFIG[mode];
  const [targetSeconds, setTargetSeconds] = useState(60);
  const [remaining, setRemaining] = useState(60);
  const [bpm, setBpm] = useState(config.defaultBpm);
  const [countdown, setCountdown] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'countdown' | 'running' | 'paused' | 'result'>('idle');
  const [beatIndex, setBeatIndex] = useState(0);
  const [bars, setBars] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [result, setResult] = useState<{ score: number; duration: number; feedback: string } | null>(null);

  const elapsed = Math.max(0, targetSeconds - remaining);
  const progress = targetSeconds > 0 ? Math.min(1, elapsed / targetSeconds) : 0;

  useEffect(() => {
    if (phase !== 'idle') return;
    setRemaining(targetSeconds);
  }, [phase, targetSeconds]);

  useEffect(() => {
    if (phase !== 'countdown') return;
    const timer = setTimeout(() => {
      if (settings.haptics) void Haptics.selectionAsync();
      if (countdown <= 1) {
        setCountdown(0);
        setPhase('running');
      } else {
        setCountdown((value) => value - 1);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdown, phase, settings.haptics]);

  useEffect(() => {
    if (phase !== 'running') return;
    const timer = setInterval(() => {
      setRemaining((value) => Math.max(0, value - 1));
    }, 1000);
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
      if (settings.haptics) void Haptics.selectionAsync();
    }, beatMs);
    return () => clearInterval(timer);
  }, [bpm, config.pattern.length, phase, settings.haptics]);

  useEffect(() => {
    if (phase === 'running' && remaining === 0) {
      completeSession(true);
    }
  }, [phase, remaining]);

  const changeMode = (nextMode: FocusMode) => {
    if (phase !== 'idle' && phase !== 'result') return;
    setMode(nextMode);
    setBpm(FOCUS_CONFIG[nextMode].defaultBpm);
    setBeatIndex(0);
    setResult(null);
    setPhase('idle');
  };

  const start = () => {
    setRemaining(targetSeconds);
    setBeatIndex(0);
    setBars(0);
    setMistakes(0);
    setResult(null);
    setCountdown(3);
    setPhase('countdown');
  };

  const togglePause = () => {
    if (phase === 'running') setPhase('paused');
    else if (phase === 'paused') setPhase('running');
  };

  const markMistake = () => {
    if (phase !== 'running' && phase !== 'paused') return;
    setMistakes((value) => value + 1);
    if (settings.haptics) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  };

  const completeSession = (completed: boolean) => {
    const practiced = completed ? targetSeconds : Math.max(0, targetSeconds - remaining);
    if (practiced < 5) {
      setPhase('idle');
      setRemaining(targetSeconds);
      setCountdown(0);
      return;
    }

    const completionPenalty = completed ? 0 : Math.round((1 - practiced / targetSeconds) * 30);
    const mistakePenalty = mistakes * 7;
    const score = Math.max(0, Math.min(100, 100 - completionPenalty - mistakePenalty));
    const feedback =
      mistakes === 0
        ? `좋습니다. ${bpm} BPM에서 ${bars}마디를 유지했습니다. 다음에는 5 BPM만 올리세요.`
        : mistakes <= 2
          ? `${config.corrections[0]} 현재 속도를 유지하고 무실수 8마디를 먼저 만드세요.`
          : `${config.corrections[1]} 속도를 ${Math.max(35, bpm - 10)} BPM으로 낮춰 틀린 동작만 반복하세요.`;

    onSaveRecord({
      id: nowId('practice'),
      createdAt: new Date().toISOString(),
      mode,
      durationSeconds: practiced,
      source: '집중 코치',
      bpm,
      mistakes,
      coachScore: score,
      feedback,
    });

    setResult({ score, duration: practiced, feedback });
    setPhase('result');
    setCountdown(0);
    if (settings.haptics) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const stop = () => completeSession(false);

  const reset = () => {
    setRemaining(targetSeconds);
    setBeatIndex(0);
    setBars(0);
    setMistakes(0);
    setResult(null);
    setPhase('idle');
  };

  return (
    <View>
      <Text style={styles.sectionTitle}>훈련 종류</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {FOCUS_MODES.map((item) => (
          <Pressable key={item} onPress={() => changeMode(item)}>
            <Pill text={item} active={mode === item} />
          </Pressable>
        ))}
      </ScrollView>

      <Card>
        <Text style={styles.cardTitle}>{config.goal}</Text>
        <Text style={styles.cardText}>{config.instruction}</Text>
      </Card>

      <Card style={styles.focusControlCard}>
        <View style={styles.rowBetween}>
          <Text style={styles.controlLabel}>연습 속도</Text>
          <Text style={styles.bpmValue}>{bpm} BPM</Text>
        </View>
        <View style={styles.buttonRow}>
          <Pressable
            disabled={phase === 'running' || phase === 'countdown' || phase === 'paused'}
            style={styles.smallButton}
            onPress={() => setBpm((value) => Math.max(35, value - 5))}
          >
            <Text style={styles.smallButtonText}>−5</Text>
          </Pressable>
          <Pressable
            disabled={phase === 'running' || phase === 'countdown' || phase === 'paused'}
            style={styles.smallButton}
            onPress={() => setBpm((value) => Math.min(180, value + 5))}
          >
            <Text style={styles.smallButtonText}>＋5</Text>
          </Pressable>
        </View>
        <View style={styles.durationRow}>
          {[
            { seconds: 30, label: '30초' },
            { seconds: 60, label: '1분' },
            { seconds: 180, label: '3분' },
            { seconds: 300, label: '5분' },
          ].map((item) => (
            <Pressable
              key={item.seconds}
              disabled={phase === 'running' || phase === 'countdown' || phase === 'paused'}
              style={[styles.durationButton, targetSeconds === item.seconds && styles.smallButtonActive]}
              onPress={() => {
                setTargetSeconds(item.seconds);
                setRemaining(item.seconds);
              }}
            >
              <Text style={styles.smallButtonText}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card style={styles.timerCard}>
        <Text style={styles.eyebrow}>
          {phase === 'countdown'
            ? '준비'
            : phase === 'running'
              ? '연습 중'
              : phase === 'paused'
                ? '일시정지'
                : phase === 'result'
                  ? '연습 결과'
                  : `${mode} 집중 코치`}
        </Text>

        {phase === 'countdown' ? (
          <Text style={styles.countdownNumber}>{countdown}</Text>
        ) : (
          <Text style={styles.countdownNumber}>{formatDuration(remaining)}</Text>
        )}

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>

        <View style={styles.patternRow}>
          {config.pattern.map((step, index) => (
            <View key={`${step}-${index}`} style={[styles.patternCell, index === beatIndex && (phase === 'running' || phase === 'paused') && styles.patternCellActive]}>
              <Text style={[styles.patternText, index === beatIndex && (phase === 'running' || phase === 'paused') && styles.patternTextActive]}>{step}</Text>
              <Text style={styles.beatNumber}>{index + 1}</Text>
            </View>
          ))}
        </View>

        <View style={styles.focusStats}>
          <View style={styles.focusStat}>
            <Text style={styles.focusStatValue}>{bpm}</Text>
            <Text style={styles.focusStatLabel}>BPM</Text>
          </View>
          <View style={styles.focusStat}>
            <Text style={styles.focusStatValue}>{bars}</Text>
            <Text style={styles.focusStatLabel}>완료 마디</Text>
          </View>
          <View style={styles.focusStat}>
            <Text style={[styles.focusStatValue, mistakes > 0 && styles.mistakeValue]}>{mistakes}</Text>
            <Text style={styles.focusStatLabel}>실수</Text>
          </View>
        </View>

        {phase === 'idle' ? (
          <Pressable style={styles.primaryButton} onPress={start}>
            <Text style={styles.primaryButtonText}>3초 카운트 후 훈련 시작</Text>
          </Pressable>
        ) : null}

        {phase === 'running' || phase === 'paused' ? (
          <View>
            <View style={styles.buttonRow}>
              <Pressable style={styles.secondaryButton} onPress={togglePause}>
                <Text style={styles.secondaryButtonText}>{phase === 'paused' ? '계속' : '일시정지'}</Text>
              </Pressable>
              <Pressable style={styles.mistakeButton} onPress={markMistake}>
                <Text style={styles.mistakeButtonText}>실수 ＋1</Text>
              </Pressable>
            </View>
            <Pressable style={[styles.primaryButton, styles.dangerButton]} onPress={stop}>
              <Text style={styles.primaryButtonText}>중지하고 결과 저장</Text>
            </Pressable>
          </View>
        ) : null}

        {phase === 'result' && result ? (
          <View style={styles.resultBox}>
            <Text style={styles.resultScore}>{result.score}점</Text>
            <Text style={styles.resultMeta}>{formatDuration(result.duration)} · {bpm} BPM · 실수 {mistakes}회</Text>
            <Text style={styles.resultFeedback}>{result.feedback}</Text>
            <Pressable style={styles.primaryButton} onPress={reset}>
              <Text style={styles.primaryButtonText}>같은 훈련 다시 하기</Text>
            </Pressable>
          </View>
        ) : null}
      </Card>

      <Card>
        <Text style={styles.cardTitle}>집중 연습 사용법</Text>
        <Text style={styles.cardText}>1. 강조되는 패턴을 박자에 맞춰 연주합니다.</Text>
        <Text style={styles.cardText}>2. 걸림·오타·코드 깨짐이 생길 때마다 ‘실수 +1’을 누릅니다.</Text>
        <Text style={styles.cardText}>3. 종료하면 완성도 점수와 다음 교정 한 가지가 기록됩니다.</Text>
      </Card>
      <Text style={styles.infoText}>현재 점수는 마이크 판정이 아닌 시간·BPM·실수 입력을 이용한 규칙 기반 코치 베타입니다.</Text>
    </View>
  );
}

function SheetScreen() {
  const [query, setQuery] = useState('');
  const [songId, setSongId] = useState(SONGS[0].id);
  const [measure, setMeasure] = useState(0);
  const song = SONGS.find((item) => item.id === songId) ?? SONGS[0];
  const filtered = SONGS.filter((item) => `${item.title} ${item.artist}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => setMeasure(0), [songId]);

  return (
    <View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="곡 제목 검색"
        placeholderTextColor="#6e7681"
        style={styles.input}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {filtered.map((item) => (
          <Pressable key={item.id} onPress={() => setSongId(item.id)}>
            <Pill text={item.title} active={item.id === songId} />
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.paper}>
        <Text style={styles.songTitle}>{song.title}</Text>
        <Text style={styles.songMeta}>{song.artist} · 연습용 악보</Text>
        <View style={styles.chordRow}>
          {song.chords.map((chord) => (
            <View key={chord} style={styles.chordBox}>
              <Text style={styles.chordName}>{chord}</Text>
              <Text style={styles.chordDots}>● ○ ● ○</Text>
            </View>
          ))}
        </View>
        {song.measures.map((item, index) => (
          <Pressable
            key={`${song.id}-${index}`}
            onPress={() => setMeasure(index)}
            style={[styles.measure, measure === index && styles.measureActive]}
          >
            <Text style={styles.measureNumber}>{String(index + 1).padStart(2, '0')}</Text>
            <Text style={styles.measureChord}>{item.chord}</Text>
            <Text style={styles.measureRhythm}>{item.rhythm}</Text>
            <Text style={styles.measureLyric}>{item.note}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.buttonRow}>
        <Pressable style={styles.secondaryButton} onPress={() => setMeasure((value) => Math.max(0, value - 1))}>
          <Text style={styles.secondaryButtonText}>이전 마디</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={() => setMeasure((value) => Math.min(song.measures.length - 1, value + 1))}>
          <Text style={styles.secondaryButtonText}>다음 마디</Text>
        </Pressable>
      </View>
      <Pressable
        style={styles.primaryButton}
        onPress={() => Linking.openURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(`${song.title} ${song.artist} official`)}`)}
      >
        <Text style={styles.primaryButtonText}>유튜브 공식 영상 검색</Text>
      </Pressable>
    </View>
  );
}

function ValueControl({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <View style={styles.controlRow}>
      <Text style={styles.controlLabel}>{label}</Text>
      <Pressable style={styles.roundButton} onPress={() => onChange(Math.max(0, value - 5))}>
        <Text style={styles.roundButtonText}>−</Text>
      </Pressable>
      <Text style={styles.controlValue}>{value}</Text>
      <Pressable style={styles.roundButton} onPress={() => onChange(Math.min(100, value + 5))}>
        <Text style={styles.roundButtonText}>＋</Text>
      </Pressable>
    </View>
  );
}

function ToneScreen({ tone, onChange }: { tone: ToneSettings; onChange: (tone: ToneSettings) => void }) {
  const equipment: ToneSettings['equipment'][] = ['Yamaha THR30', 'BOSS GT-1', '일반 앰프'];
  const update = (key: keyof ToneSettings, value: ToneSettings[keyof ToneSettings]) => onChange({ ...tone, [key]: value });

  return (
    <View>
      <Text style={styles.sectionTitle}>사용 장비</Text>
      <View style={styles.stackGap}>
        {equipment.map((item) => (
          <Pressable key={item} style={[styles.listCard, tone.equipment === item && styles.listCardActive]} onPress={() => update('equipment', item)}>
            <Text style={styles.listCardTitle}>{item}</Text>
            <Text style={styles.listCardMeta}>{tone.equipment === item ? '선택됨' : '선택'}</Text>
          </Pressable>
        ))}
      </View>
      <Card>
        <Text style={styles.cardTitle}>현재 프리셋</Text>
        <ValueControl label="GAIN" value={tone.gain} onChange={(value) => update('gain', value)} />
        <ValueControl label="BASS" value={tone.bass} onChange={(value) => update('bass', value)} />
        <ValueControl label="MID" value={tone.mid} onChange={(value) => update('mid', value)} />
        <ValueControl label="TREBLE" value={tone.treble} onChange={(value) => update('treble', value)} />
        <ValueControl label="EFFECT" value={tone.effect} onChange={(value) => update('effect', value)} />
      </Card>
      <Text style={styles.successText}>변경한 값은 휴대폰에 자동 저장됩니다.</Text>
    </View>
  );
}

function StudyScreen({ completed, onToggle }: { completed: string[]; onToggle: (id: string) => void }) {
  return (
    <View style={styles.stackGap}>
      {LESSONS.map((lesson) => {
        const done = completed.includes(lesson.id);
        return (
          <Pressable key={lesson.id} style={[styles.lessonCard, done && styles.lessonCardDone]} onPress={() => onToggle(lesson.id)}>
            <View style={[styles.checkBox, done && styles.checkBoxDone]}>
              <Text style={styles.checkText}>{done ? '✓' : ''}</Text>
            </View>
            <View style={styles.flexOne}>
              <Text style={styles.listCardTitle}>{lesson.title}</Text>
              <Text style={styles.cardText}>{lesson.body}</Text>
            </View>
          </Pressable>
        );
      })}
      <Text style={styles.infoText}>항목을 누르면 완료 상태가 자동 저장됩니다.</Text>
    </View>
  );
}

function RecordsScreen({
  records,
  onRate,
  onClear,
}: {
  records: PracticeRecord[];
  onRate: (id: string, score: number) => void;
  onClear: () => void;
}) {
  if (records.length === 0) {
    return (
      <Card>
        <Text style={styles.cardTitle}>아직 연습 기록이 없습니다.</Text>
        <Text style={styles.cardText}>집중 연습을 완료하거나 카메라 녹화를 끝내면 여기에 저장됩니다.</Text>
      </Card>
    );
  }

  return (
    <View>
      <Pressable style={styles.textButton} onPress={onClear}>
        <Text style={styles.textButtonText}>기록 전체 삭제</Text>
      </Pressable>
      <View style={styles.stackGap}>
        {records.map((record) => (
          <Card key={record.id}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>{record.mode}</Text>
              <Pill text={record.source} />
            </View>
            <Text style={styles.cardText}>{formatDate(record.createdAt)} · {formatDuration(record.durationSeconds)}</Text>
            {record.bpm !== undefined ? (
              <View style={styles.recordStats}>
                <Text style={styles.recordStat}>BPM {record.bpm}</Text>
                <Text style={styles.recordStat}>실수 {record.mistakes ?? 0}</Text>
                <Text style={styles.recordScore}>코치 {record.coachScore ?? '-'}점</Text>
              </View>
            ) : null}
            {record.feedback ? <Text style={styles.recordFeedback}>{record.feedback}</Text> : null}
            <Text style={styles.ratingLabel}>내 연습 평가 {record.selfScore ? `${record.selfScore}/5` : '선택 안 함'}</Text>
            <View style={styles.ratingRow}>
              {[1, 2, 3, 4, 5].map((score) => (
                <Pressable
                  key={score}
                  style={[styles.ratingButton, record.selfScore === score && styles.ratingButtonActive]}
                  onPress={() => onRate(record.id, score)}
                >
                  <Text style={styles.ratingButtonText}>{score}</Text>
                </Pressable>
              ))}
            </View>
          </Card>
        ))}
      </View>
    </View>
  );
}

function VideosScreen({ videos, onClear }: { videos: SavedVideo[]; onClear: () => void }) {
  return (
    <View>
      {videos.length > 0 ? (
        <Pressable style={styles.textButton} onPress={onClear}>
          <Text style={styles.textButtonText}>영상 내역 삭제</Text>
        </Pressable>
      ) : null}
      <View style={styles.stackGap}>
        {videos.length === 0 ? (
          <Card>
            <Text style={styles.cardTitle}>촬영 영상이 없습니다.</Text>
            <Text style={styles.cardText}>카메라 연습에서 녹화를 완료하면 저장 내역이 표시됩니다.</Text>
          </Card>
        ) : (
          videos.map((video, index) => (
            <Card key={video.id}>
              <View style={styles.videoThumb}>
                <Text style={styles.videoPlay}>▶</Text>
              </View>
              <Text style={styles.cardTitle}>연습 영상 {videos.length - index}</Text>
              <Text style={styles.cardText}>
                {formatDate(video.createdAt)} · {formatDuration(video.durationSeconds)} · {video.facing === 'front' ? '전면' : '후면'}
              </Text>
              <Text style={video.savedToGallery ? styles.successText : styles.warningText}>
                {video.savedToGallery ? '휴대폰 갤러리에 저장됨' : '갤러리 자동 저장 안 됨'}
              </Text>
            </Card>
          ))
        )}
      </View>
    </View>
  );
}

function WebConnectScreen() {
  const [code, setCode] = useState('----');
  return (
    <View>
      <Card style={styles.centerCard}>
        <Text style={styles.eyebrow}>컴퓨터 연결 코드</Text>
        <Text selectable style={styles.pairCode}>{code}</Text>
        <Pressable style={styles.primaryButton} onPress={() => setCode(String(Math.floor(100000 + Math.random() * 900000)))}>
          <Text style={styles.primaryButtonText}>새 연결 코드 만들기</Text>
        </Pressable>
      </Card>
      <Card>
        <Text style={styles.cardTitle}>현재 연결 범위</Text>
        <Text style={styles.cardText}>• 코드 생성: 작동</Text>
        <Text style={styles.cardText}>• PC 실시간 전송: 서버 연결 전</Text>
      </Card>
    </View>
  );
}

function SettingRow({
  title,
  description,
  value,
  onValueChange,
}: {
  title: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.flexOne}>
        <Text style={styles.listCardTitle}>{title}</Text>
        <Text style={styles.cardText}>{description}</Text>
      </View>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ false: '#30363d', true: '#238636' }} thumbColor="#f0f6fc" />
    </View>
  );
}

function SettingsScreen({ settings, onChange }: { settings: AppSettings; onChange: (settings: AppSettings) => void }) {
  return (
    <Card>
      <SettingRow
        title="박자 진동"
        description="집중 연습 박자와 시작·종료 때 진동"
        value={settings.haptics}
        onValueChange={(value) => onChange({ ...settings, haptics: value })}
      />
      <SettingRow
        title="영상 갤러리 자동 저장"
        description="촬영 완료 후 휴대폰 갤러리에 저장"
        value={settings.autoSaveVideo}
        onValueChange={(value) => onChange({ ...settings, autoSaveVideo: value })}
      />
      <SettingRow
        title="음성 피드백 예약"
        description="안정적인 음성 모듈을 별도 검증한 뒤 사용"
        value={settings.voiceFeedback}
        onValueChange={(value) => onChange({ ...settings, voiceFeedback: value })}
      />
      <Text style={styles.successText}>설정은 자동 저장됩니다.</Text>
    </Card>
  );
}

export default function AppV4() {
  const [screen, setScreen] = useState<ScreenKey>('home');
  const [state, setState] = useState<PersistedState>(DEFAULT_STATE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<PersistedState>;
        setState({
          ...DEFAULT_STATE,
          ...parsed,
          tone: { ...DEFAULT_STATE.tone, ...parsed.tone },
          settings: { ...DEFAULT_STATE.settings, ...parsed.settings },
          records: parsed.records ?? [],
          videos: parsed.videos ?? [],
          completedLessons: parsed.completedLessons ?? [],
        });
      })
      .catch(() => Alert.alert('저장 데이터 오류', '기존 설정을 읽지 못해 기본값으로 시작합니다.'))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [loaded, state]);

  const title = useMemo(
    () => (screen === 'home' ? '홈' : SCREEN_ITEMS.find((item) => item.key === screen)?.title ?? '기타 코치'),
    [screen],
  );

  const addRecord = (record: PracticeRecord) =>
    setState((current) => ({ ...current, records: [record, ...current.records].slice(0, 100) }));
  const addVideo = (video: SavedVideo) =>
    setState((current) => ({ ...current, videos: [video, ...current.videos].slice(0, 50) }));

  const content = (() => {
    if (screen === 'home') return <HomeScreen onOpen={setScreen} state={state} />;
    if (screen === 'camera') return <CameraPracticeScreen settings={state.settings} onSaveRecord={addRecord} onSaveVideo={addVideo} />;
    if (screen === 'focus') return <FocusPracticeScreen settings={state.settings} onSaveRecord={addRecord} />;
    if (screen === 'sheet') return <SheetScreen />;
    if (screen === 'tone') return <ToneScreen tone={state.tone} onChange={(tone) => setState((current) => ({ ...current, tone }))} />;
    if (screen === 'study') {
      return (
        <StudyScreen
          completed={state.completedLessons}
          onToggle={(id) =>
            setState((current) => ({
              ...current,
              completedLessons: current.completedLessons.includes(id)
                ? current.completedLessons.filter((item) => item !== id)
                : [...current.completedLessons, id],
            }))
          }
        />
      );
    }
    if (screen === 'records') {
      return (
        <RecordsScreen
          records={state.records}
          onRate={(id, score) =>
            setState((current) => ({
              ...current,
              records: current.records.map((record) => (record.id === id ? { ...record, selfScore: score } : record)),
            }))
          }
          onClear={() =>
            Alert.alert('기록 삭제', '모든 연습 기록을 삭제할까요?', [
              { text: '취소', style: 'cancel' },
              { text: '삭제', style: 'destructive', onPress: () => setState((current) => ({ ...current, records: [] })) },
            ])
          }
        />
      );
    }
    if (screen === 'videos') {
      return (
        <VideosScreen
          videos={state.videos}
          onClear={() =>
            Alert.alert('내역 삭제', '영상 저장 내역만 삭제할까요? 갤러리 영상은 삭제되지 않습니다.', [
              { text: '취소', style: 'cancel' },
              { text: '삭제', style: 'destructive', onPress: () => setState((current) => ({ ...current, videos: [] })) },
            ])
          }
        />
      );
    }
    if (screen === 'web') return <WebConnectScreen />;
    return <SettingsScreen settings={state.settings} onChange={(settings) => setState((current) => ({ ...current, settings }))} />;
  })();

  if (!loaded) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <ActivityIndicator color="#7ee787" size="large" />
        <Text style={styles.loadingText}>저장된 연습 정보를 불러오는 중</Text>
      </SafeAreaView>
    );
  }

  const bottomItems: Array<{ key: ScreenKey; label: string; icon: string }> = [
    { key: 'home', label: '홈', icon: '⌂' },
    { key: 'camera', label: '카메라', icon: '◉' },
    { key: 'focus', label: '집중', icon: '◎' },
    { key: 'records', label: '기록', icon: '▥' },
    { key: 'settings', label: '설정', icon: '⚙' },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0d1117" />
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {screen !== 'home' ? (
            <Pressable style={styles.backButton} onPress={() => setScreen('home')}>
              <Text style={styles.backButtonText}>‹</Text>
            </Pressable>
          ) : null}
          <View>
            <Text style={styles.brand}>GUITAR COACH AI</Text>
            <Text style={styles.pageTitle}>{title}</Text>
          </View>
        </View>
        <Pill text="0.4 안정판" active />
      </View>

      <ScrollView
        key={screen}
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {content}
      </ScrollView>

      <View style={styles.bottomNav}>
        {bottomItems.map((item) => (
          <Pressable key={item.key} style={styles.bottomItem} onPress={() => setScreen(item.key)}>
            <Text style={[styles.bottomIcon, screen === item.key && styles.bottomActive]}>{item.icon}</Text>
            <Text style={[styles.bottomLabel, screen === item.key && styles.bottomActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0d1117' },
  loadingScreen: { flex: 1, backgroundColor: '#0d1117', alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: '#8b949e', marginTop: 14 },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#21262d',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#21262d',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  backButtonText: { color: '#f0f6fc', fontSize: 32, lineHeight: 34 },
  brand: { color: '#7ee787', fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  pageTitle: { color: '#f0f6fc', fontSize: 24, fontWeight: '900', marginTop: 2 },
  content: { flex: 1 },
  contentContainer: { padding: 16, paddingBottom: 112 },
  card: {
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
  },
  heroCard: { padding: 20 },
  eyebrow: { color: '#7ee787', fontSize: 12, fontWeight: '900', letterSpacing: 0.8, marginBottom: 8 },
  heroTitle: { color: '#f0f6fc', fontSize: 22, lineHeight: 30, fontWeight: '900' },
  mutedText: { color: '#8b949e', fontSize: 14, lineHeight: 21, marginTop: 10 },
  primaryButton: {
    backgroundColor: '#2ea043',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  primaryButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '900' },
  dangerButton: { backgroundColor: '#da3633' },
  disabledButton: { opacity: 0.45 },
  sectionTitle: { color: '#f0f6fc', fontSize: 18, fontWeight: '900', marginTop: 12, marginBottom: 12 },
  menuGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
  menuCard: {
    width: '48%',
    margin: '1%',
    minHeight: 128,
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 16,
    padding: 15,
  },
  menuIcon: { color: '#7ee787', fontSize: 28, marginBottom: 10 },
  menuTitle: { color: '#f0f6fc', fontSize: 15, fontWeight: '900' },
  menuSubtitle: { color: '#8b949e', fontSize: 11, lineHeight: 16, marginTop: 5 },
  summaryRow: { flexDirection: 'row', marginBottom: 18 },
  summaryCell: { flex: 1, alignItems: 'center' },
  summaryValue: { color: '#7ee787', fontSize: 25, fontWeight: '900' },
  summaryLabel: { color: '#8b949e', fontSize: 11, marginTop: 3 },
  cardTitle: { color: '#f0f6fc', fontSize: 16, fontWeight: '900', marginBottom: 6 },
  cardText: { color: '#b1bac4', fontSize: 13, lineHeight: 20 },
  pill: {
    backgroundColor: '#21262d',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#30363d',
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
  },
  pillActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  pillText: { color: '#8b949e', fontSize: 11, fontWeight: '800' },
  pillTextActive: { color: '#ffffff' },
  cameraShell: {
    height: 520,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#030608',
    borderWidth: 1,
    borderColor: '#30363d',
  },
  cameraView: { flex: 1 },
  cameraOverlayTop: {
    position: 'absolute',
    top: 14,
    left: 14,
    right: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timerText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  handGuide: {
    position: 'absolute',
    top: 120,
    left: '12%',
    width: '76%',
    height: 230,
    borderWidth: 2,
    borderColor: '#7ee787',
    borderStyle: 'dashed',
    borderRadius: 115,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handGuideText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    padding: 8,
    borderRadius: 8,
  },
  cameraOverlayBottom: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(13,17,23,0.88)',
    borderRadius: 14,
    padding: 12,
  },
  overlayTitle: { color: '#7ee787', fontSize: 13, fontWeight: '900' },
  overlayText: { color: '#b1bac4', fontSize: 11, lineHeight: 17, marginTop: 4 },
  buttonRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 8 },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#21262d',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  secondaryButtonText: { color: '#f0f6fc', fontSize: 13, fontWeight: '800' },
  recordButton: { flex: 1, backgroundColor: '#f85149', borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  stopButton: { backgroundColor: '#da3633' },
  recordButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
  infoText: { color: '#6e7681', fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 12 },
  successText: { color: '#7ee787', fontSize: 12, lineHeight: 18, marginTop: 10 },
  warningText: { color: '#f2cc60', fontSize: 12, lineHeight: 18, marginTop: 10 },
  input: {
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 14,
    color: '#f0f6fc',
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 14,
  },
  chipRow: { paddingVertical: 12 },
  paper: { backgroundColor: '#fffdf7', borderRadius: 8, padding: 16 },
  songTitle: { color: '#171717', fontSize: 26, fontWeight: '900' },
  songMeta: { color: '#67625d', fontSize: 11, marginTop: 3 },
  chordRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 18 },
  chordBox: { width: '23%', alignItems: 'center', borderWidth: 1, borderColor: '#d6d0c5', paddingVertical: 8, borderRadius: 6 },
  chordName: { color: '#171717', fontSize: 16, fontWeight: '900' },
  chordDots: { color: '#4d4943', fontSize: 8, marginTop: 5 },
  measure: { borderWidth: 1, borderColor: '#dfd9ce', borderRadius: 6, padding: 12, marginBottom: 8 },
  measureActive: { backgroundColor: '#fff2ad', borderColor: '#c99800', borderWidth: 2 },
  measureNumber: { color: '#7a746d', fontSize: 10, fontWeight: '900' },
  measureChord: { color: '#9b2c2c', fontSize: 14, fontWeight: '900', marginTop: 5 },
  measureRhythm: { color: '#2d2a26', fontSize: 13, marginTop: 7 },
  measureLyric: { color: '#2d2a26', fontSize: 12, lineHeight: 18, marginTop: 5 },
  focusControlCard: { paddingBottom: 18 },
  bpmValue: { color: '#7ee787', fontSize: 20, fontWeight: '900' },
  durationRow: { flexDirection: 'row', marginTop: 12, gap: 6 },
  durationButton: {
    flex: 1,
    backgroundColor: '#21262d',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#30363d',
  },
  timerCard: { alignItems: 'stretch', padding: 20 },
  countdownNumber: { color: '#f0f6fc', fontSize: 54, fontWeight: '900', marginVertical: 12, textAlign: 'center' },
  progressTrack: { height: 9, borderRadius: 5, backgroundColor: '#21262d', overflow: 'hidden', marginBottom: 18 },
  progressFill: { height: '100%', backgroundColor: '#2ea043', borderRadius: 5 },
  patternRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  patternCell: {
    flex: 1,
    minHeight: 86,
    borderRadius: 16,
    backgroundColor: '#0d1117',
    borderWidth: 1,
    borderColor: '#30363d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  patternCellActive: { backgroundColor: '#238636', borderColor: '#7ee787', borderWidth: 2 },
  patternText: { color: '#8b949e', fontSize: 24, fontWeight: '900' },
  patternTextActive: { color: '#ffffff', fontSize: 30 },
  beatNumber: { color: '#6e7681', fontSize: 10, marginTop: 5 },
  focusStats: { flexDirection: 'row', marginTop: 18, borderTopWidth: 1, borderTopColor: '#30363d', paddingTop: 16 },
  focusStat: { flex: 1, alignItems: 'center' },
  focusStatValue: { color: '#f0f6fc', fontSize: 22, fontWeight: '900' },
  focusStatLabel: { color: '#8b949e', fontSize: 10, marginTop: 3 },
  mistakeValue: { color: '#f85149' },
  mistakeButton: { flex: 1, backgroundColor: '#9e6a03', borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  mistakeButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  resultBox: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#30363d', alignItems: 'center' },
  resultScore: { color: '#7ee787', fontSize: 46, fontWeight: '900' },
  resultMeta: { color: '#8b949e', fontSize: 12, marginTop: 4 },
  resultFeedback: { color: '#f0f6fc', fontSize: 14, lineHeight: 22, textAlign: 'center', marginTop: 14 },
  smallButton: {
    flex: 1,
    backgroundColor: '#21262d',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#30363d',
  },
  smallButtonActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  smallButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  stackGap: { gap: 10 },
  listCard: { backgroundColor: '#161b22', borderRadius: 16, borderWidth: 1, borderColor: '#30363d', padding: 15 },
  listCardActive: { borderColor: '#2ea043', backgroundColor: '#17251b' },
  listCardTitle: { color: '#f0f6fc', fontSize: 15, fontWeight: '900' },
  listCardMeta: { color: '#7ee787', fontSize: 11, marginTop: 5 },
  controlRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#21262d' },
  controlLabel: { color: '#b1bac4', flex: 1, fontSize: 12, fontWeight: '900' },
  controlValue: { color: '#f0f6fc', width: 44, textAlign: 'center', fontSize: 16, fontWeight: '900' },
  roundButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  roundButtonText: { color: '#f0f6fc', fontSize: 20, fontWeight: '900' },
  lessonCard: { flexDirection: 'row', backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 16, padding: 14 },
  lessonCardDone: { borderColor: '#2ea043', backgroundColor: '#17251b' },
  checkBox: { width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: '#6e7681', marginRight: 12, alignItems: 'center', justifyContent: 'center' },
  checkBoxDone: { backgroundColor: '#238636', borderColor: '#2ea043' },
  checkText: { color: '#ffffff', fontWeight: '900' },
  flexOne: { flex: 1 },
  textButton: { alignSelf: 'flex-end', padding: 8, marginBottom: 6 },
  textButtonText: { color: '#f85149', fontSize: 12, fontWeight: '900' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  recordStats: { flexDirection: 'row', gap: 8, marginTop: 12 },
  recordStat: { color: '#b1bac4', backgroundColor: '#21262d', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6, fontSize: 11 },
  recordScore: { color: '#7ee787', backgroundColor: '#17251b', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6, fontSize: 11, fontWeight: '900' },
  recordFeedback: { color: '#f2cc60', fontSize: 12, lineHeight: 19, marginTop: 12 },
  ratingLabel: { color: '#8b949e', fontSize: 11, marginTop: 14 },
  ratingRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  ratingButton: { flex: 1, borderRadius: 10, backgroundColor: '#21262d', paddingVertical: 9, alignItems: 'center' },
  ratingButtonActive: { backgroundColor: '#238636' },
  ratingButtonText: { color: '#ffffff', fontWeight: '900' },
  videoThumb: { height: 90, backgroundColor: '#0d1117', borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  videoPlay: { color: '#7ee787', fontSize: 28 },
  centerCard: { alignItems: 'center' },
  pairCode: { color: '#f0f6fc', fontSize: 42, fontWeight: '900', letterSpacing: 5, marginVertical: 16 },
  settingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#21262d' },
  bottomNav: { height: 76, backgroundColor: '#161b22', borderTopWidth: 1, borderTopColor: '#30363d', flexDirection: 'row', paddingBottom: 6 },
  bottomItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bottomIcon: { color: '#6e7681', fontSize: 20 },
  bottomLabel: { color: '#6e7681', fontSize: 10, fontWeight: '800', marginTop: 4 },
  bottomActive: { color: '#7ee787' },
});
