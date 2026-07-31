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
import type {
  GuitarStringTrackingResult,
  HandAnalysisResult,
  PickColor,
} from '../modules/guitar-coach-hand';
import {
  analyzePoseAsync,
  isLiveCoachNativeAvailable,
  type PoseAnalysisResult,
  type PoseLandmarkPoint,
} from '../modules/guitar-coach-native';
import { publishLiveAnalysisFrame } from '../services/analysis-stream';
import type { MotionSample } from '../services/trajectory-speed-engine';

type Size = { width: number; height: number };
type Region = { left: number; top: number; right: number; bottom: number };

type NativeHandModule = {
  androidHandCoachAvailable: boolean;
  analyzeHandAsync(uri: string, pickColor: PickColor): Promise<HandAnalysisResult>;
};

type NativeStringVisionModule = {
  androidStringVisionAvailable: boolean;
  androidAdaptiveStringRegionAvailable?: boolean;
  analyzeStringsAsync(uri: string): Promise<GuitarStringTrackingResult>;
  analyzeStringsInRegionAsync?: (
    uri: string,
    left: number,
    top: number,
    right: number,
    bottom: number,
    focusX: number,
    focusY: number,
  ) => Promise<GuitarStringTrackingResult>;
};

const HandModule = requireOptionalNativeModule<NativeHandModule>('GuitarCoachHand');
const StringModule = requireOptionalNativeModule<NativeStringVisionModule>('GuitarCoachStringVision');

const RIGHT_HAND_REGION: Region = { left: 0.28, top: 0.36, right: 0.94, bottom: 0.94 };
const LEFT_HAND_REGION: Region = { left: 0.06, top: 0.18, right: 0.76, bottom: 0.88 };
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

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function distance(left: { x: number; y: number }, right: { x: number; y: number }) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function regionFor(focus: PracticePreset['cameraFocus']) {
  return focus === 'right-hand' ? RIGHT_HAND_REGION : LEFT_HAND_REGION;
}

function pointInside(point: { x: number; y: number }, region: Region) {
  return point.x >= region.left && point.x <= region.right && point.y >= region.top && point.y <= region.bottom;
}

function handCenter(result: HandAnalysisResult) {
  return {
    x: mean(result.landmarks.map((point) => point.x)),
    y: mean(result.landmarks.map((point) => point.y)),
  };
}

function physicalHandMatches(
  result: HandAnalysisResult,
  focus: PracticePreset['cameraFocus'],
  facing: CameraType,
) {
  if (result.handedness === 'Unknown' || result.handednessScore < 0.72) return true;
  const physicalRightLabel = facing === 'back' ? 'Left' : 'Right';
  const physicalLeftLabel = facing === 'back' ? 'Right' : 'Left';
  const expected = focus === 'right-hand' ? physicalRightLabel : physicalLeftLabel;
  return result.handedness === expected;
}

