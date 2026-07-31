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
import {
  cameraRecoveryDecision,
  initialAnalysisDelayMs,
} from '../services/camera-analysis-recovery';
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

const RIGHT_HAND_REGION: Region = { left: 0.16, top: 0.22, right: 0.90, bottom: 0.96 };
const LEFT_HAND_REGION: Region = { left: 0.06, top: 0.10, right: 0.94, bottom: 0.92 };
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

function isAcceptedHand(result: HandAnalysisResult, focus: PracticePreset['cameraFocus']) {
  if (!result.hasHand || result.landmarks.length < 21 || result.handednessScore < 0.44) return false;
  const wrist = result.landmarks[0];
  const center = handCenter(result);
  const region = regionFor(focus);
  return Boolean(wrist && pointInside(wrist, region) && pointInside(center, region));
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
  const captureBusyRef = useRef(false);
  const frameRef = useRef(0);
  const readyAtRef = useRef(0);
  const captureFailuresRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);
  const stringFrameRef = useRef(0);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>(cameraFocus === 'full-body' ? 'front' : 'back');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);
  const [cameraError, setCameraError] = useState('');
  const [analysisError, setAnalysisError] = useState('');
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
    const nextFacing: CameraType = cameraFocus === 'full-body' ? 'front' : 'back';
    setFacing(nextFacing);
    setCameraReady(false);
    setCameraError('');
    setAnalysisError('');
    setHandResult(null);
    setPoseResult(null);
    frameRef.current = 0;
    captureFailuresRef.current = 0;
    stringFrameRef.current = 0;
    setCameraKey((value) => value + 1);
  }, [cameraFocus]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      const previous = appStateRef.current;
      appStateRef.current = next;
      if (previous === 'active' || next !== 'active' || !permission?.granted) return;
      const timer = setTimeout(() => {
        setCameraReady(false);
        setCameraError('');
        setAnalysisError('');
        setCameraKey((value) => value + 1);
      }, 350);
      return () => clearTimeout(timer);
    });
    return () => subscription.remove();
  }, [permission?.granted]);

  useEffect(() => {
    if (!permission?.granted || cameraReady || cameraError) return;
    const timer = setTimeout(() => {
      setCameraError('카메라 영상 준비 신호가 없습니다. 다른 앱의 카메라를 종료한 뒤 다시 연결하세요.');
    }, 8_000);
    return () => clearTimeout(timer);
  }, [cameraError, cameraReady, permission?.granted, cameraKey]);

  useEffect(() => {
    if (!permission?.granted || !cameraReady || cameraError) return;

    if (cameraFocus === 'full-body' && !isLiveCoachNativeAvailable) {
      setAnalysisError('카메라 영상은 정상입니다. 자세 AI 모듈만 사용할 수 없습니다.');
      return;
    }
    if (cameraFocus !== 'full-body' && !HandModule?.androidHandCoachAvailable) {
      setAnalysisError('카메라 영상은 정상입니다. 손 관절 AI 모듈만 사용할 수 없습니다.');
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const targetInterval = cameraFocus === 'full-body' ? 760 : cameraFocus === 'right-hand' ? 320 : 430;

    const schedule = (delay: number) => {
      if (!cancelled) timer = setTimeout(capture, delay);
    };

    const capture = async () => {
      if (cancelled || captureBusyRef.current || !cameraRef.current) {
        schedule(180);
        return;
      }

      const waitForReady = initialAnalysisDelayMs(readyAtRef.current);
      if (waitForReady > 0) {
        schedule(waitForReady);
        return;
      }

      captureBusyRef.current = true;
      const startedAt = Date.now();
      let failureKind: 'capture' | 'analysis' = 'capture';

      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: cameraFocus === 'full-body' ? 0.28 : 0.20,
          shutterSound: false,
          mirror: facing === 'front',
          skipProcessing: true,
        });
        if (!photo?.uri) throw new Error('분석 프레임을 가져오지 못했습니다.');

        failureKind = 'analysis';
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
          const hand = await HandModule!.analyzeHandAsync(photo.uri, pickColor(category, cameraFocus));
          let tracking: GuitarStringTrackingResult | null = null;
          stringFrameRef.current += 1;
          const shouldAnalyzeStrings = cameraFocus === 'right-hand'
            && Boolean(StringModule?.androidStringVisionAvailable)
            && (stringFrameRef.current === 1 || stringFrameRef.current % 4 === 0);

          if (shouldAnalyzeStrings) {
            try {
              tracking = StringModule!.androidAdaptiveStringRegionAvailable && StringModule!.analyzeStringsInRegionAsync
                ? await StringModule!.analyzeStringsInRegionAsync(
                    photo.uri,
                    focusRegion.left,
                    focusRegion.top,
                    focusRegion.right,
                    focusRegion.bottom,
                    0.54,
                    0.66,
                  )
                : await StringModule!.analyzeStringsAsync(photo.uri);
              tracking = tracking ? { ...tracking, stabilityConfidence: tracking.confidence } : null;
            } catch {
              tracking = null;
            }
          }

          const result: HandAnalysisResult = tracking ? { ...hand, stringTracking: tracking } : hand;
          const accepted = isAcceptedHand(result, cameraFocus);
          if (!cancelled) {
            setHandResult(accepted ? result : null);
            frameRef.current += 1;
            onFrameCount?.(frameRef.current);
            if (!hand.hasHand) updateStatus('분석 영역에서 손을 찾는 중');
            else if (!accepted && cameraFocus === 'right-hand') updateStatus('ROI 밖 손 무시 · 브리지~사운드홀 안에 오른손을 맞추세요');
            else if (!accepted) updateStatus('왼손과 지판을 분석 영역 안에 맞추세요');
            else if (cameraFocus === 'right-hand' && !tracking?.detected) updateStatus('오른손 관절 분석 중 · 기타줄 기준을 찾는 중');
            else updateStatus(coachingActive ? '궤적 분석 + 레슨 피드백 중' : '관절·각도·궤적 자동 분석 중');

            if (accepted) {
              const sample = motionSample(result, capturedAt);
              if (sample) onMotionSample?.(sample);
              if (coachingActive) publishLiveAnalysisFrame({ kind: 'hand', capturedAt, result });
            }
          }
        }

        captureFailuresRef.current = 0;
        if (!cancelled) setAnalysisError('');
      } catch (caught) {
        captureFailuresRef.current += 1;
        const decision = cameraRecoveryDecision(failureKind, captureFailuresRef.current, targetInterval);
        if (!cancelled) {
          const detail = caught instanceof Error ? caught.message : 'AI 분석 중 오류가 발생했습니다.';
          setAnalysisError(`${decision.message} ${detail}`);
          updateStatus('카메라 영상 유지 · AI 분석 자동 재시도 중');
        }
        schedule(decision.retryDelayMs);
        captureBusyRef.current = false;
        return;
      } finally {
        captureBusyRef.current = false;
      }

      schedule(Math.max(90, targetInterval - (Date.now() - startedAt)));
    };

    schedule(initialAnalysisDelayMs(readyAtRef.current));
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      captureBusyRef.current = false;
    };
  }, [cameraFocus, cameraReady, category, coachingActive, facing, permission?.granted, cameraError]);

  const onLayout = (event: LayoutChangeEvent) => {
    setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height });
  };

  const retryCamera = () => {
    setCameraError('');
    setAnalysisError('');
    setCameraReady(false);
    captureFailuresRef.current = 0;
    setCameraKey((value) => value + 1);
  };

  const switchCamera = () => {
    setCameraReady(false);
    setCameraError('');
    setAnalysisError('');
    captureFailuresRef.current = 0;
    setFacing((value) => value === 'front' ? 'back' : 'front');
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
        animateShutter={false}
        onCameraReady={() => {
          readyAtRef.current = Date.now();
          captureFailuresRef.current = 0;
          setCameraReady(true);
          setCameraError('');
          setAnalysisError('');
          updateStatus('카메라 영상 연결 완료 · AI 안정화 중');
        }}
        onMountError={(event) => {
          const decision = cameraRecoveryDecision('mount', 1, 800);
          setCameraReady(false);
          setCameraError(`${decision.message} ${event.message || ''}`.trim());
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
        <Text style={[styles.badge, cameraReady && styles.badgeReady]}>{cameraReady ? '영상 ON' : '영상 연결 중'}</Text>
        <Text style={[styles.badge, coachingActive && styles.badgeCoach]}>{coachingActive ? '피드백 ON' : '자동 분석'}</Text>
      </View>

      <View style={styles.bottomStatus}>
        <View style={styles.statusBox}>
          <Text style={styles.statusText} numberOfLines={2}>{cameraError || status}</Text>
          {analysisError && !cameraError ? <Text style={styles.analysisText} numberOfLines={2}>{analysisError}</Text> : null}
        </View>
        <Pressable onPress={switchCamera} style={styles.smallButton}>
          <Text style={styles.smallButtonText}>카메라 전환</Text>
        </Pressable>
      </View>

      {cameraError ? (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorTitle}>카메라 영상을 열지 못했습니다</Text>
          <Text style={styles.errorText}>{cameraError}</Text>
          <View style={styles.errorRow}>
            <Pressable onPress={retryCamera} style={styles.retryButton}><Text style={styles.retryText}>다시 연결</Text></Pressable>
            <Pressable onPress={() => void Linking.openSettings()} style={styles.settingsButton}><Text style={styles.settingsText}>휴대폰 설정</Text></Pressable>
          </View>
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
  bottomStatus: { position: 'absolute', left: 8, right: 8, bottom: 8, flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  statusBox: { flex: 1, backgroundColor: 'rgba(13,17,23,0.84)', borderRadius: 9, paddingHorizontal: 8, paddingVertical: 6 },
  statusText: { color: '#ffffff', fontSize: 8, lineHeight: 12 },
  analysisText: { color: '#f2cc60', fontSize: 7, lineHeight: 11, marginTop: 2 },
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
  errorRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  retryButton: { minHeight: 42, borderRadius: 11, backgroundColor: '#1f6feb', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  retryText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  settingsButton: { minHeight: 42, borderRadius: 11, borderWidth: 1, borderColor: '#6e7681', backgroundColor: '#21262d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  settingsText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
});
