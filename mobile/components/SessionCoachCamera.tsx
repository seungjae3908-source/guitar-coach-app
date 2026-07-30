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
import ContinuousRightHandCamera, {
  type ContinuousHandAnalysisResult,
  type ContinuousRightHandStats,
  type ContinuousStringHit,
  isContinuousRightHandCameraAvailable,
} from '../modules/guitar-coach-continuous-camera';
import {
  analyzeHandAsync,
  type HandAnalysisResult,
  isDetailedHandCoachAvailable,
} from '../modules/guitar-coach-hand';
import {
  analyzePoseAsync,
  isLiveCoachNativeAvailable,
  type PoseAnalysisResult,
  type PoseLandmarkPoint,
} from '../modules/guitar-coach-native';

type AnalysisMode = 'full' | 'right-hand' | 'left-hand';
type AnalysisPlan = AnalysisMode | 'auto-cycle';

type Size = { width: number; height: number };

const PLAN_OPTIONS: Array<{ id: AnalysisPlan; label: string }> = [
  { id: 'right-hand', label: '오른손 정밀' },
  { id: 'left-hand', label: '왼손 정밀' },
  { id: 'full', label: '전체 종합' },
  { id: 'auto-cycle', label: '자동 순환' },
];
const AUTO_CYCLE: AnalysisMode[] = ['full', 'right-hand', 'left-hand'];
const HAND_LINKS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
const POSE_LINKS: Array<[PoseLandmarkPoint['name'], PoseLandmarkPoint['name']]> = [
  ['leftEye', 'rightEye'], ['nose', 'leftEye'], ['nose', 'rightEye'],
  ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftElbow'], ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'], ['rightElbow', 'rightWrist'],
  ['leftShoulder', 'leftHip'], ['rightShoulder', 'rightHip'], ['leftHip', 'rightHip'],
];

function initialMode(focus: PracticePreset['cameraFocus']): AnalysisMode {
  if (focus === 'right-hand') return 'right-hand';
  if (focus === 'left-hand') return 'left-hand';
  return 'full';
}

function modeTitle(mode: AnalysisMode) {
  if (mode === 'right-hand') return '오른손·피크·줄 연속 분석';
  if (mode === 'left-hand') return '왼손·코드·지판 연속 분석';
  return '전체 자세·양손 종합 분석';
}

function modeGuide(category: PracticeCategoryId, mode: AnalysisMode) {
  if (mode === 'left-hand') {
    if (category === 'chords' || category === 'powerChords') {
      return '왼손과 사용하는 프렛을 크게 보이게 두세요. 손가락 좌표와 실제 음정을 함께 확인합니다.';
    }
    return '왼손과 연주할 프렛 범위를 크게 보이게 두세요. 손가락·줄·프렛 순서를 연속 추적합니다.';
  }
  if (mode === 'right-hand') {
    if (category === 'arpeggio' || category === 'fingerstyle') {
      return '브리지와 P·i·m·a 끝점이 함께 보이게 두세요. 줄 역할·복귀·관절각을 연속 측정합니다.';
    }
    if (category === 'strumming') {
      return '브리지·피크·손목이 함께 보이게 두세요. D-U 방향, 줄 범위와 손목 회전을 측정합니다.';
    }
    return '브리지·피크·손목과 여섯 줄이 함께 보이게 두세요.';
  }
  return '머리·어깨·양 팔꿈치·기타가 한 화면에 들어오게 두세요.';
}

function Segment({
  x1,
  y1,
  x2,
  y2,
  style,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  style: object;
}) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  return (
    <View
      style={[
        style,
        {
          width: length,
          left: (x1 + x2 - length) / 2,
          top: (y1 + y2) / 2,
          transform: [{ rotate: `${Math.atan2(y2 - y1, x2 - x1)}rad` }],
        },
      ]}
    />
  );
}

