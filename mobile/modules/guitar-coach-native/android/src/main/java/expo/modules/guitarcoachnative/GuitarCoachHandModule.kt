package expo.modules.guitarcoachnative

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

class GuitarCoachHandModule : Module() {
  private var handLandmarker: HandLandmarker? = null
  private val analysisBusy = AtomicBoolean(false)

  private data class NormalizedRegion(
    val left: Double,
    val top: Double,
    val right: Double,
    val bottom: Double
  ) {
    fun normalized(): NormalizedRegion {
      val safeLeft = left.coerceIn(0.0, 0.94)
      val safeTop = top.coerceIn(0.0, 0.94)
      val safeRight = right.coerceIn(safeLeft + 0.06, 1.0)
      val safeBottom = bottom.coerceIn(safeTop + 0.06, 1.0)
      return NormalizedRegion(safeLeft, safeTop, safeRight, safeBottom)
    }

    fun area(): Double = (right - left) * (bottom - top)
  }

  private data class DetectionPass(
    val hasHand: Boolean,
    val handedness: String,
    val handednessScore: Double,
    val landmarks: List<Map<String, Any>>,
    val pick: Map<String, Any>,
    val region: NormalizedRegion?
  )

  private data class PrecisionDecision(
    val shouldRefine: Boolean,
    val reason: String,
    val sourcePalmSize: Double,
    val sourceEdgeMargin: Double,
    val regionArea: Double,
    val region: NormalizedRegion?
  )

  override fun definition() = ModuleDefinition {
    Name("GuitarCoachHand")

    Constant("androidHandCoachAvailable") { true }
    Constant("androidHandRegionAnalysisAvailable") { true }
    Constant("androidAutomaticHandPrecisionAvailable") { true }

    AsyncFunction("analyzeHandAsync") { uri: String, pickColor: String, promise: Promise ->
      startAnalysis(uri, pickColor, null, automaticPrecision = true, promise)
    }

    AsyncFunction("analyzeHandInRegionAsync") {
        uri: String,
        pickColor: String,
        left: Double,
        top: Double,
        right: Double,
        bottom: Double,
        promise: Promise ->
      startAnalysis(
        uri,
        pickColor,
        NormalizedRegion(left, top, right, bottom).normalized(),
        automaticPrecision = false,
        promise
      )
    }

    OnDestroy {
      handLandmarker?.close()
      handLandmarker = null
    }
  }

  private fun startAnalysis(
    uri: String,
    pickColor: String,
    requestedRegion: NormalizedRegion?,
    automaticPrecision: Boolean,
    promise: Promise
  ) {
    if (!analysisBusy.compareAndSet(false, true)) {
      promise.reject("ERR_HAND_BUSY", "이전 손 분석이 아직 끝나지 않았습니다.", null)
      return
    }

    Thread {
      val startedAt = System.currentTimeMillis()
      var originalBitmap: Bitmap? = null
      try {
        val decoded = decodeBitmap(uri)
        originalBitmap = decoded
        val safeRegion = requestedRegion?.normalized()
        val first = detectPass(decoded, safeRegion, pickColor)
        var selected = first
        var precision = if (safeRegion != null) {
          precisionPayload(
            applied = first.hasHand,
            passes = 1,
            reason = if (first.hasHand) "explicit-region" else "no-hand",
            sourcePalmSize = palmSize(first.landmarks),
            sourceEdgeMargin = edgeMargin(first.landmarks),
            region = safeRegion
          )
        } else {
          val initialDecision = decidePrecisionRegion(first)
          precisionPayload(
            applied = false,
            passes = 1,
            reason = initialDecision.reason,
            sourcePalmSize = initialDecision.sourcePalmSize,
            sourceEdgeMargin = initialDecision.sourceEdgeMargin,
            region = initialDecision.region
          )
        }

        if (automaticPrecision && first.hasHand && safeRegion == null) {
          val decision = decidePrecisionRegion(first)
          if (decision.shouldRefine && decision.region != null) {
            val refined = detectPass(decoded, decision.region, pickColor)
            val acceptable = refined.hasHand &&
              refined.landmarks.size >= 21 &&
              refined.handednessScore >= max(0.30, first.handednessScore - 0.18)
            if (acceptable) {
              selected = refined
              precision = precisionPayload(
                applied = true,
                passes = 2,
                reason = "reacquired-and-refined",
                sourcePalmSize = decision.sourcePalmSize,
                sourceEdgeMargin = decision.sourceEdgeMargin,
                region = decision.region
              )
            } else {
              precision = precisionPayload(
                applied = false,
                passes = 2,
                reason = decision.reason,
                sourcePalmSize = decision.sourcePalmSize,
                sourceEdgeMargin = decision.sourceEdgeMargin,
                region = decision.region,
                fallbackReason = "refined-result-low-confidence"
              )
            }
          }
        }

        promise.resolve(
          mapOf(
            "hasHand" to selected.hasHand,
            "imageWidth" to decoded.width,
            "imageHeight" to decoded.height,
            "latencyMs" to (System.currentTimeMillis() - startedAt),
            "handedness" to selected.handedness,
            "handednessScore" to selected.handednessScore,
            "landmarks" to selected.landmarks,
            "pick" to selected.pick,
            "analysisRegion" to regionResult(selected.region),
            "precision" to precision
          )
        )
      } catch (error: Throwable) {
        promise.reject("ERR_HAND_ANALYSIS", "손가락과 피크를 분석하지 못했습니다.", error)
      } finally {
        if (originalBitmap != null && !originalBitmap.isRecycled) {
          originalBitmap.recycle()
        }
        analysisBusy.set(false)
      }
    }.start()
  }

