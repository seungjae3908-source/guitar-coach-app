from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"missing marker in {path}: {old[:180]!r}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


Path("mobile/services/camera-feed-health.ts").write_text('''export type CameraFeedDiagnostics = {
  previewStreamState?: string;
  previewMode?: string;
  analysisFormat?: string;
  brightness?: number;
  darkFrameCount?: number;
  healthyFrameCount?: number;
  feedHealthy?: boolean;
  recoveryCount?: number;
  lastRecoveryReason?: string;
};

export type CameraFeedHealth = {
  healthy: boolean;
  recovering: boolean;
  brightnessPercent: number;
  label: string;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function getCameraFeedHealth(feed?: CameraFeedDiagnostics): CameraFeedHealth {
  if (!feed) {
    return {
      healthy: false,
      recovering: false,
      brightnessPercent: 0,
      label: '영상 진단 대기 중',
    };
  }
  const brightness = Number.isFinite(feed.brightness) ? Number(feed.brightness) : 0;
  const brightnessPercent = Math.round(clamp(brightness / 255 * 100, 0, 100));
  const healthy = feed.feedHealthy === true
    || (brightness >= 5.5 && (feed.healthyFrameCount ?? 0) >= 2);
  const recovering = !healthy && (feed.recoveryCount ?? 0) > 0;
  const mode = feed.previewMode === 'performance' ? '성능' : '호환';
  const stream = feed.previewStreamState === 'streaming' ? '스트리밍' : '연결 중';
  return {
    healthy,
    recovering,
    brightnessPercent,
    label: healthy
      ? `영상 정상 ${brightnessPercent}% · ${stream} · ${mode} 모드`
      : recovering
        ? `검은 영상 복구 중 · ${mode} 모드 · ${feed.recoveryCount ?? 0}회`
        : `영상 확인 중 ${brightnessPercent}% · ${stream}`,
  };
}
''', encoding="utf-8")

Path("mobile/tests/camera-feed-health.test.ts").write_text('''import { getCameraFeedHealth } from '../services/camera-feed-health';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`카메라 영상 진단 테스트 실패: ${message}`);
}

const waiting = getCameraFeedHealth();
assert(!waiting.healthy, '진단값이 없으면 정상 영상으로 처리하면 안 됩니다.');

const black = getCameraFeedHealth({
  previewStreamState: 'streaming',
  previewMode: 'compatible',
  brightness: 0.8,
  darkFrameCount: 14,
  healthyFrameCount: 0,
  feedHealthy: false,
  recoveryCount: 1,
});
assert(!black.healthy, '검은 프레임을 정상 영상으로 처리하면 안 됩니다.');
assert(black.recovering, '자동 재연결 중임을 표시해야 합니다.');

const healthy = getCameraFeedHealth({
  previewStreamState: 'streaming',
  previewMode: 'compatible',
  brightness: 64,
  darkFrameCount: 0,
  healthyFrameCount: 5,
  feedHealthy: true,
  recoveryCount: 1,
});
assert(healthy.healthy, '밝기가 확보된 연속 프레임은 정상으로 처리해야 합니다.');
assert(healthy.brightnessPercent === 25, '밝기 백분율을 계산해야 합니다.');

console.log('camera-feed health: 7 checks passed');
''', encoding="utf-8")

quality_path = "mobile/services/continuous-tracking-quality.ts"
replace_once(
    quality_path,
    """  autoZoomRatio?: number;
  autoFramingState?: AutoFramingState;
  newHits: QualityStringHit[];""",
    """  autoZoomRatio?: number;
  autoFramingState?: AutoFramingState;
  strumLockActive?: boolean;
  strumLockRemainingMs?: number;
  cameraFeed?: {
    previewStreamState?: string;
    previewMode?: string;
    analysisFormat?: string;
    brightness?: number;
    darkFrameCount?: number;
    healthyFrameCount?: number;
    feedHealthy?: boolean;
    recoveryCount?: number;
    lastRecoveryReason?: string;
  };
  newHits: QualityStringHit[];""",
)

