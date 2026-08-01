package expo.modules.guitarcoachnative

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.objectdetector.ObjectDetector
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

class GuitarCoachGuitarVisionModule : Module() {
  private var objectDetector: ObjectDetector? = null
  private val busy = AtomicBoolean(false)

  override fun definition() = ModuleDefinition {
    Name("GuitarCoachGuitarVision")

    Constant("androidGuitarVisionAvailable") { true }
    Constant("androidGuitarObjectModel") { MODEL_DESCRIPTION }

    AsyncFunction("analyzeGuitarAsync") { uri: String, promise: Promise ->
      if (!busy.compareAndSet(false, true)) {
        promise.reject("ERR_GUITAR_VISION_BUSY", "이전 기타 구조 분석이 아직 끝나지 않았습니다.", null)
        return@AsyncFunction
      }

      Thread {
        var bitmap: Bitmap? = null
        try {
          val decoded = decodeBitmap(uri)
          bitmap = decoded
          promise.resolve(analyze(decoded))
        } catch (error: Throwable) {
          promise.reject("ERR_GUITAR_VISION", "기타 객체와 구조를 분석하지 못했습니다.", error)
        } finally {
          if (bitmap != null && !bitmap.isRecycled) bitmap.recycle()
          cleanupFile(uri)
          busy.set(false)
        }
      }.start()
    }

    OnDestroy {
      objectDetector?.close()
      objectDetector = null
    }
  }

  private data class Point(val x: Double, val y: Double)
  private data class Box(val left: Double, val top: Double, val right: Double, val bottom: Double) {
    val width: Double get() = max(0.0, right - left)
    val height: Double get() = max(0.0, bottom - top)
    val center: Point get() = Point((left + right) / 2.0, (top + bottom) / 2.0)
  }
  private data class Axis(val x: Double, val y: Double) {
    val normalX: Double get() = -y
    val normalY: Double get() = x
    val angleDegrees: Double get() {
      var angle = Math.toDegrees(atan2(y, x))
      while (angle > 90.0) angle -= 180.0
      while (angle < -90.0) angle += 180.0
      return angle
    }
  }
  private data class ProjectionBounds(
    val minT: Double,
    val maxT: Double,
    val minN: Double,
    val maxN: Double
  )
  private data class Geometry(
    val axis: Axis,
    val objectProjection: ProjectionBounds,
    val bodyBox: Box,
    val bodyAtMaximum: Boolean,
    val bodyConfidence: Double,
    val neckStart: Point,
    val neckEnd: Point,
    val neckConfidence: Double
  )
  private data class Feature(
    val detected: Boolean,
    val confidence: Double,
    val center: Point,
    val sizeRatio: Double
  )

