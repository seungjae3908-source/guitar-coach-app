import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { PracticeCategoryId } from '../config/guitar-mode-profiles';
import type { PracticePreset } from '../config/personal-practice-presets';
import {
  analyzeHandAsync,
  HandAnalysisResult,
  isDetailedHandCoachAvailable,
} from '../modules/guitar-coach-hand';
import {
  analyzePoseAsync,
  isLiveCoachNativeAvailable,
  PoseAnalysisResult,
  PoseLandmarkPoint,
} from '../modules/guitar-coach-native';

const POSE_LINKS: Array<[PoseLandmarkPoint['name'], PoseLandmarkPoint['name']]> = [
  ['leftEye', 'rightEye'],
  ['nose', 'leftEye'],
  ['nose', 'rightEye'],
  ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftElbow'],
  ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'],
  ['rightElbow', 'rightWrist'],
  ['leftShoulder', 'leftHip'],
  ['rightShoulder', 'rightHip'],
  ['leftHip', 'rightHip'],
];

const HAND_LINKS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

type SessionAnalysisMode = 'pose' | 'right-hand' | 'left-hand';

function analysisMode(cameraFocus: PracticePreset['cameraFocus']): SessionAnalysisMode {
  if (cameraFocus === 'right-hand') return 'right-hand';
  if (cameraFocus === 'left-hand') return 'left-hand';
  return 'pose';
}

function analysisTitle(mode: SessionAnalysisMode) {
  if (mode === 'right-hand') return '오른손 21관절·피크 자동 분석';
  if (mode === 'left-hand') return '왼손 네 손가락 자동 분석';
  return '전신 자세 자동 분석';
}

function techniqueHint(category: PracticeCategoryId) {
  switch (category) {
    case 'arpeggio':
      return 'P·i·m·a의 이동과 손목 흔들림을 분석합니다.';
    case 'strumming':
      return '다운·업 움직임, 피크 그립과 손목 범위를 분석합니다.';
    case 'alternatePicking':
      return '업·다운 피크 경로와 그립 안정성을 분석합니다.';
    case 'downPicking':
      return '다운피킹 이동량과 피크 노출량을 분석합니다.';
    case 'palmMute':
      return '브리지 근처 손 위치와 피킹 주기를 분석합니다.';
    case 'chords':
    case 'powerChords':
      return '손가락 굽힘과 전환 전후의 손 모양을 분석합니다.';
    case 'fingering':
    case 'scales':
    case 'leadTechnique':
      return '손가락 독립 움직임과 포지션 변화를 분석합니다.';
    default:
      return '현재 루틴의 자세와 움직임을 자동 수집합니다.';
  }
}

function poseMap(result: PoseAnalysisResult | null) {
  return new Map(result?.landmarks.map((point) => [point.name, point]) ?? []);
}

