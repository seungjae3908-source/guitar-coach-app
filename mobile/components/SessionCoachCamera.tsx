import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import type { PracticeCategoryId } from '../config/guitar-mode-profiles';
import type { PracticePreset } from '../config/personal-practice-presets';
import { analyzeHandAsync, type HandAnalysisResult, isDetailedHandCoachAvailable } from '../modules/guitar-coach-hand';
import { analyzePoseAsync, isLiveCoachNativeAvailable, type PoseAnalysisResult, type PoseLandmarkPoint } from '../modules/guitar-coach-native';

type AnalysisMode = 'full' | 'right-hand' | 'left-hand';
type AnalysisPlan = AnalysisMode | 'auto-cycle';

const POSE_LINKS: Array<[PoseLandmarkPoint['name'], PoseLandmarkPoint['name']]> = [
  ['leftEye', 'rightEye'], ['nose', 'leftEye'], ['nose', 'rightEye'],
  ['leftShoulder', 'rightShoulder'], ['leftShoulder', 'leftElbow'], ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'], ['rightElbow', 'rightWrist'],
  ['leftShoulder', 'leftHip'], ['rightShoulder', 'rightHip'], ['leftHip', 'rightHip'],
];
const HAND_LINKS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
const PLAN_OPTIONS: Array<{ id: AnalysisPlan; label: string }> = [
  { id: 'right-hand', label: '오른손 정밀' },
  { id: 'left-hand', label: '왼손 정밀' },
  { id: 'full', label: '전체 종합' },
  { id: 'auto-cycle', label: '자동 순환' },
];
const AUTO_CYCLE: AnalysisMode[] = ['full', 'right-hand', 'left-hand'];

function initialPlan(focus: PracticePreset['cameraFocus']): AnalysisMode {
  if (focus === 'right-hand') return 'right-hand';
  if (focus === 'left-hand') return 'left-hand';
  return 'full';
}

function modeTitle(mode: AnalysisMode) {
  if (mode === 'right-hand') return '오른손·피크·기타줄 정밀 분석';
  if (mode === 'left-hand') return '왼손·코드·지판 정밀 분석';
  return '전체 자세·양손 연결 종합 분석';
}

function modeInstruction(mode: AnalysisMode) {
  if (mode === 'right-hand') return '브리지·오른손·줄 구간만 크게 보이면 됩니다. 손과 줄은 자동으로 따라갑니다.';
  if (mode === 'left-hand') return '왼손과 사용하는 프렛만 크게 보이면 됩니다. 코드 착지와 줄 접촉 영역을 봅니다.';
  return '머리·어깨·양 팔꿈치·기타가 함께 보이면 자세와 양손 연결을 번갈아 수집합니다.';
}

function techniqueHint(category: PracticeCategoryId, mode: AnalysisMode) {
  if (mode === 'left-hand') return category === 'chords' || category === 'powerChords'
    ? '손가락 동시 착지·높이·전환 이동을 확인합니다.'
    : '손가락 독립성·포지션 이동·불필요한 들림을 확인합니다.';
  if (mode === 'right-hand') {
    if (category === 'arpeggio') return 'P·i·m·a 복귀, 동반 움직임과 실제 줄 영역을 확인합니다.';
    if (category === 'strumming') return '다운·업 줄 범위, 피크 그립, 손목과 소리 균형을 확인합니다.';
    if (category === 'palmMute') return '브리지 근처 손날 위치, 피킹 줄과 톤 일관성을 확인합니다.';
    return '피크 이동·그립·손목 안정성과 탄현 줄 영역을 확인합니다.';
  }
  return '상체 균형·기타 위치·양손 큰 움직임·박자와 전체 소리를 종합합니다.';
}

function Segment({ x1, y1, x2, y2, style }: { x1: number; y1: number; x2: number; y2: number; style: object }) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  return <View style={[style, { width: length, left: (x1 + x2 - length) / 2, top: (y1 + y2) / 2, transform: [{ rotate: `${Math.atan2(y2 - y1, x2 - x1)}rad` }] }]} />;
}