  private fun analyze(bitmap: Bitmap): Map<String, Any> {
    val mpImage = BitmapImageBuilder(bitmap).build()
    val result = getObjectDetector().detect(mpImage)
    val detection = result.detections().maxByOrNull { item ->
      item.categories().firstOrNull()?.score()?.toDouble() ?: 0.0
    } ?: return emptyResult("기타 객체 모델이 기타를 찾지 못했습니다.")

    val category = detection.categories().firstOrNull()
      ?: return emptyResult("기타 객체 라벨을 읽지 못했습니다.")
    val label = category.categoryName().ifBlank { category.displayName() }.lowercase()
    val objectConfidence = category.score().toDouble().coerceIn(0.0, 1.0)
    if (label != "guitar" || objectConfidence < OBJECT_SCORE_THRESHOLD) {
      return emptyResult("기타 객체 신뢰도가 부족합니다.", objectConfidence, label)
    }

    val rawBox = detection.boundingBox()
    val objectBox = Box(
      (rawBox.left / bitmap.width.toDouble()).coerceIn(0.0, 1.0),
      (rawBox.top / bitmap.height.toDouble()).coerceIn(0.0, 1.0),
      (rawBox.right / bitmap.width.toDouble()).coerceIn(0.0, 1.0),
      (rawBox.bottom / bitmap.height.toDouble()).coerceIn(0.0, 1.0)
    )
    if (objectBox.width < 0.12 || objectBox.height < 0.12) {
      return emptyResult("기타 객체가 너무 작게 보입니다.", objectConfidence, label, objectBox)
    }

    val geometry = analyzeGeometry(bitmap, objectBox, objectConfidence)
    val soundhole = findSoundhole(bitmap, geometry)
    val pickup = findTransverseFeature(
      bitmap = bitmap,
      geometry = geometry,
      exclusion = null,
      expectedWidthRatio = 0.34,
      darknessWeight = 0.72
    )
    val preferredResonator = if (soundhole.confidence >= pickup.confidence) soundhole else pickup
    val bridge = findTransverseFeature(
      bitmap = bitmap,
      geometry = geometry,
      exclusion = preferredResonator.takeIf { it.detected },
      expectedWidthRatio = 0.52,
      darknessWeight = 0.48
    )

    val bodyDetected = geometry.bodyConfidence >= 0.34
    val neckDetected = geometry.neckConfidence >= 0.32
    val soundholeDetected = soundhole.detected && soundhole.confidence >= 0.30
    val pickupDetected = pickup.detected && pickup.confidence >= 0.30
    val bridgeDetected = bridge.detected && bridge.confidence >= 0.28
    val resonatorConfidence = max(
      if (soundholeDetected) soundhole.confidence else 0.0,
      if (pickupDetected) pickup.confidence else 0.0
    )
    val structureConfidence = (
      objectConfidence * 0.28 +
        geometry.bodyConfidence * 0.18 +
        geometry.neckConfidence * 0.18 +
        resonatorConfidence * 0.18 +
        bridge.confidence * 0.18
      ).coerceIn(0.0, 1.0)

    return mapOf(
      "detected" to true,
      "model" to MODEL_DESCRIPTION,
      "label" to "guitar",
      "objectConfidence" to objectConfidence,
      "structureConfidence" to structureConfidence,
      "objectBox" to boxMap(objectBox),
      "bodyDetected" to bodyDetected,
      "bodyConfidence" to geometry.bodyConfidence,
      "bodyBox" to boxMap(geometry.bodyBox),
      "neckDetected" to neckDetected,
      "neckConfidence" to geometry.neckConfidence,
      "neckAngleDegrees" to geometry.axis.angleDegrees,
      "neckStartX" to geometry.neckStart.x,
      "neckStartY" to geometry.neckStart.y,
      "neckEndX" to geometry.neckEnd.x,
      "neckEndY" to geometry.neckEnd.y,
      "soundholeDetected" to soundholeDetected,
      "soundholeConfidence" to soundhole.confidence,
      "soundholeCenterX" to soundhole.center.x,
      "soundholeCenterY" to soundhole.center.y,
      "soundholeRadiusRatio" to soundhole.sizeRatio,
      "pickupDetected" to pickupDetected,
      "pickupConfidence" to pickup.confidence,
      "pickupCenterX" to pickup.center.x,
      "pickupCenterY" to pickup.center.y,
      "bridgeDetected" to bridgeDetected,
      "bridgeConfidence" to bridge.confidence,
      "bridgeCenterX" to bridge.center.x,
      "bridgeCenterY" to bridge.center.y,
      "bridgeAngleDegrees" to normalizeAngle(geometry.axis.angleDegrees + 90.0),
      "reason" to structureReason(bodyDetected, neckDetected, soundholeDetected, pickupDetected, bridgeDetected)
    )
  }