function PoseOverlay({ result, size }: { result: PoseAnalysisResult | null; size: Size }) {
  const points = useMemo(
    () => new Map(result?.landmarks.map((point) => [point.name, point]) ?? []),
    [result],
  );
  if (!result?.hasPerson || size.width <= 0 || size.height <= 0) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {POSE_LINKS.map(([fromName, toName]) => {
        const from = points.get(fromName);
        const to = points.get(toName);
        if (!from || !to || from.confidence < 0.3 || to.confidence < 0.3) return null;
        return (
          <Segment
            key={`${fromName}-${toName}`}
            x1={from.x * size.width}
            y1={from.y * size.height}
            x2={to.x * size.width}
            y2={to.y * size.height}
            style={styles.poseLine}
          />
        );
      })}
      {[...points.values()].map((point) => point.confidence >= 0.3 ? (
        <View
          key={point.name}
          style={[styles.poseDot, { left: point.x * size.width - 4, top: point.y * size.height - 4 }]}
        />
      ) : null)}
    </View>
  );
}

function HandOverlay({ result, size }: { result: HandAnalysisResult | null; size: Size }) {
  if (!result?.hasHand || result.landmarks.length < 21 || size.width <= 0 || size.height <= 0) return null;
  const activeLines = new Set(
    (result.stringTracking?.contacts ?? [])
      .filter((contact) => contact.visualIndex > 0)
      .map((contact) => contact.visualIndex),
  );
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {(result.stringTracking?.lines ?? []).map((line) => (
        <Segment
          key={`string-${line.visualIndex}`}
          x1={line.startX * size.width}
          y1={line.startY * size.height}
          x2={line.endX * size.width}
          y2={line.endY * size.height}
          style={activeLines.has(line.visualIndex) ? styles.stringLineActive : styles.stringLine}
        />
      ))}
      {HAND_LINKS.map(([fromIndex, toIndex]) => {
        const from = result.landmarks[fromIndex];
        const to = result.landmarks[toIndex];
        if (!from || !to) return null;
        return (
          <Segment
            key={`${fromIndex}-${toIndex}`}
            x1={from.x * size.width}
            y1={from.y * size.height}
            x2={to.x * size.width}
            y2={to.y * size.height}
            style={styles.handLine}
          />
        );
      })}
      {result.landmarks.map((point) => (
        <View
          key={point.index}
          style={[styles.handDot, { left: point.x * size.width - 4, top: point.y * size.height - 4 }]}
        />
      ))}
      {result.pick.detected ? (
        <View
          style={[
            styles.pickMarker,
            {
              left: result.pick.centerX * size.width - 17,
              top: result.pick.centerY * size.height - 17,
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

function handSize(result: HandAnalysisResult | null) {
  const wrist = result?.landmarks[0];
  const middleMcp = result?.landmarks[9];
  return wrist && middleMcp ? Math.hypot(wrist.x - middleMcp.x, wrist.y - middleMcp.y) : 0;
}

function framingLabel(stats: ContinuousRightHandStats | null) {
  if (!stats) return '손 찾는 중';
  if (stats.autoFramingState === 'zooming-in') return '자동 확대 중';
  if (stats.autoFramingState === 'zooming-out') return '자동 축소 중';
  if (stats.autoFramingState === 'max-zoom-too-small') return '최대 줌 · 손이 아직 작음';
  if (stats.autoFramingState === 'locked') return '구도·초점 고정';
  return '손 찾는 중';
}

function latestHitText(hit: ContinuousStringHit | null) {
  if (!hit) return '탄현 후보 대기';
  const string = hit.stringNumber > 0 ? `${hit.stringNumber}번 줄` : hit.visualIndex > 0 ? `시각 줄 ${hit.visualIndex}` : '줄 판정 불가';
  const direction = hit.direction === 'down' ? '다운' : hit.direction === 'up' ? '업' : '방향 판정 중';
  return `${hit.label} · ${string} · ${direction} · ${Math.round(hit.confidence * 100)}%`;
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
  const fullPassRef = useRef<'pose' | 'hand'>('pose');
  const [permission, requestPermission] = useCameraPermissions();
  const firstMode = initialMode(cameraFocus);
  const [selectedPlan, setSelectedPlan] = useState<AnalysisPlan>(firstMode);
  const [activeMode, setActiveMode] = useState<AnalysisMode>(firstMode);
  const [facing, setFacing] = useState<CameraType>(firstMode === 'full' ? 'front' : 'back');
  const [cameraKey, setCameraKey] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [previewSize, setPreviewSize] = useState<Size>({ width: 0, height: 0 });
  const [poseResult, setPoseResult] = useState<PoseAnalysisResult | null>(null);
  const [handResult, setHandResult] = useState<HandAnalysisResult | null>(null);
  const [continuousStats, setContinuousStats] = useState<ContinuousRightHandStats | null>(null);
  const [latestHit, setLatestHit] = useState<ContinuousStringHit | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [cycleIndex, setCycleIndex] = useState(0);

  const useContinuousHand = activeMode !== 'full' && isContinuousRightHandCameraAvailable;
  const useContinuousRightHand = activeMode === 'right-hand' && useContinuousHand;

  useEffect(() => {
    if (running) return;
    const next = initialMode(cameraFocus);
    setSelectedPlan(next);
    setActiveMode(next);
  }, [cameraFocus, running]);

  useEffect(() => {
    if (selectedPlan !== 'auto-cycle') setActiveMode(selectedPlan);
  }, [selectedPlan]);

  useEffect(() => {
    if (!running || selectedPlan !== 'auto-cycle') return;
    setCycleIndex(0);
    setActiveMode(AUTO_CYCLE[0]);
    const timer = setInterval(() => setCycleIndex((current) => {
      const next = (current + 1) % AUTO_CYCLE.length;
      setActiveMode(AUTO_CYCLE[next]);
      return next;
    }), 20_000);
    return () => clearInterval(timer);
  }, [running, selectedPlan]);

  useEffect(() => {
    setFacing(activeMode === 'full' ? 'front' : 'back');
    setCameraReady(false);
    setAnalysisError('');
    setPoseResult(null);
    setHandResult(null);
    setContinuousStats(null);
    setLatestHit(null);
    setFrameCount(0);
    setCameraKey((value) => value + 1);
    fullPassRef.current = 'pose';
  }, [activeMode]);

  useEffect(() => {
    if (useContinuousHand || !running || !cameraReady || !permission?.granted) return;
    if (activeMode === 'full' && !isLiveCoachNativeAvailable) {
      setAnalysisError('전체 자세 분석 모듈이 APK에 없습니다.');
      return;
    }
    if (activeMode !== 'full' && !isDetailedHandCoachAvailable) {
      setAnalysisError('손 관절 분석 모듈이 APK에 없습니다.');
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delay: number) => {
      if (!cancelled) timer = setTimeout(capture, delay);
    };
    const capture = async () => {
      if (cancelled || analysisBusyRef.current || !cameraRef.current) {
        schedule(120);
        return;
      }
      analysisBusyRef.current = true;
      const startedAt = Date.now();
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: activeMode === 'full' ? 0.3 : 0.52,
          shutterSound: false,
          mirror: facing === 'front',
        });
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
          const result = await analyzeHandAsync(photo.uri, 'none');
          if (!cancelled) setHandResult(result);
        }
        if (!cancelled) {
          setFrameCount((value) => value + 1);
          setAnalysisError('');
        }
      } catch (caught) {
        if (!cancelled) setAnalysisError(caught instanceof Error ? caught.message : '카메라 분석 중 오류가 발생했습니다.');
      } finally {
        analysisBusyRef.current = false;
        schedule(Math.max(130, (activeMode === 'full' ? 800 : 480) - (Date.now() - startedAt)));
      }
    };
    schedule(100);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      analysisBusyRef.current = false;
    };
  }, [activeMode, cameraReady, facing, permission?.granted, running, useContinuousHand]);

  const retryCamera = () => {
    setAnalysisError('');
    setCameraReady(false);
    setCameraKey((value) => value + 1);
  };

  const switchCamera = () => {
    if (useContinuousHand) return;
    setFacing((value) => value === 'front' ? 'back' : 'front');
    retryCamera();
  };

  const onLayout = (event: LayoutChangeEvent) => {
    setPreviewSize({
      width: event.nativeEvent.layout.width,
      height: event.nativeEvent.layout.height,
    });
  };

  if (!permission) {
    return <View style={styles.center}><ActivityIndicator /><Text style={styles.centerText}>카메라 권한 확인 중</Text></View>;
  }
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionTitle}>정밀 분석에 카메라 권한이 필요합니다</Text>
        <Text style={styles.centerText}>영상은 서버로 보내지 않고 휴대폰에서만 분석합니다.</Text>
        <Pressable onPress={() => void requestPermission()} style={styles.permissionButton}>
          <Text style={styles.permissionButtonText}>카메라 권한 허용</Text>
        </Pressable>
      </View>
    );
  }

  const size = handSize(handResult);
  const handStatus = !handResult?.hasHand
    ? '손 관절 찾는 중'
    : size < 0.13
      ? '손이 작음 · 자동 확대 중'
      : size > 0.68
        ? '손가락 끝이 잘림 · 조금 멀리'
        : `손 추적 ${Math.round(handResult.handednessScore * 100)}%`;
  const fps = continuousStats?.analysisFps ?? 0;
  const zoom = continuousStats?.autoZoomRatio ?? 0;

  return (
    <View style={styles.root}>
      <View style={styles.planCard}>
        <Text style={styles.planTitle}>정밀 분석 화면</Text>
        <View style={styles.planRow}>
          {PLAN_OPTIONS.map((item) => (
            <Pressable
              key={item.id}
              disabled={running}
              onPress={() => setSelectedPlan(item.id)}
              style={[styles.planButton, selectedPlan === item.id && styles.planButtonActive, running && styles.disabled]}
            >
              <Text style={[styles.planButtonText, selectedPlan === item.id && styles.planButtonTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.planGuide}>
          {selectedPlan === 'auto-cycle' ? `자동 순환 ${cycleIndex + 1}/3 · ${modeTitle(activeMode)}` : modeGuide(category, activeMode)}
        </Text>
      </View>

      <View style={styles.headingRow}>
        <View style={styles.headingText}>
          <Text style={styles.eyebrow}>{useContinuousHand ? 'CONTINUOUS CAMERAX · LIVE' : 'ADAPTIVE CAMERA'}</Text>
          <Text style={styles.title}>{modeTitle(activeMode)}</Text>
        </View>
        {useContinuousHand ? (
          <View style={styles.liveBadge}><Text style={styles.liveBadgeText}>후면 연속</Text></View>
        ) : (
          <Pressable onPress={switchCamera} style={styles.cameraSwitch}>
            <Text style={styles.cameraSwitchText}>{facing === 'front' ? '전면' : '후면'} 전환</Text>
          </Pressable>
        )}
      </View>

      <View style={[styles.cameraFrame, activeMode !== 'full' && styles.cameraFrameHand]} onLayout={onLayout}>
        {useContinuousHand ? (
          <ContinuousRightHandCamera
            key={`continuous-${activeMode}-${cameraKey}`}
            style={StyleSheet.absoluteFill}
            running={true}
            pickColor={useContinuousRightHand ? 'auto' : 'none'}
            onCameraReady={() => {
              setCameraReady(true);
              setAnalysisError('');
            }}
            onAnalysis={(event) => {
              const result: ContinuousHandAnalysisResult = event.nativeEvent;
              setHandResult(result);
              setContinuousStats(result.continuous);
              setFrameCount(result.continuous.frameCount);
              const newest = result.continuous.newHits.at(-1);
              if (newest) setLatestHit(newest);
              setAnalysisError('');
            }}
            onError={(event) => {
              setCameraReady(false);
              setAnalysisError(event.nativeEvent.message);
            }}
          />
        ) : (
          <CameraView
            key={`${facing}-${cameraKey}`}
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={facing}
            mirror={facing === 'front'}
            mode="picture"
            ratio="4:3"
            animateShutter={false}
            onCameraReady={() => {
              setCameraReady(true);
              setAnalysisError('');
            }}
            onMountError={(event) => {
              setCameraReady(false);
              setAnalysisError(event.message);
            }}
          />
        )}
        {activeMode === 'full' ? <PoseOverlay result={poseResult} size={previewSize} /> : null}
        <HandOverlay result={handResult} size={previewSize} />

        <View pointerEvents="none" style={styles.topBadges}>
          <Text style={[styles.stateBadge, running && styles.stateBadgeRunning]}>
            {running ? '실시간 판정 중' : useContinuousHand ? '카메라 구도 준비 중' : '연습 시작 대기'}
          </Text>
          <Text style={styles.stateBadge}>{frameCount}프레임</Text>
        </View>

        {useContinuousHand && cameraReady ? (
          <View pointerEvents="none" style={styles.framingBadge}>
            <Text style={styles.framingText}>{framingLabel(continuousStats)}{zoom > 0 ? ` · ${zoom.toFixed(2)}x` : ''}</Text>
          </View>
        ) : null}

        {!cameraReady && !analysisError ? (
          <View pointerEvents="none" style={styles.loadingOverlay}>
            <ActivityIndicator />
            <Text style={styles.loadingText}>카메라 연결 중</Text>
          </View>
        ) : null}

        {analysisError ? (
          <View style={styles.errorOverlay}>
            <Text style={styles.errorTitle}>카메라를 연결하지 못했습니다</Text>
            <Text style={styles.errorText}>{analysisError}</Text>
            <Pressable onPress={retryCamera} style={styles.retryButton}>
              <Text style={styles.retryText}>카메라 다시 연결</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <View style={styles.resultCard}>
        <View style={styles.resultHeader}>
          <Text style={styles.resultTitle}>{activeMode === 'full' ? (poseResult?.hasPerson ? `상체 관절 ${poseResult.landmarks.length}개 추적` : '전신 자세 추적 대기') : handStatus}</Text>
          {useContinuousHand ? <Text style={styles.fpsText}>{fps > 0 ? `${fps.toFixed(1)} fps` : '분석 준비'}</Text> : null}
        </View>
        {useContinuousRightHand ? (
          <>
            <Text style={styles.detailText}>{latestHitText(latestHit)}</Text>
            <Text style={styles.detailText}>피크 {handResult?.pick.detected ? `${Math.round(handResult.pick.confidence * 100)}% · 각도 ${Math.round(handResult.pick.angleDegrees)}°` : '찾는 중'}</Text>
            <Text style={styles.noticeText}>손목 회전·피크 깊이·D-U·줄 범위·P/i/m/a 관절각과 복귀를 실제 프레임이 쌓인 뒤 판정합니다.</Text>
          </>
        ) : activeMode === 'left-hand' ? (
          <>
            <Text style={styles.detailText}>연속 손 프레임을 지판 보정 좌표와 마이크 탄현 시각에 결합합니다.</Text>
            <Text style={styles.noticeText}>코드·파워코드는 이름과 점수, 핑거링·스케일은 손가락·줄·프렛 순서를 근거가 있을 때만 확정합니다.</Text>
          </>
        ) : (
          <Text style={styles.noticeText}>자세와 양손을 교차 수집하며 보이지 않는 관절은 추측하지 않습니다.</Text>
        )}
        {fps > 0 && fps < 12 ? <Text style={styles.warningText}>분석 속도가 낮아 빠른 동작 일부는 판정 불가가 될 수 있습니다.</Text> : null}
        {!isContinuousRightHandCameraAvailable && activeMode !== 'full' ? <Text style={styles.warningText}>이 APK에는 연속 CameraX 모듈이 없어 사진 분석으로 대체됩니다.</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#0d1117', paddingHorizontal: 8, paddingBottom: 12 },
  center: { minHeight: 440, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0d1117', padding: 22 },
  centerText: { color: '#8b949e', fontSize: 10, lineHeight: 16, textAlign: 'center', marginTop: 8 },
  permissionTitle: { color: '#f0f6fc', fontSize: 16, fontWeight: '900', textAlign: 'center' },
  permissionButton: { minHeight: 43, borderRadius: 12, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 14 },
  permissionButtonText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  planCard: { borderRadius: 14, borderWidth: 1, borderColor: '#1f6feb', backgroundColor: '#111d2f', padding: 10, marginTop: 4 },
  planTitle: { color: '#79c0ff', fontSize: 8, fontWeight: '900' },
  planRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 7 },
  planButton: { minHeight: 35, borderRadius: 9, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9 },
  planButtonActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  planButtonText: { color: '#b1bac4', fontSize: 8, fontWeight: '900' },
  planButtonTextActive: { color: '#ffffff' },
  planGuide: { color: '#b6d8ff', fontSize: 8, lineHeight: 13, marginTop: 7 },
  headingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  headingText: { flex: 1, paddingRight: 8 },
  eyebrow: { color: '#79c0ff', fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  title: { color: '#f0f6fc', fontSize: 14, fontWeight: '900', marginTop: 2 },
  liveBadge: { minWidth: 65, height: 36, borderRadius: 10, borderWidth: 1, borderColor: '#2ea043', backgroundColor: '#16351f', alignItems: 'center', justifyContent: 'center' },
  liveBadgeText: { color: '#7ee787', fontSize: 8, fontWeight: '900' },
  cameraSwitch: { minWidth: 65, height: 36, borderRadius: 10, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center' },
  cameraSwitchText: { color: '#f0f6fc', fontSize: 8, fontWeight: '900' },
  cameraFrame: { height: 390, borderRadius: 17, overflow: 'hidden', backgroundColor: '#000000', borderWidth: 1, borderColor: '#30363d' },
  cameraFrameHand: { height: 430 },
  poseLine: { position: 'absolute', height: 3, borderRadius: 2, backgroundColor: '#58a6ff' },
  poseDot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#7ee787', borderWidth: 1, borderColor: '#ffffff' },
  handLine: { position: 'absolute', height: 2, borderRadius: 1, backgroundColor: '#f2cc60' },
  handDot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#79c0ff', borderWidth: 1, borderColor: '#ffffff' },
  stringLine: { position: 'absolute', height: 1.5, borderRadius: 1, backgroundColor: 'rgba(242,204,96,0.65)' },
  stringLineActive: { position: 'absolute', height: 3.5, borderRadius: 2, backgroundColor: '#ff7b72' },
  pickMarker: { position: 'absolute', width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: '#ff7b72', alignItems: 'center', justifyContent: 'center' },
  pickAxis: { width: 28, height: 2, backgroundColor: '#ff7b72' },
  topBadges: { position: 'absolute', left: 8, right: 8, top: 8, flexDirection: 'row', justifyContent: 'space-between' },
  stateBadge: { color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.68)', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 5, fontSize: 7, fontWeight: '900' },
  stateBadgeRunning: { backgroundColor: 'rgba(35,134,54,0.92)' },
  framingBadge: { position: 'absolute', left: 8, bottom: 8, borderRadius: 10, backgroundColor: 'rgba(17,29,47,0.92)', borderWidth: 1, borderColor: '#1f6feb', paddingHorizontal: 8, paddingVertical: 5 },
  framingText: { color: '#b6d8ff', fontSize: 7, fontWeight: '900' },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.60)', alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: '#ffffff', fontSize: 9, fontWeight: '900', marginTop: 7 },
  errorOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(13,17,23,0.94)', alignItems: 'center', justifyContent: 'center', padding: 22 },
  errorTitle: { color: '#ff7b72', fontSize: 14, fontWeight: '900', textAlign: 'center' },
  errorText: { color: '#b1bac4', fontSize: 9, lineHeight: 14, textAlign: 'center', marginTop: 6 },
  retryButton: { minWidth: 150, minHeight: 42, borderRadius: 11, backgroundColor: '#da3633', alignItems: 'center', justifyContent: 'center', marginTop: 13 },
  retryText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  resultCard: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#30363d', borderRadius: 13, padding: 10, marginTop: 8 },
  resultHeader: { flexDirection: 'row', alignItems: 'center' },
  resultTitle: { flex: 1, color: '#f0f6fc', fontSize: 9, fontWeight: '900' },
  fpsText: { color: '#7ee787', fontSize: 8, fontWeight: '900' },
  detailText: { color: '#f2cc60', fontSize: 8, lineHeight: 13, fontWeight: '800', marginTop: 5 },
  noticeText: { color: '#8b949e', fontSize: 8, lineHeight: 13, marginTop: 5 },
  warningText: { color: '#ffb86b', fontSize: 8, lineHeight: 13, fontWeight: '800', marginTop: 5 },
  disabled: { opacity: 0.42 },
});
