import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  LayoutChangeEvent,
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

import {
  analyzePoseAsync,
  isLiveCoachNativeAvailable,
  playNativeClickAsync,
  PoseAnalysisResult,
  PoseLandmarkPoint,
} from './modules/guitar-coach-native';

type CoachMode = '아르페지오' | '스트럼' | '피킹' | '코드 전환';
type FeedbackTone = 'good' | 'warn' | 'info';

type FeedbackItem = {
  tone: FeedbackTone;
  title: string;
  detail: string;
};

type PoseFeedback = {
  score: number;
  primary: FeedbackItem;
  items: FeedbackItem[];
};

const MODES: CoachMode[] = ['아르페지오', '스트럼', '피킹', '코드 전환'];
const BEAT_OPTIONS = [2, 3, 4, 6];
const SKELETON_LINKS: Array<[PoseLandmarkPoint['name'], PoseLandmarkPoint['name']]> = [
  ['nose', 'leftShoulder'],
  ['nose', 'rightShoulder'],
  ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftElbow'],
  ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'],
  ['rightElbow', 'rightWrist'],
  ['leftShoulder', 'leftHip'],
  ['rightShoulder', 'rightHip'],
  ['leftHip', 'rightHip'],
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function pointMap(result: PoseAnalysisResult | null) {
  const map = new Map<PoseLandmarkPoint['name'], PoseLandmarkPoint>();
  result?.landmarks.forEach((point) => map.set(point.name, point));
  return map;
}

function confident(point: PoseLandmarkPoint | undefined, threshold = 0.45) {
  return point && point.confidence >= threshold ? point : undefined;
}

function distance(a: PoseLandmarkPoint, b: PoseLandmarkPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function buildPoseFeedback(result: PoseAnalysisResult | null, mode: CoachMode): PoseFeedback {
  const noPerson: FeedbackItem = {
    tone: 'info',
    title: '상체를 카메라에 맞춰 주세요',
    detail: '얼굴, 양쪽 어깨, 팔과 손목이 화면에 들어오면 자세 피드백이 시작됩니다.',
  };

  if (!result?.hasPerson) return { score: 0, primary: noPerson, items: [noPerson] };

  const points = pointMap(result);
  const leftShoulder = confident(points.get('leftShoulder'));
  const rightShoulder = confident(points.get('rightShoulder'));
  const leftWrist = confident(points.get('leftWrist'), 0.35);
  const rightWrist = confident(points.get('rightWrist'), 0.35);
  const leftElbow = confident(points.get('leftElbow'), 0.35);
  const rightElbow = confident(points.get('rightElbow'), 0.35);
  const leftHip = confident(points.get('leftHip'), 0.3);
  const rightHip = confident(points.get('rightHip'), 0.3);
  const nose = confident(points.get('nose'), 0.4);

  if (!leftShoulder || !rightShoulder) {
    return {
      score: 20,
      primary: noPerson,
      items: [noPerson],
    };
  }

  const issues: FeedbackItem[] = [];
  let score = 100;
  const shoulderWidth = distance(leftShoulder, rightShoulder);
  const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2;
  const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;

  if (shoulderWidth < 0.16) {
    score -= 20;
    issues.push({
      tone: 'warn',
      title: '카메라와 너무 멉니다',
      detail: '상체가 화면의 절반 정도를 차지하도록 휴대폰을 조금 가까이 두세요.',
    });
  } else if (shoulderWidth > 0.62) {
    score -= 18;
    issues.push({
      tone: 'warn',
      title: '카메라와 너무 가깝습니다',
      detail: '양쪽 팔꿈치와 손목까지 보이도록 휴대폰을 조금 멀리 두세요.',
    });
  }

  const centerOffset = shoulderMidX - 0.5;
  if (Math.abs(centerOffset) > 0.13) {
    score -= 12;
    issues.push({
      tone: 'warn',
      title: centerOffset < 0 ? '몸을 화면 오른쪽으로 옮기세요' : '몸을 화면 왼쪽으로 옮기세요',
      detail: '어깨 중앙을 화면 가운데 세로선에 맞추면 팔 동작을 더 정확히 볼 수 있습니다.',
    });
  }

  const shoulderTilt = Math.abs(leftShoulder.y - rightShoulder.y) / Math.max(shoulderWidth, 0.01);
  if (shoulderTilt > 0.13) {
    score -= 18;
    issues.push({
      tone: 'warn',
      title: '양쪽 어깨 높이가 다릅니다',
      detail: '기타를 받치느라 한쪽 어깨를 올리지 말고 목과 어깨 힘을 한 번 빼세요.',
    });
  }

  if (nose) {
    const headOffset = Math.abs(nose.x - shoulderMidX) / Math.max(shoulderWidth, 0.01);
    if (headOffset > 0.34) {
      score -= 10;
      issues.push({
        tone: 'warn',
        title: '고개가 한쪽으로 많이 기울었습니다',
        detail: '지판을 보더라도 턱을 과하게 내밀지 말고 머리를 어깨 중앙에 가깝게 유지하세요.',
      });
    }
  }

  if (!leftWrist || !rightWrist) {
    score -= 20;
    issues.push({
      tone: 'warn',
      title: '손목이 화면 밖으로 나갔습니다',
      detail: '왼손 손목과 오른손 손목이 모두 보이도록 카메라 각도나 거리를 조절하세요.',
    });
  }

  if ((mode === '스트럼' || mode === '피킹' || mode === '아르페지오') && rightElbow && rightWrist) {
    if (rightElbow.y < shoulderMidY - 0.015) {
      score -= 10;
      issues.push({
        tone: 'warn',
        title: '오른쪽 팔꿈치가 너무 올라갔습니다',
        detail: '팔꿈치를 억지로 들지 말고 기타 몸통 위에 자연스럽게 걸치세요.',
      });
    }

    if (rightWrist.y < rightElbow.y - 0.09) {
      score -= 10;
      issues.push({
        tone: 'warn',
        title: '오른손 손목이 과하게 꺾였습니다',
        detail: '손목을 위로 꺾기보다 팔과 손등이 부드럽게 이어지도록 맞추세요.',
      });
    }
  }

  if (mode === '코드 전환' && leftElbow && leftWrist) {
    if (leftWrist.y < leftElbow.y - 0.12) {
      score -= 10;
      issues.push({
        tone: 'warn',
        title: '왼손 손목을 과하게 들어 올렸습니다',
        detail: '엄지와 손목에 힘을 몰아주지 말고 팔꿈치 위치를 조금 자연스럽게 내려 보세요.',
      });
    }
  }

  if (leftHip && rightHip) {
    const hipMidX = (leftHip.x + rightHip.x) / 2;
    if (Math.abs(hipMidX - shoulderMidX) > 0.12) {
      score -= 10;
      issues.push({
        tone: 'warn',
        title: '상체가 옆으로 기울었습니다',
        detail: '골반 위에 상체를 세우고 기타 쪽으로 몸 전체를 접지 마세요.',
      });
    }
  }

  const safeScore = clamp(Math.round(score), 0, 100);
  if (issues.length === 0) {
    const good: FeedbackItem = {
      tone: 'good',
      title: '현재 상체 자세가 안정적입니다',
      detail: '이 자세를 유지하면서 어깨와 손목 힘을 빼고 메트로놈 박자에 맞춰 연주하세요.',
    };
    return { score: safeScore, primary: good, items: [good] };
  }

  return { score: safeScore, primary: issues[0], items: issues.slice(0, 3) };
}

function PillButton({
  label,
  active = false,
  onPress,
  disabled = false,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pillButton,
        active && styles.pillButtonActive,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.pillButtonText, active && styles.pillButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ActionButton({
  label,
  onPress,
  danger = false,
  secondary = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        secondary && styles.actionButtonSecondary,
        danger && styles.actionButtonDanger,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={styles.actionButtonText}>{label}</Text>
    </Pressable>
  );
}

function SkeletonOverlay({ result, width, height }: { result: PoseAnalysisResult | null; width: number; height: number }) {
  const points = useMemo(() => pointMap(result), [result]);
  if (!result?.hasPerson || width <= 0 || height <= 0) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {SKELETON_LINKS.map(([fromName, toName]) => {
        const from = confident(points.get(fromName), 0.35);
        const to = confident(points.get(toName), 0.35);
        if (!from || !to) return null;

        const x1 = from.x * width;
        const y1 = from.y * height;
        const x2 = to.x * width;
        const y2 = to.y * height;
        const length = Math.hypot(x2 - x1, y2 - y1);
        const angle = Math.atan2(y2 - y1, x2 - x1);

        return (
          <View
            key={`${fromName}-${toName}`}
            style={[
              styles.skeletonLine,
              {
                width: length,
                left: (x1 + x2) / 2 - length / 2,
                top: (y1 + y2) / 2 - 1.5,
                transform: [{ rotate: `${angle}rad` }],
              },
            ]}
          />
        );
      })}

      {[...points.values()].map((point) => {
        if (point.confidence < 0.35) return null;
        return (
          <View
            key={point.name}
            style={[
              styles.skeletonDot,
              {
                left: point.x * width - 5,
                top: point.y * height - 5,
                opacity: clamp(point.confidence, 0.45, 1),
              },
            ]}
          />
        );
      })}
    </View>
  );
}

function FeedbackCard({ feedback, latencyMs }: { feedback: PoseFeedback; latencyMs?: number }) {
  return (
    <View style={styles.card}>
      <View style={styles.feedbackHeader}>
        <View>
          <Text style={styles.cardEyebrow}>실시간 자세 피드백</Text>
          <Text style={styles.cardTitle}>{feedback.primary.title}</Text>
        </View>
        <View style={[styles.scoreBadge, feedback.score >= 80 && styles.scoreBadgeGood]}>
          <Text style={styles.scoreText}>{feedback.score}</Text>
        </View>
      </View>
      <Text style={styles.bodyText}>{feedback.primary.detail}</Text>
      {feedback.items.slice(1).map((item) => (
        <View key={item.title} style={styles.feedbackRow}>
          <Text style={styles.feedbackBullet}>•</Text>
          <View style={styles.feedbackBody}>
            <Text style={styles.feedbackTitle}>{item.title}</Text>
            <Text style={styles.feedbackDetail}>{item.detail}</Text>
          </View>
        </View>
      ))}
      {latencyMs !== undefined ? <Text style={styles.latencyText}>분석 처리 {latencyMs}ms · 약 1초 간격</Text> : null}
    </View>
  );
}

export default function LiveCoachTestApp() {
  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('front');
  const [cameraKey, setCameraKey] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [analysisEnabled, setAnalysisEnabled] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<PoseAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState('');
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const analysisBusyRef = useRef(false);

  const [mode, setMode] = useState<CoachMode>('아르페지오');
  const [bpm, setBpm] = useState(70);
  const [bpmInput, setBpmInput] = useState('70');
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [hapticsEnabled, setHapticsEnabled] = useState(false);
  const [metronomeRunning, setMetronomeRunning] = useState(false);
  const [beatIndex, setBeatIndex] = useState(0);
  const [soundError, setSoundError] = useState('');

  const feedback = useMemo(() => buildPoseFeedback(analysisResult, mode), [analysisResult, mode]);

  useEffect(() => {
    if (!analysisEnabled || !cameraReady || !permission?.granted || !isLiveCoachNativeAvailable) return;

    let cancelled = false;
    let nextTimer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (delay: number) => {
      if (!cancelled) nextTimer = setTimeout(captureAndAnalyze, delay);
    };

    const captureAndAnalyze = async () => {
      if (cancelled || analysisBusyRef.current || !cameraRef.current) {
        schedule(250);
        return;
      }

      analysisBusyRef.current = true;
      const cycleStarted = Date.now();

      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.22,
          shutterSound: false,
          mirror: facing === 'front',
        });

        if (!photo?.uri || cancelled) return;
        const result = await analyzePoseAsync(photo.uri);
        if (!cancelled) {
          setAnalysisResult(result);
          setAnalysisError('');
        }
      } catch (error) {
        if (!cancelled) {
          setAnalysisError(error instanceof Error ? error.message : '자세 분석 중 오류가 발생했습니다.');
        }
      } finally {
        analysisBusyRef.current = false;
        const elapsed = Date.now() - cycleStarted;
        schedule(Math.max(220, 950 - elapsed));
      }
    };

    schedule(150);
    return () => {
      cancelled = true;
      if (nextTimer) clearTimeout(nextTimer);
      analysisBusyRef.current = false;
    };
  }, [analysisEnabled, cameraReady, facing, permission?.granted]);

  useEffect(() => {
    if (!metronomeRunning) {
      setBeatIndex(0);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let currentBeat = 0;
    const intervalMs = 60000 / bpm;
    let nextAt = Date.now() + 80;

    const tick = () => {
      if (cancelled) return;
      const accent = currentBeat === 0;
      setBeatIndex(currentBeat);

      if (soundEnabled) {
        void playNativeClickAsync(accent).catch((error) => {
          setSoundError(error instanceof Error ? error.message : '메트로놈 소리를 재생하지 못했습니다.');
          setSoundEnabled(false);
        });
      }

      if (hapticsEnabled) {
        void Haptics.impactAsync(accent ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
      }

      currentBeat = (currentBeat + 1) % beatsPerBar;
      nextAt += intervalMs;
      timer = setTimeout(tick, Math.max(0, nextAt - Date.now()));
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [beatsPerBar, bpm, hapticsEnabled, metronomeRunning, soundEnabled]);

  const setSafeBpm = (next: number) => {
    const safe = clamp(Math.round(next), 35, 180);
    setBpm(safe);
    setBpmInput(String(safe));
  };

  const commitBpmInput = () => {
    const parsed = Number(bpmInput);
    if (!Number.isFinite(parsed)) {
      setBpmInput(String(bpm));
      return;
    }
    setSafeBpm(parsed);
  };

  const switchCamera = () => {
    setAnalysisEnabled(false);
    setAnalysisResult(null);
    setCameraReady(false);
    setFacing((current) => (current === 'front' ? 'back' : 'front'));
    setCameraKey((current) => current + 1);
  };

  const toggleAnalysis = () => {
    if (!isLiveCoachNativeAvailable) {
      Alert.alert('분석 모듈 없음', '이 APK에는 Android 자세 분석 모듈이 포함되지 않았습니다.');
      return;
    }
    setAnalysisError('');
    setAnalysisEnabled((current) => !current);
  };

  const testSound = () => {
    setSoundError('');
    void playNativeClickAsync(true).catch((error) => {
      setSoundError(error instanceof Error ? error.message : '소리 테스트에 실패했습니다.');
    });
  };

  const onPreviewLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setPreviewSize({ width, height });
  };

  if (!permission) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <ActivityIndicator size="large" color="#7ee787" />
        <Text style={styles.loadingText}>카메라 권한 확인 중</Text>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <StatusBar barStyle="light-content" backgroundColor="#0d1117" />
        <View style={styles.permissionCard}>
          <Text style={styles.heroTitle}>실시간 자세 코치를 사용하려면 카메라 권한이 필요합니다.</Text>
          <Text style={styles.bodyText}>영상은 서버로 전송하지 않으며, 자세 좌표는 휴대폰 안에서만 계산합니다.</Text>
          <ActionButton label="카메라 권한 허용" onPress={() => void requestPermission()} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0d1117" />
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>GUITAR COACH AI</Text>
          <Text style={styles.pageTitle}>라이브 집중 코치</Text>
        </View>
        <View style={styles.testBadge}>
          <Text style={styles.testBadgeText}>0.5.5 TEST</Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>기존 0.5.4 앱과 별도로 설치되는 호환성 테스트판</Text>
          <Text style={styles.noticeText}>소리는 Android 시스템 톤을 사용하고, 카메라 자세 분석은 약 1초 간격으로 실행됩니다.</Text>
        </View>

        <Text style={styles.sectionTitle}>연습 종류</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalRow}>
          {MODES.map((item) => (
            <PillButton key={item} label={item} active={item === mode} onPress={() => setMode(item)} />
          ))}
        </ScrollView>

        <View style={styles.cameraFrame} onLayout={onPreviewLayout}>
          <CameraView
            key={`${facing}-${cameraKey}`}
            ref={cameraRef}
            style={styles.camera}
            facing={facing}
            mirror={facing === 'front'}
            mode="picture"
            ratio="4:3"
            animateShutter={false}
            onCameraReady={() => setCameraReady(true)}
            onMountError={(event) => setAnalysisError(event.message)}
          />
          <View pointerEvents="none" style={styles.centerGuide} />
          <View pointerEvents="none" style={styles.cameraTopRow}>
            <Text style={styles.cameraBadge}>{facing === 'front' ? '전면 카메라' : '후면 카메라'}</Text>
            <Text style={[styles.cameraBadge, analysisEnabled && styles.cameraBadgeActive]}>
              {analysisEnabled ? '자세 분석 중' : '분석 대기'}
            </Text>
          </View>
          <SkeletonOverlay result={analysisResult} width={previewSize.width} height={previewSize.height} />
          {!cameraReady ? (
            <View style={styles.cameraLoading}>
              <ActivityIndicator color="#7ee787" />
              <Text style={styles.cameraLoadingText}>카메라 준비 중</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.twoColumns}>
          <ActionButton label={analysisEnabled ? '자세 분석 중지' : '자세 분석 시작'} onPress={toggleAnalysis} danger={analysisEnabled} />
          <ActionButton label="카메라 전환" onPress={switchCamera} secondary />
        </View>

        {analysisError ? <Text style={styles.errorText}>{analysisError}</Text> : null}
        <FeedbackCard feedback={feedback} latencyMs={analysisResult?.latencyMs} />

        <Text style={styles.sectionTitle}>소리 메트로놈</Text>
        <View style={styles.card}>
          <View style={styles.bpmHeader}>
            <View>
              <Text style={styles.cardEyebrow}>속도 설정</Text>
              <Text style={styles.cardTitle}>BPM</Text>
            </View>
            <TextInput
              value={bpmInput}
              onChangeText={setBpmInput}
              onBlur={commitBpmInput}
              onSubmitEditing={commitBpmInput}
              keyboardType="number-pad"
              maxLength={3}
              selectTextOnFocus
              style={styles.bpmInput}
            />
          </View>

          <View style={styles.fourColumns}>
            <PillButton label="−5" onPress={() => setSafeBpm(bpm - 5)} />
            <PillButton label="−1" onPress={() => setSafeBpm(bpm - 1)} />
            <PillButton label="+1" onPress={() => setSafeBpm(bpm + 1)} />
            <PillButton label="+5" onPress={() => setSafeBpm(bpm + 5)} />
          </View>

          <Text style={styles.controlLabel}>박자</Text>
          <View style={styles.fourColumns}>
            {BEAT_OPTIONS.map((beats) => (
              <PillButton
                key={beats}
                label={beats === 6 ? '6/8' : `${beats}/4`}
                active={beatsPerBar === beats}
                onPress={() => setBeatsPerBar(beats)}
              />
            ))}
          </View>

          <View style={styles.beatDisplay}>
            {Array.from({ length: beatsPerBar }, (_, index) => (
              <View key={index} style={[styles.beatDot, metronomeRunning && beatIndex === index && styles.beatDotActive]}>
                <Text style={[styles.beatDotText, metronomeRunning && beatIndex === index && styles.beatDotTextActive]}>{index + 1}</Text>
              </View>
            ))}
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingText}>
              <Text style={styles.settingTitle}>메트로놈 소리</Text>
              <Text style={styles.settingDetail}>첫 박은 높은 강조음</Text>
            </View>
            <Switch value={soundEnabled} onValueChange={setSoundEnabled} />
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingText}>
              <Text style={styles.settingTitle}>박자 진동</Text>
              <Text style={styles.settingDetail}>소리와 함께 손에 박자 전달</Text>
            </View>
            <Switch value={hapticsEnabled} onValueChange={setHapticsEnabled} />
          </View>

          <View style={styles.twoColumns}>
            <ActionButton label={metronomeRunning ? '메트로놈 중지' : `${bpm} BPM 시작`} onPress={() => setMetronomeRunning((current) => !current)} danger={metronomeRunning} />
            <ActionButton label="소리 테스트" onPress={testSound} secondary />
          </View>
          {soundError ? <Text style={styles.errorText}>{soundError}</Text> : null}
        </View>

        <View style={styles.limitCard}>
          <Text style={styles.limitTitle}>이번 단계에서 실제로 분석하는 범위</Text>
          <Text style={styles.limitText}>얼굴·어깨·팔꿈치·손목·골반 위치를 이용해 화면 거리, 몸 중심, 어깨 기울기, 상체 기울기, 손목 노출을 피드백합니다.</Text>
          <Text style={styles.limitText}>손가락 모양, 피크 각도, 줄 접촉 깊이는 이 카메라 모델만으로 정확히 판정하지 않으며 가짜 점수를 표시하지 않습니다.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0d1117' },
  loadingScreen: { flex: 1, backgroundColor: '#0d1117', alignItems: 'center', justifyContent: 'center', padding: 20 },
  loadingText: { color: '#8b949e', marginTop: 12 },
  permissionCard: { width: '100%', backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 20, padding: 18 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#30363d' },
  brand: { color: '#7ee787', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  pageTitle: { color: '#f0f6fc', fontSize: 23, fontWeight: '900', marginTop: 2 },
  testBadge: { backgroundColor: '#9e6a03', borderRadius: 13, paddingHorizontal: 10, paddingVertical: 6 },
  testBadgeText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  scroll: { flex: 1 },
  content: { padding: 14, paddingBottom: 80 },
  noticeCard: { backgroundColor: '#2d2207', borderWidth: 1, borderColor: '#9e6a03', borderRadius: 16, padding: 14, marginBottom: 14 },
  noticeTitle: { color: '#f2cc60', fontSize: 13, fontWeight: '900' },
  noticeText: { color: '#d6c68c', fontSize: 11, lineHeight: 17, marginTop: 6 },
  sectionTitle: { color: '#f0f6fc', fontSize: 18, fontWeight: '900', marginTop: 8, marginBottom: 10 },
  horizontalRow: { paddingBottom: 12 },
  pillButton: { minHeight: 42, minWidth: 58, borderRadius: 14, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 13, paddingVertical: 9, marginRight: 7 },
  pillButtonActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  pillButtonText: { color: '#b1bac4', fontSize: 12, fontWeight: '900' },
  pillButtonTextActive: { color: '#ffffff' },
  pressed: { opacity: 0.68, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.4 },
  cameraFrame: { height: 510, borderRadius: 22, overflow: 'hidden', backgroundColor: '#000000', borderWidth: 1, borderColor: '#30363d' },
  camera: { flex: 1 },
  cameraTopRow: { position: 'absolute', left: 10, right: 10, top: 10, flexDirection: 'row', justifyContent: 'space-between' },
  cameraBadge: { color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.68)', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 6, fontSize: 10, fontWeight: '900' },
  cameraBadgeActive: { backgroundColor: 'rgba(35,134,54,0.9)' },
  centerGuide: { position: 'absolute', left: '13%', right: '13%', top: '17%', bottom: '10%', borderWidth: 1.5, borderColor: 'rgba(126,231,135,0.72)', borderStyle: 'dashed', borderRadius: 90 },
  cameraLoading: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.66)', alignItems: 'center', justifyContent: 'center' },
  cameraLoadingText: { color: '#ffffff', marginTop: 10, fontWeight: '800' },
  skeletonLine: { position: 'absolute', height: 3, borderRadius: 2, backgroundColor: '#58a6ff' },
  skeletonDot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: '#7ee787', borderWidth: 1, borderColor: '#ffffff' },
  twoColumns: { flexDirection: 'row', gap: 8 },
  fourColumns: { flexDirection: 'row', gap: 5, marginTop: 10 },
  actionButton: { flex: 1, minHeight: 49, borderRadius: 14, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, marginTop: 10 },
  actionButtonSecondary: { backgroundColor: '#21262d', borderWidth: 1, borderColor: '#30363d' },
  actionButtonDanger: { backgroundColor: '#da3633' },
  actionButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '900', textAlign: 'center' },
  card: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 18, padding: 16, marginTop: 12, marginBottom: 10 },
  feedbackHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  cardEyebrow: { color: '#7ee787', fontSize: 10, fontWeight: '900', letterSpacing: 0.7, marginBottom: 5 },
  cardTitle: { color: '#f0f6fc', fontSize: 17, fontWeight: '900', flexShrink: 1 },
  bodyText: { color: '#b1bac4', fontSize: 13, lineHeight: 20, marginTop: 8 },
  heroTitle: { color: '#f0f6fc', fontSize: 21, lineHeight: 29, fontWeight: '900' },
  scoreBadge: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#9e6a03', alignItems: 'center', justifyContent: 'center' },
  scoreBadgeGood: { backgroundColor: '#238636' },
  scoreText: { color: '#ffffff', fontSize: 20, fontWeight: '900' },
  feedbackRow: { flexDirection: 'row', marginTop: 13, paddingTop: 11, borderTopWidth: 1, borderTopColor: '#30363d' },
  feedbackBullet: { color: '#f2cc60', fontSize: 19, marginRight: 8, lineHeight: 20 },
  feedbackBody: { flex: 1 },
  feedbackTitle: { color: '#f0f6fc', fontSize: 13, fontWeight: '900' },
  feedbackDetail: { color: '#8b949e', fontSize: 11, lineHeight: 17, marginTop: 3 },
  latencyText: { color: '#6e7681', fontSize: 9, marginTop: 12, textAlign: 'right' },
  errorText: { color: '#ff7b72', fontSize: 11, lineHeight: 17, marginTop: 8 },
  bpmHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bpmInput: { width: 92, height: 58, borderRadius: 15, borderWidth: 1, borderColor: '#2ea043', backgroundColor: '#0d1117', color: '#7ee787', fontSize: 30, fontWeight: '900', textAlign: 'center' },
  controlLabel: { color: '#b1bac4', fontSize: 12, fontWeight: '900', marginTop: 18 },
  beatDisplay: { minHeight: 80, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 16, backgroundColor: '#0d1117', borderRadius: 15, paddingHorizontal: 10 },
  beatDot: { width: 45, height: 45, borderRadius: 23, backgroundColor: '#21262d', borderWidth: 1, borderColor: '#30363d', alignItems: 'center', justifyContent: 'center' },
  beatDotActive: { backgroundColor: '#2ea043', borderColor: '#7ee787', transform: [{ scale: 1.12 }] },
  beatDotText: { color: '#8b949e', fontSize: 15, fontWeight: '900' },
  beatDotTextActive: { color: '#ffffff' },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#30363d' },
  settingText: { flex: 1, paddingRight: 12 },
  settingTitle: { color: '#f0f6fc', fontSize: 13, fontWeight: '900' },
  settingDetail: { color: '#8b949e', fontSize: 10, marginTop: 3 },
  limitCard: { backgroundColor: '#111d2f', borderWidth: 1, borderColor: '#1f6feb', borderRadius: 17, padding: 15, marginTop: 8 },
  limitTitle: { color: '#79c0ff', fontSize: 13, fontWeight: '900' },
  limitText: { color: '#b6d8ff', fontSize: 11, lineHeight: 18, marginTop: 7 },
});
