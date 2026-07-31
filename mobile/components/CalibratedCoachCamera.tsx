import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo';
import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
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
import type { HandAnalysisResult, PickColor } from '../modules/guitar-coach-hand';
import {
  analyzePoseAsync,
  isLiveCoachNativeAvailable,
  type PoseAnalysisResult,
  type PoseLandmarkPoint,
} from '../modules/guitar-coach-native';
import { publishLiveAnalysisFrame } from '../services/analysis-stream';
import {
  ConsecutiveHandGate,
  deriveRightHandRegion,
  type NormalizedPoint,
  type NormalizedRegion,
  validateHandInRegion,
} from '../services/right-hand-roi';
import type { MotionSample } from '../services/trajectory-speed-engine';

type Size = { width: number; height: number };
type CalibrationStep = 'loading' | 'soundhole' | 'bridge' | 'ready';

type NativeHandModule = {
  androidHandCoachAvailable: boolean;
  androidHandRegionAnalysisAvailable?: boolean;
  analyzeHandAsync(uri: string, pickColor: PickColor): Promise<HandAnalysisResult>;
  analyzeHandInRegionAsync?: (
    uri: string,
    pickColor: PickColor,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ) => Promise<HandAnalysisResult>;
};

const HandModule = requireOptionalNativeModule<NativeHandModule>('GuitarCoachHand');
const LEFT_HAND_REGION: NormalizedRegion = { left: 0.02, top: 0.15, right: 0.80, bottom: 0.94 };
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

const distance = (left: NormalizedPoint, right: NormalizedPoint) => Math.hypot(left.x - right.x, left.y - right.y);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const ROI_STORAGE_PREFIX = 'guitar-coach:right-hand-roi:v2';

function pickColor(category: PracticeCategoryId, focus: PracticePreset['cameraFocus']): PickColor {
  if (focus !== 'right-hand') return 'none';
  return category === 'arpeggio' || category === 'fingerstyle' ? 'none' : 'auto';
}

function motionSample(result: HandAnalysisResult, capturedAt: number): MotionSample | null {
  const points = new Map(result.landmarks.map((point) => [point.name, point]));
  const wrist = points.get('wrist');
  const middleMcp = points.get('middleMcp');
  const thumb = points.get('thumbTip');
  const index = points.get('indexTip');
  const middle = points.get('middleTip');
  const ring = points.get('ringTip');
  if (!wrist || !middleMcp || !thumb || !index || !middle || !ring) return null;
  const palmSize = distance(wrist, middleMcp);
  const edge = Math.min(wrist.x, 1 - wrist.x, wrist.y, 1 - wrist.y);
  return {
    capturedAt,
    handConfidence: result.handednessScore,
    wristConfidence: clamp(result.handednessScore * Math.min(1, edge / 0.05) * Math.min(1, palmSize / 0.11), 0, 1),
    palmSize,
    wristX: wrist.x,
    wristY: wrist.y,
    palmAngleDegrees: Math.atan2(middleMcp.y - wrist.y, middleMcp.x - wrist.x) * 180 / Math.PI,
    thumbX: thumb.x,
    thumbY: thumb.y,
    indexX: index.x,
    indexY: index.y,
    middleX: middle.x,
    middleY: middle.y,
    ringX: ring.x,
    ringY: ring.y,
    pickX: result.pick.detected ? result.pick.centerX : null,
    pickY: result.pick.detected ? result.pick.centerY : null,
    pickConfidence: result.pick.confidence,
  };
}

function Segment({ x1, y1, x2, y2, style }: { x1: number; y1: number; x2: number; y2: number; style: object }) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  return (
    <View style={[
      style,
      {
        width: length,
        left: (x1 + x2 - length) / 2,
        top: (y1 + y2) / 2,
        transform: [{ rotate: `${Math.atan2(y2 - y1, x2 - x1)}rad` }],
      },
    ]} />
  );
}

function HandOverlay({ result, size }: { result: HandAnalysisResult | null; size: Size }) {
  if (!result?.hasHand || result.landmarks.length < 21 || size.width <= 0 || size.height <= 0) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
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
      {result.pick.detected ? (
        <View style={[
          styles.pickMarker,
          {
            left: result.pick.centerX * size.width - 14,
            top: result.pick.centerY * size.height - 14,
            transform: [{ rotate: `${result.pick.angleDegrees}deg` }],
          },
        ]}>
          <View style={styles.pickAxis} />
        </View>
      ) : null}
    </View>
  );
}

