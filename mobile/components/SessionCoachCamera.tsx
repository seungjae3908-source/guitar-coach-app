import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  LayoutChangeEvent,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { PracticeCategoryId } from '../config/guitar-mode-profiles';
import type { PracticePreset } from '../config/personal-practice-presets';
import { cameraAnalysisProfile } from '../services/focus-practice-mode';
import { effectiveHandDetailSize } from '../services/hand-precision-region';
import {
  analyzeHandWithStringsAsync,
  type HandAnalysisResult,
  isDetailedHandCoachAvailable,
  type PickColor,
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
  if (mode === 'right-hand') return '오른손·피크·줄 실제 카메라 분석';
  if (mode === 'left-hand') return '왼손·코드·지판 실제 카메라 분석';
  return '전체 자세·양손 실제 카메라 분석';
}

function modeGuide(category: PracticeCategoryId, mode: AnalysisMode) {
  if (mode === 'left-hand') {
    if (category === 'chords' || category === 'powerChords') {
      return '왼손과 사용하는 프렛이 크게 보이게 두세요. 손가락 좌표와 코드 변화를 확인합니다.';
    }
    return '왼손과 연주할 프렛 범위를 크게 보이게 두세요. 손가락·줄·프렛 순서를 추적합니다.';
  }
  if (mode === 'right-hand') {
    if (category === 'arpeggio' || category === 'fingerstyle') {
      return '브리지와 P·i·m·a 끝점이 함께 보이게 두세요. 줄 역할·복귀·관절각을 측정합니다.';
    }
    if (category === 'strumming') {
      return '브리지·피크·손목이 함께 보이게 두세요. 다운·업 방향, 줄 범위와 손목 회전을 측정합니다.';
    }
    return '브리지·피크·손목과 여섯 줄이 함께 보이게 두세요.';
  }
  return '머리·어깨·양 팔꿈치·기타가 한 화면에 들어오게 두세요.';
}

