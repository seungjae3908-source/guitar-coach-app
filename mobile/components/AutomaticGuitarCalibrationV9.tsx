import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo';
import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type {
  GuitarStringTrackingResult,
  HandAnalysisResult,
  PickColor,
} from '../modules/guitar-coach-hand';
import { imagePointToPreview, type PixelSize } from '../services/camera-preview-transform';
import {
  AutomaticGuitarGate,
  evaluateAutomaticGuitarDetection,
  type AutoGuitarRegion,
} from '../services/guitar-auto-detection';
import type { NormalizedRegion } from '../services/right-hand-roi';
import { RightHandCalibrationV7 } from './FocusCoachCameraV7';

type Size = { width: number; height: number };
type CalibrationMode = 'automatic' | 'manual';

type NativeHandModule = {
  androidHandCoachAvailable: boolean;
  analyzeHandAsync(uri: string, pickColor: PickColor): Promise<HandAnalysisResult>;
};
type NativeStringVisionModule = {
  androidStringVisionAvailable: boolean;
  analyzeStringsAsync(uri: string): Promise<GuitarStringTrackingResult>;
};

const HandModule = requireOptionalNativeModule<NativeHandModule>('GuitarCoachHand');
const StringVisionModule = requireOptionalNativeModule<NativeStringVisionModule>('GuitarCoachStringVision');
const ROI_KEY_PREFIX = 'guitar-coach:right-hand-roi:focus-v7';
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function roiKey(facing: CameraType) {
  return `${ROI_KEY_PREFIX}:${facing}`;
}

function remapHandToPreview(result: HandAnalysisResult, preview: Size, image: PixelSize): HandAnalysisResult {
  return {
    ...result,
    landmarks: result.landmarks.map((point) => {
      const mapped = imagePointToPreview(point, preview, image);
      return { ...point, x: mapped.x, y: mapped.y };
    }),
    pick: result.pick.detected
      ? (() => {
          const mapped = imagePointToPreview(
            { x: result.pick.centerX, y: result.pick.centerY },
            preview,
            image,
          );
          return { ...result.pick, centerX: mapped.x, centerY: mapped.y };
        })()
      : result.pick,
  };
}

function remapStringsToPreview(
  result: GuitarStringTrackingResult,
  preview: Size,
  image: PixelSize,
): GuitarStringTrackingResult {
  return {
    ...result,
    lines: result.lines.map((line) => {
      const start = imagePointToPreview({ x: line.startX, y: line.startY }, preview, image);
      const end = imagePointToPreview({ x: line.endX, y: line.endY }, preview, image);
      return { ...line, startX: start.x, startY: start.y, endX: end.x, endY: end.y };
    }),
  };
}