camera_path = "mobile/components/LiveLocalCoachCamera.tsx"
replace_once(
    camera_path,
    """import {
  extendStrumLockUntil,
  isStrumLockActive,
} from '../services/camera-analysis-recovery';
import { LiveRecognitionVoicePolicy }""",
    """import {
  extendStrumLockUntil,
  isStrumLockActive,
} from '../services/camera-analysis-recovery';
import { getCameraFeedHealth } from '../services/camera-feed-health';
import { LiveRecognitionVoicePolicy }""",
)

replace_once(
    camera_path,
    """  const [result, setResult] = useState<ContinuousHandAnalysisResult | null>(null);
  const [error, setError] = useState('');
  const frameRef = useRef(0);""",
    """  const [result, setResult] = useState<ContinuousHandAnalysisResult | null>(null);
  const [error, setError] = useState('');
  const [voiceDiagnostic, setVoiceDiagnostic] = useState(
    voiceEnabled ? '음성 엔진 준비 중' : '음성 꺼짐',
  );
  const frameRef = useRef(0);""",
)

replace_once(
    camera_path,
    """  const lastStrumSpokenAtRef = useRef(0);
  const startupSpokenRef = useRef(false);""",
    """  const lastStrumSpokenAtRef = useRef(0);
  const lastRecoverySpokenRef = useRef(0);
  const startupSpokenRef = useRef(false);""",
)

replace_once(
    camera_path,
    """  useEffect(() => {
    if (!voiceEnabled || !isCoachSpeechAvailable) {
      speechReadyRef.current = false;
      startupSpokenRef.current = false;
      void stopCoachSpeechAsync();
      return;
    }
    let cancelled = false;
    void prepareCoachSpeechAsync()
      .then(async () => {
        if (cancelled) return;
        speechReadyRef.current = true;
        if (startupSpokenRef.current || speechBusyRef.current) return;
        startupSpokenRef.current = true;
        speechBusyRef.current = true;
        try {
          await speakCoachPhraseAsync(
            '음성 코치가 시작되었습니다. 손과 기타를 화면 안에 맞춰 주세요.',
            { interrupt: true, speechRate: 1.02 },
          );
        } finally {
          speechBusyRef.current = false;
        }
      })
      .catch(() => {
        speechReadyRef.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [voiceEnabled]);""",
    """  useEffect(() => {
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
  }, [voiceEnabled]);""",
)

replace_once(
    camera_path,
    """  const announce = (phrase: string | null) => {
    if (!phrase || !voiceEnabled || !speechReadyRef.current || speechBusyRef.current) return;
    speechBusyRef.current = true;
    void speakCoachPhraseAsync(phrase, { interrupt: false, speechRate: 1.02 })
      .catch(() => undefined)
      .finally(() => {
        speechBusyRef.current = false;
      });
  };

  const testVoice = async () => {
    if (!voiceEnabled || !isCoachSpeechAvailable || speechBusyRef.current) return;
    speechBusyRef.current = true;
    try {
      await prepareCoachSpeechAsync();
      speechReadyRef.current = true;
      await speakCoachPhraseAsync(
        '음성 테스트입니다. 오른손과 기타 줄을 화면 안에 맞춰 주세요.',
        { interrupt: true, speechRate: 1.02 },
      );
    } finally {
      speechBusyRef.current = false;
    }
  };""",
    """  const announce = (phrase: string | null) => {
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
  };""",
)

replace_once(
    camera_path,
    """  const handReady = Boolean(result?.hasHand && result.landmarks.length >= 21);
  const guitarReady = Boolean(result?.guitar?.detected);""",
    """  const cameraFeedHealth = getCameraFeedHealth(result?.continuous?.cameraFeed);
  const handReady = Boolean(
    cameraFeedHealth.healthy && result?.hasHand && result.landmarks.length >= 21,
  );
  const guitarReady = Boolean(cameraFeedHealth.healthy && result?.guitar?.detected);""",
)

