package expo.modules.guitarcoachnative

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

class GuitarCoachStringVisionModule : Module() {
  private val busy = AtomicBoolean(false)

  override fun definition() = ModuleDefinition {
    Name("GuitarCoachStringVision")

    Constant("androidStringVisionAvailable") { true }
    Constant("androidAdaptiveStringRegionAvailable") { true }

    AsyncFunction("analyzeStringsAsync") { uri: String, promise: Promise ->
      startAnalysis(uri, null, promise)
    }

    AsyncFunction("analyzeStringsInRegionAsync") {
      uri: String,
      left: Double,
      top: Double,
      right: Double,
      bottom: Double,
      focusX: Double,
      focusY: Double,
      promise: Promise ->
      startAnalysis(
        uri,
        NormalizedRegion(left, top, right, bottom, focusX, focusY),
        promise
      )
    }
  }

  private fun startAnalysis(uri: String, region: NormalizedRegion?, promise: Promise) {
    if (!busy.compareAndSet(false, true)) {
      promise.reject("ERR_STRING_VISION_BUSY", "이전 기타줄 분석이 아직 끝나지 않았습니다.", null)
      return
    }

    Thread {
      var bitmap: Bitmap? = null
      try {
        val decodedBitmap = decodeBitmap(uri)
        bitmap = decodedBitmap
        promise.resolve(detectStrings(decodedBitmap, region))
      } catch (error: Throwable) {
        promise.reject("ERR_STRING_VISION", "기타줄을 자동 분석하지 못했습니다.", error)
      } finally {
        bitmap?.recycle()
        busy.set(false)
      }
    }.start()
  }

  private data class NormalizedRegion(
    val left: Double,
    val top: Double,
    val right: Double,
    val bottom: Double,
    val focusX: Double,
    val focusY: Double
  )

  private data class PixelRegion(
    val left: Int,
    val top: Int,
    val right: Int,
    val bottom: Int,
    val focusX: Double,
    val focusY: Double
  )

  private data class SequenceCandidate(
    val angleDegrees: Int,
    val normalX: Double,
    val normalY: Double,
    val minProjection: Double,
    val positions: DoubleArray,
    val strengths: DoubleArray,
    val confidence: Double,
    val regularity: Double,
    val coverage: Double
  )