  private fun detectPass(
    originalBitmap: Bitmap,
    region: NormalizedRegion?,
    pickColor: String
  ): DetectionPass {
    var analysisBitmap: Bitmap? = null
    try {
      val inputBitmap = if (region == null) originalBitmap else cropBitmap(originalBitmap, region)
      analysisBitmap = inputBitmap
      val mpImage = BitmapImageBuilder(inputBitmap).build()
      val result = getHandLandmarker().detect(mpImage)
      val handLandmarks = result.landmarks().firstOrNull()
      val handednessCategory = result.handedness().firstOrNull()?.firstOrNull()

      if (handLandmarks == null || handLandmarks.size < 21) {
        return DetectionPass(
          hasHand = false,
          handedness = "Unknown",
          handednessScore = 0.0,
          landmarks = emptyList(),
          pick = emptyPickResult(pickColor),
          region = region
        )
      }

      val localLandmarks = handLandmarks.mapIndexed { index, landmark ->
        mapOf<String, Any>(
          "index" to index,
          "name" to LANDMARK_NAMES[index],
          "x" to landmark.x().toDouble(),
          "y" to landmark.y().toDouble(),
          "z" to landmark.z().toDouble()
        )
      }
      val landmarks = remapLandmarks(localLandmarks, region)
      val localPick = analyzePickColor(inputBitmap, localLandmarks, pickColor)
      return DetectionPass(
        hasHand = true,
        handedness = handednessCategory?.categoryName() ?: "Unknown",
        handednessScore = handednessCategory?.score()?.toDouble() ?: 0.0,
        landmarks = landmarks,
        pick = remapPick(localPick, region),
        region = region
      )
    } finally {
      if (analysisBitmap != null && analysisBitmap !== originalBitmap && !analysisBitmap.isRecycled) {
        analysisBitmap.recycle()
      }
    }
  }