  private fun analyzeGeometry(bitmap: Bitmap, objectBox: Box, objectConfidence: Double): Geometry {
    val axis = estimateObjectAxis(bitmap, objectBox)
    val projection = projectionBounds(objectBox, axis)
    val length = max(0.001, projection.maxT - projection.minT)
    val normalSpan = max(0.001, projection.maxN - projection.minN)
    val bins = 11
    val minNormals = DoubleArray(bins) { Double.POSITIVE_INFINITY }
    val maxNormals = DoubleArray(bins) { Double.NEGATIVE_INFINITY }
    val edgeTotals = DoubleArray(bins)
    val left = (objectBox.left * bitmap.width).roundToInt().coerceIn(1, bitmap.width - 2)
    val right = (objectBox.right * bitmap.width).roundToInt().coerceIn(left + 1, bitmap.width - 2)
    val top = (objectBox.top * bitmap.height).roundToInt().coerceIn(1, bitmap.height - 2)
    val bottom = (objectBox.bottom * bitmap.height).roundToInt().coerceIn(top + 1, bitmap.height - 2)
    val step = max(2, min(right - left, bottom - top) / 180)

    var y = top
    while (y <= bottom) {
      var x = left
      while (x <= right) {
        val gradient = gradient(bitmap, x, y, step)
        if (gradient >= 18.0) {
          val normalizedX = x / bitmap.width.toDouble()
          val normalizedY = y / bitmap.height.toDouble()
          val t = normalizedX * axis.x + normalizedY * axis.y
          val n = normalizedX * axis.normalX + normalizedY * axis.normalY
          val bin = (((t - projection.minT) / length) * bins).toInt().coerceIn(0, bins - 1)
          minNormals[bin] = min(minNormals[bin], n)
          maxNormals[bin] = max(maxNormals[bin], n)
          edgeTotals[bin] += gradient
        }
        x += step
      }
      y += step
    }

    fun spread(index: Int): Double {
      val low = minNormals[index]
      val high = maxNormals[index]
      return if (low.isFinite() && high.isFinite() && high > low) high - low else 0.0
    }

    val firstSpread = (0..3).map(::spread).average()
    val lastSpread = (bins - 4 until bins).map(::spread).average()
    val bodyAtMaximum = lastSpread >= firstSpread
    val wideSpread = max(firstSpread, lastSpread)
    val narrowSpread = min(firstSpread, lastSpread)
    val widthContrast = ((wideSpread - narrowSpread) / max(normalSpan * 0.46, 0.001)).coerceIn(0.0, 1.0)
    val edgeCoverage = (edgeTotals.count { it > 0.0 } / bins.toDouble()).coerceIn(0.0, 1.0)
    val bodyConfidence = (
      objectConfidence * 0.48 +
        widthContrast * 0.30 +
        edgeCoverage * 0.22
      ).coerceIn(0.0, 1.0)

    val bodyMinT: Double
    val bodyMaxT: Double
    val neckBodyPointT: Double
    val neckEndT: Double
    if (bodyAtMaximum) {
      bodyMinT = projection.minT + length * 0.46
      bodyMaxT = projection.maxT
      neckBodyPointT = projection.minT + length * 0.52
      neckEndT = projection.minT + length * 0.03
    } else {
      bodyMinT = projection.minT
      bodyMaxT = projection.maxT - length * 0.46
      neckBodyPointT = projection.maxT - length * 0.52
      neckEndT = projection.maxT - length * 0.03
    }
    val bodyMinN = projection.minN + normalSpan * 0.04
    val bodyMaxN = projection.maxN - normalSpan * 0.04
    val bodyBox = orientedBoundsToBox(axis, bodyMinT, bodyMaxT, bodyMinN, bodyMaxN)
    val centerN = (projection.minN + projection.maxN) / 2.0
    val neckStart = pointFromProjection(axis, neckBodyPointT, centerN)
    val neckEnd = pointFromProjection(axis, neckEndT, centerN)
    val aspect = length / max(normalSpan, 0.001)
    val neckConfidence = (
      objectConfidence * 0.52 +
        widthContrast * 0.26 +
        ((aspect - 1.05) / 2.2).coerceIn(0.0, 1.0) * 0.22
      ).coerceIn(0.0, 1.0)

    return Geometry(
      axis = axis,
      objectProjection = projection,
      bodyBox = bodyBox,
      bodyAtMaximum = bodyAtMaximum,
      bodyConfidence = bodyConfidence,
      neckStart = neckStart,
      neckEnd = neckEnd,
      neckConfidence = neckConfidence
    )
  }

  private fun estimateObjectAxis(bitmap: Bitmap, box: Box): Axis {
    val left = (box.left * bitmap.width).roundToInt().coerceIn(1, bitmap.width - 2)
    val right = (box.right * bitmap.width).roundToInt().coerceIn(left + 1, bitmap.width - 2)
    val top = (box.top * bitmap.height).roundToInt().coerceIn(1, bitmap.height - 2)
    val bottom = (box.bottom * bitmap.height).roundToInt().coerceIn(top + 1, bitmap.height - 2)
    val step = max(2, min(right - left, bottom - top) / 160)
    var weightSum = 0.0
    var meanX = 0.0
    var meanY = 0.0
    val samples = ArrayList<Triple<Double, Double, Double>>()

    var y = top
    while (y <= bottom) {
      var x = left
      while (x <= right) {
        val weight = gradient(bitmap, x, y, step)
        if (weight >= 20.0) {
          val nx = x / bitmap.width.toDouble()
          val ny = y / bitmap.height.toDouble()
          samples.add(Triple(nx, ny, weight))
          weightSum += weight
          meanX += nx * weight
          meanY += ny * weight
        }
        x += step
      }
      y += step
    }

    if (weightSum <= 0.0 || samples.size < 24) {
      return if (box.width >= box.height) Axis(1.0, 0.0) else Axis(0.0, 1.0)
    }
    meanX /= weightSum
    meanY /= weightSum
    var covXX = 0.0
    var covYY = 0.0
    var covXY = 0.0
    samples.forEach { (x, yValue, weight) ->
      val dx = x - meanX
      val dy = yValue - meanY
      covXX += dx * dx * weight
      covYY += dy * dy * weight
      covXY += dx * dy * weight
    }
    val angle = 0.5 * atan2(2.0 * covXY, covXX - covYY)
    val axis = Axis(cos(angle), sin(angle))
    val projected = projectionBounds(box, axis)
    val major = projected.maxT - projected.minT
    val minor = projected.maxN - projected.minN
    if (major < minor * 0.92) return Axis(-axis.y, axis.x)
    return axis
  }