function PoseOverlay({ result, size }: { result: PoseAnalysisResult | null; size: Size }) {
  const points = useMemo(() => new Map(result?.landmarks.map((point) => [point.name, point]) ?? []), [result]);
  if (!result?.hasPerson || size.width <= 0 || size.height <= 0) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {POSE_LINKS.map(([fromName, toName]) => {
        const from = points.get(fromName);
        const to = points.get(toName);
        if (!from || !to || from.confidence < 0.42 || to.confidence < 0.42) return null;
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
      {[...points.values()].map((point) => point.confidence >= 0.42 ? (
        <View key={point.name} style={[styles.poseDot, { left: point.x * size.width - 4, top: point.y * size.height - 4 }]} />
      ) : null)}
    </View>
  );
}

export default function CalibratedCoachCamera({
  coachingActive,
  category,
  cameraFocus,
  onMotionSample,
  onAcceptedFrame,
  onFrameCount,
  onStatus,
  onCalibrationReady,
}: {
  coachingActive: boolean;
  category: PracticeCategoryId;
  cameraFocus: PracticePreset['cameraFocus'];
  onMotionSample?: (sample: MotionSample) => void;
  onAcceptedFrame?: () => void;
  onFrameCount?: (count: number) => void;
  onStatus?: (status: string) => void;
  onCalibrationReady?: (ready: boolean) => void;
}) {
  const cameraRef = useRef<CameraView | null>(null);
  const captureBusyRef = useRef(false);
  const readyAtRef = useRef(0);
  const frameRef = useRef(0);
  const failureRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);
  const handGateRef = useRef(new ConsecutiveHandGate(5, 0.17));
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>(cameraFocus === 'full-body' ? 'front' : 'back');
  const [cameraKey, setCameraKey] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [analysisError, setAnalysisError] = useState('');
  const [status, setStatus] = useState('카메라 연결 중');
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [handResult, setHandResult] = useState<HandAnalysisResult | null>(null);
  const [poseResult, setPoseResult] = useState<PoseAnalysisResult | null>(null);
  const [region, setRegion] = useState<NormalizedRegion | null>(cameraFocus === 'left-hand' ? LEFT_HAND_REGION : null);
  const [calibrationStep, setCalibrationStep] = useState<CalibrationStep>(cameraFocus === 'right-hand' ? 'loading' : 'ready');
  const [soundholePoint, setSoundholePoint] = useState<NormalizedPoint | null>(null);
  const [bridgePoint, setBridgePoint] = useState<NormalizedPoint | null>(null);
  const [locked, setLocked] = useState(false);
  const [consecutive, setConsecutive] = useState(0);

  const updateStatus = (next: string) => {
    setStatus(next);
    onStatus?.(next);
  };

  const calibrationReady = cameraFocus !== 'right-hand' || calibrationStep === 'ready';

  useEffect(() => {
    onCalibrationReady?.(calibrationReady);
  }, [calibrationReady, onCalibrationReady]);

  useEffect(() => {
    let cancelled = false;
    handGateRef.current.reset();
    setLocked(false);
    setConsecutive(0);
    setHandResult(null);
    setSoundholePoint(null);
    setBridgePoint(null);

    if (cameraFocus === 'left-hand') {
      setRegion(LEFT_HAND_REGION);
      setCalibrationStep('ready');
      return;
    }
    if (cameraFocus === 'full-body') {
      setRegion(null);
      setCalibrationStep('ready');
      return;
    }

    setRegion(null);
    setCalibrationStep('loading');
    void AsyncStorage.getItem(`${ROI_STORAGE_PREFIX}:${facing}`)
      .then((stored) => {
        if (cancelled) return;
        if (!stored) {
          setCalibrationStep('soundhole');
          updateStatus('사운드홀 중앙을 한 번 터치하세요');
          return;
        }
        const parsed = JSON.parse(stored) as NormalizedRegion;
        if (![parsed.left, parsed.top, parsed.right, parsed.bottom].every(Number.isFinite)) throw new Error('invalid ROI');
        setRegion(parsed);
        setCalibrationStep('ready');
        updateStatus('저장된 오른손 영역 사용 · 손을 영역 안에 보여주세요');
      })
      .catch(() => {
        if (!cancelled) {
          setCalibrationStep('soundhole');
          updateStatus('사운드홀 중앙을 한 번 터치하세요');
        }
      });
    return () => { cancelled = true; };
  }, [cameraFocus, facing]);

  const remount = (nextFacing?: CameraType) => {
    if (nextFacing) setFacing(nextFacing);
    setCameraReady(false);
    setCameraError('');
    setAnalysisError('');
    setHandResult(null);
    setPoseResult(null);
    setLocked(false);
    setConsecutive(0);
    handGateRef.current.reset();
    failureRef.current = 0;
    setCameraKey((value) => value + 1);
  };

  useEffect(() => {
    remount(cameraFocus === 'full-body' ? 'front' : 'back');
  }, [cameraFocus]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      const previous = appStateRef.current;
      appStateRef.current = next;
      if (previous === 'active' || next !== 'active' || !permission?.granted) return;
      setTimeout(() => remount(), 300);
    });
    return () => subscription.remove();
  }, [permission?.granted]);

  useEffect(() => {
    if (!permission?.granted || cameraReady || cameraError) return;
    const timer = setTimeout(() => {
      setCameraError('카메라 영상 준비 신호가 없습니다. 다른 카메라 앱을 닫고 다시 연결하세요.');
    }, 9_000);
    return () => clearTimeout(timer);
  }, [cameraError, cameraKey, cameraReady, permission?.granted]);

  useEffect(() => {
    if (!permission?.granted || !cameraReady || cameraError) return;
    if (cameraFocus === 'right-hand' && calibrationStep !== 'ready') return;
    if (cameraFocus === 'full-body' && !isLiveCoachNativeAvailable) {
      setAnalysisError('영상은 정상이며 자세 AI 모듈만 사용할 수 없습니다.');
      return;
    }
    if (cameraFocus !== 'full-body' && !HandModule?.androidHandCoachAvailable) {
      setAnalysisError('영상은 정상이며 손 관절 AI 모듈만 사용할 수 없습니다.');
      return;
    }
    if (cameraFocus === 'right-hand' && (!HandModule?.androidHandRegionAnalysisAvailable || !HandModule.analyzeHandInRegionAsync)) {
      setAnalysisError('ROI 손 분석 모듈이 없습니다. 전체 화면 분석으로 대체하지 않습니다.');
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const interval = cameraFocus === 'full-body' ? 760 : 440;
    const schedule = (delay: number) => {
      if (!cancelled) timer = setTimeout(capture, delay);
    };

    const capture = async () => {
      if (cancelled || captureBusyRef.current || !cameraRef.current) {
        schedule(180);
        return;
      }
      const readyAge = Date.now() - readyAtRef.current;
      if (readyAge < 1_000) {
        schedule(1_000 - readyAge);
        return;
      }

      captureBusyRef.current = true;
      const startedAt = Date.now();
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: cameraFocus === 'full-body' ? 0.34 : 0.38,
          shutterSound: false,
          mirror: facing === 'front',
          skipProcessing: false,
        });
        if (!photo?.uri) throw new Error('분석 프레임을 가져오지 못했습니다.');
        const capturedAt = Date.now();

        if (cameraFocus === 'full-body') {
          const result = await analyzePoseAsync(photo.uri);
          if (!cancelled) {
            setPoseResult(result.hasPerson ? result : null);
            frameRef.current += 1;
            onFrameCount?.(frameRef.current);
            if (result.hasPerson) {
              onAcceptedFrame?.();
              updateStatus(coachingActive ? '자세 관절 추적 중' : '자세 관절 자동 추적 중');
              if (coachingActive) publishLiveAnalysisFrame({ kind: 'pose', capturedAt, result });
            } else {
              updateStatus('상체 관절을 찾는 중 · 아직 판정 안 함');
            }
          }
        } else {
          const activeRegion = cameraFocus === 'right-hand' ? region : LEFT_HAND_REGION;
          if (!activeRegion) throw new Error('오른손 분석 영역이 설정되지 않았습니다.');
          const result = cameraFocus === 'right-hand'
            ? await HandModule!.analyzeHandInRegionAsync!(
                photo.uri,
                pickColor(category, cameraFocus),
                activeRegion.left,
                activeRegion.top,
                activeRegion.right,
                activeRegion.bottom,
              )
            : await HandModule!.analyzeHandAsync(photo.uri, 'none');

          frameRef.current += 1;
          onFrameCount?.(frameRef.current);
          const gateResult = validateHandInRegion(result.landmarks, activeRegion);
          const gate = handGateRef.current.add(gateResult);
          if (!cancelled) {
            setConsecutive(gate.consecutive);
            setLocked(gate.locked);
            if (!result.hasHand) {
              setHandResult(null);
              updateStatus('잘라낸 영역에서 손을 찾는 중 · 아직 판정 안 함');
            } else if (!gateResult.valid) {
              setHandResult(null);
              updateStatus('손이 분석 영역을 벗어났습니다 · 영역 안에 오른손 전체를 맞추세요');
            } else if (!gate.locked) {
              setHandResult(null);
              updateStatus(`같은 오른손 연속 확인 ${gate.consecutive}/${gate.required} · 아직 피드백 안 함`);
            } else {
              setHandResult(result);
              onAcceptedFrame?.();
              const sample = motionSample(result, capturedAt);
              if (sample) onMotionSample?.(sample);
              updateStatus(coachingActive ? '오른손 관절·궤적 추적 중 · 피드백 가능' : '오른손 관절·궤적 자동 추적 중');
              if (coachingActive) publishLiveAnalysisFrame({ kind: 'hand', capturedAt, result });
            }
          }
        }
        failureRef.current = 0;
        if (!cancelled) setAnalysisError('');
      } catch (caught) {
        failureRef.current += 1;
        if (!cancelled) {
          const detail = caught instanceof Error ? caught.message : 'AI 분석 오류';
          setAnalysisError(`영상은 유지 중 · AI 분석 재시도 ${failureRef.current}회 · ${detail}`);
          updateStatus('카메라 영상 유지 · AI 분석만 재시도 중');
        }
      } finally {
        captureBusyRef.current = false;
      }
      schedule(Math.max(180, interval - (Date.now() - startedAt) + Math.min(1_400, failureRef.current * 220)));
    };

    schedule(1_000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      captureBusyRef.current = false;
    };
  }, [cameraError, cameraFocus, cameraReady, calibrationStep, category, coachingActive, facing, permission?.granted, region]);

  const resetCalibration = async () => {
    if (cameraFocus !== 'right-hand') return;
    await AsyncStorage.removeItem(`${ROI_STORAGE_PREFIX}:${facing}`);
    handGateRef.current.reset();
    setLocked(false);
    setConsecutive(0);
    setHandResult(null);
    setRegion(null);
    setSoundholePoint(null);
    setBridgePoint(null);
    setCalibrationStep('soundhole');
    updateStatus('사운드홀 중앙을 한 번 터치하세요');
  };

  const handleCalibrationTap = async (locationX: number, locationY: number) => {
    if (size.width <= 0 || size.height <= 0 || cameraFocus !== 'right-hand') return;
    const point = {
      x: clamp(locationX / size.width, 0, 1),
      y: clamp(locationY / size.height, 0, 1),
    };
    if (calibrationStep === 'soundhole') {
      setSoundholePoint(point);
      setCalibrationStep('bridge');
      updateStatus('이제 브리지 중앙을 한 번 터치하세요');
      return;
    }
    if (calibrationStep === 'bridge' && soundholePoint) {
      const nextRegion = deriveRightHandRegion(soundholePoint, point);
      setBridgePoint(point);
      setRegion(nextRegion);
      setCalibrationStep('ready');
      await AsyncStorage.setItem(`${ROI_STORAGE_PREFIX}:${facing}`, JSON.stringify(nextRegion));
      updateStatus('오른손 영역 저장 완료 · 손 전체를 사운드홀 위에 보여주세요');
    }
  };

  const requestOrSettings = async () => {
    if (permission?.canAskAgain !== false) await requestPermission();
    else await Linking.openSettings();
  };

  if (!permission) {
    return <View style={styles.center}><ActivityIndicator /><Text style={styles.centerText}>카메라 권한 확인 중</Text></View>;
  }
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionTitle}>카메라 권한이 필요합니다</Text>
        <Text style={styles.centerText}>영상은 휴대폰 안에서 관절·궤적 분석에만 사용합니다.</Text>
        <Pressable onPress={() => void requestOrSettings()} style={styles.permissionButton}>
          <Text style={styles.permissionButtonText}>{permission.canAskAgain === false ? '휴대폰 설정 열기' : '카메라 허용'}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View
      style={styles.root}
      onLayout={(event: LayoutChangeEvent) => setSize({
        width: event.nativeEvent.layout.width,
        height: event.nativeEvent.layout.height,
      })}
    >
      <CameraView
        key={`${cameraKey}-${facing}-${cameraFocus}`}
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        mirror={facing === 'front'}
        mode="picture"
        animateShutter={false}
        onCameraReady={() => {
          readyAtRef.current = Date.now();
          failureRef.current = 0;
          setCameraReady(true);
          setCameraError('');
          setAnalysisError('');
          updateStatus(cameraFocus === 'right-hand' && calibrationStep !== 'ready'
            ? '카메라 연결 완료 · 사운드홀 중앙을 터치하세요'
            : '카메라 연결 완료 · AI 안정화 중');
        }}
        onMountError={(event) => {
          setCameraReady(false);
          setCameraError(event.message || '카메라 영상을 열지 못했습니다.');
        }}
      />

      {cameraFocus === 'full-body'
        ? <PoseOverlay result={poseResult} size={size} />
        : <HandOverlay result={locked ? handResult : null} size={size} />}

      {region && cameraFocus !== 'full-body' ? (
        <View
          pointerEvents="none"
          style={[
            styles.roi,
            {
              left: region.left * size.width,
              top: region.top * size.height,
              width: (region.right - region.left) * size.width,
              height: (region.bottom - region.top) * size.height,
            },
          ]}
        >
          <Text style={styles.roiLabel}>{cameraFocus === 'right-hand' ? '실제 AI 입력 영역' : '왼손 분석 영역'}</Text>
        </View>
      ) : null}

      {soundholePoint ? (
        <View pointerEvents="none" style={[styles.calibrationDot, { left: soundholePoint.x * size.width - 9, top: soundholePoint.y * size.height - 9 }]}>
          <Text style={styles.calibrationDotText}>S</Text>
        </View>
      ) : null}
      {bridgePoint ? (
        <View pointerEvents="none" style={[styles.calibrationDot, styles.bridgeDot, { left: bridgePoint.x * size.width - 9, top: bridgePoint.y * size.height - 9 }]}>
          <Text style={styles.calibrationDotText}>B</Text>
        </View>
      ) : null}

      {cameraFocus === 'right-hand' && (calibrationStep === 'soundhole' || calibrationStep === 'bridge') ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={calibrationStep === 'soundhole' ? '사운드홀 위치 지정' : '브리지 위치 지정'}
          onPress={(event) => void handleCalibrationTap(event.nativeEvent.locationX, event.nativeEvent.locationY)}
          style={styles.calibrationTouchLayer}
        >
          <View pointerEvents="none" style={styles.calibrationPrompt}>
            <Text style={styles.calibrationPromptTitle}>{calibrationStep === 'soundhole' ? '① 사운드홀 중앙 터치' : '② 브리지 중앙 터치'}</Text>
            <Text style={styles.calibrationPromptText}>이 두 지점으로만 오른손 AI 입력 화면을 자릅니다.</Text>
          </View>
        </Pressable>
      ) : null}

      <View pointerEvents="none" style={styles.badgeRow}>
        <Text style={[styles.badge, cameraReady && styles.badgeReady]}>{cameraReady ? '영상 ON' : '영상 연결 중'}</Text>
        <Text style={[styles.badge, locked && styles.badgeLocked]}>{locked ? `오른손 잠금 ${consecutive}/5` : `판정 대기 ${consecutive}/5`}</Text>
        <Text style={[styles.badge, coachingActive && locked && styles.badgeCoach]}>{coachingActive && locked ? '피드백 준비' : '피드백 금지'}</Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="카메라 전환"
        onPress={() => remount(facing === 'front' ? 'back' : 'front')}
        style={styles.switchButton}
      >
        <Text style={styles.switchText}>전환</Text>
      </Pressable>

      {cameraFocus === 'right-hand' ? (
        <Pressable onPress={() => void resetCalibration()} style={styles.resetButton}>
          <Text style={styles.resetText}>영역 다시 맞춤</Text>
        </Pressable>
      ) : null}

      <View pointerEvents="none" style={styles.statusBox}>
        <Text style={styles.statusText} numberOfLines={2}>{cameraError || status}</Text>
        {analysisError && !cameraError ? <Text style={styles.analysisText} numberOfLines={2}>{analysisError}</Text> : null}
      </View>

      {cameraError ? (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorTitle}>카메라 영상을 열지 못했습니다</Text>
          <Text style={styles.errorText}>{cameraError}</Text>
          <View style={styles.errorRow}>
            <Pressable onPress={() => remount()} style={styles.retryButton}><Text style={styles.retryText}>다시 연결</Text></Pressable>
            <Pressable onPress={() => void Linking.openSettings()} style={styles.settingsButton}><Text style={styles.settingsText}>휴대폰 설정</Text></Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: '#000000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#11161d', padding: 20 },
  centerText: { color: '#b1bac4', fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 9 },
  permissionTitle: { color: '#f0f6fc', fontSize: 16, fontWeight: '900' },
  permissionButton: { minHeight: 43, borderRadius: 11, backgroundColor: '#1f6feb', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 15 },
  permissionButtonText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  roi: { position: 'absolute', borderWidth: 3, borderStyle: 'dashed', borderColor: 'rgba(126,231,135,0.98)', borderRadius: 18 },
  roiLabel: { alignSelf: 'flex-start', color: '#ffffff', backgroundColor: 'rgba(13,17,23,0.90)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, fontSize: 9, fontWeight: '900', overflow: 'hidden' },
  calibrationTouchLayer: { ...StyleSheet.absoluteFillObject, zIndex: 12, alignItems: 'center', justifyContent: 'center' },
  calibrationPrompt: { maxWidth: '82%', borderRadius: 16, backgroundColor: 'rgba(13,17,23,0.93)', borderWidth: 2, borderColor: '#f2cc60', paddingHorizontal: 16, paddingVertical: 13, alignItems: 'center' },
  calibrationPromptTitle: { color: '#f2cc60', fontSize: 15, fontWeight: '900' },
  calibrationPromptText: { color: '#ffffff', fontSize: 9, lineHeight: 14, textAlign: 'center', marginTop: 5 },
  calibrationDot: { position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: '#1f6feb', borderWidth: 2, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center', zIndex: 18 },
  bridgeDot: { backgroundColor: '#da3633' },
  calibrationDotText: { color: '#ffffff', fontSize: 7, fontWeight: '900' },
  badgeRow: { position: 'absolute', left: 10, top: 10, right: 144, flexDirection: 'row', flexWrap: 'wrap', gap: 5, zIndex: 20 },
  badge: { color: '#f2cc60', backgroundColor: 'rgba(13,17,23,0.88)', borderRadius: 9, paddingHorizontal: 7, paddingVertical: 5, fontSize: 7, fontWeight: '900', overflow: 'hidden' },
  badgeReady: { color: '#7ee787' },
  badgeLocked: { color: '#79c0ff' },
  badgeCoach: { color: '#7ee787' },
  switchButton: { position: 'absolute', right: 10, top: 10, minWidth: 58, minHeight: 40, borderRadius: 11, backgroundColor: 'rgba(13,17,23,0.94)', borderWidth: 1, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center', zIndex: 30 },
  switchText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  resetButton: { position: 'absolute', right: 10, top: 58, minWidth: 94, minHeight: 34, borderRadius: 10, backgroundColor: 'rgba(13,17,23,0.94)', borderWidth: 1, borderColor: '#f2cc60', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, zIndex: 30 },
  resetText: { color: '#f2cc60', fontSize: 8, fontWeight: '900' },
  statusBox: { position: 'absolute', left: 10, right: 10, bottom: 10, backgroundColor: 'rgba(13,17,23,0.90)', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 7, zIndex: 22 },
  statusText: { color: '#ffffff', fontSize: 8, lineHeight: 12 },
  analysisText: { color: '#f2cc60', fontSize: 7, lineHeight: 11, marginTop: 2 },
  handLine: { position: 'absolute', height: 3, backgroundColor: 'rgba(126,231,135,0.98)', borderRadius: 2 },
  handDot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#7ee787', borderWidth: 1, borderColor: '#ffffff' },
  wristDot: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#58a6ff', borderWidth: 2, borderColor: '#ffffff' },
  pickMarker: { position: 'absolute', width: 28, height: 28, borderWidth: 2, borderColor: '#f2cc60', borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  pickAxis: { width: 24, height: 2, backgroundColor: '#f2cc60' },
  poseLine: { position: 'absolute', height: 3, backgroundColor: 'rgba(88,166,255,0.90)', borderRadius: 2 },
  poseDot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#58a6ff', borderWidth: 1, borderColor: '#ffffff' },
  errorOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 50, backgroundColor: 'rgba(13,17,23,0.96)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  errorTitle: { color: '#ffb4ad', fontSize: 15, fontWeight: '900', textAlign: 'center' },
  errorText: { color: '#f0f6fc', fontSize: 9, lineHeight: 15, textAlign: 'center', marginTop: 7 },
  errorRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  retryButton: { minHeight: 42, borderRadius: 11, backgroundColor: '#2ea043', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15 },
  retryText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  settingsButton: { minHeight: 42, borderRadius: 11, backgroundColor: '#21262d', borderWidth: 1, borderColor: '#6e7681', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15 },
  settingsText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
});