  private fun decidePrecisionRegion(pass: DetectionPass): PrecisionDecision {
    if (!pass.hasHand) {
      return PrecisionDecision(false, "no-hand", 0.0, 0.0, 1.0, null)
    }
    if (pass.landmarks.size < 21) {
      return PrecisionDecision(false, "insufficient-landmarks", 0.0, 0.0, 1.0, null)
    }

    val xs = pass.landmarks.map { ((it["x"] as Number).toDouble()).coerceIn(0.0, 1.0) }
    val ys = pass.landmarks.map { ((it["y"] as Number).toDouble()).coerceIn(0.0, 1.0) }
    val minimumX = xs.minOrNull() ?: return PrecisionDecision(false, "invalid-landmarks", 0.0, 0.0, 1.0, null)
    val maximumX = xs.maxOrNull() ?: return PrecisionDecision(false, "invalid-landmarks", 0.0, 0.0, 1.0, null)
    val minimumY = ys.minOrNull() ?: return PrecisionDecision(false, "invalid-landmarks", 0.0, 0.0, 1.0, null)
    val maximumY = ys.maxOrNull() ?: return PrecisionDecision(false, "invalid-landmarks", 0.0, 0.0, 1.0, null)
    val sourcePalmSize = palmSize(pass.landmarks)
    val sourceEdgeMargin = minOf(minimumX, 1.0 - maximumX, minimumY, 1.0 - maximumY)

    if (sourcePalmSize < 0.025) {
      return PrecisionDecision(false, "hand-too-small", sourcePalmSize, sourceEdgeMargin, 1.0, null)
    }

    val boxWidth = max(0.02, maximumX - minimumX)
    val boxHeight = max(0.02, maximumY - minimumY)
    val horizontalPadding = max(0.075, sourcePalmSize * 0.72)
    val verticalPadding = max(0.085, sourcePalmSize * 0.82)
    val requestedWidth = maxOf(0.32, boxWidth + horizontalPadding * 2.0, sourcePalmSize * 3.15).coerceIn(0.32, 0.78)
    val requestedHeight = maxOf(0.36, boxHeight + verticalPadding * 2.0, sourcePalmSize * 3.55).coerceIn(0.36, 0.82)
    val horizontal = fitAxis((minimumX + maximumX) / 2.0, requestedWidth)
    val vertical = fitAxis((minimumY + maximumY) / 2.0, requestedHeight)
    val region = NormalizedRegion(horizontal.first, vertical.first, horizontal.second, vertical.second).normalized()
    val alreadyDetailed = sourcePalmSize >= 0.30 &&
      sourceEdgeMargin >= 0.075 &&
      boxWidth >= 0.34 &&
      boxHeight >= 0.34

    if (alreadyDetailed || region.area() >= 0.76) {
      return PrecisionDecision(false, "already-detailed", sourcePalmSize, sourceEdgeMargin, region.area(), region)
    }
    return PrecisionDecision(true, "region-ready", sourcePalmSize, sourceEdgeMargin, region.area(), region)
  }

  private fun fitAxis(center: Double, requestedSize: Double): Pair<Double, Double> {
    val size = requestedSize.coerceIn(0.06, 0.98)
    var start = center - size / 2.0
    var end = center + size / 2.0
    if (start < 0.01) {
      end += 0.01 - start
      start = 0.01
    }
    if (end > 0.99) {
      start -= end - 0.99
      end = 0.99
    }
    return Pair(start.coerceIn(0.01, 0.93), end.coerceIn(0.07, 0.99))
  }

  private fun palmSize(landmarks: List<Map<String, Any>>): Double {
    if (landmarks.size < 10) return 0.0
    val wristX = (landmarks[0]["x"] as Number).toDouble()
    val wristY = (landmarks[0]["y"] as Number).toDouble()
    val middleX = (landmarks[9]["x"] as Number).toDouble()
    val middleY = (landmarks[9]["y"] as Number).toDouble()
    return hypot(wristX - middleX, wristY - middleY)
  }

  private fun edgeMargin(landmarks: List<Map<String, Any>>): Double {
    if (landmarks.isEmpty()) return 0.0
    val xs = landmarks.map { (it["x"] as Number).toDouble() }
    val ys = landmarks.map { (it["y"] as Number).toDouble() }
    return minOf(
      xs.minOrNull() ?: 0.0,
      1.0 - (xs.maxOrNull() ?: 1.0),
      ys.minOrNull() ?: 0.0,
      1.0 - (ys.maxOrNull() ?: 1.0)
    )
  }

  private fun precisionPayload(
    applied: Boolean,
    passes: Int,
    reason: String,
    sourcePalmSize: Double,
    sourceEdgeMargin: Double,
    region: NormalizedRegion?,
    fallbackReason: String? = null
  ): Map<String, Any> {
    val result = mutableMapOf<String, Any>(
      "applied" to applied,
      "passes" to passes,
      "reason" to reason,
      "sourcePalmSize" to sourcePalmSize,
      "sourceEdgeMargin" to sourceEdgeMargin,
      "regionArea" to (region?.area() ?: 1.0),
      "region" to regionResult(region)
    )
    if (fallbackReason != null) result["fallbackReason"] = fallbackReason
    return result
  }