  private fun findSoundhole(bitmap: Bitmap, geometry: Geometry): Feature {
    val box = geometry.bodyBox
    val left = (box.left * bitmap.width).roundToInt().coerceIn(1, bitmap.width - 2)
    val right = (box.right * bitmap.width).roundToInt().coerceIn(left + 1, bitmap.width - 2)
    val top = (box.top * bitmap.height).roundToInt().coerceIn(1, bitmap.height - 2)
    val bottom = (box.bottom * bitmap.height).roundToInt().coerceIn(top + 1, bitmap.height - 2)
    val minimumDimension = min(right - left, bottom - top)
    if (minimumDimension < 40) return Feature(false, 0.0, box.center, 0.0)
    val step = max(4, minimumDimension / 28)
    val radii = listOf(0.065, 0.09, 0.12).map { max(4, (minimumDimension * it).roundToInt()) }
    val objectCenterN = box.center.x * geometry.axis.normalX + box.center.y * geometry.axis.normalY
    val normalSpan = max(0.001, geometry.objectProjection.maxN - geometry.objectProjection.minN)
    var best = Feature(false, 0.0, box.center, 0.0)

    var y = top + step
    while (y <= bottom - step) {
      var x = left + step
      while (x <= right - step) {
        val point = Point(x / bitmap.width.toDouble(), y / bitmap.height.toDouble())
        val normal = point.x * geometry.axis.normalX + point.y * geometry.axis.normalY
        val axisProximity = (1.0 - abs(normal - objectCenterN) / max(0.001, normalSpan * 0.34)).coerceIn(0.0, 1.0)
        if (axisProximity > 0.10) {
          radii.forEach { radius ->
            if (x - radius > left && x + radius < right && y - radius > top && y + radius < bottom) {
              val centerMean = meanDisk(bitmap, x, y, max(2, (radius * 0.56).roundToInt()))
              val ringMean = meanRing(bitmap, x, y, max(3, (radius * 0.78).roundToInt()), max(4, (radius * 1.28).roundToInt()))
              val contrast = ((ringMean - centerMean) / 72.0).coerceIn(0.0, 1.0)
              val darkness = ((178.0 - centerMean) / 118.0).coerceIn(0.0, 1.0)
              val symmetry = circularSymmetry(bitmap, x, y, radius)
              val score = (contrast * 0.52 + darkness * 0.18 + symmetry * 0.14 + axisProximity * 0.16).coerceIn(0.0, 1.0)
              if (score > best.confidence) {
                best = Feature(
                  detected = score >= 0.30,
                  confidence = score,
                  center = point,
                  sizeRatio = radius / min(bitmap.width, bitmap.height).toDouble()
                )
              }
            }
          }
        }
        x += step
      }
      y += step
    }
    return best
  }

