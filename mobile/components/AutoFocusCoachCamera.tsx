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
  HandLandmarkPoint,
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

const RIGHT_HAND_REGION: Region = { left: 0.06, top: 0.18, right: 0.94, bottom: 0.96 };
const LEFT_HAND_REGION: Region = { left: 0.03, top: 0.08, right: 0.97, bottom: 0.92 };
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

function isAcceptedHand(
  result: HandAnalysisResult,
  focus: PracticePreset['cameraFocus'],
  tracking: GuitarStringTrackingResult | null,
) {
  if (!result.hasHand || result.landmarks.length < 21 || result.handednessScore < 0.46) return false;
  const wrist = result.landmarks[0];
  const center = handCenter(result);
  const region = regionFor(focus);
  if (!wrist || !pointInside(wrist, region) || !pointInside(center, region)) return false;
  if (focus === 'right-hand') {
    return Boolean(tracking?.detected && tracking.visibleLineCount >= 3 && tracking.confidence >= 0.28);
  }
  return true;
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
          key={`line-${line.visualIndex}`}
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
            left: result.pick.centerX * size.width - 15,
            top: result.pick.centerY * size.height - 15,
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
        <View key={point.name} style={[styles.poseDot, { left: point.x * size.width - 4, top: point.y * size.height - 4 }]} />
      ) : null)}
    </View>
  );
}