  private fun cropBitmap(bitmap: Bitmap, region: NormalizedRegion): Bitmap {
    val leftPx = (region.left * bitmap.width).toInt().coerceIn(0, bitmap.width - 2)
    val topPx = (region.top * bitmap.height).toInt().coerceIn(0, bitmap.height - 2)
    val rightPx = (region.right * bitmap.width).toInt().coerceIn(leftPx + 2, bitmap.width)
    val bottomPx = (region.bottom * bitmap.height).toInt().coerceIn(topPx + 2, bitmap.height)
    val width = rightPx - leftPx
    val height = bottomPx - topPx
    if (width < 96 || height < 96) {
      throw IllegalArgumentException("손 정밀 분석 구역이 너무 작습니다.")
    }
    return Bitmap.createBitmap(bitmap, leftPx, topPx, width, height)
  }

  private fun remapLandmarks(
    landmarks: List<Map<String, Any>>,
    region: NormalizedRegion?
  ): List<Map<String, Any>> {
    if (region == null) return landmarks
    val width = region.right - region.left
    val height = region.bottom - region.top
    return landmarks.map { point ->
      val localX = (point["x"] as Number).toDouble()
      val localY = (point["y"] as Number).toDouble()
      mapOf(
        "index" to (point["index"] as Number).toInt(),
        "name" to (point["name"] as String),
        "x" to (region.left + localX * width).coerceIn(0.0, 1.0),
        "y" to (region.top + localY * height).coerceIn(0.0, 1.0),
        "z" to (point["z"] as Number).toDouble()
      )
    }
  }

  private fun remapPick(
    pick: Map<String, Any>,
    region: NormalizedRegion?
  ): Map<String, Any> {
    if (region == null || pick["detected"] != true) return pick
    val localX = (pick["centerX"] as Number).toDouble()
    val localY = (pick["centerY"] as Number).toDouble()
    return pick.toMutableMap().apply {
      this["centerX"] = (region.left + localX * (region.right - region.left)).coerceIn(0.0, 1.0)
      this["centerY"] = (region.top + localY * (region.bottom - region.top)).coerceIn(0.0, 1.0)
    }
  }

  private fun regionResult(region: NormalizedRegion?): Map<String, Any> {
    if (region == null) return emptyMap()
    return mapOf(
      "left" to region.left,
      "top" to region.top,
      "right" to region.right,
      "bottom" to region.bottom
    )
  }

  @Synchronized
  private fun getHandLandmarker(): HandLandmarker {
    return handLandmarker ?: run {
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("Android 손 분석 컨텍스트를 사용할 수 없습니다.")
      val baseOptions = BaseOptions.builder()
        .setModelAssetPath(HAND_LANDMARKER_MODEL)
        .build()
      val options = HandLandmarker.HandLandmarkerOptions.builder()
        .setBaseOptions(baseOptions)
        .setNumHands(1)
        .setMinHandDetectionConfidence(0.38f)
        .setMinHandPresenceConfidence(0.38f)
        .setMinTrackingConfidence(0.42f)
        .setRunningMode(RunningMode.IMAGE)
        .build()

      HandLandmarker.createFromOptions(context, options).also { handLandmarker = it }
    }
  }