  private fun findTransverseFeature(
    bitmap: Bitmap,
    geometry: Geometry,
    exclusion: Feature?,
    expectedWidthRatio: Double,
    darknessWeight: Double
  ): Feature {
    val projection = projectionBounds(geometry.bodyBox, geometry.axis)
    val length = max(0.001, projection.maxT - projection.minT)
    val normalSpan = max(0.001, projection.maxN - projection.minN)
    val centerN = (projection.minN + projection.maxN) / 2.0
    var best = Feature(false, 0.0, geometry.bodyBox.center, 0.0)
    val samples = 22
    for (index in 2 until samples - 2) {
      val amount = index / (samples - 1.0)
      val t = projection.minT + length * amount
      val center = pointFromProjection(geometry.axis, t, centerN)
      if (exclusion != null && distance(center, exclusion.center) < length * 0.11) continue
      val halfT = max(0.006, length * 0.025)
      val halfN = max(0.018, normalSpan * expectedWidthRatio * 0.5)
      val inside = meanOrientedRect(bitmap, geometry.axis, center, halfT, halfN)
      val before = meanOrientedRect(bitmap, geometry.axis, pointFromProjection(geometry.axis, t - halfT * 2.4, centerN), halfT, halfN)
      val after = meanOrientedRect(bitmap, geometry.axis, pointFromProjection(geometry.axis, t + halfT * 2.4, centerN), halfT, halfN)
      val neighborhood = (before + after) / 2.0
      val darkness = ((neighborhood - inside) / 60.0).coerceIn(0.0, 1.0)
      val crossEdge = transverseGradient(bitmap, geometry.axis, center, halfT, halfN)
      val centerBias = (1.0 - abs(amount - 0.56) / 0.56).coerceIn(0.0, 1.0)
      val score = (
        darkness * darknessWeight +
          crossEdge * (0.82 - darknessWeight) +
          centerBias * 0.18
        ).coerceIn(0.0, 1.0)
      if (score > best.confidence) {
        best = Feature(
          detected = score >= 0.28,
          confidence = score,
          center = center,
          sizeRatio = halfN * 2.0
        )
      }
    }
    return best
  }

  private fun transverseGradient(bitmap: Bitmap, axis: Axis, center: Point, halfT: Double, halfN: Double): Double {
    val before = pointFromProjection(
      axis,
      center.x * axis.x + center.y * axis.y - halfT,
      center.x * axis.normalX + center.y * axis.normalY
    )
    val after = pointFromProjection(
      axis,
      center.x * axis.x + center.y * axis.y + halfT,
      center.x * axis.normalX + center.y * axis.normalY
    )
    val first = meanOrientedRect(bitmap, axis, before, halfT * 0.45, halfN)
    val second = meanOrientedRect(bitmap, axis, after, halfT * 0.45, halfN)
    return (abs(first - second) / 68.0).coerceIn(0.0, 1.0)
  }

  private fun meanOrientedRect(bitmap: Bitmap, axis: Axis, center: Point, halfT: Double, halfN: Double): Double {
    val centerT = center.x * axis.x + center.y * axis.y
    val centerN = center.x * axis.normalX + center.y * axis.normalY
    val tSteps = 5
    val nSteps = 11
    var sum = 0.0
    var count = 0
    for (tIndex in 0 until tSteps) {
      val tAmount = if (tSteps == 1) 0.0 else tIndex / (tSteps - 1.0)
      val t = centerT - halfT + halfT * 2.0 * tAmount
      for (nIndex in 0 until nSteps) {
        val nAmount = if (nSteps == 1) 0.0 else nIndex / (nSteps - 1.0)
        val n = centerN - halfN + halfN * 2.0 * nAmount
        val point = pointFromProjection(axis, t, n)
        val x = (point.x * bitmap.width).roundToInt()
        val y = (point.y * bitmap.height).roundToInt()
        if (x in 0 until bitmap.width && y in 0 until bitmap.height) {
          sum += gray(bitmap.getPixel(x, y))
          count += 1
        }
      }
    }
    return if (count > 0) sum / count else 255.0
  }

  private fun meanDisk(bitmap: Bitmap, centerX: Int, centerY: Int, radius: Int): Double {
    var sum = 0.0
    var count = 0
    val step = max(1, radius / 8)
    var y = centerY - radius
    while (y <= centerY + radius) {
      var x = centerX - radius
      while (x <= centerX + radius) {
        val dx = x - centerX
        val dy = y - centerY
        if (dx * dx + dy * dy <= radius * radius && x in 0 until bitmap.width && y in 0 until bitmap.height) {
          sum += gray(bitmap.getPixel(x, y))
          count += 1
        }
        x += step
      }
      y += step
    }
    return if (count > 0) sum / count else 255.0
  }