function pickColorFor(mode: AnalysisMode, category: PracticeCategoryId): PickColor {
  if (mode === 'left-hand') return 'none';
  if (mode === 'right-hand') return cameraAnalysisProfile(category).pickColor;
  return cameraAnalysisProfile(category).pickColor;
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
          style={[
            point.index === 0 ? styles.wristDot : styles.handDot,
            {
              left: point.x * size.width - (point.index === 0 ? 7 : 4),
              top: point.y * size.height - (point.index === 0 ? 7 : 4),
            },
          ]}
        />
      ))}
      {result.landmarks[0] ? (
        <Text
          style={[
            styles.wristLabel,
            {
              left: Math.max(2, result.landmarks[0].x * size.width + 8),
              top: Math.max(2, result.landmarks[0].y * size.height - 10),
            },
          ]}
        >
          손목
        </Text>
      ) : null}
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
  if (!result) return 0;
  return effectiveHandDetailSize({ landmarks: result.landmarks, precision: result.precision });
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
  const handFrameIndexRef = useRef(0);
  const [permission, requestPermission] = useCameraPermissions();
  const firstMode = initialMode(cameraFocus);
  const analysisProfile = cameraAnalysisProfile(category);
  const [selectedPlan, setSelectedPlan] = useState<AnalysisPlan>(firstMode);
  const [activeMode, setActiveMode] = useState<AnalysisMode>(firstMode);
  const [facing, setFacing] = useState<CameraType>('front');
  const [cameraKey, setCameraKey] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [analysisError, setAnalysisError] = useState('');
  const [previewSize, setPreviewSize] = useState<Size>({ width: 0, height: 0 });
  const [poseResult, setPoseResult] = useState<PoseAnalysisResult | null>(null);
  const [handResult, setHandResult] = useState<HandAnalysisResult | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [cycleIndex, setCycleIndex] = useState(0);
  const [startupRetries, setStartupRetries] = useState(0);

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
    setFacing('front');
    setCameraReady(false);
    setCameraError('');
    setAnalysisError('');
    setPoseResult(null);
    setHandResult(null);
    setFrameCount(0);
    setStartupRetries(0);
    setCameraKey((value) => value + 1);
    fullPassRef.current = 'pose';
    handFrameIndexRef.current = 0;
  }, [activeMode]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !permission?.granted) return;
      setCameraReady(false);
      setCameraError('');
      setCameraKey((value) => value + 1);
    });
    return () => subscription.remove();
  }, [permission?.granted]);

  useEffect(() => {
    if (!permission?.granted || cameraReady || cameraError) return;
    const timeout = setTimeout(() => {
      if (startupRetries < 2) {
        setStartupRetries((value) => value + 1);
        setCameraKey((value) => value + 1);
      } else {
        setCameraError('카메라 시작 응답이 없습니다. 다른 앱의 카메라 사용을 종료한 뒤 다시 연결하세요.');
      }
    }, 5_000);
    return () => clearTimeout(timeout);
  }, [cameraError, cameraReady, permission?.granted, startupRetries]);

  useEffect(() => {
    if (!running || !cameraReady || !permission?.granted || cameraError) return;
    if (activeMode === 'full' && !isLiveCoachNativeAvailable) {
      setAnalysisError('전체 자세 분석 모듈이 APK에 없습니다. 카메라 영상만 표시합니다.');
      return;
    }
    if (activeMode !== 'full' && !isDetailedHandCoachAvailable) {
      setAnalysisError('손 관절 분석 모듈이 APK에 없습니다. 카메라 영상만 표시합니다.');
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delay: number) => {
      if (!cancelled) timer = setTimeout(capture, delay);
    };
    const capture = async () => {
      if (cancelled || analysisBusyRef.current || !cameraRef.current) {
        schedule(180);
        return;
      }
      analysisBusyRef.current = true;
      const startedAt = Date.now();
      let capturedUri: string | null = null;
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: activeMode === 'full'
            ? 0.30
            : facing === 'front'
              ? Math.max(0.60, analysisProfile.photoQuality)
              : analysisProfile.photoQuality,
          shutterSound: false,
          mirror: facing === 'front',
          skipProcessing: false,
        });
        capturedUri = photo?.uri ?? null;
        if (!capturedUri || cancelled) throw new Error('카메라 프레임을 가져오지 못했습니다.');

        handFrameIndexRef.current += 1;
        const refreshStringVision = handFrameIndexRef.current === 1
          || handFrameIndexRef.current % analysisProfile.stringVisionEveryFrames === 0;

        if (activeMode === 'full') {
          if (fullPassRef.current === 'pose' || !isDetailedHandCoachAvailable) {
            const result = await analyzePoseAsync(capturedUri);
            if (!cancelled) setPoseResult(result);
            fullPassRef.current = 'hand';
          } else {
            const result = await analyzeHandWithStringsAsync(capturedUri, pickColorFor(activeMode, category), { refreshStringVision });
            if (!cancelled) setHandResult(result);
            fullPassRef.current = 'pose';
          }
        } else {
          const result = await analyzeHandWithStringsAsync(capturedUri, pickColorFor(activeMode, category), { refreshStringVision });
          if (!cancelled) setHandResult(result);
        }
        if (!cancelled) {
          setFrameCount((value) => value + 1);
          setAnalysisError('');
        }
      } catch (caught) {
        if (!cancelled) {
          setAnalysisError(caught instanceof Error ? caught.message : '카메라 분석 중 오류가 발생했습니다.');
        }
      } finally {
        if (capturedUri) {
          try {
            const capturedFile = new File(capturedUri);
            if (capturedFile.exists) capturedFile.delete();
          } catch {
            // 카메라 캐시는 다음 운영체제 정리 주기에 맡깁니다.
          }
        }
        analysisBusyRef.current = false;
        const targetInterval = activeMode === 'full' ? 780 : analysisProfile.captureIntervalMs;
        schedule(Math.max(45, targetInterval - (Date.now() - startedAt)));
      }
    };
    schedule(180);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      analysisBusyRef.current = false;
    };
  }, [activeMode, cameraError, cameraReady, category, facing, permission?.granted, running]);

  const retryCamera = () => {
    setCameraError('');
    setAnalysisError('');
    setCameraReady(false);
    setStartupRetries(0);
    setCameraKey((value) => value + 1);
  };

  const switchCamera = () => {
    setFacing((value) => value === 'front' ? 'back' : 'front');
    retryCamera();
  };

  const onLayout = (event: LayoutChangeEvent) => {
    setPreviewSize({
      width: event.nativeEvent.layout.width,
      height: event.nativeEvent.layout.height,
    });
  };

  const requestOrOpenSettings = async () => {
    if (permission?.canAskAgain !== false) {
      await requestPermission();
      return;
    }
    await Linking.openSettings();
  };

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.centerText}>카메라 권한 확인 중</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionTitle}>정밀 분석에 카메라 권한이 필요합니다</Text>
        <Text style={styles.centerText}>영상은 서버로 보내지 않고 휴대폰에서만 분석합니다.</Text>
        <Pressable onPress={() => void requestOrOpenSettings()} style={styles.permissionButton}>
          <Text style={styles.permissionButtonText}>
            {permission.canAskAgain === false ? '휴대폰 설정에서 카메라 허용' : '카메라 권한 허용'}
          </Text>
        </Pressable>
      </View>
    );
  }

  const size = handSize(handResult);
  const precisionApplied = Boolean(handResult?.precision?.applied);
  const wristPoint = handResult?.landmarks.find((point) => point.name === 'wrist');
  const middleMcpPoint = handResult?.landmarks.find((point) => point.name === 'middleMcp');
  const wristEdgeMargin = wristPoint
    ? Math.min(wristPoint.x, 1 - wristPoint.x, wristPoint.y, 1 - wristPoint.y)
    : 0;
  const wristConfidence = wristPoint && middleMcpPoint
    ? Math.min(1, handResult!.handednessScore * Math.min(1, wristEdgeMargin / 0.07) * Math.min(1, handSize(handResult) / 0.16))
    : 0;
  const wristStatus = !running
    ? '레슨 시작 후 손목 관절점을 연속 추적합니다'
    : wristConfidence < 0.42
      ? '손목 판정 불가 · 손목을 화면 안쪽에 넣으세요'
      : `손목 추적 ${Math.round(wristConfidence * 100)}% · 손바닥 축 ${Math.round(handResult ? Math.atan2((middleMcpPoint?.y ?? 0) - (wristPoint?.y ?? 0), (middleMcpPoint?.x ?? 0) - (wristPoint?.x ?? 0)) * 180 / Math.PI : 0)}°`;

  const handStatus = !running
    ? '레슨을 시작하면 관절 분석이 실행됩니다'
    : !handResult?.hasHand
      ? '손 관절 찾는 중'
      : size < 0.13
        ? '손이 작습니다 · 카메라 가까이'
        : size > 0.68
          ? '손가락 끝이 잘립니다 · 조금 멀리'
          : `손 추적 ${Math.round(handResult.handednessScore * 100)}%${precisionApplied ? ' · ROI 2차 정밀' : ''}`;

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
        <Text style={styles.profileText}>{analysisProfile.label} · {analysisProfile.requiredEvidence.join(' · ')}</Text>
        <Text style={styles.planGuide}>
          {selectedPlan === 'auto-cycle'
            ? `자동 순환 ${cycleIndex + 1}/3 · ${modeTitle(activeMode)}`
            : modeGuide(category, activeMode)}
        </Text>
      </View>

      <View style={styles.headingRow}>
        <View style={styles.headingText}>
          <Text style={styles.eyebrow}>SAMSUNG COMPATIBILITY CAMERA · LIVE</Text>
          <Text style={styles.title}>{modeTitle(activeMode)}</Text>
        </View>
        <Pressable onPress={switchCamera} style={styles.cameraSwitch}>
          <Text style={styles.cameraSwitchText}>{facing === 'front' ? '후면으로' : '전면으로'}</Text>
        </Pressable>
      </View>

      <View style={[styles.cameraFrame, activeMode !== 'full' && styles.cameraFrameHand]} onLayout={onLayout}>
        <CameraView
          key={`${facing}-${activeMode}-${cameraKey}`}
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          mirror={facing === 'front'}
          mode="picture"
          ratio="4:3"
          animateShutter={false}
          onCameraReady={() => {
            setCameraReady(true);
            setCameraError('');
            setStartupRetries(0);
          }}
          onMountError={(event) => {
            setCameraReady(false);
            setCameraError(event.message || '카메라를 열지 못했습니다.');
          }}
        />

        {activeMode === 'full' ? <PoseOverlay result={poseResult} size={previewSize} /> : null}
        <HandOverlay result={handResult} size={previewSize} />

        <View pointerEvents="none" style={styles.topBadges}>
          <Text style={[styles.stateBadge, cameraReady && styles.stateBadgeReady]}>
            {cameraReady ? '카메라 영상 연결됨' : '카메라 연결 중'}
          </Text>
          <Text style={[styles.stateBadge, running && styles.stateBadgeRunning]}>
            {running ? `${frameCount}프레임 분석` : '레슨 시작 대기'}
          </Text>
        </View>

        {!cameraReady && !cameraError ? (
          <View pointerEvents="none" style={styles.loadingOverlay}>
            <ActivityIndicator />
            <Text style={styles.loadingText}>실제 카메라 여는 중</Text>
          </View>
        ) : null}

        {cameraError ? (
          <View style={styles.errorOverlay}>
            <Text style={styles.errorTitle}>카메라를 연결하지 못했습니다</Text>
            <Text style={styles.errorText}>{cameraError}</Text>
            <View style={styles.errorButtons}>
              <Pressable onPress={retryCamera} style={styles.retryButton}>
                <Text style={styles.retryText}>카메라 다시 연결</Text>
              </Pressable>
              <Pressable onPress={() => void Linking.openSettings()} style={styles.settingsButton}>
                <Text style={styles.settingsText}>휴대폰 설정 열기</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>

      <View style={styles.statusCard}>
        <View style={styles.statusRow}>
          <Text style={styles.statusTitle}>{activeMode === 'full' ? '자세·손 추적 상태' : handStatus}</Text>
          <Text style={[styles.statusValue, cameraReady && styles.statusValueReady]}>
            {cameraReady ? running ? '분석 중' : '영상 준비' : '연결 중'}
          </Text>
        </View>
        {activeMode !== 'full' && handResult?.hasHand ? (
          <Text style={styles.statusText}>
            {handResult.handedness} · 관절 {handResult.landmarks.length}개 · 처리 {Math.round(handResult.latencyMs)}ms
          </Text>
        ) : null}
        {activeMode !== 'full' ? <Text style={wristConfidence >= 0.42 ? styles.wristStatusGood : styles.wristStatusBad}>{wristStatus}</Text> : null}
        {analysisError ? <Text style={styles.analysisError}>{analysisError}</Text> : null}
        {!analysisError && running && frameCount === 0 ? (
          <Text style={styles.statusText}>첫 분석 프레임을 기다리는 중입니다. 카메라 영상이 보이면 손이나 상체를 화면 중앙에 맞추세요.</Text>
        ) : null}
        {!running ? (
          <Text style={styles.statusText}>카메라 영상은 지금 확인할 수 있고, 관절·피크·줄 판정은 위의 실시간 레슨 시작 버튼을 누른 뒤 실행됩니다.</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', backgroundColor: '#0d1117' },
  center: {
    minHeight: 260,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#30363d',
    backgroundColor: '#161b22',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22,
  },
  centerText: { color: '#b1bac4', fontSize: 10, lineHeight: 16, textAlign: 'center', marginTop: 10 },
  permissionTitle: { color: '#f0f6fc', fontSize: 15, fontWeight: '900', textAlign: 'center' },
  permissionButton: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#1f6feb',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    marginTop: 16,
  },
  permissionButtonText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  planCard: { borderRadius: 16, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', padding: 12 },
  planTitle: { color: '#f0f6fc', fontSize: 12, fontWeight: '900' },
  profileText: { color: '#7ee787', fontSize: 8, lineHeight: 13, fontWeight: '800', marginTop: 6 },
  planRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 9 },
  planButton: {
    minHeight: 38,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#30363d',
    backgroundColor: '#21262d',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 11,
  },
  planButtonActive: { backgroundColor: '#238636', borderColor: '#2ea043' },
  planButtonText: { color: '#b1bac4', fontSize: 9, fontWeight: '900' },
  planButtonTextActive: { color: '#ffffff' },
  planGuide: { color: '#b6d8ff', fontSize: 9, lineHeight: 15, marginTop: 9 },
  disabled: { opacity: 0.48 },
  headingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, marginBottom: 9 },
  headingText: { flex: 1, paddingRight: 8 },
  eyebrow: { color: '#79c0ff', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  title: { color: '#f0f6fc', fontSize: 17, fontWeight: '900', marginTop: 4 },
  cameraSwitch: {
    minWidth: 76,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2ea043',
    backgroundColor: '#102b17',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 9,
  },
  cameraSwitchText: { color: '#7ee787', fontSize: 9, fontWeight: '900' },
  cameraFrame: {
    width: '100%',
    height: 330,
    overflow: 'hidden',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#484f58',
    backgroundColor: '#000000',
  },
  cameraFrameHand: { height: 470 },
  topBadges: { position: 'absolute', left: 12, right: 12, top: 12, flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  stateBadge: {
    color: '#f0f6fc',
    fontSize: 8,
    fontWeight: '900',
    backgroundColor: 'rgba(13,17,23,0.78)',
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  stateBadgeReady: { color: '#7ee787' },
  stateBadgeRunning: { color: '#79c0ff' },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.56)' },
  loadingText: { color: '#ffffff', fontSize: 10, fontWeight: '800', marginTop: 9 },
  errorOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(13,17,23,0.94)', padding: 22 },
  errorTitle: { color: '#ff7b72', fontSize: 14, fontWeight: '900', textAlign: 'center' },
  errorText: { color: '#f0b7b2', fontSize: 9, lineHeight: 15, textAlign: 'center', marginTop: 8 },
  errorButtons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 15 },
  retryButton: { minHeight: 42, borderRadius: 11, backgroundColor: '#1f6feb', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  retryText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  settingsButton: { minHeight: 42, borderRadius: 11, borderWidth: 1, borderColor: '#6e7681', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  settingsText: { color: '#f0f6fc', fontSize: 9, fontWeight: '900' },
  poseLine: { position: 'absolute', height: 2, backgroundColor: 'rgba(88,166,255,0.86)' },
  poseDot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#58a6ff', borderWidth: 1, borderColor: '#ffffff' },
  handLine: { position: 'absolute', height: 2, backgroundColor: 'rgba(126,231,135,0.92)' },
  handDot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#7ee787', borderWidth: 1, borderColor: '#ffffff' },
  wristDot: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#ff7b72', borderWidth: 2, borderColor: '#ffffff' },
  wristLabel: { position: 'absolute', color: '#ffffff', fontSize: 8, fontWeight: '900', backgroundColor: 'rgba(13,17,23,0.82)', borderRadius: 7, paddingHorizontal: 5, paddingVertical: 2, overflow: 'hidden' },
  stringLine: { position: 'absolute', height: 1, backgroundColor: 'rgba(242,204,96,0.66)' },
  stringLineActive: { position: 'absolute', height: 3, backgroundColor: 'rgba(255,123,114,0.96)' },
  pickMarker: { position: 'absolute', width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: '#ff7b72', alignItems: 'center', justifyContent: 'center' },
  pickAxis: { width: 28, height: 2, backgroundColor: '#ff7b72' },
  statusCard: { borderRadius: 16, borderWidth: 1, borderColor: '#30363d', backgroundColor: '#161b22', padding: 12, marginTop: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusTitle: { flex: 1, color: '#f0f6fc', fontSize: 11, fontWeight: '900' },
  statusValue: { color: '#f2cc60', fontSize: 9, fontWeight: '900' },
  statusValueReady: { color: '#7ee787' },
  statusText: { color: '#b1bac4', fontSize: 9, lineHeight: 15, marginTop: 7 },
  analysisError: { color: '#ffb4ad', fontSize: 9, lineHeight: 15, marginTop: 7 },
  wristStatusGood: { color: '#7ee787', fontSize: 9, lineHeight: 15, marginTop: 7, fontWeight: '800' },
  wristStatusBad: { color: '#f2cc60', fontSize: 9, lineHeight: 15, marginTop: 7, fontWeight: '800' },
});