replace_once(
    camera_path,
    """  const status = error
    ? '분석 오류'
    : handReady && guitarReady""",
    """  const status = error
    ? '분석 오류'
    : result && !cameraFeedHealth.healthy
      ? cameraFeedHealth.recovering
        ? '검은 카메라 영상 자동 복구 중'
        : '카메라 실제 영상 확인 중'
    : handReady && guitarReady""",
)

replace_once(
    camera_path,
    """          const capturedAt = Date.now();
          const valid = next.hasHand && next.landmarks.length >= 21;
          const newHits = next.continuous?.newHits ?? [];""",
    """          const capturedAt = Date.now();
          const nextFeedHealth = getCameraFeedHealth(next.continuous?.cameraFeed);
          const valid = nextFeedHealth.healthy && next.hasHand && next.landmarks.length >= 21;
          const newHits = next.continuous?.newHits ?? [];""",
)

replace_once(
    camera_path,
    """          const nextPalm = (() => {
            const wrist = next.landmarks[0];""",
    """          const recoveryCount = next.continuous?.cameraFeed?.recoveryCount ?? 0;
          if (
            !nextFeedHealth.healthy
            && recoveryCount > lastRecoverySpokenRef.current
          ) {
            lastRecoverySpokenRef.current = recoveryCount;
            announce('카메라 영상이 들어오지 않아 자동으로 다시 연결합니다.');
          }

          const nextPalm = (() => {
            const wrist = next.landmarks[0];""",
)

replace_once(
    camera_path,
    """          const nextStatus = strumLockHeld && !valid
            ? '스트럼 추적 유지 중 · 다음 프레임 확인'
            : nextLocked""",
    """          const nextStatus = !nextFeedHealth.healthy
            ? nextFeedHealth.label
            : strumLockHeld && !valid
              ? '스트럼 추적 유지 중 · 다음 프레임 확인'
            : nextLocked""",
)

replace_once(
    camera_path,
    """          onStatus?.(nextStatus);
          announce(voicePolicyRef.current.next({
            running: true,
            cameraReady: ready || true,
            hasHand: next.hasHand,
            handConfidence: next.hasHand && next.landmarks.length >= 21
              ? Math.max(0.65, next.handednessScore)
              : 0,
            palmSize: nextPalm,
            guitarDetected: Boolean(next.guitar?.detected),
            guitarType: next.guitar?.type ?? 'unknown',
            guitarConfidence: next.guitar?.confidence ?? 0,
          }));""",
    """          onStatus?.(nextStatus);
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
          }""",
)

replace_once(
    camera_path,
    """      <View pointerEvents=\"none\" style={styles.voiceStatus}>
        <Text style={styles.voiceStatusText}>{voiceEnabled ? '🔊 음성 안내' : '음성 꺼짐'}</Text>
        <Text style={styles.mainStatus}>{status}</Text>
      </View>""",
    """      <View pointerEvents=\"none\" style={styles.voiceStatus}>
        <Text style={styles.voiceStatusText}>{voiceDiagnostic}</Text>
        <Text style={styles.mainStatus}>{status}</Text>
        <Text style={styles.cameraDiagnostic}>{cameraFeedHealth.label}</Text>
      </View>""",
)

replace_once(
    camera_path,
    """  mainStatus: { color: '#ffffff', fontSize: 15, fontWeight: '900', marginTop: 3, textAlign: 'center' },
  switchButton:""",
    """  mainStatus: { color: '#ffffff', fontSize: 15, fontWeight: '900', marginTop: 3, textAlign: 'center' },
  cameraDiagnostic: { color: '#b1bac4', fontSize: 10, fontWeight: '800', marginTop: 4, textAlign: 'center' },
  switchButton:""",
)
