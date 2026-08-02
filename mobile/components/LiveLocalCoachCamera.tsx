import { useCameraPermissions } from 'expo-camera';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { PracticeCategoryId } from '../config/guitar-mode-profiles';
import type { PracticePreset } from '../config/personal-practice-presets';
import ContinuousRightHandCamera, {
  isContinuousRightHandCameraAvailable,
  type ContinuousHandAnalysisResult,
} from '../modules/guitar-coach-continuous-camera';
import {
  isCoachSpeechAvailable,
  prepareCoachSpeechAsync,
  speakCoachPhraseAsync,
  stopCoachSpeechAsync,
} from '../modules/guitar-coach-speech';
import { LiveRecognitionVoicePolicy } from '../services/live-recognition-voice-policy';
import type { MotionSample } from '../services/trajectory-speed-engine';
import FocusCoachCameraV7 from './FocusCoachCameraV7';

type Size = { width: number; height: number };
const HAND_LINKS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const distance = (left: { x: number; y: number }, right: { x: number; y: number }) =>
  Math.hypot(left.x - right.x, left.y - right.y);

function Segment({
  x1,
  y1,
  x2,
  y2,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  return (
    <View
      style={[
        styles.handLine,
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

function HandOverlay({ result, size }: { result: ContinuousHandAnalysisResult | null; size: Size }) {
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
          />
        );
      })}
      {result.landmarks.map((point) => (
        <View
          key={point.index}
          style={[
            point.index === 0 ? styles.wristDot : styles.handDot,
            {
              left: point.x * size.width - (point.index === 0 ? 7 : 5),
              top: point.y * size.height - (point.index === 0 ? 7 : 5),
            },
          ]}
        />
      ))}
    </View>
  );
}

function GuitarOverlay({ result, size }: { result: ContinuousHandAnalysisResult | null; size: Size }) {
  const guitar = result?.guitar;
  if (!guitar?.detected || size.width <= 0 || size.height <= 0) return null;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.guitarBox,
        {
          left: guitar.left * size.width,
          top: guitar.top * size.height,
          width: (guitar.right - guitar.left) * size.width,
          height: (guitar.bottom - guitar.top) * size.height,
        },
      ]}
    />
  );
}

