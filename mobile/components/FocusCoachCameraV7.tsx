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
  imagePointToPreview,
  previewRegionToImage,
  type PixelSize,
} from '../services/camera-preview-transform';
import {
  ConsecutiveHandGate,
  deriveRightHandRegion,
  type NormalizedPoint,
  type NormalizedRegion,
  validateHandInRegion,
} from '../services/right-hand-roi';
import type { MotionSample } from '../services/trajectory-speed-engine';

type Size = { width: number; height: number };
type CalibrationStep = 'soundhole' | 'bridge' | 'confirm';

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
const LEFT_HAND_REGION: NormalizedRegion = { left: 0.02, top: 0.14, right: 0.86, bottom: 0.96 };
const ROI_KEY_PREFIX = 'guitar-coach:right-hand-roi:focus-v7';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const distance = (left: NormalizedPoint, right: NormalizedPoint) => Math.hypot(left.x - right.x, left.y - right.y);

function roiKey(facing: CameraType) {
  return `${ROI_KEY_PREFIX}:${facing}`;
}

export async function loadFocusV7RightHandRegion(facing: CameraType = 'back') {
  const raw = await AsyncStorage.getItem(roiKey(facing));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as NormalizedRegion;
    const values = [parsed.left, parsed.top, parsed.right, parsed.bottom];
    if (!values.every(Number.isFinite)) return null;
    if (parsed.left < 0 || parsed.top < 0 || parsed.right > 1 || parsed.bottom > 1) return null;
    if (parsed.right - parsed.left < 0.25 || parsed.bottom - parsed.top < 0.25) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearFocusV7RightHandRegion(facing: CameraType = 'back') {
  await AsyncStorage.removeItem(roiKey(facing));
}

function pickColor(category: PracticeCategoryId, cameraFocus: PracticePreset['cameraFocus']): PickColor {
  if (cameraFocus !== 'right-hand') return 'none';
  return category === 'arpeggio' || category === 'fingerstyle' ? 'none' : 'auto';
}

function toMotionSample(result: HandAnalysisResult, capturedAt: number): MotionSample | null {
  const points = new Map(result.landmarks.map((point) => [point.name, point]));
  const wrist = points.get('wrist');
  const middleMcp = points.get('middleMcp');
  const thumb = points.get('thumbTip');
  const index = points.get('indexTip');
  const middle = points.get('middleTip');
  const ring = points.get('ringTip');
  if (!wrist || !middleMcp || !thumb || !index || !middle || !ring) return null;
  const palmSize = distance(wrist, middleMcp);
  return {
    capturedAt,
    handConfidence: result.handednessScore,
    wristConfidence: clamp(result.handednessScore * Math.min(1, palmSize / 0.08), 0, 1),
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

function remapHandResultToPreview(
  result: HandAnalysisResult,
  previewSize: Size,
  imageSize: PixelSize,
): HandAnalysisResult {
  if (previewSize.width <= 0 || previewSize.height <= 0) return result;
  const safeImageSize = {
    width: Math.max(1, imageSize.width),
    height: Math.max(1, imageSize.height),
  };
  const landmarks = result.landmarks.map((point) => {
    const mapped = imagePointToPreview(point, previewSize, safeImageSize);
    return { ...point, x: mapped.x, y: mapped.y };
  });
  const pick = result.pick.detected
    ? (() => {
        const mapped = imagePointToPreview(
          { x: result.pick.centerX, y: result.pick.centerY },
          previewSize,
          safeImageSize,
        );
        return { ...result.pick, centerX: mapped.x, centerY: mapped.y };
      })()
    : result.pick;
  return { ...result, landmarks, pick };
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
    </View>
  );
}

function PermissionSurface({
  permission,
  requestPermission,
}: {
  permission: ReturnType<typeof useCameraPermissions>[0];
  requestPermission: ReturnType<typeof useCameraPermissions>[1];
}) {
  if (!permission) {
    return (
      <View style={styles.permissionSurface}>
        <ActivityIndicator />
        <Text style={styles.permissionText}>카메라 권한 확인 중</Text>
      </View>
    );
  }
  if (permission.granted) return null;
  const open = async () => {
    if (permission.canAskAgain === false) await Linking.openSettings();
    else await requestPermission();
  };
  return (
    <View style={styles.permissionSurface}>
      <Text style={styles.permissionTitle}>카메라 권한이 필요합니다</Text>
      <Text style={styles.permissionText}>오른손과 기타 위치를 휴대폰 안에서만 분석합니다.</Text>
      <Pressable onPress={() => void open()} style={styles.permissionButton}>
        <Text style={styles.permissionButtonText}>{permission.canAskAgain === false ? '휴대폰 설정 열기' : '카메라 허용'}</Text>
      </Pressable>
    </View>
  );
}

export function RightHandCalibrationV7({
  initialFacing = 'back',
  onSaved,
  onCancel,
}: {
  initialFacing?: CameraType;
  onSaved: (facing: CameraType, region: NormalizedRegion) => void;
  onCancel: () => void;
}) {
  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>(initialFacing);
  const [cameraKey, setCameraKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [step, setStep] = useState<CalibrationStep>('soundhole');
  const [soundhole, setSoundhole] = useState<NormalizedPoint | null>(null);
  const [bridge, setBridge] = useState<NormalizedPoint | null>(null);
  const [region, setRegion] = useState<NormalizedRegion | null>(null);

  const resetPoints = () => {
    setStep('soundhole');
    setSoundhole(null);
    setBridge(null);
    setRegion(null);
  };

  const switchCamera = () => {
    setFacing((current) => current === 'front' ? 'back' : 'front');
    setReady(false);
    setError('');
    setCameraKey((value) => value + 1);
    resetPoints();
  };

  const handleTap = (locationX: number, locationY: number) => {
    if (!ready || size.width <= 0 || size.height <= 0 || step === 'confirm') return;
    const point = {
      x: clamp(locationX / size.width, 0, 1),
      y: clamp(locationY / size.height, 0, 1),
    };
    if (step === 'soundhole') {
      setSoundhole(point);
      setStep('bridge');
      return;
    }
    if (soundhole) {
      const next = deriveRightHandRegion(soundhole, point);
      setBridge(point);
      setRegion(next);
      setStep('confirm');
    }
  };

  const save = async () => {
    if (!region) return;
    await AsyncStorage.setItem(roiKey(facing), JSON.stringify(region));
    onSaved(facing, region);
  };

  if (!permission?.granted) {
    return (
      <View style={styles.calibrationRoot}>
        <PermissionSurface permission={permission} requestPermission={requestPermission} />
        <Pressable onPress={onCancel} style={styles.calibrationClose}><Text style={styles.calibrationCloseText}>닫기</Text></Pressable>
      </View>
    );
  }

  return (
    <View
      style={styles.calibrationRoot}
      onLayout={(event: LayoutChangeEvent) => setSize({
        width: event.nativeEvent.layout.width,
        height: event.nativeEvent.layout.height,
      })}
    >
      <CameraView
        key={`focus-v7-calibration-${cameraKey}-${facing}`}
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        mirror={facing === 'front'}
        mode="picture"
        animateShutter={false}
        onCameraReady={() => {
          setReady(true);
          setError('');
        }}
        onMountError={(event) => {
          setReady(false);
          setError(event.message || '카메라를 열지 못했습니다.');
        }}
      />

      {region ? (
        <View pointerEvents="none" style={[
          styles.calibrationRegion,
          {
            left: region.left * size.width,
            top: region.top * size.height,
            width: (region.right - region.left) * size.width,
            height: (region.bottom - region.top) * size.height,
          },
        ]}>
          <Text style={styles.calibrationRegionLabel}>오른손 AI가 보는 영역</Text>
        </View>
      ) : null}

      {soundhole ? (
        <View pointerEvents="none" style={[styles.anchorDot, { left: soundhole.x * size.width - 14, top: soundhole.y * size.height - 14 }]}>
          <Text style={styles.anchorText}>S</Text>
        </View>
      ) : null}
      {bridge ? (
        <View pointerEvents="none" style={[styles.anchorDot, styles.bridgeAnchor, { left: bridge.x * size.width - 14, top: bridge.y * size.height - 14 }]}>
          <Text style={styles.anchorText}>B</Text>
        </View>
      ) : null}

      {step !== 'confirm' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={step === 'soundhole' ? '사운드홀 중앙 지정' : '브리지 중앙 지정'}
          onPress={(event) => handleTap(event.nativeEvent.locationX, event.nativeEvent.locationY)}
          style={styles.calibrationTouch}
        />
      ) : null}

      <View pointerEvents="none" style={styles.calibrationHeader}>
        <Text style={styles.calibrationBuild}>FOCUS V9 · v24 수동 보정</Text>
        <Text style={styles.calibrationTitle}>
          {step === 'soundhole' ? '1. 사운드홀 중앙을 터치하세요' : step === 'bridge' ? '2. 브리지 중앙을 터치하세요' : '3. 초록 영역을 확인하세요'}
        </Text>
        <Text style={styles.calibrationHelp}>
          {step === 'confirm'
            ? '얼굴과 가슴이 초록 영역에 들어오지 않고, 오른손의 시작·복귀 경로가 들어오면 됩니다.'
            : '화면 전체를 분석하지 않습니다. 지정한 기타 구역만 실제로 잘라서 손 AI에 넣습니다.'}
        </Text>
      </View>

      <Pressable onPress={onCancel} style={styles.calibrationClose}><Text style={styles.calibrationCloseText}>닫기</Text></Pressable>
      <Pressable onPress={switchCamera} style={styles.calibrationSwitch}><Text style={styles.calibrationSwitchText}>전후면 전환</Text></Pressable>

      {step === 'confirm' ? (
        <View style={styles.calibrationActions}>
          <Pressable onPress={resetPoints} style={styles.secondaryAction}><Text style={styles.secondaryActionText}>다시 지정</Text></Pressable>
          <Pressable onPress={() => void save()} style={styles.primaryAction}><Text style={styles.primaryActionText}>저장하고 연습 화면 열기</Text></Pressable>
        </View>
      ) : null}

      {error ? (
        <View style={styles.cameraErrorOverlay}>
          <Text style={styles.cameraErrorTitle}>카메라 연결 실패</Text>
          <Text style={styles.cameraErrorText}>{error}</Text>
          <Pressable onPress={() => {
            setReady(false);
            setError('');
            setCameraKey((value) => value + 1);
          }} style={styles.retryButton}><Text style={styles.retryButtonText}>다시 연결</Text></Pressable>
        </View>
      ) : null}
    </View>
  );
}

export default function FocusCoachCameraV7({
  coachingActive,
  category,
  cameraFocus,
  initialFacing = cameraFocus === 'full-body' ? 'front' : 'back',
  onNeedCalibration,
  onMotionSample,
  onAcceptedFrame,
  onFrameCount,
  onStatus,
  onHandLockChange,
}: {
  coachingActive: boolean;
  category: PracticeCategoryId;
  cameraFocus: PracticePreset['cameraFocus'];
  initialFacing?: CameraType;
  onNeedCalibration?: (facing: CameraType) => void;
  onMotionSample?: (sample: MotionSample) => void;
  onAcceptedFrame?: () => void;
  onFrameCount?: (count: number) => void;
  onStatus?: (status: string) => void;
  onHandLockChange?: (locked: boolean) => void;
}) {
  const cameraRef = useRef<CameraView | null>(null);
  const captureBusyRef = useRef(false);
  const readyAtRef = useRef(0);
  const frameRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);
  const gateRef = useRef(new ConsecutiveHandGate(5, 0.17));
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>(initialFacing);
  const [cameraKey, setCameraKey] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [analysisError, setAnalysisError] = useState('');
  const [status, setStatus] = useState('카메라 연결 중');
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [region, setRegion] = useState<NormalizedRegion | null>(cameraFocus === 'left-hand' ? LEFT_HAND_REGION : null);
  const [handResult, setHandResult] = useState<HandAnalysisResult | null>(null);
  const [poseResult, setPoseResult] = useState<PoseAnalysisResult | null>(null);
  const [locked, setLocked] = useState(false);
  const [consecutive, setConsecutive] = useState(0);

  const updateStatus = (next: string) => {
    setStatus(next);
    onStatus?.(next);
  };

  const setLock = (next: boolean) => {
    setLocked(next);
    onHandLockChange?.(next);
  };

  const resetTracking = () => {
    gateRef.current.reset();
    frameRef.current = 0;
    setConsecutive(0);
    setLock(false);
    setHandResult(null);
    setPoseResult(null);
    setAnalysisError('');
  };

  useEffect(() => {
    let cancelled = false;
    resetTracking();
    if (cameraFocus === 'left-hand') {
      setRegion(LEFT_HAND_REGION);
      return;
    }
    if (cameraFocus === 'full-body' || cameraFocus === 'none') {
      setRegion(null);
      return;
    }
    setRegion(null);
    void loadFocusV7RightHandRegion(facing).then((stored) => {
      if (cancelled) return;
      if (!stored) {
        updateStatus('기타 위치 자동 인식 또는 수동 보정이 필요합니다.');
        onNeedCalibration?.(facing);
        return;
      }
      setRegion(stored);
      updateStatus('오른손 분석 영역 준비 완료');
    });
    return () => { cancelled = true; };
  }, [cameraFocus, facing]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      const previous = appStateRef.current;
      appStateRef.current = next;
      if (previous === 'active' || next !== 'active' || !permission?.granted) return;
      setCameraReady(false);
      setCameraError('');
      resetTracking();
      setCameraKey((value) => value + 1);
    });
    return () => subscription.remove();
  }, [permission?.granted]);

  useEffect(() => {
    if (!permission?.granted || !cameraReady || cameraError || cameraFocus === 'none') return;
    if (cameraFocus === 'right-hand' && !region) return;
    if (cameraFocus === 'full-body' && !isLiveCoachNativeAvailable) {
      setAnalysisError('자세 AI 모듈을 사용할 수 없습니다. 영상은 유지합니다.');
      return;
    }
    if (cameraFocus !== 'full-body' && !HandModule?.androidHandCoachAvailable) {
      setAnalysisError('손 관절 AI 모듈을 사용할 수 없습니다. 영상은 유지합니다.');
      return;
    }
    if (cameraFocus === 'right-hand' && (!HandModule?.androidHandRegionAnalysisAvailable || !HandModule.analyzeHandInRegionAsync)) {
      setAnalysisError('ROI 손 분석 모듈이 없습니다. 전체 화면 분석으로 대체하지 않습니다.');
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const interval = cameraFocus === 'full-body' ? 760 : 680;
    const schedule = (delay: number) => {
      if (!cancelled) timer = setTimeout(capture, delay);
    };

    const capture = async () => {
      if (cancelled || captureBusyRef.current || !cameraRef.current) {
        schedule(180);
        return;
      }
      const readyAge = Date.now() - readyAtRef.current;
      if (readyAge < 900) {
        schedule(900 - readyAge);
        return;
      }
      captureBusyRef.current = true;
      const startedAt = Date.now();
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: cameraFocus === 'full-body' ? 0.40 : 0.68,
          shutterSound: false,
          mirror: facing === 'front',
          skipProcessing: false,
        });
        if (!photo?.uri) throw new Error('분석 프레임을 가져오지 못했습니다.');
        const capturedAt = Date.now();
        frameRef.current += 1;
        onFrameCount?.(frameRef.current);

        if (cameraFocus === 'full-body') {
          const result = await analyzePoseAsync(photo.uri);
          if (!cancelled) {
            setPoseResult(result.hasPerson ? result : null);
            setLock(result.hasPerson);
            if (result.hasPerson) {
              onAcceptedFrame?.();
              updateStatus(coachingActive ? '상체 관절 추적 중' : '상체 관절만 추적 중 · 아직 자세 평가 안 함');
              if (coachingActive) publishLiveAnalysisFrame({ kind: 'pose', capturedAt, result });
            } else {
              updateStatus('상체 관절을 찾는 중 · 아직 판정 안 함');
            }
          }
        } else {
          const activeRegion = cameraFocus === 'right-hand' ? region : LEFT_HAND_REGION;
          if (!activeRegion) throw new Error('손 분석 영역이 없습니다.');
          if (size.width <= 0 || size.height <= 0) throw new Error('카메라 미리보기 크기를 확인하지 못했습니다.');
          const photoSize: PixelSize = {
            width: Math.max(1, Number(photo.width) || size.width),
            height: Math.max(1, Number(photo.height) || size.height),
          };
          let rawResult: HandAnalysisResult;
          if (cameraFocus === 'right-hand') {
            const photoRegion = previewRegionToImage(activeRegion, size, photoSize, 0.025);
            rawResult = await HandModule!.analyzeHandInRegionAsync!(
              photo.uri,
              pickColor(category, cameraFocus),
              photoRegion.left,
              photoRegion.top,
              photoRegion.right,
              photoRegion.bottom,
            );
          } else {
            rawResult = await HandModule!.analyzeHandAsync(photo.uri, 'none');
          }
          const result = remapHandResultToPreview(
            rawResult,
            size,
            {
              width: Math.max(1, rawResult.imageWidth || photoSize.width),
              height: Math.max(1, rawResult.imageHeight || photoSize.height),
            },
          );
          const checked = validateHandInRegion(result.landmarks, activeRegion);
          const gate = gateRef.current.add(checked);
          if (!cancelled) {
            setConsecutive(gate.consecutive);
            setLock(gate.locked);
            if (!result.hasHand) {
              setHandResult(null);
              updateStatus('지정된 기타 구역에서 손을 찾는 중 · 아직 판정 안 함');
            } else if (!checked.valid) {
              setHandResult(null);
              updateStatus('손 전체를 초록 분석 영역 안에 맞추세요 · 아직 판정 안 함');
            } else if (!gate.locked) {
              setHandResult(null);
              updateStatus(`같은 손 연속 확인 ${gate.consecutive}/${gate.required} · 아직 판정 안 함`);
            } else {
              setHandResult(result);
              onAcceptedFrame?.();
              const sample = toMotionSample(result, capturedAt);
              if (sample) onMotionSample?.(sample);
              updateStatus(coachingActive ? '오른손 잠금 완료 · 궤적 비교 중' : '오른손 잠금 완료 · 관절만 추적 중');
              if (coachingActive) publishLiveAnalysisFrame({ kind: 'hand', capturedAt, result });
            }
          }
        }
        if (!cancelled) setAnalysisError('');
      } catch (caught) {
        if (!cancelled) {
          setAnalysisError(caught instanceof Error ? caught.message : 'AI 분석 오류');
          updateStatus('카메라 영상 유지 · AI 분석만 다시 시도 중');
        }
      } finally {
        captureBusyRef.current = false;
      }
      schedule(Math.max(200, interval - (Date.now() - startedAt)));
    };

    schedule(900);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      captureBusyRef.current = false;
    };
  }, [cameraError, cameraFocus, cameraReady, category, coachingActive, facing, permission?.granted, region, size.height, size.width]);

  const switchCamera = () => {
    const next: CameraType = facing === 'front' ? 'back' : 'front';
    setFacing(next);
    setCameraReady(false);
    setCameraError('');
    resetTracking();
    setCameraKey((value) => value + 1);
  };

  if (!permission?.granted) {
    return <PermissionSurface permission={permission} requestPermission={requestPermission} />;
  }

  return (
    <View
      style={styles.trackingRoot}
      onLayout={(event: LayoutChangeEvent) => setSize({
        width: event.nativeEvent.layout.width,
        height: event.nativeEvent.layout.height,
      })}
    >
      <CameraView
        key={`focus-v7-tracking-${cameraKey}-${facing}-${cameraFocus}`}
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        mirror={facing === 'front'}
        mode="picture"
        animateShutter={false}
        onCameraReady={() => {
          readyAtRef.current = Date.now();
          setCameraReady(true);
          setCameraError('');
          updateStatus(region || cameraFocus !== 'right-hand' ? '카메라 연결 완료 · AI 안정화 중' : '촬영 보정 필요');
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
        <View pointerEvents="none" style={[
          styles.trackingRegion,
          {
            left: region.left * size.width,
            top: region.top * size.height,
            width: (region.right - region.left) * size.width,
            height: (region.bottom - region.top) * size.height,
          },
        ]}>
          <Text style={styles.trackingRegionLabel}>{cameraFocus === 'right-hand' ? '오른손 AI 입력' : '왼손 분석 영역'}</Text>
        </View>
      ) : null}

      <View pointerEvents="none" style={styles.trackingBadges}>
        <Text style={[styles.trackingBadge, cameraReady && styles.trackingBadgeReady]}>{cameraReady ? '영상 ON' : '영상 연결 중'}</Text>
        <Text style={[styles.trackingBadge, locked && styles.trackingBadgeLocked]}>{locked ? '손 잠금 완료' : `판정 대기 ${consecutive}/5`}</Text>
      </View>

      <Pressable onPress={switchCamera} style={styles.trackingSwitch}>
        <Text style={styles.trackingSwitchText}>전후면 전환</Text>
      </Pressable>

      {cameraFocus === 'right-hand' ? (
        <Pressable onPress={() => onNeedCalibration?.(facing)} style={styles.trackingRecalibrate}>
          <Text style={styles.trackingRecalibrateText}>촬영 위치 다시 맞추기</Text>
        </Pressable>
      ) : null}

      <View pointerEvents="none" style={styles.trackingStatus}>
        <Text style={styles.trackingStatusText}>{status}</Text>
        {analysisError ? <Text style={styles.trackingAnalysisError}>AI: {analysisError}</Text> : null}
      </View>

      {cameraError ? (
        <View style={styles.cameraErrorOverlay}>
          <Text style={styles.cameraErrorTitle}>카메라 연결 실패</Text>
          <Text style={styles.cameraErrorText}>{cameraError}</Text>
          <Pressable onPress={() => {
            setCameraReady(false);
            setCameraError('');
            resetTracking();
            setCameraKey((value) => value + 1);
          }} style={styles.retryButton}><Text style={styles.retryButtonText}>다시 연결</Text></Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  permissionSurface: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0d1117', padding: 24 },
  permissionTitle: { color: '#ffffff', fontSize: 20, fontWeight: '900', textAlign: 'center' },
  permissionText: { color: '#b1bac4', fontSize: 12, lineHeight: 19, textAlign: 'center', marginTop: 8 },
  permissionButton: { minHeight: 50, borderRadius: 14, backgroundColor: '#238636', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, marginTop: 18 },
  permissionButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },

  calibrationRoot: { flex: 1, backgroundColor: '#000000', overflow: 'hidden' },
  calibrationHeader: { position: 'absolute', left: 12, right: 12, top: 58, borderRadius: 18, backgroundColor: 'rgba(13,17,23,0.94)', borderWidth: 2, borderColor: '#f2cc60', padding: 15, alignItems: 'center', zIndex: 30 },
  calibrationBuild: { color: '#7ee787', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  calibrationTitle: { color: '#ffffff', fontSize: 20, lineHeight: 27, fontWeight: '900', textAlign: 'center', marginTop: 5 },
  calibrationHelp: { color: '#d8dee4', fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 7 },
  calibrationTouch: { ...StyleSheet.absoluteFillObject, zIndex: 20 },
  calibrationClose: { position: 'absolute', left: 12, top: 10, minWidth: 64, minHeight: 42, borderRadius: 12, backgroundColor: 'rgba(13,17,23,0.94)', borderWidth: 1, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  calibrationCloseText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  calibrationSwitch: { position: 'absolute', right: 12, top: 10, minWidth: 105, minHeight: 42, borderRadius: 12, backgroundColor: 'rgba(13,17,23,0.94)', borderWidth: 1, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  calibrationSwitchText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  calibrationRegion: { position: 'absolute', borderWidth: 4, borderColor: '#7ee787', borderRadius: 20, backgroundColor: 'rgba(46,160,67,0.08)', zIndex: 18 },
  calibrationRegionLabel: { alignSelf: 'flex-start', color: '#ffffff', backgroundColor: 'rgba(13,17,23,0.92)', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6, fontSize: 10, fontWeight: '900', overflow: 'hidden' },
  anchorDot: { position: 'absolute', width: 28, height: 28, borderRadius: 14, backgroundColor: '#1f6feb', borderWidth: 3, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center', zIndex: 40 },
  bridgeAnchor: { backgroundColor: '#da3633' },
  anchorText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  calibrationActions: { position: 'absolute', left: 12, right: 12, bottom: 30, flexDirection: 'row', gap: 9, zIndex: 50 },
  secondaryAction: { minWidth: 105, minHeight: 54, borderRadius: 15, borderWidth: 1, borderColor: '#ffffff', backgroundColor: 'rgba(13,17,23,0.94)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  secondaryActionText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  primaryAction: { flex: 1, minHeight: 54, borderRadius: 15, backgroundColor: '#238636', borderWidth: 1, borderColor: '#7ee787', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  primaryActionText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },

  trackingRoot: { flex: 1, backgroundColor: '#000000', overflow: 'hidden' },
  trackingRegion: { position: 'absolute', borderWidth: 3, borderStyle: 'dashed', borderColor: 'rgba(126,231,135,0.98)', borderRadius: 18, backgroundColor: 'rgba(46,160,67,0.04)' },
  trackingRegionLabel: { alignSelf: 'flex-start', color: '#ffffff', backgroundColor: 'rgba(13,17,23,0.90)', borderRadius: 7, paddingHorizontal: 7, paddingVertical: 5, fontSize: 8, fontWeight: '900', overflow: 'hidden' },
  trackingBadges: { position: 'absolute', left: 10, top: 10, right: 125, flexDirection: 'row', flexWrap: 'wrap', gap: 5, zIndex: 20 },
  trackingBadge: { color: '#f2cc60', backgroundColor: 'rgba(13,17,23,0.90)', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 5, fontSize: 8, fontWeight: '900', overflow: 'hidden' },
  trackingBadgeReady: { color: '#7ee787' },
  trackingBadgeLocked: { color: '#79c0ff' },
  trackingSwitch: { position: 'absolute', right: 10, top: 10, minWidth: 104, minHeight: 42, borderRadius: 12, backgroundColor: 'rgba(13,17,23,0.94)', borderWidth: 1, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center', zIndex: 30 },
  trackingSwitchText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  trackingRecalibrate: { position: 'absolute', right: 10, top: 59, minWidth: 132, minHeight: 36, borderRadius: 10, backgroundColor: 'rgba(13,17,23,0.94)', borderWidth: 1, borderColor: '#f2cc60', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9, zIndex: 30 },
  trackingRecalibrateText: { color: '#f2cc60', fontSize: 9, fontWeight: '900' },
  trackingStatus: { position: 'absolute', left: 10, right: 10, bottom: 10, borderRadius: 11, backgroundColor: 'rgba(13,17,23,0.91)', paddingHorizontal: 10, paddingVertical: 8, zIndex: 24 },
  trackingStatusText: { color: '#ffffff', fontSize: 10, lineHeight: 14, fontWeight: '800' },
  trackingAnalysisError: { color: '#f2cc60', fontSize: 8, lineHeight: 12, marginTop: 2 },
  handLine: { position: 'absolute', height: 3, backgroundColor: 'rgba(126,231,135,0.98)', borderRadius: 2 },
  handDot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#7ee787', borderWidth: 1, borderColor: '#ffffff' },
  wristDot: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#58a6ff', borderWidth: 2, borderColor: '#ffffff' },
  poseLine: { position: 'absolute', height: 3, backgroundColor: 'rgba(88,166,255,0.92)', borderRadius: 2 },

  cameraErrorOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(13,17,23,0.97)', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 80 },
  cameraErrorTitle: { color: '#ffb4ad', fontSize: 19, fontWeight: '900', textAlign: 'center' },
  cameraErrorText: { color: '#ffffff', fontSize: 11, lineHeight: 18, textAlign: 'center', marginTop: 8 },
  retryButton: { minHeight: 48, borderRadius: 13, backgroundColor: '#238636', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, marginTop: 16 },
  retryButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
});
