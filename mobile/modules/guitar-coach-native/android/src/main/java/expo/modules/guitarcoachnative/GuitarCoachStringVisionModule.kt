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

class GuitarCoachStringVisionModule : Module() {
  private val busy = AtomicBoolean(false)

  override fun definition() = ModuleDefinition {
    Name("GuitarCoachStringVision")

    Constant("androidStringVisionAvailable") { true }

    AsyncFunction("analyzeStringsAsync") { uri: String, promise: Promise ->
      if (!busy.compareAndSet(false, true)) {
        promise.reject("ERR_STRING_VISION_BUSY", "이전 기타줄 분석이 아직 끝나지 않았습니다.", null)
        return@AsyncFunction
      }

      Thread {
        var bitmap: Bitmap? = null
        try {
          val decodedBitmap = decodeBitmap(uri)
          bitmap = decodedBitmap
          promise.resolve(detectStrings(decodedBitmap))
        } catch (error: Throwable) {
          promise.reject("ERR_STRING_VISION", "기타줄을 자동 분석하지 못했습니다.", error)
        } finally {
          bitmap?.recycle()
          busy.set(false)
        }
      }.start()
    }
  }

  private data class SequenceCandidate(
    val angleDegrees: Int,
    val normalX: Double,
    val normalY: Double,
    val minProjection: Double,
    val startBin: Int,
    val gap: Int,
    val strengths: DoubleArray,
    val confidence: Double
  )

  private fun detectStrings(bitmap: Bitmap): Map<String, Any> {
    val width = bitmap.width
    val height = bitmap.height
    val minimumDimension = min(width, height)
    if (minimumDimension < 180) return emptyResult()

    val roiLeft = (width * 0.02).roundToInt()
    val roiRight = (width * 0.98).roundToInt()
    val roiTop = (height * 0.12).roundToInt()
    val roiBottom = (height * 0.88).roundToInt()
    val sampleStep = max(3, minimumDimension / 220)
    val offset = max(2, sampleStep / 2)
    var best: SequenceCandidate? = null

    for (angleDegrees in -40..40 step 5) {
      val radians = Math.toRadians(angleDegrees.toDouble())
      val lineX = cos(radians)
      val lineY = sin(radians)
      val normalX = -lineY
      val normalY = lineX
      val projections = doubleArrayOf(
        normalX * roiLeft + normalY * roiTop,
        normalX * roiRight + normalY * roiTop,
        normalX * roiLeft + normalY * roiBottom,
        normalX * roiRight + normalY * roiBottom
      )
      val minProjection = projections.minOrNull() ?: continue
      val maxProjection = projections.maxOrNull() ?: continue
      val profile = DoubleArray(max(8, ceil(maxProjection - minProjection).toInt() + 3))

      var y = roiTop
      while (y <= roiBottom) {
        var x = roiLeft
        while (x <= roiRight) {
          val x1 = (x + normalX * offset).roundToInt().coerceIn(0, width - 1)
          val y1 = (y + normalY * offset).roundToInt().coerceIn(0, height - 1)
          val x2 = (x - normalX * offset).roundToInt().coerceIn(0, width - 1)
          val y2 = (y - normalY * offset).roundToInt().coerceIn(0, height - 1)
          val edge = abs(gray(bitmap.getPixel(x1, y1)) - gray(bitmap.getPixel(x2, y2))).toDouble()
          if (edge >= 5.0) {
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
      val gapMin = max(4, minimumDimension / 210)
      val gapMax = min(52, maximumUsefulGap(minimumDimension, smooth.size))
      if (gapMax <= gapMin) continue

      var bestScore = 0.0
      var bestStart = 0
      var bestGap = 0
      var bestStrengths = DoubleArray(6)
      for (gap in gapMin..gapMax) {
        val lastStart = smooth.size - gap * 5 - 3
        if (lastStart <= 2) continue
        for (start in 2..lastStart) {
          val strengths = DoubleArray(6) { index -> localMaximum(smooth, start + index * gap, 2) }
          val averageStrength = strengths.average()
          if (averageStrength <= profileMean * 1.15) continue
          val minimumStrength = strengths.minOrNull() ?: 0.0
          val regularity = (minimumStrength / averageStrength).coerceIn(0.0, 1.0)
          val score = strengths.sum() * (0.62 + regularity * 0.38)
          if (score > bestScore) {
            bestScore = score
            bestStart = start
            bestGap = gap
            bestStrengths = strengths
          }
        }
      }

      if (bestGap <= 0) continue
      val contrast = bestScore / (profileMean * 6.0 + 1.0)
      val confidence = ((contrast - 1.15) / 5.5).coerceIn(0.0, 1.0)
      val candidate = SequenceCandidate(
        angleDegrees,
        normalX,
        normalY,
        minProjection,
        bestStart,
        bestGap,
        bestStrengths,
        confidence
      )
      val currentBest = best
      if (currentBest == null || candidate.confidence > currentBest.confidence) best = candidate
    }

    val candidate = best ?: return emptyResult()
    if (candidate.confidence < 0.36) return emptyResult(candidate.confidence, candidate.angleDegrees.toDouble())

    val maximumStrength = (candidate.strengths.maxOrNull() ?: 1.0).coerceAtLeast(1.0)
    val normalizedStrengths = candidate.strengths.map { (it / maximumStrength).coerceIn(0.0, 1.0) }
    val firstSide = normalizedStrengths.take(2).average()
    val lastSide = normalizedStrengths.takeLast(2).average()
    val directionDifference = abs(firstSide - lastSide) / max(0.001, max(firstSide, lastSide))
    val numberingConfidence = ((directionDifference - 0.10) / 0.38).coerceIn(0.0, 1.0) * candidate.confidence
    val stringOrder = when {
      numberingConfidence < 0.62 -> "unknown"
      firstSide > lastSide -> "low-to-high"
      else -> "high-to-low"
    }

    val lines = ArrayList<Map<String, Any>>()
    for (index in 0 until 6) {
      val projection = candidate.minProjection + candidate.startBin + candidate.gap * index
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

    val visibleCount = normalizedStrengths.count { it >= 0.34 }
    val detected = lines.size == 6 && visibleCount >= 4 && candidate.confidence >= 0.36
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
      "lines" to lines
    )
  }

  private fun maximumUsefulGap(minimumDimension: Int, profileSize: Int): Int {
    return min(profileSize / 7, max(8, minimumDimension / 16))
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

  private fun localMaximum(values: DoubleArray, center: Int, radius: Int): Double {
    var maximum = 0.0
    for (offset in -radius..radius) {
      val index = center + offset
      if (index in values.indices) maximum = max(maximum, values[index])
    }
    return maximum
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

  private fun emptyResult(confidence: Double = 0.0, angleDegrees: Double = 0.0): Map<String, Any> {
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
