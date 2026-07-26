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

type PracticeMode = '코드' | '핑거링' | '아르페지오' | '스트럼' | '피킹' | '카메라 연습';

type PracticeRecord = {
  id: string;
  createdAt: string;
  mode: PracticeMode;
  durationSeconds: number;
  source: '타이머' | '카메라';
  selfScore?: number;
};

type SavedVideo = {
  id: string;
  createdAt: string;
  durationSeconds: number;
  savedToGallery: boolean;
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
    voiceFeedback: true,
    haptics: true,
    autoSaveVideo: true,
  },
};

const SCREENS: Array<{ key: ScreenKey; title: string; icon: string; subtitle: string }> = [
  { key: 'camera', title: '카메라 연습', icon: '◉', subtitle: '실제 카메라 미리보기와 녹화' },
  { key: 'sheet', title: '악보', icon: '♬', subtitle: '곡 선택과 현재 마디 이동' },
  { key: 'focus', title: '집중 연습', icon: '◎', subtitle: '카운트다운·타이머·기록 저장' },
  { key: 'tone', title: '톤메이킹', icon: '≋', subtitle: '장비와 노브 설정 저장' },
  { key: 'study', title: '공부하기', icon: '▤', subtitle: '학습 항목 완료 체크' },
  { key: 'records', title: '연습 기록', icon: '▥', subtitle: '저장된 연습 결과 확인' },
  { key: 'videos', title: '촬영 영상', icon: '▶', subtitle: '갤러리 저장 내역 확인' },
  { key: 'web', title: '웹 연결', icon: '⌁', subtitle: '연결 코드 생성' },
  { key: 'settings', title: '설정', icon: '⚙', subtitle: '피드백·진동·저장 옵션' },
];

const FOCUS_MODES: PracticeMode[] = ['코드', '핑거링', '아르페지오', '스트럼', '피킹'];

const SONGS = [
  {
    id: 'photograph',
    title: 'Photograph',
    artist: 'Ed Sheeran',
    chords: ['G', 'Em', 'C', 'D'],
    measures: [
      { chord: 'G        Em', lyric: 'Loving can hurt, loving can hurt sometimes', rhythm: '↓  ↓↑  ↑↓↑' },
      { chord: 'C         D', lyric: 'But it is the only thing that I know', rhythm: '↓  ↓↑  ↑↓↑' },
      { chord: 'G        Em', lyric: 'When it gets hard, you know it can get hard sometimes', rhythm: '↓  ↓↑  ↑↓↑' },
    ],
  },
  {
    id: 'windsong',
    title: 'Windsong',
    artist: 'Acoustic practice',
    chords: ['Am', 'F', 'C', 'G'],
    measures: [
      { chord: 'Am        F', lyric: 'P · I · M · I arpeggio pattern', rhythm: 'P  I  M  I' },
      { chord: 'C         G', lyric: 'Keep the thumb volume even', rhythm: 'P  I  M  I' },
      { chord: 'Am        F', lyric: 'Return the index without reaching forward', rhythm: 'P  I  P  M' },
    ],
  },
];

function nowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
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