  private fun meanRing(bitmap: Bitmap, centerX: Int, centerY: Int, innerRadius: Int, outerRadius: Int): Double {
    var sum = 0.0
    var count = 0
    val step = max(1, outerRadius / 10)
    val innerSquared = innerRadius * innerRadius
    val outerSquared = outerRadius * outerRadius
    var y = centerY - outerRadius
    while (y <= centerY + outerRadius) {
      var x = centerX - outerRadius
      while (x <= centerX + outerRadius) {
        val dx = x - centerX
        val dy = y - centerY
        val squared = dx * dx + dy * dy
        if (squared in innerSquared..outerSquared && x in 0 until bitmap.width && y in 0 until bitmap.height) {
          sum += gray(bitmap.getPixel(x, y))
          count += 1
        }
        x += step
      }
      y += step
    }
    return if (count > 0) sum / count else 255.0
  }

  private fun circularSymmetry(bitmap: Bitmap, centerX: Int, centerY: Int, radius: Int): Double {
    val values = ArrayList<Double>()
    for (index in 0 until 12) {
      val angle = index * PI * 2.0 / 12.0
      val x = (centerX + cos(angle) * radius * 0.72).roundToInt().coerceIn(0, bitmap.width - 1)
      val y = (centerY + sin(angle) * radius * 0.72).roundToInt().coerceIn(0, bitmap.height - 1)
      values.add(gray(bitmap.getPixel(x, y)))
    }
    val mean = values.average()
    val deviation = sqrt(values.sumOf { (it - mean) * (it - mean) } / max(1, values.size))
    return (1.0 - deviation / 64.0).coerceIn(0.0, 1.0)
  }

  private fun gradient(bitmap: Bitmap, x: Int, y: Int, offset: Int): Double {
    val safeOffset = max(1, offset)
    val left = gray(bitmap.getPixel((x - safeOffset).coerceIn(0, bitmap.width - 1), y.coerceIn(0, bitmap.height - 1)))
    val right = gray(bitmap.getPixel((x + safeOffset).coerceIn(0, bitmap.width - 1), y.coerceIn(0, bitmap.height - 1)))
    val top = gray(bitmap.getPixel(x.coerceIn(0, bitmap.width - 1), (y - safeOffset).coerceIn(0, bitmap.height - 1)))
    val bottom = gray(bitmap.getPixel(x.coerceIn(0, bitmap.width - 1), (y + safeOffset).coerceIn(0, bitmap.height - 1)))
    return sqrt((right - left) * (right - left) + (bottom - top) * (bottom - top))
  }

  private fun gray(pixel: Int): Double {
    val red = (pixel shr 16) and 0xff
    val green = (pixel shr 8) and 0xff
    val blue = pixel and 0xff
    return red * 0.299 + green * 0.587 + blue * 0.114
  }

  private fun projectionBounds(box: Box, axis: Axis): ProjectionBounds {
    val corners = listOf(
      Point(box.left, box.top),
      Point(box.right, box.top),
      Point(box.left, box.bottom),
      Point(box.right, box.bottom)
    )
    val tValues = corners.map { it.x * axis.x + it.y * axis.y }
    val nValues = corners.map { it.x * axis.normalX + it.y * axis.normalY }
    return ProjectionBounds(
      tValues.minOrNull() ?: 0.0,
      tValues.maxOrNull() ?: 1.0,
      nValues.minOrNull() ?: 0.0,
      nValues.maxOrNull() ?: 1.0
    )
  }

  private fun pointFromProjection(axis: Axis, t: Double, n: Double): Point {
    return Point(
      (axis.x * t + axis.normalX * n).coerceIn(0.0, 1.0),
      (axis.y * t + axis.normalY * n).coerceIn(0.0, 1.0)
    )
  }

  private fun orientedBoundsToBox(axis: Axis, minT: Double, maxT: Double, minN: Double, maxN: Double): Box {
    val points = listOf(
      pointFromProjection(axis, minT, minN),
      pointFromProjection(axis, minT, maxN),
      pointFromProjection(axis, maxT, minN),
      pointFromProjection(axis, maxT, maxN)
    )
    return Box(
      points.minOf { it.x }.coerceIn(0.0, 1.0),
      points.minOf { it.y }.coerceIn(0.0, 1.0),
      points.maxOf { it.x }.coerceIn(0.0, 1.0),
      points.maxOf { it.y }.coerceIn(0.0, 1.0)
    )
  }

  private fun distance(left: Point, right: Point): Double {
    val dx = left.x - right.x
    val dy = left.y - right.y
    return sqrt(dx * dx + dy * dy)
  }