  private fun detectStrings(bitmap: Bitmap, requestedRegion: NormalizedRegion?): Map<String, Any> {
    val width = bitmap.width
    val height = bitmap.height
    val minimumDimension = min(width, height)
    if (minimumDimension < 180) return emptyResult()

    val region = pixelRegion(requestedRegion, width, height)
    val roiWidth = region.right - region.left + 1
    val roiHeight = region.bottom - region.top + 1
    if (roiWidth < 120 || roiHeight < 90) return emptyResult()

    val analysisDimension = min(roiWidth, roiHeight)
    val sampleStep = max(2, analysisDimension / 280)
    val offset = max(2, sampleStep / 2)
    var best: SequenceCandidate? = null

    for (angleDegrees in -45..45 step 3) {
      val radians = Math.toRadians(angleDegrees.toDouble())
      val lineX = cos(radians)
      val lineY = sin(radians)
      val normalX = -lineY
      val normalY = lineX
      val projections = doubleArrayOf(
        normalX * region.left + normalY * region.top,
        normalX * region.right + normalY * region.top,
        normalX * region.left + normalY * region.bottom,
        normalX * region.right + normalY * region.bottom
      )
      val minProjection = projections.minOrNull() ?: continue
      val maxProjection = projections.maxOrNull() ?: continue
      val profile = DoubleArray(max(8, ceil(maxProjection - minProjection).toInt() + 3))

      var y = region.top
      while (y <= region.bottom) {
        var x = region.left
        while (x <= region.right) {
          val x1 = (x + normalX * offset).roundToInt().coerceIn(0, width - 1)
          val y1 = (y + normalY * offset).roundToInt().coerceIn(0, height - 1)
          val x2 = (x - normalX * offset).roundToInt().coerceIn(0, width - 1)
          val y2 = (y - normalY * offset).roundToInt().coerceIn(0, height - 1)
          val first = gray(bitmap.getPixel(x1, y1))
          val second = gray(bitmap.getPixel(x2, y2))
          val center = gray(bitmap.getPixel(x, y))
          val twoSideEdge = abs(first - second).toDouble()
          val centerContrast = abs(center - (first + second) / 2.0)
          val edge = twoSideEdge + centerContrast * 0.62
          if (edge >= 4.2) {
            val projection = normalX * x + normalY * y
            val bin = (projection - minProjection).roundToInt()
            if (bin in profile.indices) profile[bin] += edge
          }
          x += sampleStep
        }
        y += sampleStep
      }

      val smooth = smooth(profile, 2)
      val profileMean = smooth.average().coerceAtLeast(0.001)
      val gapMin = max(3, analysisDimension / 260)
      val gapMax = min(64, maximumUsefulGap(analysisDimension, smooth.size))
      if (gapMax <= gapMin) continue

      val focusProjection = normalX * region.focusX + normalY * region.focusY
      val focusBin = focusProjection - minProjection
      var bestScore = 0.0
      var bestPositions = DoubleArray(6)
      var bestStrengths = DoubleArray(6)
      var bestRegularity = 0.0
      var bestCoverage = 0.0
      var bestFocusWeight = 0.0

      for (gap in gapMin..gapMax) {
        val lastStart = smooth.size - gap * 5 - 3
        if (lastStart <= 2) continue
        val peakRadius = max(2, gap / 3)
        for (start in 2..lastStart) {
          val positions = DoubleArray(6)
          val strengths = DoubleArray(6)
          for (index in 0 until 6) {
            val center = start + index * gap
            positions[index] = localPeakPosition(smooth, center, peakRadius)
            strengths[index] = interpolatedValue(smooth, positions[index])
          }

          val averageStrength = strengths.average()
          if (averageStrength <= profileMean * 1.10) continue
          val minimumStrength = strengths.minOrNull() ?: 0.0
          val minimumRegularity = (minimumStrength / averageStrength).coerceIn(0.0, 1.0)
          val spacings = DoubleArray(5) { positions[it + 1] - positions[it] }
          val spacingMean = spacings.average().coerceAtLeast(0.001)
          val spacingDeviation = standardDeviation(spacings)
          val spacingRegularity = (1.0 - spacingDeviation / max(1.0, spacingMean * 0.34)).coerceIn(0.0, 1.0)
          val regularity = (spacingRegularity * 0.68 + minimumRegularity * 0.32).coerceIn(0.0, 1.0)
          val coverage = strengths.count { it >= profileMean * 1.06 } / 6.0
          if (coverage < 0.66 || regularity < 0.34) continue

          val bandStart = positions.first() - spacingMean * 0.65
          val bandEnd = positions.last() + spacingMean * 0.65
          val focusDistance = when {
            focusBin < bandStart -> bandStart - focusBin
            focusBin > bandEnd -> focusBin - bandEnd
            else -> 0.0
          }
          val focusWeight = 1.0 / (1.0 + focusDistance / max(1.0, spacingMean) * 0.42)
          val score = strengths.sum() *
            (0.46 + regularity * 0.34 + minimumRegularity * 0.20) *
            (0.76 + coverage * 0.24) *
            (0.72 + focusWeight * 0.28)

          if (score > bestScore) {
            bestScore = score
            bestPositions = positions
            bestStrengths = strengths
            bestRegularity = regularity
            bestCoverage = coverage
            bestFocusWeight = focusWeight
          }
        }
      }

      if (bestScore <= 0.0) continue
      val contrast = bestScore / (profileMean * 6.0 + 1.0)
      val contrastConfidence = ((contrast - 1.02) / 5.0).coerceIn(0.0, 1.0)
      val confidence = (
        contrastConfidence * 0.48 +
          bestRegularity * 0.24 +
          bestCoverage * 0.18 +
          bestFocusWeight * 0.10
        ).coerceIn(0.0, 1.0)
      val candidate = SequenceCandidate(
        angleDegrees,
        normalX,
        normalY,
        minProjection,
        bestPositions,
        bestStrengths,
        confidence,
        bestRegularity,
        bestCoverage
      )
      val currentBest = best
      if (currentBest == null || candidate.confidence > currentBest.confidence) best = candidate
    }

    val candidate = best ?: return emptyResult()
    if (candidate.confidence < 0.40 || candidate.coverage < 0.66) {
      return emptyResult(candidate.confidence, candidate.angleDegrees.toDouble(), region, width, height)
    }

    val maximumStrength = (candidate.strengths.maxOrNull() ?: 1.0).coerceAtLeast(1.0)
    val normalizedStrengths = candidate.strengths.map { (it / maximumStrength).coerceIn(0.0, 1.0) }
    val firstSide = normalizedStrengths.take(2).average()
    val lastSide = normalizedStrengths.takeLast(2).average()
    val directionDifference = abs(firstSide - lastSide) / max(0.001, max(firstSide, lastSide))
    val numberingConfidence = (
      ((directionDifference - 0.11) / 0.36).coerceIn(0.0, 1.0) *
        candidate.confidence *
        candidate.regularity
      ).coerceIn(0.0, 1.0)
    val stringOrder = when {
      numberingConfidence < 0.64 -> "unknown"
      firstSide > lastSide -> "low-to-high"
      else -> "high-to-low"
    }

    val lines = ArrayList<Map<String, Any>>()
    for (index in 0 until 6) {
      val projection = candidate.minProjection + candidate.positions[index]
      val endpoints = lineEndpoints(
        candidate.normalX,
        candidate.normalY,
        projection,
        width,
        height
      )
      if (endpoints.size < 2) continue
      val first = endpoints[0]
      val second = endpoints[1]
      val stringNumber = when (stringOrder) {
        "low-to-high" -> 6 - index
        "high-to-low" -> index + 1
        else -> 0
      }
      lines.add(
        mapOf(
          "visualIndex" to index + 1,
          "stringNumber" to stringNumber,
          "startX" to (first.first / width.toDouble()).coerceIn(0.0, 1.0),
          "startY" to (first.second / height.toDouble()).coerceIn(0.0, 1.0),
          "endX" to (second.first / width.toDouble()).coerceIn(0.0, 1.0),
          "endY" to (second.second / height.toDouble()).coerceIn(0.0, 1.0),
          "strength" to normalizedStrengths[index]
        )
      )
    }

    val visibleCount = normalizedStrengths.count { it >= 0.28 }
    val detected = lines.size == 6 && visibleCount >= 4 && candidate.confidence >= 0.40
    return mapOf(
      "detected" to detected,
      "confidence" to candidate.confidence,
      "angleDegrees" to candidate.angleDegrees.toDouble(),
      "visibleLineCount" to visibleCount,
      "stringOrder" to stringOrder,
      "numberingConfidence" to numberingConfidence,
      "nearestVisualIndex" to 0,
      "nearestStringNumber" to 0,
      "nearestDistanceRatio" to 1.0,
      "roiLeft" to (region.left / width.toDouble()).coerceIn(0.0, 1.0),
      "roiTop" to (region.top / height.toDouble()).coerceIn(0.0, 1.0),
      "roiRight" to (region.right / width.toDouble()).coerceIn(0.0, 1.0),
      "roiBottom" to (region.bottom / height.toDouble()).coerceIn(0.0, 1.0),
      "focusX" to (region.focusX / width.toDouble()).coerceIn(0.0, 1.0),
      "focusY" to (region.focusY / height.toDouble()).coerceIn(0.0, 1.0),
      "lines" to lines
    )
  }

