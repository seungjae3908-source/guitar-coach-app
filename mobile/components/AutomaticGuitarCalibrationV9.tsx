import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo';
import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
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
  type AutoGuitarStructureEvidence,
} from '../services/guitar-auto-detection';
import type { NormalizedRegion } from '../services/right-hand-roi';
import { RightHandCalibrationV7 } from './FocusCoachCameraV7';

type Size = { width: number; height: number };
type CalibrationMode = 'automatic' | 'manual';
type AnalysisCopies = { hand: string; strings: string; guitar: string };

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
type NativeGuitarVisionModule = {
  androidGuitarVisionAvailable: boolean;
  androidGuitarObjectModel?: string;
  analyzeGuitarAsync(uri: string): Promise<AutoGuitarStructureEvidence>;
};

const HandModule = requireOptionalNativeModule<NativeHandModule>('GuitarCoachHand');
const StringVisionModule = requireOptionalNativeModule<NativeStringVisionModule>('GuitarCoachStringVision');
const GuitarVisionModule = requireOptionalNativeModule<NativeGuitarVisionModule>('GuitarCoachGuitarVision');
const ROI_KEY_PREFIX = 'guitar-coach:right-hand-roi:focus-v7';
const REQUIRED_EVIDENCE_FRAMES = 5;
const MANUAL_FALLBACK_ATTEMPTS = 10;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function roiKey(facing: CameraType) {
  return `${ROI_KEY_PREFIX}:${facing}`;
}

function buildRawStringSearchRegion(hand: HandAnalysisResult) {
  if (!hand.hasHand || hand.landmarks.length < 21) return null;
  const points = hand.landmarks.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (points.length < 21) return null;
  const tips = [4, 8, 12, 16, 20].map((index) => hand.landmarks[index]).filter(Boolean);
  const focusPoints = tips.length ? tips : points;
  const focusX = clamp(focusPoints.reduce((sum, point) => sum + point.x, 0) / focusPoints.length, 0, 1);
  const focusY = clamp(focusPoints.reduce((sum, point) => sum + point.y, 0) / focusPoints.length, 0, 1);
  const ys = points.map((point) => point.y);
  let top = clamp(Math.min(...ys, focusY) - 0.24, 0.01, 0.95);
  let bottom = clamp(Math.max(...ys, focusY) + 0.24, 0.05, 0.99);
  if (bottom - top < 0.44) {
    const center = (top + bottom) / 2;
    top = clamp(center - 0.22, 0.01, 0.55);
    bottom = clamp(center + 0.22, 0.45, 0.99);
  }
  return { left: 0.01, top, right: 0.99, bottom, focusX, focusY };
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
          const mapped = imagePointToPreview({ x: result.pick.centerX, y: result.pick.centerY }, preview, image);
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

function remapRegion(region: AutoGuitarRegion, preview: Size, image: PixelSize): AutoGuitarRegion {
  const corners = [
    imagePointToPreview({ x: region.left, y: region.top }, preview, image),
    imagePointToPreview({ x: region.right, y: region.top }, preview, image),
    imagePointToPreview({ x: region.left, y: region.bottom }, preview, image),
    imagePointToPreview({ x: region.right, y: region.bottom }, preview, image),
  ];
  return {
    left: clamp(Math.min(...corners.map((point) => point.x)), 0, 1),
    top: clamp(Math.min(...corners.map((point) => point.y)), 0, 1),
    right: clamp(Math.max(...corners.map((point) => point.x)), 0, 1),
    bottom: clamp(Math.max(...corners.map((point) => point.y)), 0, 1),
  };
}

function remapStructureToPreview(
  result: AutoGuitarStructureEvidence,
  preview: Size,
  image: PixelSize,
): AutoGuitarStructureEvidence {
  const neckStart = imagePointToPreview({ x: result.neckStartX, y: result.neckStartY }, preview, image);
  const neckEnd = imagePointToPreview({ x: result.neckEndX, y: result.neckEndY }, preview, image);
  const soundhole = imagePointToPreview({ x: result.soundholeCenterX, y: result.soundholeCenterY }, preview, image);
  const pickup = imagePointToPreview({ x: result.pickupCenterX, y: result.pickupCenterY }, preview, image);
  const bridge = imagePointToPreview({ x: result.bridgeCenterX, y: result.bridgeCenterY }, preview, image);
  const neckAngleDegrees = Math.atan2(neckEnd.y - neckStart.y, neckEnd.x - neckStart.x) * 180 / Math.PI;
  return {
    ...result,
    objectBox: remapRegion(result.objectBox, preview, image),
    bodyBox: remapRegion(result.bodyBox, preview, image),
    neckStartX: neckStart.x,
    neckStartY: neckStart.y,
    neckEndX: neckEnd.x,
    neckEndY: neckEnd.y,
    neckAngleDegrees,
    soundholeCenterX: soundhole.x,
    soundholeCenterY: soundhole.y,
    pickupCenterX: pickup.x,
    pickupCenterY: pickup.y,
    bridgeCenterX: bridge.x,
    bridgeCenterY: bridge.y,
    bridgeAngleDegrees: neckAngleDegrees + 90,
  };
}

async function createAnalysisCopies(sourceUri: string): Promise<AnalysisCopies> {
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) throw new Error('AI 분석용 임시 저장소를 사용할 수 없습니다.');
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const copies: AnalysisCopies = {
    hand: `${cacheDirectory}guitar-hand-${token}.jpg`,
    strings: `${cacheDirectory}guitar-strings-${token}.jpg`,
    guitar: `${cacheDirectory}guitar-object-${token}.jpg`,
  };
  await Promise.all(Object.values(copies).map((destination) => FileSystem.copyAsync({ from: sourceUri, to: destination })));
  return copies;
}

