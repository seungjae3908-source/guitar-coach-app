import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  analyzePoseAsync,
  isLiveCoachNativeAvailable,
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

function confident(point: PoseLandmarkPoint | undefined, threshold = 0.4) {
  return point && point.confidence >= threshold ? point : undefined;
}

function distance(a: PoseLandmarkPoint, b: PoseLandmarkPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function buildPoseFeedback(result: PoseAnalysisResult | null, mode: CoachMode): PoseFeedback {
  const noPerson: FeedbackItem = {
    tone: 'info',
    title: '상체를 카메라 안에 맞춰 주세요',
    detail: '얼굴, 양쪽 어깨, 팔꿈치와 손목이 모두 보이면 자세 피드백이 시작됩니다.',
  };

  if (!result?.hasPerson) return { score: 0, primary: noPerson, items: [noPerson] };

  const points = pointMap(result);
  const leftShoulder = confident(points.get('leftShoulder'));
  const rightShoulder = confident(points.get('rightShoulder'));
  const leftWrist = confident(points.get('leftWrist'), 0.32);
  const rightWrist = confident(points.get('rightWrist'), 0.32);
  const leftElbow = confident(points.get('leftElbow'), 0.32);
  const rightElbow = confident(points.get('rightElbow'), 0.32);
  const leftHip = confident(points.get('leftHip'), 0.28);
  const rightHip = confident(points.get('rightHip'), 0.28);
  const nose = confident(points.get('nose'), 0.35);

  if (!leftShoulder || !rightShoulder) return { score: 20, primary: noPerson, items: [noPerson] };

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
      detail: '어깨 중앙을 화면 가운데 세로선에 맞추세요.',
    });
  }

  const shoulderTilt = Math.abs(leftShoulder.y - rightShoulder.y) / Math.max(shoulderWidth, 0.01);
  if (shoulderTilt > 0.13) {
    score -= 18;
    issues.push({
      tone: 'warn',
      title: '양쪽 어깨 높이가 다릅니다',
      detail: '기타를 받치느라 한쪽 어깨를 올리지 말고 목과 어깨 힘을 빼세요.',
    });
  }

  if (nose) {
    const headOffset = Math.abs(nose.x - shoulderMidX) / Math.max(shoulderWidth, 0.01);
    if (headOffset > 0.34) {
      score -= 10;
      issues.push({
        tone: 'warn',
        title: '고개가 한쪽으로 많이 기울었습니다',
        detail: '지판을 보더라도 머리를 어깨 중앙에 가깝게 유지하세요.',
      });
    }
  }

  if (!leftWrist || !rightWrist) {
    score -= 20;
    issues.push({
      tone: 'warn',
      title: '손목이 화면 밖으로 나갔습니다',
      detail: '왼손과 오른손 손목이 모두 보이도록 카메라 거리나 각도를 조절하세요.',
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
        detail: '손등과 팔이 부드럽게 이어지도록 손목 힘을 빼세요.',
      });
    }
  }

  if (mode === '코드 전환' && leftElbow && leftWrist && leftWrist.y < leftElbow.y - 0.12) {
    score -= 10;
    issues.push({
      tone: 'warn',
      title: '왼손 손목을 과하게 들어 올렸습니다',
      detail: '엄지와 손목에 힘을 몰지 말고 팔꿈치를 자연스럽게 내리세요.',
    });
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
      detail: '이 자세를 유지하면서 어깨와 손목 힘을 빼고 연주하세요.',
    };
    return { score: safeScore, primary: good, items: [good] };
  }

  return { score: safeScore, primary: issues[0], items: issues.slice(0, 3) };
}

function ModeButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.modeButton, active && styles.modeButtonActive, pressed && styles.pressed]}
    >
      <Text style={[styles.modeButtonText, active && styles.modeButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

function SkeletonOverlay({ result, width, height }: { result: PoseAnalysisResult | null; width: number; height: number }) {
  const points = useMemo(() => pointMap(result), [result]);
  if (!result?.hasPerson || width <= 0 || height <= 0) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {SKELETON_LINKS.map(([fromName, toName]) => {
        const from = confident(points.get(fromName), 0.32);
        const to = confident(points.get(toName), 0.32);
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
      {[...points.values()].map((point) =>
        point.confidence >= 0.32 ? (
          <View
            key={point.name}
            style={[
              styles.skeletonDot,
              {
                left: point.x * width - 5,
                top: point.y * height - 5,
                opacity: clamp(point.confidence, 0.35, 1),
              },
            ]}
          />
        ) : null,
      )}
    </View>
  );
}

export default function LiveCoachCameraOnly() {
  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('front');
  const [cameraKey, setCameraKey] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [analysisEnabled, setAnalysisEnabled] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<PoseAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState('');
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [mode, setMode] = useState<CoachMode>('아르페지오');
  const analysisBusyRef = useRef(false);

  const feedback = useMemo(() => buildPoseFeedback(analysisResult, mode), [analysisResult, mode]);

  useEffect(() => {
    if (!analysisEnabled || !cameraReady || !permission?.granted || !isLiveCoachNativeAvailable) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (delay: number) => {
      if (!cancelled) timer = setTimeout(captureAndAnalyze, delay);
    };

    const captureAndAnalyze = async () => {
      if (cancelled || analysisBusyRef.current || !cameraRef.current) {
        schedule(250);
        return;
      }

      analysisBusyRef.current = true;
      const startedAt = Date.now();
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
        if (!cancelled) setAnalysisError(error instanceof Error ? error.message : '자세 분석 중 오류가 발생했습니다.');
      } finally {
        analysisBusyRef.current = false;
        schedule(Math.max(260, 1000 - (Date.now() - startedAt)));
      }
    };

    schedule(150);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      analysisBusyRef.current = false;
    };
  }, [analysisEnabled, cameraReady, facing, permission?.granted]);

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

  const onPreviewLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setPreviewSize({ width, height });
  };

  if (!permission) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.mutedText}>카메라 권한 확인 중</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Text style={styles.permissionTitle}>카메라 권한이 필요합니다.</Text>
        <Text style={styles.permissionText}>영상은 서버로 전송하지 않고 휴대폰 안에서만 자세 좌표를 계산합니다.</Text>
        <Pressable onPress={() => void requestPermission()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>카메라 권한 허용</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.sectionTitle}>연습 종류</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modeRow}>
        {MODES.map((item) => (
          <ModeButton key={item} label={item} active={item === mode} onPress={() => setMode(item)} />
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
            <ActivityIndicator />
            <Text style={styles.cameraLoadingText}>카메라 준비 중</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.actionRow}>
        <Pressable onPress={toggleAnalysis} style={[styles.primaryButton, analysisEnabled && styles.stopButton]}>
          <Text style={styles.primaryButtonText}>{analysisEnabled ? '자세 분석 중지' : '자세 분석 시작'}</Text>
        </Pressable>
        <Pressable onPress={switchCamera} style={styles.secondaryButton}>
          <Text style={styles.primaryButtonText}>카메라 전환</Text>
        </Pressable>
      </View>

      {analysisError ? <Text style={styles.errorText}>{analysisError}</Text> : null}

      <View style={styles.feedbackCard}>
        <View style={styles.feedbackHeader}>
          <View style={styles.feedbackTextWrap}>
            <Text style={styles.eyebrow}>실시간 자세 피드백</Text>
            <Text style={styles.feedbackTitle}>{feedback.primary.title}</Text>
          </View>
          <View style={[styles.scoreBadge, feedback.score >= 80 && styles.scoreBadgeGood]}>
            <Text style={styles.scoreText}>{feedback.score}</Text>
          </View>
        </View>
        <Text style={styles.feedbackDetail}>{feedback.primary.detail}</Text>
        {feedback.items.slice(1).map((item) => (
          <View key={item.title} style={styles.feedbackRow}>
            <Text style={styles.feedbackBullet}>•</Text>
            <View style={styles.feedbackTextWrap}>
              <Text style={styles.feedbackItemTitle}>{item.title}</Text>
              <Text style={styles.feedbackItemDetail}>{item.detail}</Text>
            </View>
          </View>
        ))}
        {analysisResult ? <Text style={styles.latency}>분석 처리 {analysisResult.latencyMs}ms · 약 1초 간격</Text> : null}
      </View>

      <View style={styles.limitCard}>
        <Text style={styles.limitTitle}>분석 범위</Text>
        <Text style={styles.limitText}>얼굴·어깨·팔꿈치·손목·골반 위치로 거리, 몸 중심, 어깨와 상체 기울기를 분석합니다.</Text>
        <Text style={styles.limitText}>손가락 모양, 피크 각도와 줄 접촉 깊이는 현재 카메라 모델만으로 판정하지 않습니다.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117' },
  content: { padding: 14, paddingBottom: 80 },
  centered: { flex: 1, backgroundColor: '#0d1117', alignItems: 'center', justifyContent: 'center', padding: 22 },
  mutedText: { color: '#8b949e', marginTop: 10 },
  permissionTitle: { color: '#f0f6fc', fontSize: 20, fontWeight: '900', textAlign: 'center' },
  permissionText: { color: '#8b949e', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 10 },
  sectionTitle: { color: '#f0f6fc', fontSize: 17, fontWeight: '900', marginBottom: 10 },
  modeRow: { paddingBottom: 12 },
  modeButton: { minHeight: 42, borderRadius: 14, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 13, marginRight: 7 },
  modeButtonActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  modeButtonText: { color: '#b1bac4', fontSize: 12, fontWeight: '900' },
  modeButtonTextActive: { color: '#ffffff' },
  pressed: { opacity: 0.68 },
  cameraFrame: { height: 500, borderRadius: 22, overflow: 'hidden', backgroundColor: '#000000', borderWidth: 1, borderColor: '#30363d' },
  camera: { flex: 1 },
  centerGuide: { position: 'absolute', left: '13%', right: '13%', top: '17%', bottom: '10%', borderWidth: 1.5, borderColor: 'rgba(126,231,135,0.72)', borderStyle: 'dashed', borderRadius: 90 },
  cameraTopRow: { position: 'absolute', left: 10, right: 10, top: 10, flexDirection: 'row', justifyContent: 'space-between' },
  cameraBadge: { color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.68)', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 6, fontSize: 10, fontWeight: '900' },
  cameraBadgeActive: { backgroundColor: 'rgba(35,134,54,0.9)' },
  cameraLoading: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.66)', alignItems: 'center', justifyContent: 'center' },
  cameraLoadingText: { color: '#ffffff', marginTop: 10, fontWeight: '800' },
  skeletonLine: { position: 'absolute', height: 3, borderRadius: 2, backgroundColor: '#58a6ff' },
  skeletonDot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: '#7ee787', borderWidth: 1, borderColor: '#ffffff' },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  primaryButton: { flex: 1, minHeight: 49, borderRadius: 14, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, marginTop: 10 },
  secondaryButton: { flex: 1, minHeight: 49, borderRadius: 14, backgroundColor: '#21262d', borderWidth: 1, borderColor: '#30363d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, marginTop: 10 },
  stopButton: { backgroundColor: '#da3633' },
  primaryButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '900', textAlign: 'center' },
  errorText: { color: '#ff7b72', fontSize: 11, lineHeight: 17, marginTop: 8 },
  feedbackCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 18, padding: 16, marginTop: 14 },
  feedbackHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  feedbackTextWrap: { flex: 1 },
  eyebrow: { color: '#7ee787', fontSize: 10, fontWeight: '900', letterSpacing: 0.7, marginBottom: 5 },
  feedbackTitle: { color: '#f0f6fc', fontSize: 17, fontWeight: '900' },
  feedbackDetail: { color: '#b1bac4', fontSize: 13, lineHeight: 20, marginTop: 8 },
  scoreBadge: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#9e6a03', alignItems: 'center', justifyContent: 'center' },
  scoreBadgeGood: { backgroundColor: '#238636' },
  scoreText: { color: '#ffffff', fontSize: 20, fontWeight: '900' },
  feedbackRow: { flexDirection: 'row', marginTop: 13, paddingTop: 11, borderTopWidth: 1, borderTopColor: '#30363d' },
  feedbackBullet: { color: '#f2cc60', fontSize: 19, marginRight: 8 },
  feedbackItemTitle: { color: '#f0f6fc', fontSize: 13, fontWeight: '900' },
  feedbackItemDetail: { color: '#8b949e', fontSize: 11, lineHeight: 17, marginTop: 3 },
  latency: { color: '#6e7681', fontSize: 9, marginTop: 12, textAlign: 'right' },
  limitCard: { backgroundColor: '#111d2f', borderWidth: 1, borderColor: '#1f6feb', borderRadius: 17, padding: 15, marginTop: 12 },
  limitTitle: { color: '#79c0ff', fontSize: 13, fontWeight: '900' },
  limitText: { color: '#b6d8ff', fontSize: 11, lineHeight: 18, marginTop: 7 },
});