function toMotionSample(result: ContinuousHandAnalysisResult, capturedAt: number): MotionSample | null {
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

function pickColor(category: PracticeCategoryId) {
  return category === 'arpeggio' || category === 'fingerstyle' ? 'none' : 'auto';
}

export default function LiveLocalCoachCamera({
  coachingActive,
  category,
  cameraFocus,
  initialFacing = cameraFocus === 'full-body' ? 'front' : 'back',
  voiceEnabled,
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
  initialFacing?: 'front' | 'back';
  voiceEnabled: boolean;
  onNeedCalibration?: (facing: 'front' | 'back') => void;
  onMotionSample?: (sample: MotionSample) => void;
  onAcceptedFrame?: () => void;
  onFrameCount?: (count: number) => void;
  onStatus?: (status: string) => void;
  onHandLockChange?: (locked: boolean) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<'front' | 'back'>(initialFacing);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState<ContinuousHandAnalysisResult | null>(null);
  const [error, setError] = useState('');
  const frameRef = useRef(0);
  const validFramesRef = useRef(0);
  const lockedRef = useRef(false);
  const lastAcceptedAtRef = useRef(0);
  const voicePolicyRef = useRef(new LiveRecognitionVoicePolicy());
  const speechReadyRef = useRef(false);
  const speechBusyRef = useRef(false);

  const palmSize = useMemo(() => {
    const wrist = result?.landmarks[0];
    const middleMcp = result?.landmarks[9];
    return wrist && middleMcp ? distance(wrist, middleMcp) : 0;
  }, [result]);

  useEffect(() => {
    setFacing(initialFacing);
  }, [initialFacing]);

  useEffect(() => {
    if (!voiceEnabled || !isCoachSpeechAvailable) {
      speechReadyRef.current = false;
      void stopCoachSpeechAsync();
      return;
    }
    let cancelled = false;
    void prepareCoachSpeechAsync()
      .then(() => {
        if (!cancelled) speechReadyRef.current = true;
      })
      .catch(() => {
        speechReadyRef.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [voiceEnabled]);

  useEffect(() => () => {
    void stopCoachSpeechAsync();
  }, []);

  const announce = (phrase: string | null) => {
    if (!phrase || !voiceEnabled || !speechReadyRef.current || speechBusyRef.current) return;
    speechBusyRef.current = true;
    void speakCoachPhraseAsync(phrase, { interrupt: false, speechRate: 1.02 })
      .catch(() => undefined)
      .finally(() => {
        speechBusyRef.current = false;
      });
  };

  const updateLock = (next: boolean) => {
    if (lockedRef.current === next) return;
    lockedRef.current = next;
    onHandLockChange?.(next);
  };

  if (cameraFocus === 'full-body' || cameraFocus === 'none') {
    return (
      <FocusCoachCameraV7
        coachingActive={coachingActive}
        category={category}
        cameraFocus={cameraFocus}
        initialFacing={initialFacing}
        onNeedCalibration={onNeedCalibration}
        onMotionSample={onMotionSample}
        onAcceptedFrame={onAcceptedFrame}
        onFrameCount={onFrameCount}
        onStatus={onStatus}
        onHandLockChange={onHandLockChange}
      />
    );
  }

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.permissionText}>카메라 권한 확인 중</Text>
      </View>
    );
  }

  if (!permission.granted) {
    const open = async () => {
      if (permission.canAskAgain === false) await Linking.openSettings();
      else await requestPermission();
    };
    return (
      <View style={styles.center}>
        <Text style={styles.permissionTitle}>카메라 권한이 필요합니다</Text>
        <Text style={styles.permissionText}>손과 기타는 서버 전송 없이 휴대폰에서만 인식합니다.</Text>
        <Pressable onPress={() => void open()} style={styles.permissionButton}>
          <Text style={styles.permissionButtonText}>
            {permission.canAskAgain === false ? '휴대폰 설정 열기' : '카메라 허용'}
          </Text>
        </Pressable>
      </View>
    );
  }

  if (!isContinuousRightHandCameraAvailable) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionTitle}>연속 카메라 모듈 판정 불가</Text>
        <Text style={styles.permissionText}>현재 APK에는 CameraX 연속 손 인식 모듈이 없습니다.</Text>
      </View>
    );
  }

  const handReady = Boolean(result?.hasHand && result.landmarks.length >= 21 && result.handednessScore >= 0.25);
  const guitarReady = Boolean(result?.guitar?.detected);
  const guitarLabel = result?.guitar?.label || '기타';
  const status = error
    ? '분석 오류'
    : handReady && guitarReady
      ? '손 · 기타 준비 완료'
      : handReady
        ? '손 인식 완료'
        : guitarReady
          ? `${guitarLabel} 인식 완료`
          : '손과 기타 찾는 중';

  return (
    <View
      style={styles.root}
      onLayout={(event: LayoutChangeEvent) => setSize({
        width: event.nativeEvent.layout.width,
        height: event.nativeEvent.layout.height,
      })}
    >
      <ContinuousRightHandCamera
        style={StyleSheet.absoluteFill}
        running
        facing={facing}
        analyzeStrings={false}
        pickColor={pickColor(category)}
        onCameraReady={() => {
          setReady(true);
          setError('');
          onStatus?.('카메라 연결 완료 · 손과 기타를 독립적으로 찾는 중');
          announce(voicePolicyRef.current.next({
            running: true,
            cameraReady: true,
            hasHand: false,
            handConfidence: 0,
            palmSize: 0,
            guitarDetected: false,
            guitarType: 'unknown',
            guitarConfidence: 0,
          }));
        }}
        onAnalysis={(event) => {
          const next = event.nativeEvent;
          setResult(next);
          frameRef.current += 1;
          onFrameCount?.(frameRef.current);
          const valid = next.hasHand && next.landmarks.length >= 21 && next.handednessScore >= 0.25;
          validFramesRef.current = valid ? Math.min(5, validFramesRef.current + 1) : 0;
          const nextLocked = validFramesRef.current >= 3;
          updateLock(nextLocked);

          if (nextLocked) {
            const capturedAt = Date.now();
            const sample = toMotionSample(next, capturedAt);
            if (sample) onMotionSample?.(sample);
            if (coachingActive && capturedAt - lastAcceptedAtRef.current >= 120) {
              lastAcceptedAtRef.current = capturedAt;
              onAcceptedFrame?.();
            }
          }

          const nextPalm = (() => {
            const wrist = next.landmarks[0];
            const middleMcp = next.landmarks[9];
            return wrist && middleMcp ? distance(wrist, middleMcp) : 0;
          })();
          const nextStatus = nextLocked
            ? next.guitar?.detected
              ? `손과 ${next.guitar.label || '기타'} 인식 완료`
              : '손 단독 인식 완료 · 기타는 별도 확인 중'
            : next.guitar?.detected
              ? `${next.guitar.label || '기타'} 인식 완료 · 손 찾는 중`
              : '손과 기타를 독립적으로 찾는 중';
          onStatus?.(nextStatus);
          announce(voicePolicyRef.current.next({
            running: true,
            cameraReady: ready || true,
            hasHand: next.hasHand,
            handConfidence: next.handednessScore,
            palmSize: nextPalm,
            guitarDetected: Boolean(next.guitar?.detected),
            guitarType: next.guitar?.type ?? 'unknown',
            guitarConfidence: next.guitar?.confidence ?? 0,
          }));
        }}
        onError={(event) => {
          const message = event.nativeEvent.message || '연속 카메라 분석 오류';
          setError(message);
          onStatus?.(`카메라 분석 오류 · ${message}`);
          updateLock(false);
          announce(voicePolicyRef.current.next({
            running: true,
            cameraReady: ready,
            hasHand: false,
            handConfidence: 0,
            palmSize: 0,
            guitarDetected: false,
            guitarType: 'unknown',
            guitarConfidence: 0,
            error: message,
          }));
        }}
      />

      <GuitarOverlay result={result} size={size} />
      <HandOverlay result={result} size={size} />

      <View pointerEvents="none" style={styles.topStatus}>
        <View style={[styles.largeBadge, handReady ? styles.goodBadge : styles.waitBadge]}>
          <Text style={styles.badgeIcon}>{handReady ? '✓' : '○'}</Text>
          <Text style={styles.badgeText}>{handReady ? '손' : '손 찾는 중'}</Text>
        </View>
        <View style={[styles.largeBadge, guitarReady ? styles.goodBadge : styles.waitBadge]}>
          <Text style={styles.badgeIcon}>{guitarReady ? '✓' : '○'}</Text>
          <Text style={styles.badgeText}>{guitarReady ? guitarLabel : '기타 찾는 중'}</Text>
        </View>
      </View>

      <View pointerEvents="none" style={styles.voiceStatus}>
        <Text style={styles.voiceStatusText}>{voiceEnabled ? '🔊 음성 안내' : '음성 꺼짐'}</Text>
        <Text style={styles.mainStatus}>{status}</Text>
      </View>

      <Pressable
        onPress={() => {
          setFacing((current) => current === 'back' ? 'front' : 'back');
          setResult(null);
          setReady(false);
          setError('');
          validFramesRef.current = 0;
          updateLock(false);
          voicePolicyRef.current.reset();
        }}
        style={styles.switchButton}
      >
        <Text style={styles.switchText}>전후면</Text>
      </Pressable>

      {onNeedCalibration ? (
        <Pressable onPress={() => onNeedCalibration(facing)} style={styles.manualButton}>
          <Text style={styles.manualText}>수동 보정</Text>
        </Pressable>
      ) : null}

      {error ? (
        <View pointerEvents="none" style={styles.errorBox}>
          <Text style={styles.errorText}>현재 판정 불가</Text>
        </View>
      ) : null}

      {!ready ? (
        <View pointerEvents="none" style={styles.loading}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>카메라 연결 중</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000', overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0d1117', padding: 24 },
  permissionTitle: { color: '#ffffff', fontSize: 20, fontWeight: '900', textAlign: 'center' },
  permissionText: { color: '#b1bac4', fontSize: 12, lineHeight: 19, textAlign: 'center', marginTop: 8 },
  permissionButton: { minHeight: 50, borderRadius: 14, backgroundColor: '#238636', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, marginTop: 18 },
  permissionButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  handLine: { position: 'absolute', height: 4, borderRadius: 2, backgroundColor: 'rgba(126,231,135,0.95)', zIndex: 20 },
  handDot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: '#7ee787', borderWidth: 2, borderColor: '#ffffff', zIndex: 22 },
  wristDot: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#ff7b72', borderWidth: 2, borderColor: '#ffffff', zIndex: 22 },
  guitarBox: { position: 'absolute', borderWidth: 4, borderColor: '#58a6ff', borderRadius: 22, backgroundColor: 'rgba(88,166,255,0.04)', zIndex: 15 },
  topStatus: { position: 'absolute', left: 12, right: 12, top: 12, flexDirection: 'row', gap: 9, zIndex: 40 },
  largeBadge: { flex: 1, minHeight: 58, borderRadius: 17, borderWidth: 3, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 8 },
  goodBadge: { backgroundColor: 'rgba(22,101,52,0.92)', borderColor: '#7ee787' },
  waitBadge: { backgroundColor: 'rgba(32,36,45,0.90)', borderColor: '#f2cc60' },
  badgeIcon: { color: '#ffffff', fontSize: 22, fontWeight: '900' },
  badgeText: { color: '#ffffff', fontSize: 16, fontWeight: '900' },
  voiceStatus: { position: 'absolute', left: 12, right: 12, bottom: 78, borderRadius: 16, backgroundColor: 'rgba(13,17,23,0.90)', borderWidth: 2, borderColor: '#30363d', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, zIndex: 40 },
  voiceStatusText: { color: '#79c0ff', fontSize: 12, fontWeight: '900' },
  mainStatus: { color: '#ffffff', fontSize: 15, fontWeight: '900', marginTop: 3, textAlign: 'center' },
  switchButton: { position: 'absolute', right: 12, bottom: 14, minWidth: 86, minHeight: 50, borderRadius: 15, backgroundColor: 'rgba(13,17,23,0.94)', borderWidth: 2, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  switchText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  manualButton: { position: 'absolute', left: 12, bottom: 14, minWidth: 96, minHeight: 50, borderRadius: 15, backgroundColor: 'rgba(13,17,23,0.94)', borderWidth: 2, borderColor: '#6e7681', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  manualText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  errorBox: { position: 'absolute', left: '25%', right: '25%', top: '45%', minHeight: 52, borderRadius: 15, backgroundColor: 'rgba(177,35,36,0.94)', alignItems: 'center', justifyContent: 'center', zIndex: 60 },
  errorText: { color: '#ffffff', fontSize: 16, fontWeight: '900' },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)', zIndex: 70 },
  loadingText: { color: '#ffffff', fontSize: 14, fontWeight: '900', marginTop: 10 },
});
