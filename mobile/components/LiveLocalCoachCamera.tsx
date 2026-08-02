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
import {
  extendStrumLockUntil,
  isStrumLockActive,
} from '../services/camera-analysis-recovery';
import { getCameraFeedHealth } from '../services/camera-feed-health';
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
  const handPresenceConfidence = result.hasHand && result.landmarks.length >= 21
    ? Math.max(0.65, result.handednessScore)
    : 0;
  return {
    capturedAt,
    handConfidence: handPresenceConfidence,
    wristConfidence: clamp(handPresenceConfidence * Math.min(1, palmSize / 0.055), 0, 1),
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

const STRING_ANALYSIS_CATEGORIES = new Set<PracticeCategoryId>([
  'strumming',
  'alternatePicking',
  'downPicking',
  'palmMute',
  'arpeggio',
  'fingerstyle',
  'songPractice',
]);

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
  const [voiceDiagnostic, setVoiceDiagnostic] = useState(
    voiceEnabled ? '음성 엔진 준비 중' : '음성 꺼짐',
  );
  const frameRef = useRef(0);
  const validFramesRef = useRef(0);
  const lockedRef = useRef(false);
  const lastAcceptedAtRef = useRef(0);
  const strumLockUntilRef = useRef(0);
  const lastStrumSpokenAtRef = useRef(0);
  const lastRecoverySpokenRef = useRef(0);
  const startupSpokenRef = useRef(false);
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
      startupSpokenRef.current = false;
      setVoiceDiagnostic(voiceEnabled ? '음성 모듈 없음' : '음성 꺼짐');
      void stopCoachSpeechAsync();
      return;
    }
    let cancelled = false;
    setVoiceDiagnostic('음성 엔진 준비 중');
    void prepareCoachSpeechAsync()
      .then(async (preparation) => {
        if (cancelled) return;
        speechReadyRef.current = true;
        const volumeLabel = preparation.musicVolume === 0
          ? ' · 미디어 음량 0'
          : '';
        setVoiceDiagnostic(`음성 준비 완료${volumeLabel}`);
        if (startupSpokenRef.current || speechBusyRef.current) return;
        startupSpokenRef.current = true;
        speechBusyRef.current = true;
        try {
          await speakCoachPhraseAsync(
            '음성 코치가 시작되었습니다. 손과 기타를 화면 안에 맞춰 주세요.',
            { interrupt: true, speechRate: 1.02 },
          );
          if (!cancelled) setVoiceDiagnostic('시작 음성 재생 완료');
        } catch (speechError) {
          if (!cancelled) {
            setVoiceDiagnostic(`음성 오류 · ${speechError instanceof Error ? speechError.message : '재생 실패'}`);
          }
        } finally {
          speechBusyRef.current = false;
        }
      })
      .catch((speechError) => {
        speechReadyRef.current = false;
        if (!cancelled) {
          setVoiceDiagnostic(`음성 준비 오류 · ${speechError instanceof Error ? speechError.message : '초기화 실패'}`);
        }
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
    setVoiceDiagnostic('음성 재생 중');
    void speakCoachPhraseAsync(phrase, { interrupt: false, speechRate: 1.02 })
      .then(() => setVoiceDiagnostic('음성 재생 완료'))
      .catch((speechError) => {
        setVoiceDiagnostic(`음성 오류 · ${speechError instanceof Error ? speechError.message : '재생 실패'}`);
      })
      .finally(() => {
        speechBusyRef.current = false;
      });
  };

  const testVoice = async () => {
    if (!voiceEnabled || !isCoachSpeechAvailable || speechBusyRef.current) return;
    speechBusyRef.current = true;
    setVoiceDiagnostic('테스트 음성 재생 중');
    try {
      await prepareCoachSpeechAsync();
      speechReadyRef.current = true;
      await speakCoachPhraseAsync(
        '음성 테스트입니다. 오른손과 기타 줄을 화면 안에 맞춰 주세요.',
        { interrupt: true, speechRate: 1.02 },
      );
      setVoiceDiagnostic('테스트 음성 재생 완료');
    } catch (speechError) {
      setVoiceDiagnostic(`음성 테스트 오류 · ${speechError instanceof Error ? speechError.message : '재생 실패'}`);
    } finally {
      speechBusyRef.current = false;
    }
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

  const cameraFeedHealth = getCameraFeedHealth(result?.continuous?.cameraFeed);
  const handReady = Boolean(
    cameraFeedHealth.healthy && result?.hasHand && result.landmarks.length >= 21,
  );
  const guitarReady = Boolean(cameraFeedHealth.healthy && result?.guitar?.detected);
  const guitarLabel = result?.guitar?.label || '기타';
  const status = error
    ? '분석 오류'
    : result && !cameraFeedHealth.healthy
      ? cameraFeedHealth.recovering
        ? '검은 카메라 영상 자동 복구 중'
        : '카메라 실제 영상 확인 중'
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
        running={true}
        facing={facing}
        analyzeStrings={STRING_ANALYSIS_CATEGORIES.has(category)}
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
          const capturedAt = Date.now();
          const nextFeedHealth = getCameraFeedHealth(next.continuous?.cameraFeed);
          const valid = nextFeedHealth.healthy && next.hasHand && next.landmarks.length >= 21;
          const newHits = next.continuous?.newHits ?? [];
          strumLockUntilRef.current = extendStrumLockUntil(
            strumLockUntilRef.current,
            capturedAt,
            STRING_ANALYSIS_CATEGORIES.has(category) && newHits.length > 0,
          );
          const strumLockHeld = isStrumLockActive(strumLockUntilRef.current, capturedAt);
          validFramesRef.current = valid
            ? Math.min(5, validFramesRef.current + 1)
            : strumLockHeld
              ? Math.max(3, validFramesRef.current)
              : 0;
          const nextLocked = validFramesRef.current >= 3 || strumLockHeld;
          updateLock(nextLocked);

          if (nextLocked) {
            const sample = toMotionSample(next, capturedAt);
            if (sample) onMotionSample?.(sample);
            if (coachingActive && capturedAt - lastAcceptedAtRef.current >= 120) {
              lastAcceptedAtRef.current = capturedAt;
              onAcceptedFrame?.();
            }
          }

          const latestHit = newHits.at(-1);
          if (latestHit && capturedAt - lastStrumSpokenAtRef.current >= 1_800) {
            lastStrumSpokenAtRef.current = capturedAt;
            announce(
              latestHit.direction === 'down'
                ? '다운 스트럼을 추적했습니다.'
                : latestHit.direction === 'up'
                  ? '업 스트럼을 추적했습니다.'
                  : '스트럼 움직임을 추적했습니다.',
            );
          }

          const recoveryCount = next.continuous?.cameraFeed?.recoveryCount ?? 0;
          if (
            !nextFeedHealth.healthy
            && recoveryCount > lastRecoverySpokenRef.current
          ) {
            lastRecoverySpokenRef.current = recoveryCount;
            announce('카메라 영상이 들어오지 않아 자동으로 다시 연결합니다.');
          }

          const nextPalm = (() => {
            const wrist = next.landmarks[0];
            const middleMcp = next.landmarks[9];
            return wrist && middleMcp ? distance(wrist, middleMcp) : 0;
          })();
          const nextStatus = !nextFeedHealth.healthy
            ? nextFeedHealth.label
            : strumLockHeld && !valid
              ? '스트럼 추적 유지 중 · 다음 프레임 확인'
            : nextLocked
              ? next.guitar?.detected
                ? `손과 ${next.guitar.label || '기타'} 인식 완료`
                : '손 단독 인식 완료 · 기타는 별도 확인 중'
              : next.guitar?.detected
              ? `${next.guitar.label || '기타'} 인식 완료 · 손 찾는 중`
              : '손과 기타를 독립적으로 찾는 중';
          onStatus?.(nextStatus);
          if (nextFeedHealth.healthy) {
            announce(voicePolicyRef.current.next({
              running: true,
              cameraReady: true,
              hasHand: next.hasHand,
              handConfidence: next.hasHand && next.landmarks.length >= 21
                ? Math.max(0.65, next.handednessScore)
                : 0,
              palmSize: nextPalm,
              guitarDetected: Boolean(next.guitar?.detected),
              guitarType: next.guitar?.type ?? 'unknown',
              guitarConfidence: next.guitar?.confidence ?? 0,
            }));
          }
        }}
        onError={(event) => {
          const message = event.nativeEvent.message || '연속 카메라 분석 오류';
          setError(message);
          onStatus?.(`카메라 분석 오류 · ${message}`);
          strumLockUntilRef.current = 0;
          validFramesRef.current = 0;
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
        <Text style={styles.voiceStatusText}>{voiceDiagnostic}</Text>
        <Text style={styles.mainStatus}>{status}</Text>
        <Text style={styles.cameraDiagnostic}>{cameraFeedHealth.label}</Text>
      </View>

      <Pressable
        onPress={() => {
          setFacing((current) => current === 'back' ? 'front' : 'back');
          setResult(null);
          setReady(false);
          setError('');
          validFramesRef.current = 0;
          strumLockUntilRef.current = 0;
          updateLock(false);
          voicePolicyRef.current.reset();
        }}
        style={styles.switchButton}
      >
        <Text style={styles.switchText}>전후면</Text>
      </Pressable>

      {voiceEnabled ? (
        <Pressable onPress={() => void testVoice()} style={styles.voiceTestButton}>
          <Text style={styles.voiceTestText}>음성 테스트</Text>
        </Pressable>
      ) : null}

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
  cameraDiagnostic: { color: '#b1bac4', fontSize: 10, fontWeight: '800', marginTop: 4, textAlign: 'center' },
  switchButton: { position: 'absolute', right: 12, bottom: 14, minWidth: 86, minHeight: 50, borderRadius: 15, backgroundColor: 'rgba(13,17,23,0.94)', borderWidth: 2, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  switchText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  voiceTestButton: { position: 'absolute', left: '50%', marginLeft: -52, bottom: 14, width: 104, minHeight: 50, borderRadius: 15, backgroundColor: 'rgba(22,101,52,0.94)', borderWidth: 2, borderColor: '#7ee787', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  voiceTestText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  manualButton: { position: 'absolute', left: 12, bottom: 14, minWidth: 96, minHeight: 50, borderRadius: 15, backgroundColor: 'rgba(13,17,23,0.94)', borderWidth: 2, borderColor: '#6e7681', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  manualText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  errorBox: { position: 'absolute', left: '25%', right: '25%', top: '45%', minHeight: 52, borderRadius: 15, backgroundColor: 'rgba(177,35,36,0.94)', alignItems: 'center', justifyContent: 'center', zIndex: 60 },
  errorText: { color: '#ffffff', fontSize: 16, fontWeight: '900' },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)', zIndex: 70 },
  loadingText: { color: '#ffffff', fontSize: 14, fontWeight: '900', marginTop: 10 },
});