function Line({
  startX,
  startY,
  endX,
  endY,
  size,
}: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  size: Size;
}) {
  const x1 = startX * size.width;
  const y1 = startY * size.height;
  const x2 = endX * size.width;
  const y2 = endY * size.height;
  const length = Math.hypot(x2 - x1, y2 - y1);
  return (
    <View
      style={[
        styles.stringLine,
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

function PermissionSurface({
  permission,
  requestPermission,
  onCancel,
}: {
  permission: ReturnType<typeof useCameraPermissions>[0];
  requestPermission: ReturnType<typeof useCameraPermissions>[1];
  onCancel: () => void;
}) {
  if (!permission) {
    return (
      <View style={styles.permissionSurface}>
        <ActivityIndicator />
        <Text style={styles.permissionText}>카메라 권한 확인 중</Text>
      </View>
    );
  }
  const open = async () => {
    if (permission.canAskAgain === false) await Linking.openSettings();
    else await requestPermission();
  };
  return (
    <View style={styles.permissionSurface}>
      <Text style={styles.permissionTitle}>카메라 권한이 필요합니다</Text>
      <Text style={styles.permissionText}>기타줄과 연주 손을 휴대폰 안에서 자동 인식합니다.</Text>
      <Pressable onPress={() => void open()} style={styles.permissionPrimary}>
        <Text style={styles.permissionPrimaryText}>{permission.canAskAgain === false ? '휴대폰 설정 열기' : '카메라 허용'}</Text>
      </Pressable>
      <Pressable onPress={onCancel} style={styles.permissionSecondary}>
        <Text style={styles.permissionSecondaryText}>닫기</Text>
      </Pressable>
    </View>
  );
}

export default function AutomaticGuitarCalibrationV9({
  initialFacing = 'back',
  onSaved,
  onCancel,
}: {
  initialFacing?: CameraType;
  onSaved: (facing: CameraType, region: NormalizedRegion) => void;
  onCancel: () => void;
}) {
  const cameraRef = useRef<CameraView | null>(null);
  const captureBusyRef = useRef(false);
  const gateRef = useRef(new AutomaticGuitarGate(3, 0.14, 15));
  const saveStartedRef = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<CalibrationMode>('automatic');
  const [facing, setFacing] = useState<CameraType>(initialFacing);
  const [cameraKey, setCameraKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [status, setStatus] = useState('카메라 연결 중');
  const [detail, setDetail] = useState('기타 6줄과 연주 손을 함께 찾습니다.');
  const [error, setError] = useState('');
  const [candidateRegion, setCandidateRegion] = useState<AutoGuitarRegion | null>(null);
  const [stringResult, setStringResult] = useState<GuitarStringTrackingResult | null>(null);
  const [consecutive, setConsecutive] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [confidence, setConfidence] = useState(0);

  const resetAutomatic = () => {
    gateRef.current.reset();
    saveStartedRef.current = false;
    captureBusyRef.current = false;
    setCandidateRegion(null);
    setStringResult(null);
    setConsecutive(0);
    setAttempts(0);
    setConfidence(0);
    setError('');
    setDetail('기타 6줄과 연주 손을 함께 찾습니다.');
  };

  const switchCamera = () => {
    setFacing((current) => current === 'front' ? 'back' : 'front');
    setReady(false);
    resetAutomatic();
    setCameraKey((value) => value + 1);
  };

  useEffect(() => {
    if (mode !== 'automatic' || !permission?.granted || !ready || size.width <= 0 || size.height <= 0) return;
    if (!HandModule?.androidHandCoachAvailable || !StringVisionModule?.androidStringVisionAvailable) {
      setError('자동 기타 인식 모듈을 사용할 수 없습니다.');
      setDetail('수동 보정으로 기타 위치를 맞추세요.');
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delay: number) => {
      if (!cancelled) timer = setTimeout(capture, delay);
    };

    const capture = async () => {
      if (cancelled || captureBusyRef.current || !cameraRef.current || saveStartedRef.current) {
        schedule(220);
        return;
      }
      captureBusyRef.current = true;
      const startedAt = Date.now();
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.64,
          shutterSound: false,
          mirror: facing === 'front',
          skipProcessing: false,
        });
        if (!photo?.uri) throw new Error('분석 사진을 가져오지 못했습니다.');
        const photoSize = {
          width: Math.max(1, Number(photo.width) || size.width),
          height: Math.max(1, Number(photo.height) || size.height),
        };
        const [rawHand, rawStrings] = await Promise.all([
          HandModule!.analyzeHandAsync(photo.uri, 'none'),
          StringVisionModule!.analyzeStringsAsync(photo.uri),
        ]);
        if (cancelled) return;
        const hand = remapHandToPreview(rawHand, size, photoSize);
        const strings = remapStringsToPreview(rawStrings, size, photoSize);
        setStringResult(strings.detected ? strings : null);
        setAttempts((value) => value + 1);
        const detection = evaluateAutomaticGuitarDetection(hand, strings);
        const gate = gateRef.current.add(detection);
        setConsecutive(gate.consecutive);
        setConfidence(gate.confidence || detection.confidence);
        setCandidateRegion(gate.region ?? detection.region);
        setDetail(detection.reason);

        if (!detection.accepted) {
          setStatus('기타 위치 자동 인식 중');
        } else if (!gate.locked) {
          setStatus(`같은 기타 위치 확인 ${gate.consecutive}/${gate.required}`);
        } else if (gate.region && !saveStartedRef.current) {
          saveStartedRef.current = true;
          const region: NormalizedRegion = {
            left: clamp(gate.region.left, 0, 1),
            top: clamp(gate.region.top, 0, 1),
            right: clamp(gate.region.right, 0, 1),
            bottom: clamp(gate.region.bottom, 0, 1),
          };
          setCandidateRegion(region);
          setStatus('기타 위치 자동 인식 완료');
          setDetail(`기타줄과 연주 손이 일치했습니다 · 신뢰도 ${Math.round(gate.confidence * 100)}%`);
          await AsyncStorage.setItem(roiKey(facing), JSON.stringify(region));
          if (!cancelled) {
            setTimeout(() => {
              if (!cancelled) onSaved(facing, region);
            }, 650);
          }
        }
        setError('');
      } catch (caught) {
        if (!cancelled) {
          gateRef.current.reset();
          setConsecutive(0);
          setError(caught instanceof Error ? caught.message : '자동 기타 인식 오류');
          setStatus('자동 인식을 다시 시도 중');
        }
      } finally {
        captureBusyRef.current = false;
      }
      schedule(Math.max(240, 900 - (Date.now() - startedAt)));
    };

    schedule(900);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      captureBusyRef.current = false;
    };
  }, [facing, mode, onSaved, permission?.granted, ready, size.height, size.width]);

  if (mode === 'manual') {
    return (
      <RightHandCalibrationV7
        initialFacing={facing}
        onCancel={() => {
          setMode('automatic');
          setReady(false);
          resetAutomatic();
          setCameraKey((value) => value + 1);
        }}
        onSaved={onSaved}
      />
    );
  }

  if (!permission?.granted) {
    return <PermissionSurface permission={permission} requestPermission={requestPermission} onCancel={onCancel} />;
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
        key={`focus-v9-auto-guitar-${cameraKey}-${facing}`}
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        mirror={facing === 'front'}
        mode="picture"
        animateShutter={false}
        onCameraReady={() => {
          setReady(true);
          setStatus('기타 위치 자동 인식 중');
          setError('');
        }}
        onMountError={(event) => {
          setReady(false);
          setError(event.message || '카메라를 열지 못했습니다.');
        }}
      />

      {stringResult?.lines.map((line, index) => (
        <Line
          key={`${index}-${line.startX}-${line.startY}`}
          startX={line.startX}
          startY={line.startY}
          endX={line.endX}
          endY={line.endY}
          size={size}
        />
      ))}

      {candidateRegion ? (
        <View
          pointerEvents="none"
          style={[
            styles.candidateRegion,
            consecutive >= 3 && styles.candidateRegionLocked,
            {
              left: candidateRegion.left * size.width,
              top: candidateRegion.top * size.height,
              width: (candidateRegion.right - candidateRegion.left) * size.width,
              height: (candidateRegion.bottom - candidateRegion.top) * size.height,
            },
          ]}
        >
          <Text style={styles.candidateLabel}>{consecutive >= 3 ? '기타 인식 완료' : '기타 연주 구역 후보'}</Text>
        </View>
      ) : null}

      <View pointerEvents="none" style={styles.header}>
        <Text style={styles.build}>FOCUS V9 · v24</Text>
        <Text style={styles.title}>기타 위치 자동 인식</Text>
        <Text style={styles.status}>{status}</Text>
        <Text style={styles.detail}>{detail}</Text>
        <View style={styles.progressRow}>
          <Text style={styles.progress}>연속 확인 {consecutive}/3</Text>
          <Text style={styles.progress}>신뢰도 {Math.round(confidence * 100)}%</Text>
          <Text style={styles.progress}>시도 {attempts}</Text>
        </View>
      </View>

      <Pressable onPress={onCancel} style={styles.closeButton}>
        <Text style={styles.closeText}>닫기</Text>
      </Pressable>
      <Pressable onPress={switchCamera} style={styles.switchButton}>
        <Text style={styles.switchText}>전후면 전환</Text>
      </Pressable>

      <View style={styles.bottomActions}>
        <Pressable onPress={() => setMode('manual')} style={styles.manualButton}>
          <Text style={styles.manualText}>수동으로 맞추기</Text>
        </Pressable>
        <View style={styles.autoHint}>
          <Text style={styles.autoHintTitle}>기타를 연주 자세로 잡으세요</Text>
          <Text style={styles.autoHintText}>사운드홀부터 넥 방향의 줄과 오른손이 함께 보이면 자동 저장됩니다.</Text>
        </View>
      </View>

      {error ? (
        <View pointerEvents="none" style={styles.errorBox}>
          <Text style={styles.errorText}>자동 인식: {error}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000', overflow: 'hidden' },
  permissionSurface: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0d1117', padding: 24 },
  permissionTitle: { color: '#ffffff', fontSize: 20, fontWeight: '900', textAlign: 'center' },
  permissionText: { color: '#b1bac4', fontSize: 12, lineHeight: 19, textAlign: 'center', marginTop: 8 },
  permissionPrimary: { minHeight: 50, borderRadius: 14, backgroundColor: '#238636', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, marginTop: 18 },
  permissionPrimaryText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  permissionSecondary: { minHeight: 44, borderRadius: 13, borderWidth: 1, borderColor: '#6e7681', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, marginTop: 9 },
  permissionSecondaryText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  stringLine: { position: 'absolute', height: 3, backgroundColor: 'rgba(242,204,96,0.96)', borderRadius: 2, zIndex: 12 },
  candidateRegion: { position: 'absolute', borderWidth: 4, borderColor: '#f2cc60', borderRadius: 20, backgroundColor: 'rgba(242,204,96,0.08)', zIndex: 14 },
  candidateRegionLocked: { borderColor: '#7ee787', backgroundColor: 'rgba(46,160,67,0.10)' },
  candidateLabel: { alignSelf: 'flex-start', color: '#ffffff', backgroundColor: 'rgba(13,17,23,0.92)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, fontSize: 9, fontWeight: '900', overflow: 'hidden' },
  header: { position: 'absolute', left: 12, right: 12, top: 60, borderRadius: 18, backgroundColor: 'rgba(13,17,23,0.94)', borderWidth: 2, borderColor: '#58a6ff', padding: 14, alignItems: 'center', zIndex: 30 },
  build: { color: '#7ee787', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  title: { color: '#ffffff', fontSize: 20, fontWeight: '900', marginTop: 4 },
  status: { color: '#79c0ff', fontSize: 13, fontWeight: '900', marginTop: 7, textAlign: 'center' },
  detail: { color: '#d8dee4', fontSize: 10, lineHeight: 15, marginTop: 5, textAlign: 'center' },
  progressRow: { flexDirection: 'row', gap: 6, marginTop: 9 },
  progress: { color: '#ffffff', backgroundColor: '#21262d', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 5, fontSize: 7, fontWeight: '900', overflow: 'hidden' },
  closeButton: { position: 'absolute', left: 12, top: 10, minWidth: 64, minHeight: 42, borderRadius: 12, backgroundColor: 'rgba(13,17,23,0.94)', borderWidth: 1, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  closeText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  switchButton: { position: 'absolute', right: 12, top: 10, minWidth: 105, minHeight: 42, borderRadius: 12, backgroundColor: 'rgba(13,17,23,0.94)', borderWidth: 1, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  switchText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  bottomActions: { position: 'absolute', left: 12, right: 12, bottom: 34, flexDirection: 'row', gap: 8, zIndex: 50 },
  manualButton: { minWidth: 118, minHeight: 58, borderRadius: 15, backgroundColor: 'rgba(13,17,23,0.96)', borderWidth: 1, borderColor: '#f2cc60', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  manualText: { color: '#f2cc60', fontSize: 11, fontWeight: '900' },
  autoHint: { flex: 1, minHeight: 58, borderRadius: 15, backgroundColor: 'rgba(13,17,23,0.92)', paddingHorizontal: 11, paddingVertical: 8, justifyContent: 'center' },
  autoHintTitle: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  autoHintText: { color: '#b1bac4', fontSize: 8, lineHeight: 12, marginTop: 3 },
  errorBox: { position: 'absolute', left: 12, right: 12, bottom: 104, borderRadius: 12, backgroundColor: 'rgba(58,23,24,0.96)', borderWidth: 1, borderColor: '#da3633', padding: 9, zIndex: 40 },
  errorText: { color: '#ffb4ad', fontSize: 9, lineHeight: 13, fontWeight: '800', textAlign: 'center' },
});
