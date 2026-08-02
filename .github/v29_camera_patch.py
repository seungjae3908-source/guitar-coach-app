from pathlib import Path
import json


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"missing marker in {path}: {old[:160]!r}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


app_path = Path("mobile/app.json")
app = json.loads(app_path.read_text(encoding="utf-8"))
app["expo"]["android"]["versionCode"] = 29
app_path.write_text(json.dumps(app, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

native_path = "mobile/modules/guitar-coach-native/android/src/main/java/expo/modules/guitarcoachnative/GuitarCoachContinuousCameraModule.kt"

replace_once(
    native_path,
    """  private val previewView = PreviewView(context).also {
    it.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    it.scaleType = PreviewView.ScaleType.FILL_CENTER
    it.implementationMode = PreviewView.ImplementationMode.COMPATIBLE
    addView(it)
  }""",
    """  private var previewMode = PreviewView.ImplementationMode.COMPATIBLE
  private val previewView = PreviewView(context).also {
    it.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    it.scaleType = PreviewView.ScaleType.FILL_CENTER
    it.implementationMode = previewMode
    it.setBackgroundColor(Color.TRANSPARENT)
    it.alpha = 1.0f
    addView(it)
  }""",
)

replace_once(
    native_path,
    """  private var lastFrameReceivedAt = 0L
  private var cameraRestarting = false
  private var strumLockUntilMs = 0L""",
    """  @Volatile private var lastFrameReceivedAt = 0L
  @Volatile private var previewStreamState = \"idle\"
  @Volatile private var frameBrightness = 0.0
  @Volatile private var consecutiveDarkFrames = 0
  @Volatile private var healthyFrameCount = 0
  @Volatile private var recoveryCount = 0
  @Volatile private var lastRecoveryReason = \"\"
  private var cameraBoundAt = 0L
  private var lastRecoveryAt = 0L
  private var cameraRestarting = false
  private var strumLockUntilMs = 0L""",
)

replace_once(
    native_path,
    """      if (
        cameraProvider != null
        && lastFrameReceivedAt > 0
        && now - lastFrameReceivedAt > 1_600
        && !cameraRestarting
      ) {
        restartCamera()
      }
      mainHandler.postDelayed(this, 750)""",
    """      val noFrame = cameraProvider != null
        && lastFrameReceivedAt > 0
        && now - lastFrameReceivedAt > 1_600
      val previewIdle = cameraProvider != null
        && cameraBoundAt > 0
        && now - cameraBoundAt > 2_200
        && previewStreamState != \"streaming\"
      val darkFeed = cameraProvider != null
        && consecutiveDarkFrames >= 12
        && now - lastRecoveryAt > 2_200
      if (!cameraRestarting && (noFrame || previewIdle || darkFeed)) {
        val reason = when {
          noFrame -> \"no-analysis-frame\"
          darkFeed -> \"dark-analysis-frame\"
          else -> \"preview-not-streaming\"
        }
        restartCamera(reason, previewIdle || darkFeed)
      }
      mainHandler.postDelayed(this, 650)""",
)

replace_once(
    native_path,
    """  private fun restartCamera() {
    if (destroyed || !running || cameraRestarting || !isAttachedToWindow) return
    cameraRestarting = true
    stopCamera()
    mainHandler.postDelayed({
      cameraRestarting = false
      if (!destroyed && running && isAttachedToWindow) startCamera()
    }, 180)
  }""",
    """  private fun restartCamera(reason: String, switchPreviewMode: Boolean = false) {
    if (destroyed || !running || cameraRestarting || !isAttachedToWindow) return
    cameraRestarting = true
    recoveryCount += 1
    lastRecoveryReason = reason
    lastRecoveryAt = SystemClock.elapsedRealtime()
    if (switchPreviewMode) {
      previewMode = if (previewMode == PreviewView.ImplementationMode.COMPATIBLE) {
        PreviewView.ImplementationMode.PERFORMANCE
      } else {
        PreviewView.ImplementationMode.COMPATIBLE
      }
      previewView.implementationMode = previewMode
    }
    stopCamera()
    mainHandler.postDelayed({
      cameraRestarting = false
      if (!destroyed && running && isAttachedToWindow) startCamera()
    }, 260)
  }""",
)

replace_once(
    native_path,
    """        val provider = future.get()
        val preview = Preview.Builder().build().also {
          it.setSurfaceProvider(previewView.surfaceProvider)
        }
        val analysis = ImageAnalysis.Builder()
          .setTargetResolution(Size(960, 720))
          .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
          .setOutputImageRotationEnabled(true)
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
          .build()""",
    """        val provider = future.get()
        previewView.implementationMode = previewMode
        previewView.alpha = 1.0f
        previewView.setBackgroundColor(Color.TRANSPARENT)
        previewView.previewStreamState.removeObservers(lifecycleOwner)
        previewView.previewStreamState.observe(lifecycleOwner) { state ->
          previewStreamState = if (state == PreviewView.StreamState.STREAMING) {
            \"streaming\"
          } else {
            \"idle\"
          }
        }
        val preview = Preview.Builder()
          .setTargetResolution(Size(1280, 720))
          .build().also {
            it.setSurfaceProvider(previewView.surfaceProvider)
          }
        val analysis = ImageAnalysis.Builder()
          .setTargetResolution(Size(640, 480))
          .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
          .setOutputImageRotationEnabled(true)
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
          .build()""",
)

replace_once(
    native_path,
    """        cameraProvider = provider
        boundCamera = camera
        cameraRestarting = false
        lastFrameReceivedAt = SystemClock.elapsedRealtime()
        currentZoomRatio = camera.cameraInfo.zoomState.value?.zoomRatio ?: 1.0f
        previewUseCase = preview
        analysisUseCase = analysis
        resetTracking()
        onCameraReady(""",
    """        cameraProvider = provider
        boundCamera = camera
        cameraRestarting = false
        cameraBoundAt = SystemClock.elapsedRealtime()
        lastFrameReceivedAt = cameraBoundAt
        currentZoomRatio = camera.cameraInfo.zoomState.value?.zoomRatio ?: 1.0f
        previewUseCase = preview
        analysisUseCase = analysis
        resetTracking()
        previewView.post {
          preview.setSurfaceProvider(previewView.surfaceProvider)
          previewView.requestLayout()
          previewView.invalidate()
        }
        onCameraReady(""",
)

replace_once(
    native_path,
    """            \"autoFraming\" to true,
            \"facing\" to facing,
            \"guitarClassifier\" to true""",
    """            \"autoFraming\" to true,
            \"facing\" to facing,
            \"guitarClassifier\" to true,
            \"previewMode\" to previewMode.name.lowercase(),
            \"analysisFormat\" to \"yuv_420_888\"""",
)

replace_once(
    native_path,
    """  private fun stopCamera() {
    analysisUseCase?.clearAnalyzer()
    cameraProvider?.let { provider ->""",
    """  private fun stopCamera() {
    analysisUseCase?.clearAnalyzer()
    val lifecycleOwner = appContext.activityProvider?.currentActivity as? LifecycleOwner
    if (lifecycleOwner != null) {
      runCatching { previewView.previewStreamState.removeObservers(lifecycleOwner) }
    }
    cameraProvider?.let { provider ->""",
)

replace_once(
    native_path,
    """    analysisUseCase = null
    lastFrameReceivedAt = 0
    resetTracking()""",
    """    analysisUseCase = null
    lastFrameReceivedAt = 0
    cameraBoundAt = 0
    previewStreamState = \"idle\"
    resetTracking()""",
)

replace_once(
    native_path,
    """    cameraFps = 0.0
    analysisFps = 0.0
    lastAnalysisEventAt = 0""",
    """    cameraFps = 0.0
    analysisFps = 0.0
    frameBrightness = 0.0
    consecutiveDarkFrames = 0
    healthyFrameCount = 0
    lastAnalysisEventAt = 0""",
)

replace_once(
    native_path,
    """      bitmap = image.toBitmap()
      val timestamp = max(lastTimestampMs + 1, startedAt)
      lastTimestampMs = timestamp

      val shouldRefreshHand""",
    """      bitmap = image.toBitmap()
      frameBrightness = estimateBrightness(bitmap)
      if (frameBrightness < 5.5) {
        consecutiveDarkFrames += 1
        healthyFrameCount = 0
      } else {
        consecutiveDarkFrames = 0
        healthyFrameCount = min(120, healthyFrameCount + 1)
      }
      val timestamp = max(lastTimestampMs + 1, startedAt)
      lastTimestampMs = timestamp

      val shouldRefreshHand""",
)

replace_once(
    native_path,
    """        \"strumLockActive\" to (SystemClock.elapsedRealtime() < strumLockUntilMs),
        \"strumLockRemainingMs\" to max(0L, strumLockUntilMs - SystemClock.elapsedRealtime()),
        \"newHits\" to hits,""",
    """        \"strumLockActive\" to (SystemClock.elapsedRealtime() < strumLockUntilMs),
        \"strumLockRemainingMs\" to max(0L, strumLockUntilMs - SystemClock.elapsedRealtime()),
        \"cameraFeed\" to mapOf(
          \"previewStreamState\" to previewStreamState,
          \"previewMode\" to previewMode.name.lowercase(),
          \"analysisFormat\" to \"yuv_420_888\",
          \"brightness\" to frameBrightness,
          \"darkFrameCount\" to consecutiveDarkFrames,
          \"healthyFrameCount\" to healthyFrameCount,
          \"feedHealthy\" to (frameBrightness >= 5.5 && healthyFrameCount >= 2),
          \"recoveryCount\" to recoveryCount,
          \"lastRecoveryReason\" to lastRecoveryReason
        ),
        \"newHits\" to hits,""",
)

replace_once(
    native_path,
    """  private fun gray(color: Int): Double =
    (Color.red(color) * 30 + Color.green(color) * 59 + Color.blue(color) * 11) / 100.0""",
    """  private fun estimateBrightness(bitmap: Bitmap): Double {
    val stepX = max(1, bitmap.width / 24)
    val stepY = max(1, bitmap.height / 24)
    var sum = 0.0
    var count = 0
    var y = stepY / 2
    while (y < bitmap.height) {
      var x = stepX / 2
      while (x < bitmap.width) {
        sum += gray(bitmap.getPixel(x, y))
        count += 1
        x += stepX
      }
      y += stepY
    }
    return if (count > 0) sum / count else 0.0
  }

  private fun gray(color: Int): Double =
    (Color.red(color) * 30 + Color.green(color) * 59 + Color.blue(color) * 11) / 100.0""",
)

Path("mobile/V29_CAMERA_FEED_REPORT.md").write_text(
    """# v29 camera feed and speech recovery\n\n"
    "- CameraX analysis changed from RGBA to YUV 420 888 for Samsung compatibility.\n"
    "- Preview stream state and sampled frame brightness are monitored.\n"
    "- Missing, idle, or black frames trigger automatic rebind and PreviewView mode fallback.\n"
    "- The UI receives brightness, preview mode, stream state, and recovery diagnostics.\n"
    "- TTS waits for the Android utterance completion callback and reports real playback errors.\n"
    "- PR #16 remains Draft and unmerged; main is unchanged.\n"
    """,
    encoding="utf-8",
)