function isAcceptedHand(
  result: HandAnalysisResult,
  focus: PracticePreset['cameraFocus'],
  facing: CameraType,
) {
  if (!result.hasHand || result.landmarks.length < 21 || result.handednessScore < 0.48) return false;
  if (!physicalHandMatches(result, focus, facing)) return false;
  const wrist = result.landmarks[0];
  const middleMcp = result.landmarks[9];
  const center = handCenter(result);
  const region = regionFor(focus);
  const palmSize = wrist && middleMcp ? distance(wrist, middleMcp) : 0;
  return Boolean(
    wrist
    && pointInside(wrist, region)
    && pointInside(center, region)
    && palmSize >= 0.055,
  );
}

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
  const wristConfidence = clamp(
    result.handednessScore
      * Math.min(1, edge / 0.06)
      * Math.min(1, palmSize / 0.13),
    0,
    1,
  );
  return {
    capturedAt,
    handConfidence: result.handednessScore,
    wristConfidence,
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
      {(result.stringTracking?.lines ?? []).map((line) => (
        <Segment
          key={`string-${line.visualIndex}`}
          x1={line.startX * size.width}
          y1={line.startY * size.height}
          x2={line.endX * size.width}
          y2={line.endY * size.height}
          style={styles.stringLine}
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
        if (!from || !to || from.confidence < 0.35 || to.confidence < 0.35) return null;
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
      {[...points.values()].map((point) => point.confidence >= 0.35 ? (
        <View key={point.name} style={[styles.poseDot, { left: point.x * size.width - 4, top: point.y * size.height - 4 }]} />
      ) : null)}
    </View>
  );
}

export default function StableCoachCamera({
  coachingActive,
  category,
  cameraFocus,
  onMotionSample,
  onAcceptedFrame,
  onFrameCount,
  onStatus,
}: {
  coachingActive: boolean;
  category: PracticeCategoryId;
  cameraFocus: PracticePreset['cameraFocus'];
  onMotionSample?: (sample: MotionSample) => void;
  onAcceptedFrame?: () => void;
  onFrameCount?: (count: number) => void;
  onStatus?: (status: string) => void;
}) {
  const cameraRef = useRef<CameraView | null>(null);
  const captureBusyRef = useRef(false);
  const readyAtRef = useRef(0);
  const frameRef = useRef(0);
  const failureRef = useRef(0);
  const stringFrameRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);
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
  const region = regionFor(cameraFocus);

  const updateStatus = (next: string) => {
    setStatus(next);
    onStatus?.(next);
  };

  const remount = (nextFacing?: CameraType) => {
    if (nextFacing) setFacing(nextFacing);
    setCameraReady(false);
    setCameraError('');
    setAnalysisError('');
    setHandResult(null);
    setPoseResult(null);
    failureRef.current = 0;
    stringFrameRef.current = 0;
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
    if (cameraFocus === 'full-body' && !isLiveCoachNativeAvailable) {
      setAnalysisError('영상은 정상이며 자세 AI 모듈만 사용할 수 없습니다.');
      return;
    }
    if (cameraFocus !== 'full-body' && !HandModule?.androidHandCoachAvailable) {
      setAnalysisError('영상은 정상이며 손 관절 AI 모듈만 사용할 수 없습니다.');
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const interval = cameraFocus === 'full-body' ? 760 : cameraFocus === 'right-hand' ? 380 : 500;

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
          quality: cameraFocus === 'full-body' ? 0.30 : 0.22,
          shutterSound: false,
          mirror: facing === 'front',
          skipProcessing: true,
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
              updateStatus(coachingActive ? '자세 추적·피드백 중' : '자세 관절 자동 추적 중');
              if (coachingActive) publishLiveAnalysisFrame({ kind: 'pose', capturedAt, result });
            } else {
              updateStatus('상체 관절을 찾는 중 · 아직 자세 판정 안 함');
            }
          }
        } else {
          const hand = await HandModule!.analyzeHandAsync(photo.uri, pickColor(category, cameraFocus));
          let tracking: GuitarStringTrackingResult | null = null;
          stringFrameRef.current += 1;
          if (
            cameraFocus === 'right-hand'
            && StringModule?.androidStringVisionAvailable
            && (stringFrameRef.current === 1 || stringFrameRef.current % 5 === 0)
          ) {
            try {
              tracking = StringModule.androidAdaptiveStringRegionAvailable && StringModule.analyzeStringsInRegionAsync
                ? await StringModule.analyzeStringsInRegionAsync(
                    photo.uri,
                    region.left,
                    region.top,
                    region.right,
                    region.bottom,
                    0.62,
                    0.68,
                  )
                : await StringModule.analyzeStringsAsync(photo.uri);
            } catch {
              tracking = null;
            }
          }

          const result: HandAnalysisResult = tracking ? { ...hand, stringTracking: tracking } : hand;
          const accepted = isAcceptedHand(result, cameraFocus, facing);
          if (!cancelled) {
            setHandResult(accepted ? result : null);
            frameRef.current += 1;
            onFrameCount?.(frameRef.current);
            if (!hand.hasHand) {
              updateStatus('분석 영역에서 손을 찾는 중 · 아직 판정 안 함');
            } else if (!accepted) {
              updateStatus(cameraFocus === 'right-hand'
                ? '오른손만 허용 · 점선 안 브리지~사운드홀에 맞추세요'
                : '왼손만 허용 · 점선 안 지판과 손가락을 맞추세요');
            } else {
              onAcceptedFrame?.();
              const sample = motionSample(result, capturedAt);
              if (sample) onMotionSample?.(sample);
              updateStatus(coachingActive ? '관절·궤적 추적 + 피드백 중' : '관절·각도·궤적 자동 추적 중');
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
      schedule(Math.max(160, interval - (Date.now() - startedAt) + Math.min(1_200, failureRef.current * 180)));
    };

    schedule(900);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      captureBusyRef.current = false;
    };
  }, [cameraError, cameraFocus, cameraReady, category, coachingActive, facing, permission?.granted]);

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
          updateStatus('카메라 영상 연결 완료 · AI 안정화 중');
        }}
        onMountError={(event) => {
          setCameraReady(false);
          setCameraError(event.message || '카메라 영상을 열지 못했습니다.');
        }}
      />

      {cameraFocus === 'full-body'
        ? <PoseOverlay result={poseResult} size={size} />
        : <HandOverlay result={handResult} size={size} />}

      {cameraFocus !== 'full-body' ? (
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
          <Text style={styles.roiLabel}>{cameraFocus === 'right-hand' ? '오른손만 · 브리지~사운드홀' : '왼손만 · 지판 영역'}</Text>
        </View>
      ) : null}

      <View pointerEvents="none" style={styles.badgeRow}>
        <Text style={[styles.badge, cameraReady && styles.badgeReady]}>{cameraReady ? '영상 ON' : '영상 연결 중'}</Text>
        <Text style={[styles.badge, coachingActive && styles.badgeCoach]}>{coachingActive ? '피드백 ON' : '판정 대기'}</Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="카메라 전환"
        onPress={() => remount(facing === 'front' ? 'back' : 'front')}
        style={styles.switchButton}
      >
        <Text style={styles.switchText}>전환</Text>
      </Pressable>

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
  roi: { position: 'absolute', borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(126,231,135,0.95)', borderRadius: 18 },
  roiLabel: { alignSelf: 'flex-start', color: '#ffffff', backgroundColor: 'rgba(13,17,23,0.84)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, fontSize: 9, fontWeight: '900', overflow: 'hidden' },
  badgeRow: { position: 'absolute', left: 10, top: 10, flexDirection: 'row', gap: 6 },
  badge: { color: '#f2cc60', backgroundColor: 'rgba(13,17,23,0.84)', borderRadius: 9, paddingHorizontal: 8, paddingVertical: 5, fontSize: 8, fontWeight: '900', overflow: 'hidden' },
  badgeReady: { color: '#7ee787' },
  badgeCoach: { color: '#79c0ff' },
  switchButton: { position: 'absolute', right: 10, top: 10, minWidth: 54, minHeight: 38, borderRadius: 11, backgroundColor: 'rgba(13,17,23,0.92)', borderWidth: 1, borderColor: '#8b949e', alignItems: 'center', justifyContent: 'center', zIndex: 20 },
  switchText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  statusBox: { position: 'absolute', left: 10, right: 10, bottom: 10, backgroundColor: 'rgba(13,17,23,0.86)', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 7 },
  statusText: { color: '#ffffff', fontSize: 8, lineHeight: 12 },
  analysisText: { color: '#f2cc60', fontSize: 7, lineHeight: 11, marginTop: 2 },
  handLine: { position: 'absolute', height: 2, backgroundColor: 'rgba(126,231,135,0.95)' },
  handDot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#7ee787', borderWidth: 1, borderColor: '#ffffff' },
  wristDot: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#ff7b72', borderWidth: 2, borderColor: '#ffffff' },
  stringLine: { position: 'absolute', height: 2, backgroundColor: 'rgba(242,204,96,0.88)' },
  pickMarker: { position: 'absolute', width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#ff7b72', alignItems: 'center', justifyContent: 'center' },
  pickAxis: { width: 23, height: 2, backgroundColor: '#ff7b72' },
  poseLine: { position: 'absolute', height: 2, backgroundColor: 'rgba(88,166,255,0.95)' },
  poseDot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#58a6ff', borderWidth: 1, borderColor: '#ffffff' },
  errorOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(13,17,23,0.96)', padding: 22, zIndex: 30 },
  errorTitle: { color: '#ff7b72', fontSize: 15, fontWeight: '900', textAlign: 'center' },
  errorText: { color: '#f0b7b2', fontSize: 10, lineHeight: 16, textAlign: 'center', marginTop: 7 },
  errorRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  retryButton: { minHeight: 42, borderRadius: 11, backgroundColor: '#1f6feb', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  retryText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  settingsButton: { minHeight: 42, borderRadius: 11, borderWidth: 1, borderColor: '#6e7681', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  settingsText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
});