function PoseOverlay({ result, width, height }: { result: PoseAnalysisResult | null; width: number; height: number }) {
  const points = useMemo(() => poseMap(result), [result]);
  if (!result?.hasPerson || width <= 0 || height <= 0) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {POSE_LINKS.map(([fromName, toName]) => {
        const from = points.get(fromName);
        const to = points.get(toName);
        if (!from || !to || from.confidence < 0.3 || to.confidence < 0.3) return null;
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
              styles.poseLine,
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
      {[...points.values()].map((point) => point.confidence >= 0.3 ? (
        <View key={point.name} style={[styles.poseDot, { left: point.x * width - 4, top: point.y * height - 4 }]} />
      ) : null)}
    </View>
  );
}

function HandOverlay({ result, width, height }: { result: HandAnalysisResult | null; width: number; height: number }) {
  if (!result?.hasHand || result.landmarks.length < 21 || width <= 0 || height <= 0) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {HAND_LINKS.map(([fromIndex, toIndex]) => {
        const from = result.landmarks[fromIndex];
        const to = result.landmarks[toIndex];
        const x1 = from.x * width;
        const y1 = from.y * height;
        const x2 = to.x * width;
        const y2 = to.y * height;
        const length = Math.hypot(x2 - x1, y2 - y1);
        const angle = Math.atan2(y2 - y1, x2 - x1);
        return (
          <View
            key={`${fromIndex}-${toIndex}`}
            style={[
              styles.handLine,
              {
                width: length,
                left: (x1 + x2) / 2 - length / 2,
                top: (y1 + y2) / 2 - 1,
                transform: [{ rotate: `${angle}rad` }],
              },
            ]}
          />
        );
      })}
      {result.landmarks.map((point) => (
        <View key={point.index} style={[styles.handDot, { left: point.x * width - 4, top: point.y * height - 4 }]} />
      ))}
      {result.pick.detected ? (
        <View
          style={[
            styles.pickMarker,
            {
              left: result.pick.centerX * width - 17,
              top: result.pick.centerY * height - 17,
              transform: [{ rotate: `${result.pick.angleDegrees}deg` }],
            },
          ]}
        >
          <View style={styles.pickAxis} />
        </View>
      ) : null}
    </View>
  );
}

export default function SessionCoachCamera({
  running,
  category,
  cameraFocus,
}: {
  running: boolean;
  category: PracticeCategoryId;
  cameraFocus: PracticePreset['cameraFocus'];
}) {
  const cameraRef = useRef<CameraView | null>(null);
  const analysisBusyRef = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const mode = analysisMode(cameraFocus);
  const [facing, setFacing] = useState<CameraType>(mode === 'pose' ? 'front' : 'back');
  const [cameraKey, setCameraKey] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [poseResult, setPoseResult] = useState<PoseAnalysisResult | null>(null);
  const [handResult, setHandResult] = useState<HandAnalysisResult | null>(null);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [analysisError, setAnalysisError] = useState('');
  const [frameCount, setFrameCount] = useState(0);

  useEffect(() => {
    setFacing(mode === 'pose' ? 'front' : 'back');
    setCameraReady(false);
    setCameraKey((value) => value + 1);
    setPoseResult(null);
    setHandResult(null);
    setFrameCount(0);
    setAnalysisError('');
  }, [mode]);

  useEffect(() => {
    if (!running || !cameraReady || !permission?.granted) return;
    const available = mode === 'pose' ? isLiveCoachNativeAvailable : isDetailedHandCoachAvailable;
    if (!available) {
      setAnalysisError(mode === 'pose' ? '전신 자세 모듈이 APK에 없습니다.' : '손 관절 모듈이 APK에 없습니다.');
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delay: number) => {
      if (!cancelled) timer = setTimeout(captureAndAnalyze, delay);
    };
    const captureAndAnalyze = async () => {
      if (cancelled || analysisBusyRef.current || !cameraRef.current) {
        schedule(150);
        return;
      }
      analysisBusyRef.current = true;
      const startedAt = Date.now();
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: mode === 'pose' ? 0.24 : 0.42,
          shutterSound: false,
          mirror: facing === 'front',
        });
        if (!photo?.uri || cancelled) return;
        if (mode === 'pose') {
          const result = await analyzePoseAsync(photo.uri);
          if (!cancelled) {
            setPoseResult(result);
            setHandResult(null);
          }
        } else {
          const result = await analyzeHandAsync(photo.uri, mode === 'right-hand' ? 'auto' : 'none');
          if (!cancelled) {
            setHandResult(result);
            setPoseResult(null);
          }
        }
        if (!cancelled) {
          setFrameCount((value) => value + 1);
          setAnalysisError('');
        }
      } catch (caught) {
        if (!cancelled) setAnalysisError(caught instanceof Error ? caught.message : '자동 AI 분석 중 오류가 발생했습니다.');
      } finally {
        analysisBusyRef.current = false;
        const targetInterval = mode === 'pose' ? 900 : 420;
        schedule(Math.max(150, targetInterval - (Date.now() - startedAt)));
      }
    };

    schedule(100);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      analysisBusyRef.current = false;
    };
  }, [cameraReady, facing, mode, permission?.granted, running]);

  const switchCamera = () => {
    setCameraReady(false);
    setPoseResult(null);
    setHandResult(null);
    setFacing((value) => value === 'front' ? 'back' : 'front');
    setCameraKey((value) => value + 1);
  };

  const onLayout = (event: LayoutChangeEvent) => {
    setPreviewSize({
      width: event.nativeEvent.layout.width,
      height: event.nativeEvent.layout.height,
    });
  };

  const detectionText = mode === 'pose'
    ? poseResult?.hasPerson ? `상체 관절 ${poseResult.landmarks.length}개` : '상체를 가이드 안에 맞추세요.'
    : handResult?.hasHand
      ? `손 관절 ${handResult.landmarks.length}개 · ${handResult.handedness}`
      : '손 하나를 화면의 절반 이상 보이게 하세요.';
  const pickText = mode === 'right-hand' && handResult
    ? handResult.pick.detected
      ? `피크 ${Math.round(handResult.pick.confidence * 100)}% · 노출 ${handResult.pick.exposure.toFixed(2)}`
      : '피크 자동 감지 대기'
    : null;

  if (!permission) {
    return <View style={styles.center}><ActivityIndicator /><Text style={styles.centerText}>카메라 권한 확인 중</Text></View>;
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionTitle}>집중 연습에 카메라 권한이 필요합니다</Text>
        <Text style={styles.centerText}>손과 자세는 서버로 보내지 않고 휴대폰 안에서 분석합니다.</Text>
        <Pressable onPress={() => void requestPermission()} style={styles.permissionButton}>
          <Text style={styles.permissionButtonText}>카메라 권한 허용</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.infoRow}>
        <View style={styles.infoTextWrap}>
          <Text style={styles.eyebrow}>AUTO CAMERA AI</Text>
          <Text style={styles.title}>{analysisTitle(mode)}</Text>
          <Text style={styles.hint}>{techniqueHint(category)}</Text>
        </View>
        <Pressable onPress={switchCamera} style={styles.cameraButton}>
          <Text style={styles.cameraButtonText}>{facing === 'front' ? '전면' : '후면'} 전환</Text>
        </Pressable>
      </View>

      <View style={[styles.cameraFrame, mode !== 'pose' && styles.cameraFrameClose]} onLayout={onLayout}>
        <CameraView
          key={`${facing}-${cameraKey}`}
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          mirror={facing === 'front'}
          mode="picture"
          ratio="4:3"
          animateShutter={false}
          onCameraReady={() => setCameraReady(true)}
          onMountError={(event) => setAnalysisError(event.message)}
        />
        <View pointerEvents="none" style={mode === 'pose' ? styles.bodyGuide : styles.handGuide} />
        {mode === 'right-hand' ? <View pointerEvents="none" style={styles.stringGuide} /> : null}
        {mode === 'pose'
          ? <PoseOverlay result={poseResult} width={previewSize.width} height={previewSize.height} />
          : <HandOverlay result={handResult} width={previewSize.width} height={previewSize.height} />}
        <View pointerEvents="none" style={styles.badgeRow}>
          <Text style={[styles.badge, running && styles.badgeRunning]}>{running ? '세션과 함께 자동 분석 중' : '세션 시작 대기'}</Text>
          <Text style={styles.badge}>{frameCount}프레임</Text>
        </View>
        {!cameraReady ? (
          <View style={styles.loading}><ActivityIndicator /><Text style={styles.loadingText}>카메라 준비 중</Text></View>
        ) : null}
      </View>

      <View style={styles.resultCard}>
        <Text style={styles.resultTitle}>{detectionText}</Text>
        {pickText ? <Text style={styles.resultDetail}>{pickText}</Text> : null}
        <Text style={styles.resultDetail}>{running ? '별도 버튼 없이 세션 시작·종료에 맞춰 자동 작동합니다.' : '상단의 세션 시작 버튼을 누르면 자동으로 분석합니다.'}</Text>
        {analysisError ? <Text style={styles.errorText}>{analysisError}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117', paddingHorizontal: 8, paddingBottom: 12 },
  center: { flex: 1, minHeight: 340, backgroundColor: '#0d1117', alignItems: 'center', justifyContent: 'center', padding: 22 },
  centerText: { color: '#8b949e', fontSize: 10, lineHeight: 16, textAlign: 'center', marginTop: 8 },
  permissionTitle: { color: '#f0f6fc', fontSize: 16, fontWeight: '900', textAlign: 'center' },
  permissionButton: { minHeight: 42, borderRadius: 12, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15, marginTop: 14 },
  permissionButtonText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  infoTextWrap: { flex: 1, paddingRight: 8 },
  eyebrow: { color: '#79c0ff', fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  title: { color: '#f0f6fc', fontSize: 13, fontWeight: '900', marginTop: 2 },
  hint: { color: '#8b949e', fontSize: 8, lineHeight: 12, marginTop: 2 },
  cameraButton: { minWidth: 64, height: 36, borderRadius: 10, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  cameraButtonText: { color: '#f0f6fc', fontSize: 8, fontWeight: '900' },
  cameraFrame: { height: 390, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000000', borderWidth: 1, borderColor: '#30363d' },
  cameraFrameClose: { height: 430 },
  bodyGuide: { position: 'absolute', left: '13%', right: '13%', top: '14%', bottom: '7%', borderWidth: 1.5, borderColor: 'rgba(126,231,135,0.75)', borderStyle: 'dashed', borderRadius: 80 },
  handGuide: { position: 'absolute', left: '7%', right: '7%', top: '9%', bottom: '9%', borderWidth: 1.5, borderColor: 'rgba(121,192,255,0.85)', borderStyle: 'dashed', borderRadius: 42 },
  stringGuide: { position: 'absolute', left: '7%', right: '7%', top: '52%', height: 1, backgroundColor: 'rgba(242,204,96,0.85)' },
  badgeRow: { position: 'absolute', left: 8, right: 8, top: 8, flexDirection: 'row', justifyContent: 'space-between' },
  badge: { color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.68)', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 5, fontSize: 7, fontWeight: '900' },
  badgeRunning: { backgroundColor: 'rgba(35,134,54,0.92)' },
  loading: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.64)', alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: '#ffffff', fontSize: 9, fontWeight: '800', marginTop: 7 },
  poseLine: { position: 'absolute', height: 3, borderRadius: 2, backgroundColor: '#58a6ff' },
  poseDot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#7ee787', borderWidth: 1, borderColor: '#ffffff' },
  handLine: { position: 'absolute', height: 2, borderRadius: 1, backgroundColor: '#f2cc60' },
  handDot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#79c0ff', borderWidth: 1, borderColor: '#ffffff' },
  pickMarker: { position: 'absolute', width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: '#ff7b72', alignItems: 'center', justifyContent: 'center' },
  pickAxis: { width: 28, height: 2, backgroundColor: '#ff7b72' },
  resultCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 12, padding: 9, marginTop: 7 },
  resultTitle: { color: '#f0f6fc', fontSize: 9, fontWeight: '900' },
  resultDetail: { color: '#8b949e', fontSize: 8, lineHeight: 12, marginTop: 3 },
  errorText: { color: '#ff7b72', fontSize: 8, lineHeight: 12, marginTop: 4 },
});