function HomeScreen({
  onOpen,
  state,
}: {
  onOpen: (screen: ScreenKey) => void;
  state: PersistedState;
}) {
  const totalSeconds = state.records.reduce((sum, record) => sum + record.durationSeconds, 0);
  const latest = state.records[0];

  return (
    <View>
      <Card style={styles.heroCard}>
        <Text style={styles.eyebrow}>오늘의 연습</Text>
        <Text style={styles.heroTitle}>화면을 선택하면 완전히 다른 기능 화면으로 이동합니다.</Text>
        <Text style={styles.mutedText}>
          카메라 녹화, 집중 타이머, 기록 저장, 톤 설정과 공부 체크가 실제로 작동하도록 연결했습니다.
        </Text>
        <Pressable style={styles.primaryButton} onPress={() => onOpen('camera')}>
          <Text style={styles.primaryButtonText}>카메라 연습 열기</Text>
        </Pressable>
      </Card>

      <Text style={styles.sectionTitle}>기능 화면</Text>
      <View style={styles.menuGrid}>
        {SCREENS.map((item) => (
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
          {latest ? `${latest.mode} · ${formatDuration(latest.durationSeconds)} · ${formatDate(latest.createdAt)}` : '아직 저장된 연습이 없습니다.'}
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
  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const recordingStartedAtRef = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState('촬영 대기');

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

  const startRecording = async () => {
    if (!cameraReady || !cameraRef.current || recording) return;
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
        });
        onSaveRecord({
          id: nowId('practice'),
          createdAt: new Date().toISOString(),
          mode: '카메라 연습',
          durationSeconds,
          source: '카메라',
        });
        setStatus(savedToGallery ? '갤러리에 저장 완료' : '앱 촬영 완료');
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
          ref={cameraRef}
          style={styles.cameraView}
          facing={facing}
          mode="video"
          onCameraReady={() => setCameraReady(true)}
        />
        <View style={styles.cameraOverlayTop}>
          <Pill text={recording ? '● 녹화 중' : status} active={recording} />
          <Text style={styles.timerText}>{formatDuration(elapsed)}</Text>
        </View>
        <View style={styles.handGuide}>
          <Text style={styles.handGuideText}>오른손과 기타 줄이 이 영역에 보이도록 맞추세요.</Text>
        </View>
        <View style={styles.cameraOverlayBottom}>
          <Text style={styles.overlayTitle}>실제 카메라 기능 연결됨</Text>
          <Text style={styles.overlayText}>현재 버전은 촬영과 저장까지 지원합니다. AI 자세 판정은 아직 연결 전입니다.</Text>
        </View>
      </View>

      <View style={styles.buttonRow}>
        <Pressable
          style={styles.secondaryButton}
          disabled={recording}
          onPress={() => setFacing((value) => (value === 'back' ? 'front' : 'back'))}
        >
          <Text style={styles.secondaryButtonText}>카메라 전환</Text>
        </Pressable>
        <Pressable style={[styles.recordButton, recording && styles.stopButton]} onPress={recording ? stopRecording : startRecording}>
          <Text style={styles.recordButtonText}>{recording ? '녹화 종료' : '녹화 시작'}</Text>
        </Pressable>
      </View>
      <Text style={styles.infoText}>최대 10분 촬영합니다. 자동 저장이 켜져 있으면 갤러리에 저장됩니다.</Text>
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
          <Pressable key={`${song.id}-${index}`} onPress={() => setMeasure(index)} style={[styles.measure, measure === index && styles.measureActive]}>
            <Text style={styles.measureNumber}>{String(index + 1).padStart(2, '0')}</Text>
            <Text style={styles.measureChord}>{item.chord}</Text>
            <Text style={styles.measureRhythm}>{item.rhythm}</Text>
            <Text style={styles.measureLyric}>{item.lyric}</Text>
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
        <Text style={styles.primaryButtonText}>유튜브에서 공식 영상 검색</Text>
      </Pressable>
      <Text style={styles.infoText}>현재 마디 이동은 작동합니다. 음원 시간과 자동 동기화는 다음 단계입니다.</Text>
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
  const [mode, setMode] = useState<PracticeMode>('아르페지오');
  const [targetSeconds, setTargetSeconds] = useState(180);
  const [remaining, setRemaining] = useState(180);
  const [countdown, setCountdown] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'countdown' | 'running'>('idle');
  const [finishedDuration, setFinishedDuration] = useState(0);

  useEffect(() => {
    if (phase !== 'idle') return;
    setRemaining(targetSeconds);
    setFinishedDuration(0);
  }, [targetSeconds, mode]);

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
    const timer = setTimeout(() => {
      setRemaining((value) => {
        if (value <= 1) {
          setPhase('idle');
          setFinishedDuration(targetSeconds);
          onSaveRecord({
            id: nowId('practice'),
            createdAt: new Date().toISOString(),
            mode,
            durationSeconds: targetSeconds,
            source: '타이머',
          });
          if (settings.haptics) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert('연습 완료', `${mode} ${formatDuration(targetSeconds)} 기록을 저장했습니다.`);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearTimeout(timer);
  }, [phase, mode, onSaveRecord, settings.haptics, targetSeconds, remaining]);

  const start = () => {
    if (phase !== 'idle') return;
    if (remaining === 0) setRemaining(targetSeconds);
    setCountdown(3);
    setPhase('countdown');
    setFinishedDuration(0);
  };

  const stop = () => {
    const practiced = Math.max(0, targetSeconds - remaining);
    setPhase('idle');
    setCountdown(0);
    setRemaining(targetSeconds);
    if (practiced >= 5) {
      onSaveRecord({
        id: nowId('practice'),
        createdAt: new Date().toISOString(),
        mode,
        durationSeconds: practiced,
        source: '타이머',
      });
      setFinishedDuration(practiced);
      Alert.alert('기록 저장', `${formatDuration(practiced)} 연습을 저장했습니다.`);
    }
  };

  return (
    <View>
      <Text style={styles.sectionTitle}>연습 종류</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {FOCUS_MODES.map((item) => (
          <Pressable key={item} disabled={phase !== 'idle'} onPress={() => setMode(item)}>
            <Pill text={item} active={mode === item} />
          </Pressable>
        ))}
      </ScrollView>

      <Card style={styles.timerCard}>
        <Text style={styles.eyebrow}>{mode} 집중 연습</Text>
        <Text style={styles.countdownNumber}>{countdown > 0 ? countdown : formatDuration(remaining)}</Text>
        <Text style={styles.drillPattern}>{mode === '아르페지오' ? 'P · I · P · M' : mode === '스트럼' ? '↓ · ↓↑ · ↑↓↑' : '천천히 · 정확하게 · 반복'}</Text>
        <View style={styles.buttonRow}>
          {[60, 180, 300].map((seconds) => (
            <Pressable key={seconds} disabled={phase !== 'idle'} style={[styles.smallButton, targetSeconds === seconds && styles.smallButtonActive]} onPress={() => setTargetSeconds(seconds)}>
              <Text style={styles.smallButtonText}>{seconds / 60}분</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={[styles.primaryButton, phase !== 'idle' && styles.dangerButton]} onPress={phase !== 'idle' ? stop : start}>
          <Text style={styles.primaryButtonText}>{phase !== 'idle' ? '중지하고 기록 저장' : '3초 카운트 후 시작'}</Text>
        </Pressable>
      </Card>
      {finishedDuration > 0 ? <Text style={styles.successText}>최근 저장: {formatDuration(finishedDuration)}</Text> : null}
      <Text style={styles.infoText}>타이머와 기록 저장은 실제로 작동합니다. AI 점수는 아직 생성하지 않습니다.</Text>
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

const LESSONS = [
  { id: 'index-return', title: '검지 복귀가 느려지는 이유', body: '손가락을 앞으로 밀지 말고 관절을 접어 줄을 통과합니다.' },
  { id: 'pick-depth', title: '피크 깊이 일정하게 만들기', body: '줄 안쪽으로 2~3mm만 들어가도록 기준을 정합니다.' },
  { id: 'upstroke', title: '업스트로크 걸림 줄이기', body: '업에서는 피크 각도를 아주 조금 열고 손목 힘을 뺍니다.' },
  { id: 'rhythm', title: '4박 75 BPM 안정화', body: '속도보다 8마디 연속 무실수를 먼저 목표로 합니다.' },
];

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
      <Text style={styles.infoText}>항목을 누르면 완료 상태가 저장됩니다.</Text>
    </View>
  );
}

function RecordsScreen({ records, onRate, onClear }: { records: PracticeRecord[]; onRate: (id: string, score: number) => void; onClear: () => void }) {
  if (records.length === 0) {
    return (
      <Card>
        <Text style={styles.cardTitle}>아직 연습 기록이 없습니다.</Text>
        <Text style={styles.cardText}>집중 연습 타이머를 완료하거나 카메라 녹화를 끝내면 여기에 저장됩니다.</Text>
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
            <Text style={styles.ratingLabel}>내 연습 평가 {record.selfScore ? `${record.selfScore}/5` : '선택 안 함'}</Text>
            <View style={styles.ratingRow}>
              {[1, 2, 3, 4, 5].map((score) => (
                <Pressable key={score} style={[styles.ratingButton, record.selfScore === score && styles.ratingButtonActive]} onPress={() => onRate(record.id, score)}>
                  <Text style={styles.ratingButtonText}>{score}</Text>
                </Pressable>
              ))}
            </View>
          </Card>
        ))}
      </View>
      <Text style={styles.infoText}>현재 점수는 사용자가 직접 남기는 자기평가입니다. AI 점수로 표시하지 않습니다.</Text>
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
            <Text style={styles.cardText}>카메라 연습 화면에서 녹화를 완료하면 저장 내역이 표시됩니다.</Text>
          </Card>
        ) : (
          videos.map((video, index) => (
            <Card key={video.id}>
              <View style={styles.videoThumb}>
                <Text style={styles.videoPlay}>▶</Text>
              </View>
              <Text style={styles.cardTitle}>연습 영상 {videos.length - index}</Text>
              <Text style={styles.cardText}>{formatDate(video.createdAt)} · {formatDuration(video.durationSeconds)}</Text>
              <Text style={video.savedToGallery ? styles.successText : styles.warningText}>
                {video.savedToGallery ? '휴대폰 갤러리에 저장됨' : '자동 갤러리 저장이 꺼져 있었음'}
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
  const makeCode = () => setCode(String(Math.floor(100000 + Math.random() * 900000)));

  return (
    <View>
      <Card style={styles.centerCard}>
        <Text style={styles.eyebrow}>컴퓨터 연결 코드</Text>
        <Text selectable style={styles.pairCode}>{code}</Text>
        <Text style={styles.cardText}>연결 코드는 현재 휴대폰에서 생성됩니다.</Text>
        <Pressable style={styles.primaryButton} onPress={makeCode}>
          <Text style={styles.primaryButtonText}>새 연결 코드 만들기</Text>
        </Pressable>
      </Card>
      <Card>
        <Text style={styles.cardTitle}>현재 연결 범위</Text>
        <Text style={styles.cardText}>• 코드 생성: 작동</Text>
        <Text style={styles.cardText}>• PC 실시간 전송: 아직 서버 미연결</Text>
        <Text style={styles.cardText}>• 전체 영상 스트리밍: 사용하지 않음</Text>
      </Card>
    </View>
  );
}

function SettingRow({ title, description, value, onValueChange }: { title: string; description: string; value: boolean; onValueChange: (value: boolean) => void }) {
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
        title="음성 피드백"
        description="향후 음성 코칭 사용 여부"
        value={settings.voiceFeedback}
        onValueChange={(value) => onChange({ ...settings, voiceFeedback: value })}
      />
      <SettingRow
        title="진동 카운트"
        description="연습 시작과 종료 때 진동"
        value={settings.haptics}
        onValueChange={(value) => onChange({ ...settings, haptics: value })}
      />
      <SettingRow
        title="영상 갤러리 자동 저장"
        description="촬영 완료 후 휴대폰 갤러리에 저장"
        value={settings.autoSaveVideo}
        onValueChange={(value) => onChange({ ...settings, autoSaveVideo: value })}
      />
      <Text style={styles.successText}>설정은 자동 저장됩니다.</Text>
    </Card>
  );
}

export default function App() {
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

  const title = useMemo(() => (screen === 'home' ? '홈' : SCREENS.find((item) => item.key === screen)?.title ?? '기타 코치'), [screen]);

  const addRecord = (record: PracticeRecord) => setState((current) => ({ ...current, records: [record, ...current.records].slice(0, 100) }));
  const addVideo = (video: SavedVideo) => setState((current) => ({ ...current, videos: [video, ...current.videos].slice(0, 50) }));

  const content = (() => {
    if (screen === 'home') return <HomeScreen onOpen={setScreen} state={state} />;
    if (screen === 'camera') return <CameraPracticeScreen settings={state.settings} onSaveRecord={addRecord} onSaveVideo={addVideo} />;
    if (screen === 'sheet') return <SheetScreen />;
    if (screen === 'focus') return <FocusPracticeScreen settings={state.settings} onSaveRecord={addRecord} />;
    if (screen === 'tone') return <ToneScreen tone={state.tone} onChange={(tone) => setState((current) => ({ ...current, tone }))} />;
    if (screen === 'study') {
      return (
        <StudyScreen
          completed={state.completedLessons}
          onToggle={(id) => setState((current) => ({
            ...current,
            completedLessons: current.completedLessons.includes(id)
              ? current.completedLessons.filter((item) => item !== id)
              : [...current.completedLessons, id],
          }))}
        />
      );
    }
    if (screen === 'records') {
      return (
        <RecordsScreen
          records={state.records}
          onRate={(id, score) => setState((current) => ({
            ...current,
            records: current.records.map((record) => (record.id === id ? { ...record, selfScore: score } : record)),
          }))}
          onClear={() => Alert.alert('기록 삭제', '모든 연습 기록을 삭제할까요?', [
            { text: '취소', style: 'cancel' },
            { text: '삭제', style: 'destructive', onPress: () => setState((current) => ({ ...current, records: [] })) },
          ])}
        />
      );
    }
    if (screen === 'videos') {
      return (
        <VideosScreen
          videos={state.videos}
          onClear={() => Alert.alert('내역 삭제', '영상 저장 내역만 삭제할까요? 갤러리 영상은 삭제되지 않습니다.', [
            { text: '취소', style: 'cancel' },
            { text: '삭제', style: 'destructive', onPress: () => setState((current) => ({ ...current, videos: [] })) },
          ])}
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
        <Pill text="기능 시험판" />
      </View>

      <ScrollView key={screen} style={styles.content} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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
  header: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#21262d' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  backButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  backButtonText: { color: '#f0f6fc', fontSize: 32, lineHeight: 34 },
  brand: { color: '#7ee787', fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  pageTitle: { color: '#f0f6fc', fontSize: 24, fontWeight: '900', marginTop: 2 },
  content: { flex: 1 },
  contentContainer: { padding: 16, paddingBottom: 112 },
  card: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 18, padding: 16, marginBottom: 12 },
  heroCard: { padding: 20 },
  eyebrow: { color: '#7ee787', fontSize: 12, fontWeight: '900', letterSpacing: 0.8, marginBottom: 8 },
  heroTitle: { color: '#f0f6fc', fontSize: 22, lineHeight: 30, fontWeight: '900' },
  mutedText: { color: '#8b949e', fontSize: 14, lineHeight: 21, marginTop: 10 },
  primaryButton: { backgroundColor: '#2ea043', borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  primaryButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '900' },
  dangerButton: { backgroundColor: '#da3633' },
  sectionTitle: { color: '#f0f6fc', fontSize: 18, fontWeight: '900', marginTop: 12, marginBottom: 12 },
  menuGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
  menuCard: { width: '48%', margin: '1%', minHeight: 128, backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 16, padding: 15 },
  menuIcon: { color: '#7ee787', fontSize: 28, marginBottom: 10 },
  menuTitle: { color: '#f0f6fc', fontSize: 15, fontWeight: '900' },
  menuSubtitle: { color: '#8b949e', fontSize: 11, lineHeight: 16, marginTop: 5 },
  summaryRow: { flexDirection: 'row', marginBottom: 18 },
  summaryCell: { flex: 1, alignItems: 'center' },
  summaryValue: { color: '#7ee787', fontSize: 25, fontWeight: '900' },
  summaryLabel: { color: '#8b949e', fontSize: 11, marginTop: 3 },
  cardTitle: { color: '#f0f6fc', fontSize: 16, fontWeight: '900', marginBottom: 6 },
  cardText: { color: '#b1bac4', fontSize: 13, lineHeight: 20 },
  pill: { backgroundColor: '#21262d', borderRadius: 16, borderWidth: 1, borderColor: '#30363d', paddingHorizontal: 10, paddingVertical: 6, marginRight: 8 },
  pillActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  pillText: { color: '#8b949e', fontSize: 11, fontWeight: '800' },
  pillTextActive: { color: '#ffffff' },
  cameraShell: { height: 520, borderRadius: 24, overflow: 'hidden', backgroundColor: '#030608', borderWidth: 1, borderColor: '#30363d' },
  cameraView: { flex: 1 },
  cameraOverlayTop: { position: 'absolute', top: 14, left: 14, right: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  timerText: { color: '#ffffff', fontSize: 18, fontWeight: '900', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
  handGuide: { position: 'absolute', top: 120, left: '12%', width: '76%', height: 230, borderWidth: 2, borderColor: '#7ee787', borderStyle: 'dashed', borderRadius: 115, alignItems: 'center', justifyContent: 'center' },
  handGuideText: { color: '#ffffff', fontSize: 12, fontWeight: '800', textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.55)', padding: 8, borderRadius: 8 },
  cameraOverlayBottom: { position: 'absolute', bottom: 12, left: 12, right: 12, backgroundColor: 'rgba(13,17,23,0.88)', borderRadius: 14, padding: 12 },
  overlayTitle: { color: '#7ee787', fontSize: 13, fontWeight: '900' },
  overlayText: { color: '#b1bac4', fontSize: 11, lineHeight: 17, marginTop: 4 },
  buttonRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 8 },
  secondaryButton: { flex: 1, backgroundColor: '#21262d', borderWidth: 1, borderColor: '#30363d', borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  secondaryButtonText: { color: '#f0f6fc', fontSize: 13, fontWeight: '800' },
  recordButton: { flex: 1, backgroundColor: '#f85149', borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  stopButton: { backgroundColor: '#da3633' },
  recordButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
  infoText: { color: '#6e7681', fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 12 },
  successText: { color: '#7ee787', fontSize: 12, lineHeight: 18, marginTop: 10 },
  warningText: { color: '#f2cc60', fontSize: 12, lineHeight: 18, marginTop: 10 },
  input: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 14, color: '#f0f6fc', paddingHorizontal: 14, paddingVertical: 13, fontSize: 14 },
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
  timerCard: { alignItems: 'center', padding: 22 },
  countdownNumber: { color: '#f0f6fc', fontSize: 54, fontWeight: '900', marginVertical: 12 },
  drillPattern: { color: '#f2cc60', fontSize: 20, fontWeight: '900', letterSpacing: 2, marginBottom: 8 },
  smallButton: { flex: 1, backgroundColor: '#21262d', borderRadius: 12, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: '#30363d' },
  smallButtonActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  smallButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  stackGap: { gap: 10 },
  listCard: { backgroundColor: '#161b22', borderRadius: 16, borderWidth: 1, borderColor: '#30363d', padding: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listCardActive: { borderColor: '#2ea043', backgroundColor: '#122018' },
  listCardTitle: { color: '#f0f6fc', fontSize: 14, fontWeight: '900' },
  listCardMeta: { color: '#7ee787', fontSize: 11, fontWeight: '800' },
  controlRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#21262d' },
  controlLabel: { color: '#b1bac4', fontSize: 12, fontWeight: '900', width: 72 },
  roundButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  roundButtonText: { color: '#f0f6fc', fontSize: 18, fontWeight: '900' },
  controlValue: { color: '#7ee787', fontSize: 16, fontWeight: '900', minWidth: 50, textAlign: 'center' },
  lessonCard: { backgroundColor: '#161b22', borderRadius: 16, borderWidth: 1, borderColor: '#30363d', padding: 15, flexDirection: 'row', alignItems: 'flex-start' },
  lessonCardDone: { backgroundColor: '#122018', borderColor: '#2ea043' },
  checkBox: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: '#6e7681', marginRight: 12, alignItems: 'center', justifyContent: 'center' },
  checkBoxDone: { backgroundColor: '#2ea043', borderColor: '#2ea043' },
  checkText: { color: '#ffffff', fontWeight: '900' },
  flexOne: { flex: 1 },
  textButton: { alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 4, marginBottom: 6 },
  textButtonText: { color: '#ff7b72', fontSize: 12, fontWeight: '800' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ratingLabel: { color: '#8b949e', fontSize: 11, marginTop: 12 },
  ratingRow: { flexDirection: 'row', marginTop: 8, gap: 7 },
  ratingButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  ratingButtonActive: { backgroundColor: '#2ea043' },
  ratingButtonText: { color: '#ffffff', fontWeight: '900' },
  videoThumb: { height: 110, borderRadius: 12, backgroundColor: '#030608', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  videoPlay: { color: '#7ee787', fontSize: 34 },
  centerCard: { alignItems: 'center', padding: 24 },
  pairCode: { color: '#f0f6fc', fontSize: 48, letterSpacing: 8, fontWeight: '900', marginVertical: 16 },
  settingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#21262d' },
  bottomNav: { height: 72, flexDirection: 'row', backgroundColor: '#161b22', borderTopWidth: 1, borderTopColor: '#30363d', paddingBottom: 8 },
  bottomItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bottomIcon: { color: '#6e7681', fontSize: 19, fontWeight: '900' },
  bottomLabel: { color: '#6e7681', fontSize: 10, fontWeight: '800', marginTop: 3 },
  bottomActive: { color: '#7ee787' },
});