  private fun pixelRegion(requested: NormalizedRegion?, width: Int, height: Int): PixelRegion {
    val fallback = requested ?: NormalizedRegion(0.02, 0.12, 0.98, 0.88, 0.5, 0.5)
    var left = (fallback.left.coerceIn(0.0, 0.96) * width).roundToInt()
    var right = (fallback.right.coerceIn(0.04, 1.0) * width).roundToInt()
    var top = (fallback.top.coerceIn(0.0, 0.96) * height).roundToInt()
    var bottom = (fallback.bottom.coerceIn(0.04, 1.0) * height).roundToInt()
    if (right - left < width * 0.45) {
      val center = (left + right) / 2
      left = (center - width * 0.24).roundToInt()
      right = (center + width * 0.24).roundToInt()
    }
    if (bottom - top < height * 0.30) {
      val center = (top + bottom) / 2
      top = (center - height * 0.16).roundToInt()
      bottom = (center + height * 0.16).roundToInt()
    }
    left = left.coerceIn(0, width - 2)
    right = right.coerceIn(left + 1, width - 1)
    top = top.coerceIn(0, height - 2)
    bottom = bottom.coerceIn(top + 1, height - 1)
    return PixelRegion(
      left,
      top,
      right,
      bottom,
      (fallback.focusX.coerceIn(0.0, 1.0) * width).coerceIn(left.toDouble(), right.toDouble()),
      (fallback.focusY.coerceIn(0.0, 1.0) * height).coerceIn(top.toDouble(), bottom.toDouble())
    )
  }

  private fun maximumUsefulGap(minimumDimension: Int, profileSize: Int): Int {
    return min(profileSize / 7, max(8, minimumDimension / 13))
  }

  private fun smooth(values: DoubleArray, radius: Int): DoubleArray {
    if (values.isEmpty()) return values
    return DoubleArray(values.size) { index ->
      var sum = 0.0
      var count = 0
      for (offset in -radius..radius) {
        val target = index + offset
        if (target in values.indices) {
          sum += values[target]
          count += 1
        }
      }
      sum / max(1, count)
    }
  }

  private fun localPeakPosition(values: DoubleArray, center: Int, radius: Int): Double {
    var weightedPosition = 0.0
    var weightTotal = 0.0
    var maximum = 0.0
    for (offset in -radius..radius) {
      val index = center + offset
      if (index !in values.indices) continue
      maximum = max(maximum, values[index])
    }
    val threshold = maximum * 0.72
    for (offset in -radius..radius) {
      val index = center + offset
      if (index !in values.indices) continue
      val value = values[index]
      if (value >= threshold) {
        weightedPosition += index * value
        weightTotal += value
      }
    }
    return if (weightTotal > 0.0) weightedPosition / weightTotal else center.toDouble()
  }

