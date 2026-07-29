package expo.modules.guitarcoachnative

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.os.SystemClock
import android.util.Size
import android.view.ViewGroup.LayoutParams
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

class GuitarCoachContinuousCameraModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GuitarCoachContinuousCamera")

    Constant("androidContinuousRightHandAvailable") { true }

    View(GuitarCoachContinuousCameraView::class) {
      Events("onCameraReady", "onAnalysis", "onError")

      Prop("running", false) { view: GuitarCoachContinuousCameraView, running: Boolean ->
        view.setRunning(running)
      }

      Prop("pickColor", "auto") { view: GuitarCoachContinuousCameraView, pickColor: String ->
        view.setPickColor(pickColor)
      }

      OnViewDestroys { view: GuitarCoachContinuousCameraView ->
        view.destroy()
      }
    }
  }
}

class GuitarCoachContinuousCameraView(
  context: Context,
  appContext: AppContext
) : ExpoView(context, appContext) {
  val onCameraReady by EventDispatcher()
  val onAnalysis by EventDispatcher()
  val onError by EventDispatcher()

  private val previewView = PreviewView(context).also {
    it.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    it.scaleType = PreviewView.ScaleType.FILL_CENTER
    it.implementationMode = PreviewView.ImplementationMode.PERFORMANCE
    addView(it)
  }

  private val analysisExecutor: ExecutorService = Executors.newSingleThreadExecutor()
  private val eventPending = AtomicBoolean(false)
  private var latestPayload: Map<String, Any?>? = null
  private var cameraProvider: ProcessCameraProvider? = null
  private var previewUseCase: Preview? = null
  private var analysisUseCase: ImageAnalysis? = null
  private var handLandmarker: HandLandmarker? = null
  private var running = false
  private var destroyed = false
  private var pickColor = "auto"
  private var frameCount = 0L
  private var analyzedFrameCount = 0L
  private var lastTimestampMs = 0L
  private var fpsWindowStartedAt = 0L
  private var fpsWindowFrames = 0
  private var cameraFps = 0.0
  private var analysisFps = 0.0
  private var lastAnalysisEventAt = 0L
  private var lastHandResult: LiveHandResult? = null
  private var lastStringState: LiveStringState? = null
  private var lastStringRefreshFrame = 0L
  private val previousContacts = mutableMapOf<String, PreviousContact>()
  private val recentHits = ArrayDeque<Map<String, Any>>()

  fun setRunning(value: Boolean) {
    if (running == value || destroyed) return
    running = value
    if (value) post { startCamera() } else post { stopCamera() }
  }

  fun setPickColor(value: String) {
    pickColor = value.lowercase()
  }

  private fun startCamera() {
    if (!running || destroyed || cameraProvider != null) return
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      onError(mapOf("message" to "연속 오른손 분석에 카메라 권한이 필요합니다."))
      return
    }
    val lifecycleOwner = appContext.activityProvider?.currentActivity as? LifecycleOwner
    if (lifecycleOwner == null) {
      onError(mapOf("message" to "카메라 생명주기를 연결할 수 없습니다."))
      return
    }

    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      if (!running || destroyed) return@addListener
      try {
        val provider = future.get()
        val preview = Preview.Builder().build().also {
          it.setSurfaceProvider(previewView.surfaceProvider)
        }
        val analysis = ImageAnalysis.Builder()
          .setTargetResolution(Size(960, 720))
          .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
          .setOutputImageRotationEnabled(true)
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
          .build()
        analysis.setAnalyzer(analysisExecutor) { image -> analyzeFrame(image) }

        provider.unbindAll()
        provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
        cameraProvider = provider
        previewUseCase = preview
        analysisUseCase = analysis
        resetTracking()
        onCameraReady(mapOf("continuous" to true, "targetPreviewFps" to 30))
      } catch (error: Throwable) {
        onError(mapOf("message" to (error.message ?: "연속 카메라를 시작하지 못했습니다.")))
      }
    }, ContextCompat.getMainExecutor(context))
  }

  private fun stopCamera() {
    analysisUseCase?.clearAnalyzer()
    val provider = cameraProvider
    val preview = previewUseCase
    val analysis = analysisUseCase
    if (provider != null && preview != null && analysis != null) runCatching { provider.unbind(preview, analysis) }
    cameraProvider = null
    previewUseCase = null
    analysisUseCase = null
    resetTracking()
  }

  fun destroy() {
    if (destroyed) return
    destroyed = true
    running = false
    stopCamera()
    handLandmarker?.close()
    handLandmarker = null
    analysisExecutor.shutdownNow()
  }

  private fun resetTracking() {
    frameCount = 0
    analyzedFrameCount = 0
    lastTimestampMs = 0
    fpsWindowStartedAt = 0
    fpsWindowFrames = 0
    cameraFps = 0.0
    analysisFps = 0.0
    lastAnalysisEventAt = 0
    lastHandResult = null
    lastStringState = null
    lastStringRefreshFrame = 0
    previousContacts.clear()
    recentHits.clear()
  }

  private fun analyzeFrame(image: ImageProxy) {
    if (!running || destroyed) {
      image.close()
      return
    }
    val startedAt = SystemClock.elapsedRealtime()
    frameCount += 1
    updateCameraFps(startedAt)
    var bitmap: Bitmap? = null
    try {
      bitmap = image.toBitmap()
      val timestamp = max(lastTimestampMs + 1, startedAt)
      lastTimestampMs = timestamp

      val shouldRefreshHand = lastHandResult == null || frameCount % 2L == 1L
      if (shouldRefreshHand) {
        lastHandResult = detectHand(bitmap, timestamp)
      }
      val hand = lastHandResult

      val shouldRefreshStrings = lastStringState == null || frameCount - lastStringRefreshFrame >= 3L
      if (shouldRefreshStrings) {
        val detected = detectStrings(bitmap, hand)
        if (detected != null) lastStringState = stabilizeStrings(lastStringState, detected)
        lastStringRefreshFrame = frameCount
      }

      val pick = if (hand?.hasHand == true) analyzePick(bitmap, hand) else emptyPick()
      val strings = lastStringState
      val contacts = if (hand?.hasHand == true && strings != null) buildContacts(hand, pick, strings, timestamp) else emptyList()
      val hits = detectHits(contacts, timestamp)
      hits.forEach { hit ->
        recentHits.addLast(hit)
        while (recentHits.size > 12) recentHits.removeFirst()
      }

      analyzedFrameCount += 1
      val now = SystemClock.elapsedRealtime()
      val elapsedSinceEvent = now - lastAnalysisEventAt
      if (elapsedSinceEvent >= 45 || hits.isNotEmpty()) {
        analysisFps = if (lastAnalysisEventAt > 0 && elapsedSinceEvent > 0) 1000.0 / elapsedSinceEvent else 0.0
        lastAnalysisEventAt = now
        val payload = buildPayload(
          bitmap.width,
          bitmap.height,
          hand,
          pick,
          strings,
          contacts,
          hits,
          now - startedAt
        )
        dispatchCoalesced(payload)
      }
    } catch (error: Throwable) {
      dispatchError(error.message ?: "연속 오른손 프레임 분석 중 오류가 발생했습니다.")
    } finally {
      bitmap?.recycle()
      image.close()
    }
  }

  private fun updateCameraFps(now: Long) {
    if (fpsWindowStartedAt == 0L) fpsWindowStartedAt = now
    fpsWindowFrames += 1
    val elapsed = now - fpsWindowStartedAt
    if (elapsed >= 800) {
      cameraFps = fpsWindowFrames * 1000.0 / elapsed
      fpsWindowFrames = 0
      fpsWindowStartedAt = now
    }
  }

  private fun dispatchCoalesced(payload: Map<String, Any?>) {
    latestPayload = payload
    if (!eventPending.compareAndSet(false, true)) return
    post {
      val current = latestPayload
      latestPayload = null
      eventPending.set(false)
      if (!destroyed && current != null) onAnalysis(current)
    }
  }

  private fun dispatchError(message: String) {
    post { if (!destroyed) onError(mapOf("message" to message)) }
  }

  private fun getHandLandmarker(): HandLandmarker {
    return handLandmarker ?: run {
      val applicationContext = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("손 추적 컨텍스트를 사용할 수 없습니다.")
      val options = HandLandmarker.HandLandmarkerOptions.builder()
        .setBaseOptions(BaseOptions.builder().setModelAssetPath(HAND_MODEL).build())
        .setNumHands(1)
        .setMinHandDetectionConfidence(0.42f)
        .setMinHandPresenceConfidence(0.42f)
        .setMinTrackingConfidence(0.38f)
        .setRunningMode(RunningMode.VIDEO)
        .build()
      HandLandmarker.createFromOptions(applicationContext, options).also { handLandmarker = it }
    }
  }

  private fun detectHand(bitmap: Bitmap, timestamp: Long): LiveHandResult {
    val mpImage = BitmapImageBuilder(bitmap).build()
    val result = getHandLandmarker().detectForVideo(mpImage, timestamp)
    val points = result.landmarks().firstOrNull()
    val handedness = result.handedness().firstOrNull()?.firstOrNull()
    if (points == null || points.size < 21) return LiveHandResult(false, "Unknown", 0.0, emptyList())
    return LiveHandResult(
      true,
      handedness?.categoryName() ?: "Unknown",
      handedness?.score()?.toDouble() ?: 0.0,
      points.mapIndexed { index, point ->
        LivePoint(index, LANDMARK_NAMES[index], point.x().toDouble(), point.y().toDouble(), point.z().toDouble())
      }
    )
  }

  private fun handRegion(hand: LiveHandResult?, width: Int, height: Int): PixelRegion {
    if (hand?.hasHand != true || hand.landmarks.size < 21) {
      return PixelRegion((width * 0.02).roundToInt(), (height * 0.10).roundToInt(), (width * 0.98).roundToInt(), (height * 0.90).roundToInt(), width * 0.5, height * 0.5)
    }
    val xs = hand.landmarks.map { it.x * width }
    val ys = hand.landmarks.map { it.y * height }
    val focus = listOf(4, 8, 12, 16).map { hand.landmarks[it] }
    val focusX = focus.map { it.x * width }.average()
    val focusY = focus.map { it.y * height }.average()
    val top = max(0, (min(ys.minOrNull() ?: focusY, focusY) - height * 0.24).roundToInt())
    val bottom = min(height - 1, (max(ys.maxOrNull() ?: focusY, focusY) + height * 0.24).roundToInt())
    return PixelRegion((width * 0.01).roundToInt(), top, (width * 0.99).roundToInt(), bottom, focusX, focusY)
  }

  private fun detectStrings(bitmap: Bitmap, hand: LiveHandResult?): LiveStringState? {
    val region = handRegion(hand, bitmap.width, bitmap.height)
    val roiWidth = region.right - region.left + 1
    val roiHeight = region.bottom - region.top + 1
    if (roiWidth < 160 || roiHeight < 100) return null
    val analysisDimension = min(roiWidth, roiHeight)
    val sampleStep = max(3, analysisDimension / 210)
    val offset = max(2, sampleStep / 2)
    var best: StringCandidate? = null

    for (angle in -42..42 step 4) {
      val radians = Math.toRadians(angle.toDouble())
      val normalX = -sin(radians)
      val normalY = cos(radians)
      val corners = doubleArrayOf(
        normalX * region.left + normalY * region.top,
        normalX * region.right + normalY * region.top,
        normalX * region.left + normalY * region.bottom,
        normalX * region.right + normalY * region.bottom
      )
      val minProjection = corners.minOrNull() ?: continue
      val maxProjection = corners.maxOrNull() ?: continue
      val profile = DoubleArray(max(8, ceil(maxProjection - minProjection).toInt() + 3))
      var y = region.top
      while (y <= region.bottom) {
        var x = region.left
        while (x <= region.right) {
          val x1 = (x + normalX * offset).roundToInt().coerceIn(0, bitmap.width - 1)
          val y1 = (y + normalY * offset).roundToInt().coerceIn(0, bitmap.height - 1)
          val x2 = (x - normalX * offset).roundToInt().coerceIn(0, bitmap.width - 1)
          val y2 = (y - normalY * offset).roundToInt().coerceIn(0, bitmap.height - 1)
          val first = gray(bitmap.getPixel(x1, y1))
          val second = gray(bitmap.getPixel(x2, y2))
          val center = gray(bitmap.getPixel(x, y))
          val edge = abs(first - second) + abs(center - (first + second) / 2.0) * 0.58
          if (edge >= 4.5) {
            val bin = (normalX * x + normalY * y - minProjection).roundToInt()
            if (bin in profile.indices) profile[bin] += edge
          }
          x += sampleStep
        }
        y += sampleStep
      }

      val smooth = smooth(profile, 2)
      val mean = smooth.average().coerceAtLeast(0.001)
      val gapMin = max(3, analysisDimension / 250)
      val gapMax = min(62, min(smooth.size / 7, max(9, analysisDimension / 15)))
      if (gapMax <= gapMin) continue
      val focusBin = normalX * region.focusX + normalY * region.focusY - minProjection

      for (gap in gapMin..gapMax) {
        val lastStart = smooth.size - gap * 5 - 3
        if (lastStart <= 2) continue
        val radius = max(2, gap / 3)
        var start = 2
        while (start <= lastStart) {
          val positions = DoubleArray(6)
          val strengths = DoubleArray(6)
          for (index in 0 until 6) {
            positions[index] = localPeakPosition(smooth, start + index * gap, radius)
            strengths[index] = interpolated(smooth, positions[index])
          }
          val average = strengths.average()
          if (average > mean * 1.08) {
            val spacings = DoubleArray(5) { positions[it + 1] - positions[it] }
            val spacingMean = spacings.average().coerceAtLeast(0.001)
            val spacingDeviation = standardDeviation(spacings)
            val spacingRegularity = (1.0 - spacingDeviation / max(1.0, spacingMean * 0.35)).coerceIn(0.0, 1.0)
            val minimumRegularity = ((strengths.minOrNull() ?: 0.0) / average).coerceIn(0.0, 1.0)
            val coverage = strengths.count { it >= mean * 1.04 } / 6.0
            val regularity = spacingRegularity * 0.72 + minimumRegularity * 0.28
            if (coverage >= 0.66 && regularity >= 0.32) {
              val bandStart = positions.first() - spacingMean * 0.65
              val bandEnd = positions.last() + spacingMean * 0.65
              val focusDistance = when {
                focusBin < bandStart -> bandStart - focusBin
                focusBin > bandEnd -> focusBin - bandEnd
                else -> 0.0
              }
              val focusWeight = 1.0 / (1.0 + focusDistance / spacingMean * 0.45)
              val contrast = strengths.sum() / (mean * 6.0 + 1.0)
              val confidence = (((contrast - 1.05) / 5.0).coerceIn(0.0, 1.0) * 0.52 + regularity * 0.30 + coverage * 0.18) * focusWeight
              val candidate = StringCandidate(angle.toDouble(), normalX, normalY, minProjection, positions, strengths, confidence.coerceIn(0.0, 1.0), region)
              if (best == null || candidate.confidence > best!!.confidence) best = candidate
            }
          }
          start += max(1, gap / 5)
        }
      }
    }

    val candidate = best ?: return null
    if (candidate.confidence < 0.34) return null
    val maxStrength = (candidate.strengths.maxOrNull() ?: 1.0).coerceAtLeast(1.0)
    val normalized = candidate.strengths.map { (it / maxStrength).coerceIn(0.0, 1.0) }
    val firstSide = normalized.take(2).average()
    val lastSide = normalized.takeLast(2).average()
    val difference = abs(firstSide - lastSide) / max(0.001, max(firstSide, lastSide))
    val numberingConfidence = ((difference - 0.10) / 0.38).coerceIn(0.0, 1.0) * candidate.confidence
    val order = when {
      numberingConfidence < 0.62 -> "unknown"
      firstSide > lastSide -> "low-to-high"
      else -> "high-to-low"
    }
    val lines = candidate.positions.mapIndexedNotNull { index, position ->
      val projection = candidate.minProjection + position
      val endpoints = lineEndpoints(candidate.normalX, candidate.normalY, projection, bitmap.width, bitmap.height)
      if (endpoints.size < 2) null else LiveLine(
        index + 1,
        when (order) { "low-to-high" -> 6 - index; "high-to-low" -> index + 1; else -> 0 },
        endpoints[0].first / bitmap.width,
        endpoints[0].second / bitmap.height,
        endpoints[1].first / bitmap.width,
        endpoints[1].second / bitmap.height,
        normalized[index]
      )
    }
    if (lines.size < 5) return null
    return LiveStringState(candidate.angle, candidate.confidence, numberingConfidence, order, lines, candidate.region)
  }

  private fun stabilizeStrings(previous: LiveStringState?, next: LiveStringState): LiveStringState {
    if (previous == null || previous.lines.size != next.lines.size || abs(previous.angle - next.angle) > 14.0) return next
    val previousWeight = 0.58
    val nextWeight = 1.0 - previousWeight
    val lines = next.lines.mapIndexed { index, line ->
      val old = previous.lines[index]
      line.copy(
        startX = old.startX * previousWeight + line.startX * nextWeight,
        startY = old.startY * previousWeight + line.startY * nextWeight,
        endX = old.endX * previousWeight + line.endX * nextWeight,
        endY = old.endY * previousWeight + line.endY * nextWeight,
        strength = old.strength * 0.42 + line.strength * 0.58
      )
    }
    return next.copy(
      angle = previous.angle * 0.55 + next.angle * 0.45,
      confidence = previous.confidence * 0.35 + next.confidence * 0.65,
      lines = lines
    )
  }

  private fun analyzePick(bitmap: Bitmap, hand: LiveHandResult): LivePick {
    if (pickColor == "none" || hand.landmarks.size < 21) return emptyPick()
    fun x(index: Int) = hand.landmarks[index].x * bitmap.width
    fun y(index: Int) = hand.landmarks[index].y * bitmap.height
    val thumbX = x(4)
    val thumbY = y(4)
    val indexX = x(8)
    val indexY = y(8)
    val wristX = x(0)
    val wristY = y(0)
    val middleX = x(9)
    val middleY = y(9)
    val palmScale = hypot(middleX - wristX, middleY - wristY).coerceAtLeast(20.0)
    val centerX = (thumbX + indexX) / 2.0
    val centerY = (thumbY + indexY) / 2.0
    val radius = (palmScale * 0.68).coerceIn(22.0, min(bitmap.width, bitmap.height) * 0.17)
    val left = max(0, (centerX - radius).roundToInt())
    val right = min(bitmap.width - 1, (centerX + radius).roundToInt())
    val top = max(0, (centerY - radius).roundToInt())
    val bottom = min(bitmap.height - 1, (centerY + radius).roundToInt())
    val xs = ArrayList<Double>()
    val ys = ArrayList<Double>()
    val hsv = FloatArray(3)
    var py = top
    while (py <= bottom) {
      var px = left
      while (px <= right) {
        val dx = px - centerX
        val dy = py - centerY
        if (dx * dx + dy * dy <= radius * radius) {
          Color.colorToHSV(bitmap.getPixel(px, py), hsv)
          if (matchesPickColor(hsv[0], hsv[1], hsv[2], pickColor)) {
            xs.add(px.toDouble())
            ys.add(py.toDouble())
          }
        }
        px += 3
      }
      py += 3
    }
    val areaSamples = PI * radius * radius / 9.0
    val minimum = max(10, (areaSamples * 0.011).roundToInt())
    if (xs.size < minimum) return emptyPick()
    val meanX = xs.average()
    val meanY = ys.average()
    var covXX = 0.0
    var covYY = 0.0
    var covXY = 0.0
    var minX = Double.MAX_VALUE
    var maxX = -Double.MAX_VALUE
    var minY = Double.MAX_VALUE
    var maxY = -Double.MAX_VALUE
    for (index in xs.indices) {
      val dx = xs[index] - meanX
      val dy = ys[index] - meanY
      covXX += dx * dx
      covYY += dy * dy
      covXY += dx * dy
      minX = min(minX, xs[index]); maxX = max(maxX, xs[index])
      minY = min(minY, ys[index]); maxY = max(maxY, ys[index])
    }
    covXX /= xs.size; covYY /= xs.size; covXY /= xs.size
    var angle = Math.toDegrees(0.5 * atan2(2.0 * covXY, covXX - covYY))
    while (angle > 90) angle -= 180
    while (angle < -90) angle += 180
    val coverage = (xs.size / areaSamples).coerceIn(0.0, 1.0)
    return LivePick(
      true,
      pickColor,
      (coverage / 0.085).coerceIn(0.0, 1.0),
      angle,
      (max(maxX - minX, maxY - minY) / palmScale).coerceIn(0.0, 1.5),
      (meanX / bitmap.width).coerceIn(0.0, 1.0),
      (meanY / bitmap.height).coerceIn(0.0, 1.0)
    )
  }

  private fun buildContacts(hand: LiveHandResult, pick: LivePick, strings: LiveStringState, timestamp: Long): List<LiveContact> {
    val spacing = averageLineSpacing(strings.lines).coerceAtLeast(0.004)
    val points = ArrayList<Triple<String, String, Pair<Double, Double>>>()
    if (pick.detected && pick.confidence >= 0.32) points.add(Triple("pick", "피크", estimatedPickTip(pick, strings.lines)))
    listOf(4 to ("thumb" to "P"), 8 to ("index" to "i"), 12 to ("middle" to "m"), 16 to ("ring" to "a"), 20 to ("pinky" to "새끼")).forEach { (index, identity) ->
      val point = hand.landmarks.getOrNull(index)
      if (point != null) points.add(Triple(identity.first, identity.second, point.x to point.y))
    }
    return points.map { (id, label, point) ->
      val nearest = strings.lines.minByOrNull { pointToLineDistance(point.first, point.second, it) }
      val distance = if (nearest == null) 2.0 else pointToLineDistance(point.first, point.second, nearest) / spacing
      val visual = if (nearest != null && distance <= 1.16) nearest.visualIndex else 0
      val number = if (nearest != null && distance <= 0.76 && strings.confidence >= 0.48 && strings.numberingConfidence >= 0.62) nearest.stringNumber else 0
      val previous = previousContacts[id]
      val dt = if (previous == null) 0.0 else max(1L, timestamp - previous.timestamp).toDouble() / 1000.0
      val speed = if (previous == null || dt <= 0) 0.0 else hypot(point.first - previous.x, point.second - previous.y) / dt
      val confidence = (hand.score * 0.34 + strings.confidence * 0.30 + (1.0 - distance / 1.2).coerceIn(0.0, 1.0) * 0.24 + min(1.0, speed / 0.8) * 0.12).coerceIn(0.0, 1.0)
      LiveContact(id, label, point.first, point.second, visual, number, distance, confidence, speed)
    }
  }

  private fun detectHits(contacts: List<LiveContact>, timestamp: Long): List<Map<String, Any>> {
    val hits = ArrayList<Map<String, Any>>()
    contacts.forEach { contact ->
      val previous = previousContacts[contact.id]
      if (previous != null) {
        val changedLine = contact.visualIndex > 0 && previous.visualIndex > 0 && contact.visualIndex != previous.visualIndex
        val approachedLine = previous.distanceRatio > 0.48 && contact.distanceRatio <= 0.32
        val fastEnough = contact.speed >= 0.16
        if (fastEnough && (changedLine || approachedLine) && timestamp - previous.lastHitAt >= 55) {
          val direction = when {
            contact.y > previous.y + 0.004 -> "down"
            contact.y < previous.y - 0.004 -> "up"
            else -> "unknown"
          }
          hits.add(mapOf(
            "capturedAt" to timestamp,
            "contactId" to contact.id,
            "label" to contact.label,
            "visualIndex" to contact.visualIndex,
            "stringNumber" to contact.stringNumber,
            "direction" to direction,
            "speed" to contact.speed,
            "confidence" to contact.confidence
          ))
          previous.lastHitAt = timestamp
        }
      }
      previousContacts[contact.id] = PreviousContact(contact.x, contact.y, contact.visualIndex, contact.distanceRatio, timestamp, previous?.lastHitAt ?: 0)
    }
    return hits
  }

  private fun buildPayload(
    width: Int,
    height: Int,
    hand: LiveHandResult?,
    pick: LivePick,
    strings: LiveStringState?,
    contacts: List<LiveContact>,
    hits: List<Map<String, Any>>,
    latencyMs: Long
  ): Map<String, Any?> {
    val handMap = hand ?: LiveHandResult(false, "Unknown", 0.0, emptyList())
    return mapOf(
      "hasHand" to handMap.hasHand,
      "imageWidth" to width,
      "imageHeight" to height,
      "latencyMs" to latencyMs,
      "handedness" to handMap.handedness,
      "handednessScore" to handMap.score,
      "landmarks" to handMap.landmarks.map { point -> mapOf("index" to point.index, "name" to point.name, "x" to point.x, "y" to point.y, "z" to point.z) },
      "pick" to pick.toMap(),
      "stringTracking" to strings?.toMap(contacts),
      "continuous" to mapOf(
        "enabled" to true,
        "previewFps" to cameraFps,
        "analysisFps" to analysisFps,
        "frameCount" to frameCount,
        "analyzedFrameCount" to analyzedFrameCount,
        "stringRefreshAgeFrames" to max(0, frameCount - lastStringRefreshFrame),
        "newHits" to hits,
        "recentHits" to recentHits.toList()
      )
    )
  }

  private fun estimatedPickTip(pick: LivePick, lines: List<LiveLine>): Pair<Double, Double> {
    val radians = Math.toRadians(pick.angle)
    val length = (0.026 + pick.exposure * 0.026).coerceIn(0.025, 0.075)
    val candidates = listOf(
      pick.centerX to pick.centerY,
      (pick.centerX + cos(radians) * length).coerceIn(0.0, 1.0) to (pick.centerY + sin(radians) * length).coerceIn(0.0, 1.0),
      (pick.centerX - cos(radians) * length).coerceIn(0.0, 1.0) to (pick.centerY - sin(radians) * length).coerceIn(0.0, 1.0)
    )
    return candidates.minByOrNull { point -> lines.minOfOrNull { pointToLineDistance(point.first, point.second, it) } ?: 1.0 } ?: candidates[0]
  }

  private fun averageLineSpacing(lines: List<LiveLine>): Double {
    if (lines.size < 2) return 0.03
    return lines.zipWithNext().map { (a, b) ->
      hypot((a.startX + a.endX - b.startX - b.endX) / 2.0, (a.startY + a.endY - b.startY - b.endY) / 2.0)
    }.filter { it > 0.001 }.average().takeIf { !it.isNaN() } ?: 0.03
  }

  private fun pointToLineDistance(x: Double, y: Double, line: LiveLine): Double {
    val abX = line.endX - line.startX
    val abY = line.endY - line.startY
    val denominator = max(0.000001, abX * abX + abY * abY)
    val amount = (((x - line.startX) * abX + (y - line.startY) * abY) / denominator).coerceIn(0.0, 1.0)
    return hypot(x - (line.startX + abX * amount), y - (line.startY + abY * amount))
  }

  private fun smooth(values: DoubleArray, radius: Int): DoubleArray = DoubleArray(values.size) { index ->
    var sum = 0.0
    var count = 0
    for (offset in -radius..radius) {
      val target = index + offset
      if (target in values.indices) { sum += values[target]; count += 1 }
    }
    sum / max(1, count)
  }

  private fun localPeakPosition(values: DoubleArray, center: Int, radius: Int): Double {
    var bestIndex = center.coerceIn(0, values.lastIndex)
    var bestValue = -1.0
    for (offset in -radius..radius) {
      val index = center + offset
      if (index in values.indices && values[index] > bestValue) { bestValue = values[index]; bestIndex = index }
    }
    if (bestIndex <= 0 || bestIndex >= values.lastIndex) return bestIndex.toDouble()
    val left = values[bestIndex - 1]
    val middle = values[bestIndex]
    val right = values[bestIndex + 1]
    val denominator = left - 2.0 * middle + right
    val adjustment = if (abs(denominator) < 0.000001) 0.0 else (left - right) / (2.0 * denominator)
    return bestIndex + adjustment.coerceIn(-0.5, 0.5)
  }

  private fun interpolated(values: DoubleArray, position: Double): Double {
    val left = position.toInt().coerceIn(0, values.lastIndex)
    val right = min(values.lastIndex, left + 1)
    val amount = (position - left).coerceIn(0.0, 1.0)
    return values[left] * (1.0 - amount) + values[right] * amount
  }

  private fun standardDeviation(values: DoubleArray): Double {
    if (values.size < 2) return 0.0
    val mean = values.average()
    return sqrt(values.map { (it - mean) * (it - mean) }.average())
  }

  private fun lineEndpoints(normalX: Double, normalY: Double, projection: Double, width: Int, height: Int): List<Pair<Double, Double>> {
    val points = ArrayList<Pair<Double, Double>>()
    val maxX = (width - 1).toDouble()
    val maxY = (height - 1).toDouble()
    if (abs(normalY) > 1e-8) {
      val yLeft = projection / normalY
      if (yLeft in 0.0..maxY) points.add(0.0 to yLeft)
      val yRight = (projection - normalX * maxX) / normalY
      if (yRight in 0.0..maxY) points.add(maxX to yRight)
    }
    if (abs(normalX) > 1e-8) {
      val xTop = projection / normalX
      if (xTop in 0.0..maxX) points.add(xTop to 0.0)
      val xBottom = (projection - normalY * maxY) / normalX
      if (xBottom in 0.0..maxX) points.add(xBottom to maxY)
    }
    val unique = points.distinctBy { "${it.first.roundToInt()}-${it.second.roundToInt()}" }
    if (unique.size <= 2) return unique
    var bestA = unique[0]
    var bestB = unique[1]
    var bestDistance = 0.0
    for (a in unique.indices) for (b in a + 1 until unique.size) {
      val distance = hypot(unique[a].first - unique[b].first, unique[a].second - unique[b].second)
      if (distance > bestDistance) { bestDistance = distance; bestA = unique[a]; bestB = unique[b] }
    }
    return listOf(bestA, bestB)
  }

  private fun matchesPickColor(hue: Float, saturation: Float, value: Float, key: String): Boolean = when (key) {
    "red" -> (hue <= 18f || hue >= 342f) && saturation >= 0.42f && value >= 0.22f
    "orange" -> hue in 15f..45f && saturation >= 0.42f && value >= 0.25f
    "yellow" -> hue in 42f..78f && saturation >= 0.38f && value >= 0.35f
    "green" -> hue in 75f..170f && saturation >= 0.35f && value >= 0.22f
    "blue" -> hue in 175f..255f && saturation >= 0.38f && value >= 0.20f
    "purple" -> hue in 250f..335f && saturation >= 0.35f && value >= 0.20f
    "white" -> saturation <= 0.16f && value >= 0.78f
    "black" -> value <= 0.22f
    "auto" -> saturation >= 0.50f && value >= 0.22f && hue in 42f..338f
    else -> false
  }

  private fun gray(color: Int): Double = (Color.red(color) * 30 + Color.green(color) * 59 + Color.blue(color) * 11) / 100.0
  private fun emptyPick() = LivePick(false, pickColor, 0.0, 0.0, 0.0, 0.0, 0.0)

  private data class PixelRegion(val left: Int, val top: Int, val right: Int, val bottom: Int, val focusX: Double, val focusY: Double)
  private data class StringCandidate(val angle: Double, val normalX: Double, val normalY: Double, val minProjection: Double, val positions: DoubleArray, val strengths: DoubleArray, val confidence: Double, val region: PixelRegion)
  private data class LivePoint(val index: Int, val name: String, val x: Double, val y: Double, val z: Double)
  private data class LiveHandResult(val hasHand: Boolean, val handedness: String, val score: Double, val landmarks: List<LivePoint>)
  private data class LivePick(val detected: Boolean, val color: String, val confidence: Double, val angle: Double, val exposure: Double, val centerX: Double, val centerY: Double) {
    fun toMap() = mapOf("detected" to detected, "color" to color, "confidence" to confidence, "angleDegrees" to angle, "exposure" to exposure, "centerX" to centerX, "centerY" to centerY)
  }
  private data class LiveLine(val visualIndex: Int, val stringNumber: Int, val startX: Double, val startY: Double, val endX: Double, val endY: Double, val strength: Double)
  private data class LiveStringState(val angle: Double, val confidence: Double, val numberingConfidence: Double, val order: String, val lines: List<LiveLine>, val region: PixelRegion) {
    fun toMap(contacts: List<LiveContact>) = mapOf(
      "detected" to true,
      "confidence" to confidence,
      "angleDegrees" to angle,
      "visibleLineCount" to lines.count { it.strength >= 0.28 },
      "stringOrder" to order,
      "numberingConfidence" to numberingConfidence,
      "stabilityConfidence" to confidence,
      "nearestVisualIndex" to (contacts.minByOrNull { it.distanceRatio }?.visualIndex ?: 0),
      "nearestStringNumber" to (contacts.minByOrNull { it.distanceRatio }?.stringNumber ?: 0),
      "nearestDistanceRatio" to (contacts.minByOrNull { it.distanceRatio }?.distanceRatio ?: 1.0),
      "primaryContactId" to (contacts.minByOrNull { it.distanceRatio }?.id ?: ""),
      "contacts" to contacts.map { it.toMap() },
      "roiLeft" to region.left,
      "roiTop" to region.top,
      "roiRight" to region.right,
      "roiBottom" to region.bottom,
      "lines" to lines.map { line -> mapOf("visualIndex" to line.visualIndex, "stringNumber" to line.stringNumber, "startX" to line.startX, "startY" to line.startY, "endX" to line.endX, "endY" to line.endY, "strength" to line.strength) }
    )
  }
  private data class LiveContact(val id: String, val label: String, val x: Double, val y: Double, val visualIndex: Int, val stringNumber: Int, val distanceRatio: Double, val confidence: Double, val speed: Double) {
    fun toMap() = mapOf("id" to id, "label" to label, "x" to x, "y" to y, "visualIndex" to visualIndex, "stringNumber" to stringNumber, "distanceRatio" to distanceRatio, "confidence" to confidence, "speed" to speed, "source" to if (stringNumber > 0) "vision" else "unresolved")
  }
  private data class PreviousContact(val x: Double, val y: Double, val visualIndex: Int, val distanceRatio: Double, val timestamp: Long, var lastHitAt: Long)

  companion object {
    private const val HAND_MODEL = "hand_landmarker.task"
    private val LANDMARK_NAMES = listOf(
      "wrist", "thumbCmc", "thumbMcp", "thumbIp", "thumbTip",
      "indexMcp", "indexPip", "indexDip", "indexTip",
      "middleMcp", "middlePip", "middleDip", "middleTip",
      "ringMcp", "ringPip", "ringDip", "ringTip",
      "pinkyMcp", "pinkyPip", "pinkyDip", "pinkyTip"
    )
  }
}