export default function AutoFocusCoachCamera({
  coachingActive,
  category,
  cameraFocus,
  onMotionSample,
  onFrameCount,
  onStatus,
}: {
  coachingActive: boolean;
  category: PracticeCategoryId;
  cameraFocus: PracticePreset['cameraFocus'];
  onMotionSample?: (sample: MotionSample) => void;
  onFrameCount?: (count: number) => void;
  onStatus?: (status: string) => void;
}) {
  const cameraRef = useRef<CameraView | null>(null);
  const busyRef = useRef(false);
  const frameRef = useRef(0);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>(cameraFocus === 'full-body' ? 'front' : 'back');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('카메라 연결 중');
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [handResult, setHandResult] = useState<HandAnalysisResult | null>(null);
  const [poseResult, setPoseResult] = useState<PoseAnalysisResult | null>(null);
  const focusRegion = regionFor(cameraFocus);

  const updateStatus = (next: string) => {
    setStatus(next);
    onStatus?.(next);
  };

  useEffect(() => {
    setFacing(cameraFocus === 'full-body' ? 'front' : 'back');
    setCameraReady(false);
    setError('');
    setHandResult(null);
    setPoseResult(null);
    frameRef.current = 0;
    setCameraKey((value) => value + 1);
  }, [cameraFocus, category]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || !permission?.granted) return;
      setCameraReady(false);
      setError('');
      setCameraKey((value) => value + 1);
    });
    return () => subscription.remove();
  }, [permission?.granted]);

  useEffect(() => {
    if (!permission?.granted || !cameraReady || error) return;
    if (cameraFocus === 'full-body' && !isLiveCoachNativeAvailable) {
      setError('자세 분석 모듈을 사용할 수 없습니다.');
      return;
    }
    if (cameraFocus !== 'full-body' && !HandModule?.androidHandCoachAvailable) {
      setError('손 관절 분석 모듈을 사용할 수 없습니다.');
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delay: number) => {
      if (!cancelled) timer = setTimeout(capture, delay);
    };
    const capture = async () => {
      if (cancelled || busyRef.current || !cameraRef.current) {
        schedule(100);
        return;
      }
      busyRef.current = true;
      const startedAt = Date.now();
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: cameraFocus === 'full-body' ? 0.30 : 0.22,
          shutterSound: false,
          mirror: facing === 'front',
          skipProcessing: false,
        });
        if (!photo?.uri) throw new Error('카메라 프레임을 가져오지 못했습니다.');
        const capturedAt = Date.now();

        if (cameraFocus === 'full-body') {
          const result = await analyzePoseAsync(photo.uri);
          if (!cancelled) {
            setPoseResult(result);
            frameRef.current += 1;
            onFrameCount?.(frameRef.current);
            updateStatus(result.hasPerson ? '자세 관절·각도 자동 분석 중' : '상체 관절을 찾는 중');
            if (coachingActive) publishLiveAnalysisFrame({ kind: 'pose', capturedAt, result });
          }
        } else {
          const color = pickColor(category, cameraFocus);
          const hand = await HandModule!.analyzeHandAsync(photo.uri, color);
          let tracking: GuitarStringTrackingResult | null = null;
          if (cameraFocus === 'right-hand' && StringModule?.androidStringVisionAvailable) {
            try {
              tracking = StringModule.androidAdaptiveStringRegionAvailable && StringModule.analyzeStringsInRegionAsync
                ? await StringModule.analyzeStringsInRegionAsync(
                    photo.uri,
                    focusRegion.left,
                    focusRegion.top,
                    focusRegion.right,
                    focusRegion.bottom,
                    0.52,
                    0.64,
                  )
                : await StringModule.analyzeStringsAsync(photo.uri);
              tracking = tracking ? { ...tracking, stabilityConfidence: tracking.confidence } : null;
            } catch {
              tracking = null;
            }
          }
          const result: HandAnalysisResult = tracking ? { ...hand, stringTracking: tracking } : hand;
          const accepted = isAcceptedHand(result, cameraFocus, tracking);
          if (!cancelled) {
            setHandResult(accepted ? result : null);
            frameRef.current += 1;
            onFrameCount?.(frameRef.current);
            if (!hand.hasHand) updateStatus('손을 찾는 중');
            else if (!accepted && cameraFocus === 'right-hand') updateStatus('ROI 밖 손 무시 · 브리지·사운드홀 안에 오른손을 맞추세요');
            else if (!accepted) updateStatus('왼손과 지판을 분석 영역 안에 맞추세요');
            else updateStatus(coachingActive ? '궤적 분석 + 레슨 피드백 중' : '관절·각도·궤적 자동 분석 중');
            if (accepted) {
              const sample = motionSample(result, capturedAt);
              if (sample) onMotionSample?.(sample);
              if (coachingActive) publishLiveAnalysisFrame({ kind: 'hand', capturedAt, result });
            }
          }
        }
        if (!cancelled) setError('');
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '카메라 분석 중 오류가 발생했습니다.');
      } finally {
        busyRef.current = false;
        const interval = cameraFocus === 'full-body' ? 650 : cameraFocus === 'right-hand' ? 165 : 240;
        schedule(Math.max(35, interval - (Date.now() - startedAt)));
      }
    };
    schedule(120);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      busyRef.current = false;
    };
  }, [cameraFocus, cameraReady, category, coachingActive, error, facing, permission?.granted]);

  const onLayout = (event: LayoutChangeEvent) => {
    setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height });
  };

  const retry = () => {
    setError('');
    setCameraReady(false);
    setCameraKey((value) => value + 1);
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
        <Text style={styles.centerText}>영상은 휴대폰 안에서만 관절·궤적 분석에 사용합니다.</Text>
        <Pressable onPress={() => void requestOrSettings()} style={styles.permissionButton}>
          <Text style={styles.permissionButtonText}>{permission.canAskAgain === false ? '휴대폰 설정 열기' : '카메라 허용'}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root} onLayout={onLayout}>
      <CameraView
        key={`${cameraKey}-${facing}-${cameraFocus}`}
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        mirror={facing === 'front'}
        mode="picture"
        ratio="4:3"
        animateShutter={false}
        onCameraReady={() => {
          setCameraReady(true);
          setError('');
          updateStatus('카메라 연결 완료 · 자동 분석 준비');
        }}
        onMountError={(event) => {
          setCameraReady(false);
          setError(event.message || '카메라를 열지 못했습니다.');
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
              left: focusRegion.left * size.width,
              top: focusRegion.top * size.height,
              width: (focusRegion.right - focusRegion.left) * size.width,
              height: (focusRegion.bottom - focusRegion.top) * size.height,
            },
          ]}
        >
          <Text style={styles.roiLabel}>{cameraFocus === 'right-hand' ? '오른손 전용 · 브리지~사운드홀' : '왼손·지판 전용'}</Text>
        </View>
      ) : null}

      <View pointerEvents="none" style={styles.topStatus}>
        <Text style={[styles.badge, cameraReady && styles.badgeReady]}>{cameraReady ? '자동 분석 ON' : '카메라 연결 중'}</Text>
        <Text style={[styles.badge, coachingActive && styles.badgeCoach]}>{coachingActive ? '피드백 ON' : '피드백 대기'}</Text>
      </View>

      <View style={styles.bottomStatus}>
        <Text style={styles.statusText} numberOfLines={2}>{error || status}</Text>
        <Pressable onPress={() => setFacing((value) => value === 'front' ? 'back' : 'front')} style={styles.smallButton}>
          <Text style={styles.smallButtonText}>카메라 전환</Text>
        </Pressable>
      </View>

      {error ? (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorTitle}>분석을 계속할 수 없습니다</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={retry} style={styles.retryButton}><Text style={styles.retryText}>다시 연결</Text></Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 360, overflow: 'hidden', backgroundColor: '#000000' },
  center: { flex: 1, minHeight: 360, alignItems: 'center', justifyContent: 'center', backgroundColor: '#11161d', padding: 20 },
  centerText: { color: '#b1bac4', fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 9 },
  permissionTitle: { color: '#f0f6fc', fontSize: 16, fontWeight: '900' },
  permissionButton: { minHeight: 43, borderRadius: 11, backgroundColor: '#1f6feb', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 15 },
  permissionButtonText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  roi: { position: 'absolute', borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(126,231,135,0.92)', borderRadius: 18 },
  roiLabel: { alignSelf: 'flex-start', color: '#ffffff', backgroundColor: 'rgba(13,17,23,0.78)', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4, fontSize: 8, fontWeight: '900', overflow: 'hidden' },
  topStatus: { position: 'absolute', left: 8, right: 8, top: 8, flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  badge: { color: '#f2cc60', backgroundColor: 'rgba(13,17,23,0.82)', borderRadius: 9, paddingHorizontal: 8, paddingVertical: 5, fontSize: 8, fontWeight: '900', overflow: 'hidden' },
  badgeReady: { color: '#7ee787' },
  badgeCoach: { color: '#79c0ff' },
  bottomStatus: { position: 'absolute', left: 8, right: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 7 },
  statusText: { flex: 1, color: '#ffffff', backgroundColor: 'rgba(13,17,23,0.82)', borderRadius: 9, paddingHorizontal: 8, paddingVertical: 6, fontSize: 8, lineHeight: 12, overflow: 'hidden' },
  smallButton: { minWidth: 66, minHeight: 34, borderRadius: 9, backgroundColor: 'rgba(13,17,23,0.88)', borderWidth: 1, borderColor: '#6e7681', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  smallButtonText: { color: '#f0f6fc', fontSize: 8, fontWeight: '900' },
  handLine: { position: 'absolute', height: 2, backgroundColor: 'rgba(126,231,135,0.94)' },
  handDot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#7ee787', borderWidth: 1, borderColor: '#ffffff' },
  wristDot: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#ff7b72', borderWidth: 2, borderColor: '#ffffff' },
  stringLine: { position: 'absolute', height: 2, backgroundColor: 'rgba(242,204,96,0.84)' },
  pickMarker: { position: 'absolute', width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: '#ff7b72', alignItems: 'center', justifyContent: 'center' },
  pickAxis: { width: 25, height: 2, backgroundColor: '#ff7b72' },
  poseLine: { position: 'absolute', height: 2, backgroundColor: 'rgba(88,166,255,0.90)' },
  poseDot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#58a6ff', borderWidth: 1, borderColor: '#ffffff' },
  errorOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(13,17,23,0.94)', padding: 22 },
  errorTitle: { color: '#ff7b72', fontSize: 15, fontWeight: '900', textAlign: 'center' },
  errorText: { color: '#f0b7b2', fontSize: 10, lineHeight: 16, textAlign: 'center', marginTop: 7 },
  retryButton: { minHeight: 42, borderRadius: 11, backgroundColor: '#1f6feb', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 14 },
  retryText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
});