  private fun interpolatedValue(values: DoubleArray, position: Double): Double {
    if (values.isEmpty()) return 0.0
    val lower = position.toInt().coerceIn(0, values.lastIndex)
    val upper = min(values.lastIndex, lower + 1)
    val fraction = (position - lower).coerceIn(0.0, 1.0)
    return values[lower] * (1.0 - fraction) + values[upper] * fraction
  }

  private fun standardDeviation(values: DoubleArray): Double {
    if (values.size < 2) return 0.0
    val mean = values.average()
    return sqrt(values.map { (it - mean) * (it - mean) }.average())
  }

  private fun lineEndpoints(
    normalX: Double,
    normalY: Double,
    projection: Double,
    width: Int,
    height: Int
  ): List<Pair<Double, Double>> {
    val points = ArrayList<Pair<Double, Double>>()
    val maxX = (width - 1).toDouble()
    val maxY = (height - 1).toDouble()

    if (abs(normalY) > 1e-8) {
      val yAtLeft = projection / normalY
      if (yAtLeft in 0.0..maxY) points.add(0.0 to yAtLeft)
      val yAtRight = (projection - normalX * maxX) / normalY
      if (yAtRight in 0.0..maxY) points.add(maxX to yAtRight)
    }
    if (abs(normalX) > 1e-8) {
      val xAtTop = projection / normalX
      if (xAtTop in 0.0..maxX) points.add(xAtTop to 0.0)
      val xAtBottom = (projection - normalY * maxY) / normalX
      if (xAtBottom in 0.0..maxX) points.add(xAtBottom to maxY)
    }

    val unique = points.distinctBy { "${it.first.roundToInt()}-${it.second.roundToInt()}" }
    if (unique.size <= 2) return unique
    var bestA = unique[0]
    var bestB = unique[1]
    var bestDistance = 0.0
    for (a in unique.indices) {
      for (b in a + 1 until unique.size) {
        val dx = unique[a].first - unique[b].first
        val dy = unique[a].second - unique[b].second
        val distance = dx * dx + dy * dy
        if (distance > bestDistance) {
          bestDistance = distance
          bestA = unique[a]
          bestB = unique[b]
        }
      }
    }
    return listOf(bestA, bestB)
  }

  private fun gray(color: Int): Int {
    return (Color.red(color) * 30 + Color.green(color) * 59 + Color.blue(color) * 11) / 100
  }

  private fun emptyResult(
    confidence: Double = 0.0,
    angleDegrees: Double = 0.0,
    region: PixelRegion? = null,
    width: Int = 1,
    height: Int = 1
  ): Map<String, Any> {
    return mapOf(
      "detected" to false,
      "confidence" to confidence,
      "angleDegrees" to angleDegrees,
      "visibleLineCount" to 0,
      "stringOrder" to "unknown",
      "numberingConfidence" to 0.0,
      "nearestVisualIndex" to 0,
      "nearestStringNumber" to 0,
      "nearestDistanceRatio" to 1.0,
      "roiLeft" to ((region?.left ?: 0) / width.toDouble()).coerceIn(0.0, 1.0),
      "roiTop" to ((region?.top ?: 0) / height.toDouble()).coerceIn(0.0, 1.0),
      "roiRight" to ((region?.right ?: width) / width.toDouble()).coerceIn(0.0, 1.0),
      "roiBottom" to ((region?.bottom ?: height) / height.toDouble()).coerceIn(0.0, 1.0),
      "focusX" to ((region?.focusX ?: width * 0.5) / width.toDouble()).coerceIn(0.0, 1.0),
      "focusY" to ((region?.focusY ?: height * 0.5) / height.toDouble()).coerceIn(0.0, 1.0),
      "lines" to emptyList<Map<String, Any>>()
    )
  }

  private fun decodeBitmap(uriString: String): Bitmap {
    val context = appContext.reactContext
      ?: throw IllegalStateException("Android 기타줄 분석 컨텍스트를 사용할 수 없습니다.")
    val uri = Uri.parse(uriString)
    val stream: InputStream = when (uri.scheme) {
      "content" -> context.contentResolver.openInputStream(uri)
        ?: throw IllegalArgumentException("카메라 파일을 열 수 없습니다.")
      "file" -> FileInputStream(File(requireNotNull(uri.path)))
      else -> FileInputStream(File(uriString))
    }
    return stream.use {
      BitmapFactory.decodeStream(it) ?: throw IllegalArgumentException("카메라 이미지를 읽지 못했습니다.")
    }
  }
}