function PoseOverlay({ result, width, height }: { result: PoseAnalysisResult | null; width: number; height: number }) {
  const points = useMemo(() => new Map(result?.landmarks.map((point) => [point.name, point]) ?? []), [result]);
  if (!result?.hasPerson || width <= 0 || height <= 0) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {POSE_LINKS.map(([fromName, toName]) => {
        const from = points.get(fromName);
        const to = points.get(toName);
        if (!from || !to || from.confidence < 0.3 || to.confidence < 0.3) return null;
        return <Segment key={`${fromName}-${toName}`} x1={from.x * width} y1={from.y * height} x2={to.x * width} y2={to.y * height} style={styles.poseLine} />;
      })}
      {[...points.values()].map((point) => point.confidence >= 0.3 ? <View key={point.name} style={[styles.poseDot, { left: point.x * width - 4, top: point.y * height - 4 }]} /> : null)}
    </View>
  );
}

function StringOverlay({ result, width, height }: { result: HandAnalysisResult; width: number; height: number }) {
  const tracking = result.stringTracking;
  if (!tracking?.detected || tracking.lines.length < 4) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {tracking.lines.map((line) => {
        const active = line.visualIndex === tracking.nearestVisualIndex;
        const label = line.stringNumber > 0 ? `${line.stringNumber}` : `V${line.visualIndex}`;
        const x1 = line.startX * width;
        const y1 = line.startY * height;
        const x2 = line.endX * width;
        const y2 = line.endY * height;
        return (
          <View key={line.visualIndex}>
            <Segment x1={x1} y1={y1} x2={x2} y2={y2} style={active ? styles.stringLineActive : styles.stringLine} />
            {(active || line.stringNumber > 0) ? (
              <View style={[styles.stringLabel, active && styles.stringLabelActive, { left: (x1 + x2) / 2 - 10, top: (y1 + y2) / 2 - 10 }]}>
                <Text style={styles.stringLabelText}>{label}</Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function HandOverlay({ result, width, height }: { result: HandAnalysisResult | null; width: number; height: number }) {
  if (!result?.hasHand || result.landmarks.length < 21 || width <= 0 || height <= 0) return null;
  const xs = result.landmarks.map((point) => point.x);
  const ys = result.landmarks.map((point) => point.y);
  const left = Math.max(0, Math.min(...xs) - 0.06) * width;
  const top = Math.max(0, Math.min(...ys) - 0.06) * height;
  const right = Math.min(1, Math.max(...xs) + 0.06) * width;
  const bottom = Math.min(1, Math.max(...ys) + 0.06) * height;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <StringOverlay result={result} width={width} height={height} />
      <View style={[styles.trackingBox, { left, top, width: Math.max(30, right - left), height: Math.max(30, bottom - top) }]} />
      {HAND_LINKS.map(([fromIndex, toIndex]) => {
        const from = result.landmarks[fromIndex];
        const to = result.landmarks[toIndex];
        return <Segment key={`${fromIndex}-${toIndex}`} x1={from.x * width} y1={from.y * height} x2={to.x * width} y2={to.y * height} style={styles.handLine} />;
      })}
      {result.landmarks.map((point) => <View key={point.index} style={[styles.handDot, { left: point.x * width - 4, top: point.y * height - 4 }]} />)}
      {result.pick.detected ? (
        <View style={[styles.pickMarker, { left: result.pick.centerX * width - 17, top: result.pick.centerY * height - 17, transform: [{ rotate: `${result.pick.angleDegrees}deg` }] }]}><View style={styles.pickAxis} /></View>
      ) : null}
    </View>
  );
}

function handSize(result: HandAnalysisResult | null) {
  if (!result?.hasHand || result.landmarks.length < 21) return 0;
  return Math.hypot(result.landmarks[0].x - result.landmarks[9].x, result.landmarks[0].y - result.landmarks[9].y);
}

function stringStatus(result: HandAnalysisResult | null) {
  const tracking = result?.stringTracking;
  if (!tracking) return '기타줄 자동 인식 모듈 대기';
  if (!tracking.detected) return `줄 판정 불가 · 후보 신뢰 ${Math.round(tracking.confidence * 100)}%`;
  const nearest = tracking.nearestStringNumber > 0
    ? `${tracking.nearestStringNumber}번 줄 근처`
    : tracking.nearestVisualIndex > 0
      ? `시각 줄 ${tracking.nearestVisualIndex} 근처 · 번호 판정 불가`
      : '접촉 줄 계산 중';
  return `줄 ${tracking.visibleLineCount}/6 · ${Math.round(tracking.confidence * 100)}% · ${nearest}`;
}

export default function SessionCoachCamera({ running, category, cameraFocus }: { running: boolean; category: PracticeCategoryId; cameraFocus: PracticePreset['cameraFocus'] }) {
  const cameraRef = useRef<CameraView | null>(null);
  const analysisBusyRef = useRef(false);
  const fullPassRef = useRef<'pose' | 'hand'>('pose');
  const [permission, requestPermission] = useCameraPermissions();
  const initial = initialPlan(cameraFocus);
  const [selectedPlan, setSelectedPlan] = useState<AnalysisPlan>(initial);
  const [activeMode, setActiveMode] = useState<AnalysisMode>(initial);
  const [facing, setFacing] = useState<CameraType>(initial === 'full' ? 'front' : 'back');
  const [cameraKey, setCameraKey] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [poseResult, setPoseResult] = useState<PoseAnalysisResult | null>(null);
  const [handResult, setHandResult] = useState<HandAnalysisResult | null>(null);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [analysisError, setAnalysisError] = useState('');
  const [frameCount, setFrameCount] = useState(0);
  const [cycleIndex, setCycleIndex] = useState(0);

  useEffect(() => {
    if (running) return;
    const next = initialPlan(cameraFocus);
    setSelectedPlan(next);
    setActiveMode(next);
  }, [cameraFocus, running]);

  useEffect(() => {
    if (!running || selectedPlan !== 'auto-cycle') return;
    setCycleIndex(0);
    setActiveMode('full');
    const timer = setInterval(() => setCycleIndex((value) => {
      const next = (value + 1) % AUTO_CYCLE.length;
      setActiveMode(AUTO_CYCLE[next]);
      return next;
    }), 20_000);
    return () => clearInterval(timer);
  }, [running, selectedPlan]);

  useEffect(() => {
    if (selectedPlan !== 'auto-cycle') setActiveMode(selectedPlan);
  }, [selectedPlan]);

  useEffect(() => {
    setFacing(activeMode === 'full' ? 'front' : 'back');
    setCameraReady(false);
    setCameraKey((value) => value + 1);
    setPoseResult(null);
    setHandResult(null);
    setFrameCount(0);
    setAnalysisError('');
    fullPassRef.current = 'pose';
  }, [activeMode]);

  useEffect(() => {
    if (!running || !cameraReady || !permission?.granted) return;
    if (activeMode === 'full' && !isLiveCoachNativeAvailable) {
      setAnalysisError('전체 자세 모듈이 APK에 없습니다.');
      return;
    }
    if (activeMode !== 'full' && !isDetailedHandCoachAvailable) {
      setAnalysisError('손 관절 모듈이 APK에 없습니다.');
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delay: number) => { if (!cancelled) timer = setTimeout(captureAndAnalyze, delay); };
    const captureAndAnalyze = async () => {
      if (cancelled || analysisBusyRef.current || !cameraRef.current) {
        schedule(140);
        return;
      }
      analysisBusyRef.current = true;
      const startedAt = Date.now();
      try {
        const photo = await cameraRef.current.takePictureAsync({ quality: activeMode === 'full' ? 0.28 : 0.46, shutterSound: false, mirror: facing === 'front' });
        if (!photo?.uri || cancelled) return;
        if (activeMode === 'full') {
          if (fullPassRef.current === 'pose' || !isDetailedHandCoachAvailable) {
            const result = await analyzePoseAsync(photo.uri);
            if (!cancelled) setPoseResult(result);
            fullPassRef.current = 'hand';
          } else {
            const result = await analyzeHandAsync(photo.uri, 'none');
            if (!cancelled) setHandResult(result);
            fullPassRef.current = 'pose';
          }
        } else {
          const result = await analyzeHandAsync(photo.uri, activeMode === 'right-hand' ? 'auto' : 'none');
          if (!cancelled) setHandResult(result);
        }
        if (!cancelled) {
          setFrameCount((value) => value + 1);
          setAnalysisError('');
        }
      } catch (caught) {
        if (!cancelled) setAnalysisError(caught instanceof Error ? caught.message : '자동 AI 분석 중 오류가 발생했습니다.');
      } finally {
        analysisBusyRef.current = false;
        const target = activeMode === 'full' ? 820 : 520;
        schedule(Math.max(150, target - (Date.now() - startedAt)));
      }
    };
    schedule(100);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      analysisBusyRef.current = false;
    };
  }, [activeMode, cameraReady, facing, permission?.granted, running]);

  const switchCamera = () => {
    setCameraReady(false);
    setFacing((value) => value === 'front' ? 'back' : 'front');
    setCameraKey((value) => value + 1);
  };
  const onLayout = (event: LayoutChangeEvent) => setPreviewSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height });
  const size = handSize(handResult);
  const handStatus = !handResult?.hasHand ? '손 자동 추적 대기' : size < 0.13 ? '손이 작습니다 · 카메라를 가까이' : size > 0.68 ? '손이 너무 큽니다 · 카메라를 조금 멀리' : `손 추적 안정 · ${Math.round(handResult.handednessScore * 100)}%`;
  const detectionText = activeMode === 'full'
    ? poseResult?.hasPerson ? `상체 관절 ${poseResult.landmarks.length}개 · 양손 교차 수집` : '상체와 기타가 보이면 자동 추적합니다.'
    : handStatus;

  if (!permission) return <View style={styles.center}><ActivityIndicator /><Text style={styles.centerText}>카메라 권한 확인 중</Text></View>;
  if (!permission.granted) return (
    <View style={styles.center}>
      <Text style={styles.permissionTitle}>집중 분석에 카메라 권한이 필요합니다</Text>
      <Text style={styles.centerText}>손과 자세는 서버로 보내지 않고 휴대폰 안에서 분석합니다.</Text>
      <Pressable onPress={() => void requestPermission()} style={styles.permissionButton}><Text style={styles.permissionButtonText}>카메라 권한 허용</Text></Pressable>
    </View>
  );

  return (
    <View style={styles.root}>
      <View style={styles.planCard}>
        <Text style={styles.planTitle}>분석 화면 선택</Text>
        <View style={styles.planRow}>{PLAN_OPTIONS.map((item) => (
          <Pressable key={item.id} disabled={running} onPress={() => setSelectedPlan(item.id)} style={[styles.planButton, selectedPlan === item.id && styles.planButtonActive, running && styles.disabled]}>
            <Text style={[styles.planButtonText, selectedPlan === item.id && styles.planButtonTextActive]}>{item.label}</Text>
          </Pressable>
        ))}</View>
        <Text style={styles.planNotice}>{selectedPlan === 'auto-cycle' ? `자동 순환 ${cycleIndex + 1}/3 · 현재 ${modeTitle(activeMode)}` : modeInstruction(activeMode)}</Text>
      </View>

      <View style={styles.infoRow}>
        <View style={styles.infoTextWrap}><Text style={styles.eyebrow}>ADAPTIVE CAMERA AI</Text><Text style={styles.title}>{modeTitle(activeMode)}</Text><Text style={styles.hint}>{techniqueHint(category, activeMode)}</Text></View>
        <Pressable onPress={switchCamera} style={styles.cameraButton}><Text style={styles.cameraButtonText}>{facing === 'front' ? '전면' : '후면'} 전환</Text></Pressable>
      </View>

      <View style={[styles.cameraFrame, activeMode !== 'full' && styles.cameraFrameClose]} onLayout={onLayout}>
        <CameraView key={`${facing}-${cameraKey}`} ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} mirror={facing === 'front'} mode="picture" ratio="4:3" animateShutter={false} onCameraReady={() => setCameraReady(true)} onMountError={(event) => setAnalysisError(event.message)} />
        {activeMode === 'full' ? <PoseOverlay result={poseResult} width={previewSize.width} height={previewSize.height} /> : null}
        <HandOverlay result={handResult} width={previewSize.width} height={previewSize.height} />
        <View pointerEvents="none" style={styles.badgeRow}><Text style={[styles.badge, running && styles.badgeRunning]}>{running ? `${activeMode === 'full' ? '전체' : activeMode === 'right-hand' ? '오른손' : '왼손'} 자동 추적` : '세션 시작 대기'}</Text><Text style={styles.badge}>{frameCount}프레임</Text></View>
        {!cameraReady ? <View style={styles.loading}><ActivityIndicator /><Text style={styles.loadingText}>카메라 준비 중</Text></View> : null}
      </View>

      <View style={styles.resultCard}>
        <Text style={styles.resultTitle}>{detectionText}</Text>
        {activeMode !== 'full' || handResult ? <Text style={styles.stringResult}>{stringStatus(handResult)}</Text> : null}
        {activeMode === 'right-hand' && handResult?.pick.detected ? <Text style={styles.resultDetail}>피크 {Math.round(handResult.pick.confidence * 100)}% · 노출 {handResult.pick.exposure.toFixed(2)} · 각도 {Math.round(handResult.pick.angleDegrees)}°</Text> : null}
        <Text style={styles.resultDetail}>고정 사각형이 아니라 검출된 손과 기타줄 위치를 따라 표시가 이동합니다.</Text>
        {selectedPlan === 'auto-cycle' ? <Text style={styles.cycleText}>20초마다 전체 → 오른손 → 왼손으로 전환됩니다. 안내에 맞춰 휴대폰 위치만 옮기세요.</Text> : null}
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
  planCard: { borderRadius: 13, borderWidth: 1, borderColor: '#1f6feb', backgroundColor: '#111d2f', padding: 9, marginTop: 4 },
  planTitle: { color: '#79c0ff', fontSize: 8, fontWeight: '900' },
  planRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 7 },
  planButton: { minHeight: 34, borderRadius: 9, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9 },
  planButtonActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  planButtonText: { color: '#b1bac4', fontSize: 8, fontWeight: '900' },
  planButtonTextActive: { color: '#ffffff' },
  planNotice: { color: '#b6d8ff', fontSize: 8, lineHeight: 13, marginTop: 7 },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  infoTextWrap: { flex: 1, paddingRight: 8 },
  eyebrow: { color: '#79c0ff', fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  title: { color: '#f0f6fc', fontSize: 13, fontWeight: '900', marginTop: 2 },
  hint: { color: '#8b949e', fontSize: 8, lineHeight: 12, marginTop: 2 },
  cameraButton: { minWidth: 64, height: 36, borderRadius: 10, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  cameraButtonText: { color: '#f0f6fc', fontSize: 8, fontWeight: '900' },
  cameraFrame: { height: 390, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000000', borderWidth: 1, borderColor: '#30363d' },
  cameraFrameClose: { height: 430 },
  trackingBox: { position: 'absolute', borderWidth: 2, borderColor: '#7ee787', borderRadius: 22, backgroundColor: 'rgba(126,231,135,0.05)' },
  stringLine: { position: 'absolute', height: 1.5, borderRadius: 1, backgroundColor: 'rgba(242,204,96,0.62)' },
  stringLineActive: { position: 'absolute', height: 4, borderRadius: 2, backgroundColor: '#ff7b72' },
  stringLabel: { position: 'absolute', width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center' },
  stringLabelActive: { backgroundColor: '#da3633' },
  stringLabelText: { color: '#ffffff', fontSize: 7, fontWeight: '900' },
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
  stringResult: { color: '#f2cc60', fontSize: 8, lineHeight: 12, fontWeight: '800', marginTop: 4 },
  resultDetail: { color: '#8b949e', fontSize: 8, lineHeight: 12, marginTop: 3 },
  cycleText: { color: '#79c0ff', fontSize: 8, lineHeight: 12, marginTop: 4 },
  errorText: { color: '#ff7b72', fontSize: 8, lineHeight: 12, marginTop: 4 },
  disabled: { opacity: 0.42 },
});