  private fun normalizeAngle(value: Double): Double {
    var angle = value
    while (angle > 90.0) angle -= 180.0
    while (angle < -90.0) angle += 180.0
    return angle
  }

  private fun boxMap(box: Box): Map<String, Any> = mapOf(
    "left" to box.left,
    "top" to box.top,
    "right" to box.right,
    "bottom" to box.bottom
  )

  private fun structureReason(
    body: Boolean,
    neck: Boolean,
    soundhole: Boolean,
    pickup: Boolean,
    bridge: Boolean
  ): String {
    val missing = ArrayList<String>()
    if (!body) missing.add("몸통")
    if (!neck) missing.add("넥")
    if (!soundhole && !pickup) missing.add("사운드홀/픽업")
    if (!bridge) missing.add("브리지")
    return if (missing.isEmpty()) {
      "기타 객체와 몸통·넥·사운드홀/픽업·브리지 후보를 확인했습니다."
    } else {
      "기타 객체는 찾았지만 ${missing.joinToString("·")} 구조 증거가 부족합니다."
    }
  }

  private fun emptyResult(
    reason: String,
    confidence: Double = 0.0,
    label: String = "unknown",
    box: Box = Box(0.0, 0.0, 0.0, 0.0)
  ): Map<String, Any> = mapOf(
    "detected" to false,
    "model" to MODEL_DESCRIPTION,
    "label" to label,
    "objectConfidence" to confidence.coerceIn(0.0, 1.0),
    "structureConfidence" to 0.0,
    "objectBox" to boxMap(box),
    "bodyDetected" to false,
    "bodyConfidence" to 0.0,
    "bodyBox" to boxMap(box),
    "neckDetected" to false,
    "neckConfidence" to 0.0,
    "neckAngleDegrees" to 0.0,
    "neckStartX" to 0.0,
    "neckStartY" to 0.0,
    "neckEndX" to 0.0,
    "neckEndY" to 0.0,
    "soundholeDetected" to false,
    "soundholeConfidence" to 0.0,
    "soundholeCenterX" to 0.0,
    "soundholeCenterY" to 0.0,
    "soundholeRadiusRatio" to 0.0,
    "pickupDetected" to false,
    "pickupConfidence" to 0.0,
    "pickupCenterX" to 0.0,
    "pickupCenterY" to 0.0,
    "bridgeDetected" to false,
    "bridgeConfidence" to 0.0,
    "bridgeCenterX" to 0.0,
    "bridgeCenterY" to 0.0,
    "bridgeAngleDegrees" to 0.0,
    "reason" to reason
  )

  @Synchronized
  private fun getObjectDetector(): ObjectDetector {
    return objectDetector ?: run {
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("Android 기타 객체 분석 컨텍스트를 사용할 수 없습니다.")
      val baseOptions = BaseOptions.builder()
        .setModelAssetPath(GUITAR_OBJECT_MODEL)
        .build()
      val options = ObjectDetector.ObjectDetectorOptions.builder()
        .setBaseOptions(baseOptions)
        .setRunningMode(RunningMode.IMAGE)
        .setMaxResults(5)
        .setScoreThreshold(OBJECT_SCORE_THRESHOLD.toFloat())
        .setCategoryAllowlist(listOf("guitar"))
        .build()
      ObjectDetector.createFromOptions(context, options).also { objectDetector = it }
    }
  }

  private fun decodeBitmap(uriString: String): Bitmap {
    val context = appContext.reactContext
      ?: throw IllegalStateException("Android 기타 객체 분석 컨텍스트를 사용할 수 없습니다.")
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
    while (max(bounds.outWidth, bounds.outHeight) / sampleSize > 1_280) sampleSize *= 2
    val options = BitmapFactory.Options().apply {
      inSampleSize = sampleSize
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
      ?: throw IllegalArgumentException("카메라 이미지를 읽지 못했습니다.")
  }

  private fun cleanupFile(uriString: String) {
    runCatching {
      val uri = Uri.parse(uriString)
      if (uri.scheme == "file" && uri.path != null) File(uri.path!!).delete()
    }
  }

  companion object {
    private const val GUITAR_OBJECT_MODEL = "efficientdet_lite0.tflite"
    private const val MODEL_DESCRIPTION = "EfficientDet-Lite0 COCO guitar + geometric parts v1"
    private const val OBJECT_SCORE_THRESHOLD = 0.24
  }
}