  private fun analyzePickColor(
    bitmap: Bitmap,
    landmarks: List<Map<String, Any>>,
    requestedColor: String
  ): Map<String, Any> {
    val colorKey = requestedColor.lowercase()
    if (colorKey == "none") return emptyPickResult(colorKey)

    fun x(index: Int) = (landmarks[index]["x"] as Number).toDouble() * bitmap.width
    fun y(index: Int) = (landmarks[index]["y"] as Number).toDouble() * bitmap.height

    val thumbX = x(4)
    val thumbY = y(4)
    val indexX = x(8)
    val indexY = y(8)
    val wristX = x(0)
    val wristY = y(0)
    val middleMcpX = x(9)
    val middleMcpY = y(9)

    val palmScale = sqrt(
      (middleMcpX - wristX) * (middleMcpX - wristX) +
        (middleMcpY - wristY) * (middleMcpY - wristY)
    ).coerceAtLeast(20.0)
    val centerX = (thumbX + indexX) / 2.0
    val centerY = (thumbY + indexY) / 2.0
    val radius = (palmScale * 0.72).coerceIn(24.0, min(bitmap.width, bitmap.height) * 0.18)

    val left = max(0, (centerX - radius).toInt())
    val right = min(bitmap.width - 1, (centerX + radius).toInt())
    val top = max(0, (centerY - radius).toInt())
    val bottom = min(bitmap.height - 1, (centerY + radius).toInt())

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
          if (matchesPickColor(hsv[0], hsv[1], hsv[2], colorKey)) {
            xs.add(px.toDouble())
            ys.add(py.toDouble())
          }
        }
        px += 2
      }
      py += 2
    }

    val roiAreaSamples = PI * radius * radius / 4.0
    val minimumSamples = max(14, (roiAreaSamples * 0.012).toInt())
    if (xs.size < minimumSamples) return emptyPickResult(colorKey)

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
      minX = min(minX, xs[index])
      maxX = max(maxX, xs[index])
      minY = min(minY, ys[index])
      maxY = max(maxY, ys[index])
    }

    covXX /= xs.size
    covYY /= xs.size
    covXY /= xs.size
    var angle = Math.toDegrees(0.5 * atan2(2.0 * covXY, covXX - covYY))
    while (angle > 90.0) angle -= 180.0
    while (angle < -90.0) angle += 180.0

    val coverage = (xs.size / roiAreaSamples).coerceIn(0.0, 1.0)
    val confidence = (coverage / 0.09).coerceIn(0.0, 1.0)
    val majorExtent = max(maxX - minX, maxY - minY)
    val exposure = (majorExtent / palmScale).coerceIn(0.0, 1.5)

    return mapOf(
      "detected" to true,
      "color" to colorKey,
      "confidence" to confidence,
      "angleDegrees" to angle,
      "exposure" to exposure,
      "centerX" to (meanX / bitmap.width).coerceIn(0.0, 1.0),
      "centerY" to (meanY / bitmap.height).coerceIn(0.0, 1.0)
    )
  }

  private fun matchesPickColor(hue: Float, saturation: Float, value: Float, key: String): Boolean {
    return when (key) {
      "red" -> (hue <= 18f || hue >= 342f) && saturation >= 0.42f && value >= 0.22f
      "orange" -> hue in 15f..45f && saturation >= 0.42f && value >= 0.25f
      "yellow" -> hue in 42f..78f && saturation >= 0.38f && value >= 0.35f
      "green" -> hue in 75f..170f && saturation >= 0.35f && value >= 0.22f
      "blue" -> hue in 175f..255f && saturation >= 0.38f && value >= 0.20f
      "purple" -> hue in 250f..335f && saturation >= 0.35f && value >= 0.20f
      "white" -> saturation <= 0.16f && value >= 0.78f
      "black" -> value <= 0.22f
      "auto" -> saturation >= 0.52f && value >= 0.24f && hue in 48f..338f
      else -> false
    }
  }

  private fun emptyPickResult(color: String): Map<String, Any> {
    return mapOf(
      "detected" to false,
      "color" to color,
      "confidence" to 0.0,
      "angleDegrees" to 0.0,
      "exposure" to 0.0,
      "centerX" to 0.0,
      "centerY" to 0.0
    )
  }

  private fun decodeBitmap(uriString: String): Bitmap {
    val context = appContext.reactContext
      ?: throw IllegalStateException("Android 손 분석 컨텍스트를 사용할 수 없습니다.")
    val uri = Uri.parse(uriString)
    val bytes = when (uri.scheme) {
      "content" -> context.contentResolver.openInputStream(uri)
        ?.use { it.readBytes() }
        ?: throw IllegalArgumentException("카메라 파일을 열 수 없습니다.")
      "file" -> FileInputStream(File(requireNotNull(uri.path))).use { it.readBytes() }
      else -> FileInputStream(File(uriString)).use { it.readBytes() }
    }

    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
      throw IllegalArgumentException("카메라 이미지 크기를 읽지 못했습니다.")
    }
    var sampleSize = 1
    while (max(bounds.outWidth, bounds.outHeight) / sampleSize > 2_048) sampleSize *= 2
    val options = BitmapFactory.Options().apply {
      inSampleSize = sampleSize
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
      ?: throw IllegalArgumentException("카메라 이미지를 읽지 못했습니다.")
  }

  companion object {
    private const val HAND_LANDMARKER_MODEL = "hand_landmarker.task"
    private val LANDMARK_NAMES = listOf(
      "wrist",
      "thumbCmc",
      "thumbMcp",
      "thumbIp",
      "thumbTip",
      "indexMcp",
      "indexPip",
      "indexDip",
      "indexTip",
      "middleMcp",
      "middlePip",
      "middleDip",
      "middleTip",
      "ringMcp",
      "ringPip",
      "ringDip",
      "ringTip",
      "pinkyMcp",
      "pinkyPip",
      "pinkyDip",
      "pinkyTip"
    )
  }
}
