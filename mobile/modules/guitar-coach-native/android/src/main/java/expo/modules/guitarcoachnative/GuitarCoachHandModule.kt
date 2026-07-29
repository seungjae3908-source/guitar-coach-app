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
import java.io.InputStream
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

class GuitarCoachHandModule : Module() {
  private var handLandmarker: HandLandmarker? = null
  private val analysisBusy = AtomicBoolean(false)

  override fun definition() = ModuleDefinition {
    Name("GuitarCoachHand")

    Constant("androidHandCoachAvailable") {
      true
    }

    AsyncFunction("analyzeHandAsync") { uri: String, pickColor: String, promise: Promise ->
      if (!analysisBusy.compareAndSet(false, true)) {
        promise.reject("ERR_HAND_BUSY", "이전 손 분석이 아직 끝나지 않았습니다.", null)
        return@AsyncFunction
      }

      Thread {
        val startedAt = System.currentTimeMillis()
        var bitmap: Bitmap? = null
        try {
          val decodedBitmap = decodeBitmap(uri)
          bitmap = decodedBitmap
          val mpImage = BitmapImageBuilder(decodedBitmap).build()
          val result = getHandLandmarker().detect(mpImage)
          val handLandmarks = result.landmarks().firstOrNull()
          val handednessCategory = result.handedness().firstOrNull()?.firstOrNull()

          if (handLandmarks == null || handLandmarks.size < 21) {
            promise.resolve(
              mapOf(
                "hasHand" to false,
                "imageWidth" to decodedBitmap.width,
                "imageHeight" to decodedBitmap.height,
                "latencyMs" to (System.currentTimeMillis() - startedAt),
                "handedness" to "Unknown",
                "handednessScore" to 0.0,
                "landmarks" to emptyList<Map<String, Any>>(),
                "pick" to emptyPickResult(pickColor)
              )
            )
          } else {
            val landmarks = handLandmarks.mapIndexed { index, landmark ->
              mapOf(
                "index" to index,
                "name" to LANDMARK_NAMES[index],
                "x" to landmark.x().toDouble(),
                "y" to landmark.y().toDouble(),
                "z" to landmark.z().toDouble()
              )
            }

            val pickResult = analyzePickColor(
              bitmap = decodedBitmap,
              landmarks = landmarks,
              requestedColor = pickColor
            )

            promise.resolve(
              mapOf(
                "hasHand" to true,
                "imageWidth" to decodedBitmap.width,
                "imageHeight" to decodedBitmap.height,
                "latencyMs" to (System.currentTimeMillis() - startedAt),
                "handedness" to (handednessCategory?.categoryName() ?: "Unknown"),
                "handednessScore" to (handednessCategory?.score()?.toDouble() ?: 0.0),
                "landmarks" to landmarks,
                "pick" to pickResult
              )
            )
          }
        } catch (error: Throwable) {
          promise.reject("ERR_HAND_ANALYSIS", "손가락과 피크를 분석하지 못했습니다.", error)
        } finally {
          bitmap?.recycle()
          cleanupFile(uri)
          analysisBusy.set(false)
        }
      }.start()
    }

    OnDestroy {
      handLandmarker?.close()
      handLandmarker = null
    }
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
        .setMinHandDetectionConfidence(0.45f)
        .setMinHandPresenceConfidence(0.45f)
        .setMinTrackingConfidence(0.45f)
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

    fun x(index: Int) = (landmarks[index]["x"] as Double) * bitmap.width
    fun y(index: Int) = (landmarks[index]["y"] as Double) * bitmap.height

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

  private fun cleanupFile(uriString: String) {
    runCatching {
      val uri = Uri.parse(uriString)
      if (uri.scheme == "file" && uri.path != null) File(uri.path!!).delete()
    }
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
