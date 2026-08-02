from pathlib import Path
import json

def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'marker missing in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

# Version code: v27.
app = Path('mobile/app.json')
app_data = json.loads(app.read_text(encoding='utf-8'))
app_data['expo']['android']['versionCode'] = 27
app.write_text(json.dumps(app_data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

# Testable 850 ms lock policy.
recovery = Path('mobile/services/camera-analysis-recovery.ts')
text = recovery.read_text(encoding='utf-8')
if 'STRUM_LOCK_HOLD_MS' not in text:
    text += """

export const STRUM_LOCK_HOLD_MS = 850;

export function extendStrumLockUntil(
  currentUntil: number,
  capturedAt: number,
  hasStrumHit: boolean,
  holdMs = STRUM_LOCK_HOLD_MS,
) {
  if (!hasStrumHit) return currentUntil;
  return Math.max(currentUntil, capturedAt + Math.max(0, holdMs));
}

export function isStrumLockActive(lockUntil: number, capturedAt: number) {
  return capturedAt < lockUntil;
}
"""
    recovery.write_text(text, encoding='utf-8')

replace_once(
    'mobile/tests/camera-analysis-recovery.test.ts',
    """  cameraRecoveryDecision,
  initialAnalysisDelayMs,
} from '../services/camera-analysis-recovery';""",
    """  cameraRecoveryDecision,
  extendStrumLockUntil,
  initialAnalysisDelayMs,
  isStrumLockActive,
  STRUM_LOCK_HOLD_MS,
} from '../services/camera-analysis-recovery';"""
)
replace_once(
    'mobile/tests/camera-analysis-recovery.test.ts',
    """assert.equal(initialAnalysisDelayMs(1_000, 2_000), 0, '안정 시간이 지난 뒤에는 바로 분석할 수 있어야 합니다.');

const region = deriveRightHandRegion(""",
    """assert.equal(initialAnalysisDelayMs(1_000, 2_000), 0, '안정 시간이 지난 뒤에는 바로 분석할 수 있어야 합니다.');

const lockUntil = extendStrumLockUntil(0, 10_000, true);
assert.equal(lockUntil, 10_000 + STRUM_LOCK_HOLD_MS, '스트럼 검출 뒤 잠금은 정확히 850ms 유지되어야 합니다.');
assert.equal(isStrumLockActive(lockUntil, 10_849), true, '850ms가 끝나기 전에는 스트럼 추적 잠금을 유지해야 합니다.');
assert.equal(isStrumLockActive(lockUntil, 10_850), false, '850ms가 끝나면 잠금을 해제할 수 있어야 합니다.');
assert.equal(extendStrumLockUntil(lockUntil, 10_400, true), 11_250, '잠금 중 새 스트럼이 오면 850ms를 다시 연장해야 합니다.');

const region = deriveRightHandRegion("""
)
replace_once(
    'mobile/tests/camera-analysis-recovery.test.ts',
    "console.log('Camera analysis recovery and calibrated ROI tests passed: 18');",
    "console.log('Camera analysis recovery, 850ms strum lock, and calibrated ROI tests passed: 22');"
)

# Android must use the native continuous CameraX path and feed accepted frames to voice.
camera = Path('mobile/components/LiveLocalCoachCamera.tsx')
text = camera.read_text(encoding='utf-8')
text = text.replace('  Platform,\n', '')
text = text.replace(
    "import { LiveRecognitionVoicePolicy } from '../services/live-recognition-voice-policy';",
    """import {
  extendStrumLockUntil,
  isStrumLockActive,
} from '../services/camera-analysis-recovery';
import { LiveRecognitionVoicePolicy } from '../services/live-recognition-voice-policy';"""
)
text = text.replace(
    """function pickColor(category: PracticeCategoryId) {
  return category === 'arpeggio' || category === 'fingerstyle' ? 'none' : 'auto';
}
""",
    """function pickColor(category: PracticeCategoryId) {
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
"""
)
text = text.replace(
    """  const lastAcceptedAtRef = useRef(0);
  const voicePolicyRef = useRef(new LiveRecognitionVoicePolicy());""",
    """  const lastAcceptedAtRef = useRef(0);
  const strumLockUntilRef = useRef(0);
  const lastStrumSpokenAtRef = useRef(0);
  const startupSpokenRef = useRef(false);
  const voicePolicyRef = useRef(new LiveRecognitionVoicePolicy());"""
)
text = text.replace(
    """    if (!voiceEnabled || !isCoachSpeechAvailable) {
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
      });""",
    """    if (!voiceEnabled || !isCoachSpeechAvailable) {
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
      });"""
)
text = text.replace(
    """  const updateLock = (next: boolean) => {
    if (lockedRef.current === next) return;
    lockedRef.current = next;
    onHandLockChange?.(next);
  };

  if (cameraFocus === 'full-body' || cameraFocus === 'none' || Platform.OS === 'android') {""",
    """  const testVoice = async () => {
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
  };

  const updateLock = (next: boolean) => {
    if (lockedRef.current === next) return;
    lockedRef.current = next;
    onHandLockChange?.(next);
  };

  if (cameraFocus === 'full-body' || cameraFocus === 'none') {"""
)
text = text.replace('        running\n', '        running={true}\n', 1)
text = text.replace(
    '        analyzeStrings={false}\n',
    '        analyzeStrings={STRING_ANALYSIS_CATEGORIES.has(category)}\n',
    1
)
old_analysis = """          const valid = next.hasHand && next.landmarks.length >= 21 && next.handednessScore >= 0.25;
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

          const nextPalm = (() => {"""
new_analysis = """          const capturedAt = Date.now();
          const valid = next.hasHand && next.landmarks.length >= 21 && next.handednessScore >= 0.20;
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

          const nextPalm = (() => {"""
if old_analysis not in text:
    raise SystemExit('LiveLocalCoachCamera analysis marker missing')
text = text.replace(old_analysis, new_analysis, 1)
text = text.replace(
    """          const nextStatus = nextLocked
            ? next.guitar?.detected""",
    """          const nextStatus = strumLockHeld && !valid
            ? '스트럼 추적 유지 중 · 다음 프레임 확인'
            : nextLocked
              ? next.guitar?.detected"""
)
text = text.replace(
    """              ? `손과 ${next.guitar.label || '기타'} 인식 완료`
              : '손 단독 인식 완료 · 기타는 별도 확인 중'
            : next.guitar?.detected""",
    """                ? `손과 ${next.guitar.label || '기타'} 인식 완료`
                : '손 단독 인식 완료 · 기타는 별도 확인 중'
              : next.guitar?.detected"""
)
text = text.replace(
    """          updateLock(false);
          announce(voicePolicyRef.current.next({""",
    """          strumLockUntilRef.current = 0;
          validFramesRef.current = 0;
          updateLock(false);
          announce(voicePolicyRef.current.next({"""
)
text = text.replace(
    """          validFramesRef.current = 0;
          updateLock(false);
          voicePolicyRef.current.reset();""",
    """          validFramesRef.current = 0;
          strumLockUntilRef.current = 0;
          updateLock(false);
          voicePolicyRef.current.reset();"""
)
text = text.replace(
    """      {onNeedCalibration ? (
        <Pressable onPress={() => onNeedCalibration(facing)} style={styles.manualButton}>""",
    """      {voiceEnabled ? (
        <Pressable onPress={() => void testVoice()} style={styles.voiceTestButton}>
          <Text style={styles.voiceTestText}>음성 테스트</Text>
        </Pressable>
      ) : null}

      {onNeedCalibration ? (
        <Pressable onPress={() => onNeedCalibration(facing)} style={styles.manualButton}>"""
)
text = text.replace(
    """  switchText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  manualButton:""",
    """  switchText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  voiceTestButton: { position: 'absolute', left: '50%', marginLeft: -52, bottom: 14, width: 104, minHeight: 50, borderRadius: 15, backgroundColor: 'rgba(22,101,52,0.94)', borderWidth: 2, borderColor: '#7ee787', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  voiceTestText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  manualButton:"""
)
camera.write_text(text, encoding='utf-8')

# Voice coach no longer demands an unrealistically close hand.
voice = Path('mobile/components/VoiceCoachController.tsx')
text = voice.read_text(encoding='utf-8')
replacements = {
    "'손목과 다섯 손가락 끝이 모두 보이도록 손을 가이드 안에 크게 맞추세요.'":
        "'손목과 다섯 손가락 끝이 보이도록 손을 화면 안에 맞추세요.'",
    "'손 하나만 화면의 절반 이상 보이게 한 뒤 3회 연주하세요.'":
        "'손 하나가 화면 안에 들어오게 한 뒤 3회 연주하세요.'",
    "'손 동작을 판정할 수 없습니다. 손목과 다섯 손가락 끝이 모두 보이게 가까이 맞춰 주세요.'":
        "'손 동작을 판정할 수 없습니다. 손목과 다섯 손가락 끝이 화면 안에 보이게 맞춰 주세요.'",
    'if (palmSize < 0.13) {': 'if (palmSize < 0.075) {',
    "'손목과 손가락 끝이 잘리지 않는 범위에서 휴대폰을 더 가까이 두세요.'":
        "'손목과 손가락 끝이 보이도록 조명과 카메라 각도를 먼저 맞추세요.'",
    "'손바닥 길이가 화면의 약 18~55%가 되게 맞추세요.'":
        "'손바닥 길이가 화면의 약 8~55%가 되게 맞추세요.'",
    "'손가락이 너무 작게 보입니다. 손목과 손가락 끝이 크게 보이도록 카메라를 가까이 두세요.'":
        "'손이 흐리게 보입니다. 손목과 손가락 끝이 보이도록 조명과 각도를 맞춰 주세요.'",
}
for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f'VoiceCoach marker missing: {old}')
    text = text.replace(old, new, 1)
voice.write_text(text, encoding='utf-8')

# Relax only the overly strict temporal/string gates; keep geometry checks.
quality = Path('mobile/services/continuous-tracking-quality.ts')
text = quality.read_text(encoding='utf-8')
for old, new in [
    ('next.handednessScore < 0.32', 'next.handednessScore < 0.20'),
    ('tracking.confidence < 0.38', 'tracking.confidence < 0.28'),
    ('distanceRatio <= 1.12', 'distanceRatio <= 1.42'),
    ('distanceRatio <= 0.72', 'distanceRatio <= 0.90'),
    ('tracking.confidence >= 0.50', 'tracking.confidence >= 0.36'),
    ("(tracking.stabilityConfidence ?? 0) >= 0.52", "(tracking.stabilityConfidence ?? 0) >= 0.40"),
    ('tracking.numberingConfidence >= 0.66', 'tracking.numberingConfidence >= 0.54'),
    ('distanceRatio / 1.15', 'distanceRatio / 1.45'),
    ('contact.distanceRatio > 0.74', 'contact.distanceRatio > 0.96'),
    ('contact.confidence < 0.50', 'contact.confidence < 0.38'),
    ('confidence < 0.54', 'confidence < 0.44'),
]:
    if old not in text:
        raise SystemExit(f'quality gate marker missing: {old}')
    text = text.replace(old, new, 1)
quality.write_text(text, encoding='utf-8')

# CameraX child layout, frame watchdog/rebind, relaxed detection, and native 850ms lock.
native = Path('mobile/modules/guitar-coach-native/android/src/main/java/expo/modules/guitarcoachnative/GuitarCoachContinuousCameraModule.kt')
text = native.read_text(encoding='utf-8')
text = text.replace(
    'import android.os.SystemClock\nimport android.util.Size\nimport android.view.ViewGroup.LayoutParams\n',
    'import android.os.Handler\nimport android.os.Looper\nimport android.os.SystemClock\nimport android.util.Size\nimport android.view.View.MeasureSpec\nimport android.view.ViewGroup.LayoutParams\n'
)
text = text.replace(
    """  private val previousContacts = mutableMapOf<String, PreviousContact>()
  private val recentHits = ArrayDeque<Map<String, Any>>()

  fun setRunning(value: Boolean) {""",
    """  private val previousContacts = mutableMapOf<String, PreviousContact>()
  private val recentHits = ArrayDeque<Map<String, Any>>()
  private val mainHandler = Handler(Looper.getMainLooper())
  private var lastFrameReceivedAt = 0L
  private var cameraRestarting = false
  private var strumLockUntilMs = 0L
  private val frameWatchdog = object : Runnable {
    override fun run() {
      if (destroyed || !running || !isAttachedToWindow) return
      val now = SystemClock.elapsedRealtime()
      if (
        cameraProvider != null
        && lastFrameReceivedAt > 0
        && now - lastFrameReceivedAt > 1_600
        && !cameraRestarting
      ) {
        restartCamera()
      }
      mainHandler.postDelayed(this, 750)
    }
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    super.onMeasure(widthMeasureSpec, heightMeasureSpec)
    previewView.measure(
      MeasureSpec.makeMeasureSpec(measuredWidth, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(measuredHeight, MeasureSpec.EXACTLY)
    )
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    previewView.layout(0, 0, right - left, bottom - top)
  }

  fun setRunning(value: Boolean) {"""
)
text = text.replace(
    """    running = value
    if (value) post { startCamera() } else post { stopCamera() }""",
    """    running = value
    mainHandler.removeCallbacks(frameWatchdog)
    if (value) {
      mainHandler.post(frameWatchdog)
      post { startCamera() }
    } else {
      post { stopCamera() }
    }"""
)
text = text.replace(
    """  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (running && !destroyed) post { startCamera() }
  }

  override fun onDetachedFromWindow() {
    stopCamera()
    super.onDetachedFromWindow()
  }

  private fun startCamera() {""",
    """  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    mainHandler.removeCallbacks(frameWatchdog)
    if (running && !destroyed) {
      mainHandler.post(frameWatchdog)
      post { startCamera() }
    }
  }

  override fun onDetachedFromWindow() {
    mainHandler.removeCallbacks(frameWatchdog)
    stopCamera()
    super.onDetachedFromWindow()
  }

  private fun restartCamera() {
    if (destroyed || !running || cameraRestarting || !isAttachedToWindow) return
    cameraRestarting = true
    stopCamera()
    mainHandler.postDelayed({
      cameraRestarting = false
      if (!destroyed && running && isAttachedToWindow) startCamera()
    }, 180)
  }

  private fun startCamera() {"""
)
text = text.replace(
    """        cameraProvider = provider
        boundCamera = camera""",
    """        cameraProvider = provider
        boundCamera = camera
        cameraRestarting = false
        lastFrameReceivedAt = SystemClock.elapsedRealtime()"""
)
text = text.replace(
    """      } catch (error: Throwable) {
        stopCamera()
        onError""",
    """      } catch (error: Throwable) {
        cameraRestarting = false
        stopCamera()
        onError"""
)
old_stop = """  private fun stopCamera() {
    analysisUseCase?.clearAnalyzer()
    val provider = cameraProvider
    val preview = previewUseCase
    val analysis = analysisUseCase
    if (provider != null && preview != null && analysis != null) {
      runCatching { provider.unbind(preview, analysis) }
    }
    cameraProvider = null
    boundCamera = null
    previewUseCase = null
    analysisUseCase = null
    resetTracking()
  }"""
new_stop = """  private fun stopCamera() {
    analysisUseCase?.clearAnalyzer()
    cameraProvider?.let { provider ->
      runCatching { provider.unbindAll() }
    }
    cameraProvider = null
    boundCamera = null
    previewUseCase = null
    analysisUseCase = null
    lastFrameReceivedAt = 0
    resetTracking()
  }"""
if old_stop not in text:
    raise SystemExit('native stopCamera marker missing')
text = text.replace(old_stop, new_stop, 1)
text = text.replace(
    """    running = false
    stopCamera()
    handLandmarker?.close()""",
    """    running = false
    mainHandler.removeCallbacksAndMessages(null)
    stopCamera()
    handLandmarker?.close()"""
)
text = text.replace(
    """    recentHits.clear()
  }

  private fun resetSpatialTracking()""",
    """    recentHits.clear()
    strumLockUntilMs = 0
  }

  private fun resetSpatialTracking()"""
)
text = text.replace(
    """    val startedAt = SystemClock.elapsedRealtime()
    if (spatialResetRequested.compareAndSet(true, false))""",
    """    val startedAt = SystemClock.elapsedRealtime()
    lastFrameReceivedAt = startedAt
    if (spatialResetRequested.compareAndSet(true, false))"""
)
text = text.replace(
    '      if (hand?.hasHand != true) previousContacts.clear()\n',
    '      if (hand?.hasHand != true && startedAt >= strumLockUntilMs) previousContacts.clear()\n'
)
text = text.replace(
    """          if (consecutiveStringMisses >= 2) {
            lastStringState = null
            previousContacts.clear()
          }""",
    """          if (consecutiveStringMisses >= 4 && startedAt >= strumLockUntilMs) {
            lastStringState = null
            previousContacts.clear()
          }"""
)
text = text.replace(
    """      val hits = detectHits(contacts, timestamp)
      hits.forEach { hit ->""",
    """      val hits = detectHits(contacts, timestamp)
      if (hits.isNotEmpty()) {
        strumLockUntilMs = max(strumLockUntilMs, timestamp + 850)
      }
      hits.forEach { hit ->"""
)
text = text.replace(
    """        "autoFramingState" to autoFramingState,
        "newHits" to hits,""",
    """        "autoFramingState" to autoFramingState,
        "strumLockActive" to (SystemClock.elapsedRealtime() < strumLockUntilMs),
        "strumLockRemainingMs" to max(0L, strumLockUntilMs - SystemClock.elapsedRealtime()),
        "newHits" to hits,"""
)
for old, new in [
    ('.setMinHandDetectionConfidence(0.30f)', '.setMinHandDetectionConfidence(0.20f)'),
    ('.setMinHandPresenceConfidence(0.30f)', '.setMinHandPresenceConfidence(0.20f)'),
    ('.setMinTrackingConfidence(0.34f)', '.setMinTrackingConfidence(0.24f)'),
    ('palm < 0.115 -> currentZoomRatio * min(1.38, (0.235 / palm).pow(0.42)).toFloat()', 'palm < 0.080 -> currentZoomRatio * min(1.22, (0.170 / palm).pow(0.34)).toFloat()'),
    ('palm < 0.165 -> currentZoomRatio * 1.18f', 'palm < 0.110 -> currentZoomRatio * 1.10f'),
    ('palm < 0.205 -> currentZoomRatio * 1.08f', 'palm < 0.140 -> currentZoomRatio * 1.04f'),
    ('palm > 0.54 -> currentZoomRatio * 0.76f', 'palm > 0.58 -> currentZoomRatio * 0.78f'),
    ('palm > 0.43 -> currentZoomRatio * 0.88f', 'palm > 0.48 -> currentZoomRatio * 0.90f'),
    ('palm < 0.205 && currentZoomRatio >= maxZoom * 0.98f', 'palm < 0.140 && currentZoomRatio >= maxZoom * 0.98f'),
    ('palm < 0.205 -> "zooming-in"', 'palm < 0.140 -> "zooming-in"'),
    ('palm > 0.43 -> "zooming-out"', 'palm > 0.48 -> "zooming-out"'),
    ('candidate.confidence < 0.34', 'candidate.confidence < 0.26'),
    ('pick.confidence >= 0.32', 'pick.confidence >= 0.24'),
    ('distance <= 1.16', 'distance <= 1.46'),
    ('distance <= 0.76', 'distance <= 0.92'),
    ('strings.confidence >= 0.48', 'strings.confidence >= 0.34'),
    ('strings.numberingConfidence >= 0.62', 'strings.numberingConfidence >= 0.50'),
    ('previous.distanceRatio > 0.48 && contact.distanceRatio <= 0.32', 'previous.distanceRatio > 0.70 && contact.distanceRatio <= 0.48'),
    ('contact.speed >= 0.16', 'contact.speed >= 0.10'),
]:
    if old not in text:
        raise SystemExit(f'native marker missing: {old}')
    text = text.replace(old, new, 1)
native.write_text(text, encoding='utf-8')