async function cleanupCopies(copies: AnalysisCopies | null) {
  if (!copies) return;
  await Promise.all(Object.values(copies).map((uri) => FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined)));
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
    <View style={[
      styles.stringLine,
      {
        width: length,
        left: (x1 + x2 - length) / 2,
        top: (y1 + y2) / 2,
        transform: [{ rotate: `${Math.atan2(y2 - y1, x2 - x1)}rad` }],
      },
    ]} />
  );
}

function Anchor({ x, y, label, size, ready }: { x: number; y: number; label: string; size: Size; ready: boolean }) {
  if (!ready || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return (
    <View pointerEvents="none" style={[styles.anchor, { left: x * size.width - 14, top: y * size.height - 14 }]}>
      <Text style={styles.anchorText}>{label}</Text>
    </View>
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
      <Text style={styles.permissionText}>기타 객체·몸통·넥·사운드홀/픽업·브리지·6줄·손을 기기 안에서 확인합니다.</Text>
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
  const gateRef = useRef(new AutomaticGuitarGate(REQUIRED_EVIDENCE_FRAMES, 0.09, 11, 0.075));
  const saveStartedRef = useRef(false);
  const attemptRef = useRef(0);
  const onSavedRef = useRef(onSaved);
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<CalibrationMode>('automatic');
  const [facing, setFacing] = useState<CameraType>(initialFacing);
  const [cameraKey, setCameraKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [status, setStatus] = useState('카메라 연결 중');
  const [detail, setDetail] = useState('기타 전체와 각 구조를 함께 확인합니다.');
  const [error, setError] = useState('');
  const [candidateRegion, setCandidateRegion] = useState<AutoGuitarRegion | null>(null);
  const [stringResult, setStringResult] = useState<GuitarStringTrackingResult | null>(null);
  const [structureResult, setStructureResult] = useState<AutoGuitarStructureEvidence | null>(null);
  const [consecutive, setConsecutive] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [confidence, setConfidence] = useState(0);
  const [manualAvailable, setManualAvailable] = useState(false);

  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);

  const resetAutomatic = () => {
    gateRef.current.reset();
    saveStartedRef.current = false;
    captureBusyRef.current = false;
    attemptRef.current = 0;
    setCandidateRegion(null);
    setStringResult(null);
    setStructureResult(null);
    setConsecutive(0);
    setAttempts(0);
    setConfidence(0);
    setManualAvailable(false);
    setError('');
    setDetail('기타 전체와 각 구조를 함께 확인합니다.');
  };

  const switchCamera = () => {
    setFacing((current) => current === 'front' ? 'back' : 'front');
    setReady(false);
    resetAutomatic();
    setCameraKey((value) => value + 1);
  };

  useEffect(() => {
    if (mode !== 'automatic' || !permission?.granted || !ready || size.width <= 0 || size.height <= 0) return;
    if (!HandModule?.androidHandCoachAvailable || !StringVisionModule?.androidStringVisionAvailable || !GuitarVisionModule?.androidGuitarVisionAvailable) {
      setError('필수 자동 인식 모듈을 사용할 수 없어 자동 판정이 불가능합니다.');
      setStatus('자동 인식 판정 불가');
      setDetail('손·줄·기타 객체 모듈을 모두 사용할 수 있어야 합니다. 수동 보정을 사용하세요.');
      setManualAvailable(true);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delayedSave: ReturnType<typeof setTimeout> | undefined;
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
      let copies: AnalysisCopies | null = null;
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.72,
          shutterSound: false,
          mirror: facing === 'front',
          skipProcessing: false,
        });
        if (!photo?.uri) throw new Error('분석 사진을 가져오지 못했습니다.');
        const photoSize = {
          width: Math.max(1, Number(photo.width) || size.width),
          height: Math.max(1, Number(photo.height) || size.height),
        };
        copies = await createAnalysisCopies(photo.uri);
        const [rawHand, rawStructure] = await Promise.all([
          HandModule!.analyzeHandAsync(copies.hand, 'none'),
          GuitarVisionModule!.analyzeGuitarAsync(copies.guitar),
        ]);
        const searchRegion = buildRawStringSearchRegion(rawHand);
        const rawStrings = searchRegion
          && StringVisionModule!.androidAdaptiveStringRegionAvailable
          && StringVisionModule!.analyzeStringsInRegionAsync
          ? await StringVisionModule!.analyzeStringsInRegionAsync(
              copies.strings,
              searchRegion.left,
              searchRegion.top,
              searchRegion.right,
              searchRegion.bottom,
              searchRegion.focusX,
              searchRegion.focusY,
            )
          : await StringVisionModule!.analyzeStringsAsync(copies.strings);
        if (cancelled) return;

        const hand = remapHandToPreview(rawHand, size, photoSize);
        const strings = remapStringsToPreview(rawStrings, size, photoSize);
        const structure = remapStructureToPreview(rawStructure, size, photoSize);
        setStringResult(strings.detected ? strings : null);
        setStructureResult(structure.detected ? structure : null);
        attemptRef.current += 1;
        const nextAttempts = attemptRef.current;
        setAttempts(nextAttempts);
        const detection = evaluateAutomaticGuitarDetection(hand, strings, structure);
        const gate = gateRef.current.add(detection);
        setConsecutive(gate.consecutive);
        setConfidence(gate.confidence || detection.confidence);
        setCandidateRegion(gate.region ?? detection.region);
        setDetail(detection.reason);

        if (!detection.accepted) {
          setStatus('기타 구조 자동 확인 중');
          if (nextAttempts >= MANUAL_FALLBACK_ATTEMPTS) setManualAvailable(true);
        } else if (!gate.locked) {
          setStatus(`같은 기타 구조 연속 확인 ${gate.consecutive}/${gate.required}`);
        } else if (gate.region && !saveStartedRef.current) {
          saveStartedRef.current = true;
          const region: NormalizedRegion = {
            left: clamp(gate.region.left, 0, 1),
            top: clamp(gate.region.top, 0, 1),
            right: clamp(gate.region.right, 0, 1),
            bottom: clamp(gate.region.bottom, 0, 1),
          };
          setCandidateRegion(region);
          setStatus('기타 구조 자동 인식 완료');
          setDetail(`다섯 프레임 구조 일치 · 통합 신뢰도 ${Math.round(gate.confidence * 100)}%`);
          await AsyncStorage.setItem(roiKey(facing), JSON.stringify(region));
          if (!cancelled) {
            delayedSave = setTimeout(() => {
              if (!cancelled) onSavedRef.current(facing, region);
            }, 650);
          }
        }
        setError('');
      } catch (caught) {
        if (!cancelled) {
          gateRef.current.reset();
          setConsecutive(0);
          attemptRef.current += 1;
          const nextAttempts = attemptRef.current;
          setAttempts(nextAttempts);
          setError(caught instanceof Error ? caught.message : '자동 기타 구조 인식 오류');
          setStatus('자동 인식을 다시 시도 중');
          setDetail('현재 프레임은 판정 불가입니다. 같은 실패가 누적되면 수동 보정이 열립니다.');
          if (nextAttempts >= MANUAL_FALLBACK_ATTEMPTS) setManualAvailable(true);
        }
      } finally {
        await cleanupCopies(copies);
        captureBusyRef.current = false;
      }
      schedule(Math.max(260, 1_150 - (Date.now() - startedAt)));
    };

    schedule(900);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (delayedSave) clearTimeout(delayedSave);
      captureBusyRef.current = false;
    };
  }, [facing, mode, permission?.granted, ready, size.height, size.width]);

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

  const resonatorReady = Boolean(
    structureResult?.soundholeDetected || structureResult?.pickupDetected,
  );
  const resonatorX = structureResult?.soundholeDetected
    ? structureResult.soundholeCenterX
    : structureResult?.pickupCenterX ?? 0;
  const resonatorY = structureResult?.soundholeDetected
    ? structureResult.soundholeCenterY
    : structureResult?.pickupCenterY ?? 0;

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
          setStatus('기타 객체와 구조 자동 확인 중');
          setError('');
        }}
        onMountError={(event) => {
          setReady(false);
          setError(event.message || '카메라를 열지 못했습니다.');
          setStatus('카메라 판정 불가');
          setManualAvailable(true);
        }}
      />

      {structureResult?.detected ? (
        <View pointerEvents="none" style={[
          styles.objectBox,
          {
            left: structureResult.objectBox.left * size.width,
            top: structureResult.objectBox.top * size.height,
            width: (structureResult.objectBox.right - structureResult.objectBox.left) * size.width,
            height: (structureResult.objectBox.bottom - structureResult.objectBox.top) * size.height,
          },
        ]}>
          <Text style={styles.objectLabel}>기타 객체</Text>
        </View>
      ) : null}

      {structureResult?.bodyDetected ? (
        <View pointerEvents="none" style={[
          styles.bodyBox,
          {
            left: structureResult.bodyBox.left * size.width,
            top: structureResult.bodyBox.top * size.height,
            width: (structureResult.bodyBox.right - structureResult.bodyBox.left) * size.width,
            height: (structureResult.bodyBox.bottom - structureResult.bodyBox.top) * size.height,
          },
        ]}>
          <Text style={styles.bodyLabel}>몸통</Text>
        </View>
      ) : null}

      {structureResult?.neckDetected ? (
        <Line
          startX={structureResult.neckStartX}
          startY={structureResult.neckStartY}
          endX={structureResult.neckEndX}
          endY={structureResult.neckEndY}
          size={size}
        />
      ) : null}

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

      <Anchor x={resonatorX} y={resonatorY} label={structureResult?.soundholeDetected ? 'S' : 'P'} size={size} ready={resonatorReady} />
      <Anchor x={structureResult?.bridgeCenterX ?? 0} y={structureResult?.bridgeCenterY ?? 0} label="B" size={size} ready={Boolean(structureResult?.bridgeDetected)} />

      {candidateRegion ? (
        <View pointerEvents="none" style={[
          styles.candidateRegion,
          consecutive >= REQUIRED_EVIDENCE_FRAMES && styles.candidateRegionLocked,
          {
            left: candidateRegion.left * size.width,
            top: candidateRegion.top * size.height,
            width: (candidateRegion.right - candidateRegion.left) * size.width,
            height: (candidateRegion.bottom - candidateRegion.top) * size.height,
          },
        ]}>
          <Text style={styles.candidateLabel}>{consecutive >= REQUIRED_EVIDENCE_FRAMES ? '연주 구역 확정' : '연주 구역 후보'}</Text>
        </View>
      ) : null}

      <View pointerEvents="none" style={styles.header}>
        <Text style={styles.build}>FOCUS V9 · 구조 인식 개발판</Text>
        <Text style={styles.title}>기타 전체 자동 인식</Text>
        <Text style={styles.status}>{status}</Text>
        <Text style={styles.detail}>{detail}</Text>
        <View style={styles.progressRow}>
          <Text style={styles.progress}>연속 {consecutive}/{REQUIRED_EVIDENCE_FRAMES}</Text>
          <Text style={styles.progress}>신뢰도 {Math.round(confidence * 100)}%</Text>
          <Text style={styles.progress}>시도 {attempts}/{MANUAL_FALLBACK_ATTEMPTS}</Text>
        </View>
        <View style={styles.evidenceRow}>
          <Text style={[styles.evidence, structureResult?.detected && styles.evidenceReady]}>객체</Text>
          <Text style={[styles.evidence, structureResult?.bodyDetected && styles.evidenceReady]}>몸통</Text>
          <Text style={[styles.evidence, structureResult?.neckDetected && styles.evidenceReady]}>넥</Text>
          <Text style={[styles.evidence, resonatorReady && styles.evidenceReady]}>홀/픽업</Text>
          <Text style={[styles.evidence, structureResult?.bridgeDetected && styles.evidenceReady]}>브리지</Text>
          <Text style={[styles.evidence, stringResult?.detected && styles.evidenceReady]}>6줄</Text>
        </View>
      </View>

      <Pressable onPress={onCancel} style={styles.closeButton}>
        <Text style={styles.closeText}>닫기</Text>
      </Pressable>
      <Pressable onPress={switchCamera} style={styles.switchButton}>
        <Text style={styles.switchText}>전후면 전환</Text>
      </Pressable>

      <View style={styles.bottomActions}>
        {manualAvailable ? (
          <Pressable onPress={() => setMode('manual')} style={styles.manualButton}>
            <Text style={styles.manualText}>자동 실패 · 수동 보정</Text>
          </Pressable>
        ) : null}
        <View style={styles.autoHint}>
          <Text style={styles.autoHintTitle}>{manualAvailable ? '자동 인식 실패가 누적되었습니다' : '기타 전체가 화면 안에 보이게 잡으세요'}</Text>
          <Text style={styles.autoHintText}>
            {manualAvailable
              ? '수동 보정은 자동 인식 실패가 확인된 뒤에만 사용할 수 있습니다.'
              : '몸통·넥·사운드홀/픽업·브리지와 오른손을 가리지 마세요.'}
          </Text>
        </View>
      </View>

      {error ? (
        <View pointerEvents="none" style={styles.errorBox}>
          <Text style={styles.errorText}>현재 프레임 판정 불가: {error}</Text>
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
  objectBox: { position: 'absolute', borderWidth: 3, borderColor: '#58a6ff', borderRadius: 18, zIndex: 8 },
  objectLabel: { alignSelf: 'flex-start', color: '#ffffff', backgroundColor: '#1f6feb', paddingHorizontal: 6, paddingVertical: 3, fontSize: 8, fontWeight: '900' },
  bodyBox: { position: 'absolute', borderWidth: 3, borderColor: '#bc8cff', borderRadius: 22, zIndex: 9 },
  bodyLabel: { alignSelf: 'flex-end', color: '#ffffff', backgroundColor: '#8957e5', paddingHorizontal: 6, paddingVertical: 3, fontSize: 8, fontWeight: '900' },
  anchor: { position: 'absolute', width: 28, height: 28, borderRadius: 14, backgroundColor: '#d1242f', borderWidth: 2, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center', zIndex: 18 },
  anchorText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  candidateRegion: { position: 'absolute', borderWidth: 4, borderColor: '#f2cc60', borderRadius: 20, backgroundColor: 'rgba(242,204,96,0.08)', zIndex: 14 },
  candidateRegionLocked: { borderColor: '#7ee787', backgroundColor: 'rgba(46,160,67,0.10)' },
  candidateLabel: { alignSelf: 'flex-start', color: '#ffffff', backgroundColor: 'rgba(13,17,23,0.92)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, fontSize: 9, fontWeight: '900', overflow: 'hidden' },
  header: { position: 'absolute', left: 12, right: 12, top: 60, borderRadius: 18, backgroundColor: 'rgba(13,17,23,0.94)', borderWidth: 2, borderColor: '#58a6ff', padding: 12, alignItems: 'center', zIndex: 30 },
  build: { color: '#7ee787', fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  title: { color: '#ffffff', fontSize: 18, fontWeight: '900', marginTop: 3 },
  status: { color: '#79c0ff', fontSize: 12, fontWeight: '900', marginTop: 6, textAlign: 'center' },
  detail: { color: '#d8dee4', fontSize: 9, lineHeight: 14, marginTop: 4, textAlign: 'center' },
  progressRow: { flexDirection: 'row', gap: 5, marginTop: 8 },
  progress: { color: '#ffffff', backgroundColor: '#21262d', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 4, fontSize: 7, fontWeight: '900', overflow: 'hidden' },
  evidenceRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 4, marginTop: 7 },
  evidence: { color: '#8b949e', backgroundColor: '#21262d', borderRadius: 7, paddingHorizontal: 6, paddingVertical: 3, fontSize: 7, fontWeight: '900', overflow: 'hidden' },
  evidenceReady: { color: '#ffffff', backgroundColor: '#238636' },
  closeButton: { position: 'absolute', left: 12, top: 10, minWidth: 64, minHeight: 42, borderRadius: 12, backgroundColor: 'rgba(13,17,23,0.94)', borderWidth: 1, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  closeText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  switchButton: { position: 'absolute', right: 12, top: 10, minWidth: 105, minHeight: 42, borderRadius: 12, backgroundColor: 'rgba(13,17,23,0.94)', borderWidth: 1, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  switchText: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  bottomActions: { position: 'absolute', left: 12, right: 12, bottom: 34, flexDirection: 'row', gap: 8, zIndex: 50 },
  manualButton: { minWidth: 138, minHeight: 58, borderRadius: 15, backgroundColor: 'rgba(13,17,23,0.96)', borderWidth: 1, borderColor: '#f2cc60', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  manualText: { color: '#f2cc60', fontSize: 10, fontWeight: '900' },
  autoHint: { flex: 1, minHeight: 58, borderRadius: 15, backgroundColor: 'rgba(13,17,23,0.92)', paddingHorizontal: 11, paddingVertical: 8, justifyContent: 'center' },
  autoHintTitle: { color: '#ffffff', fontSize: 10, fontWeight: '900' },
  autoHintText: { color: '#b1bac4', fontSize: 8, lineHeight: 12, marginTop: 3 },
  errorBox: { position: 'absolute', left: 12, right: 12, bottom: 104, borderRadius: 12, backgroundColor: 'rgba(58,23,24,0.96)', borderWidth: 1, borderColor: '#da3633', padding: 9, zIndex: 40 },
  errorText: { color: '#ffb4ad', fontSize: 9, lineHeight: 13, fontWeight: '800', textAlign: 'center' },
});
