package expo.modules.guitarcoachnative

import android.content.Context
import android.graphics.Bitmap
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.imageclassifier.ImageClassifier
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

internal data class LocalGuitarState(
  val detected: Boolean,
  val type: String,
  val label: String,
  val confidence: Double,
  val left: Double,
  val top: Double,
  val right: Double,
  val bottom: Double,
  val modelReady: Boolean,
  val reason: String
) {
  fun toMap() = mapOf(
    "detected" to detected,
    "type" to type,
    "label" to label,
    "confidence" to confidence,
    "left" to left,
    "top" to top,
    "right" to right,
    "bottom" to bottom,
    "modelReady" to modelReady,
    "reason" to reason
  )

  companion object {
    fun searching(modelReady: Boolean = true, reason: String = "기타를 찾는 중") =
      LocalGuitarState(false, "unknown", "", 0.0, 0.0, 0.0, 1.0, 1.0, modelReady, reason)
  }
}

internal class LocalGuitarClassifier(private val context: Context) {
  private var classifier: ImageClassifier? = null
  private var unavailableReason = ""

  fun classify(bitmap: Bitmap): LocalGuitarState {
    val task = try {
      getClassifier()
    } catch (error: Throwable) {
      unavailableReason = error.message ?: "로컬 기타 분류 모델을 열지 못했습니다."
      return LocalGuitarState.searching(false, unavailableReason)
    }

    val regions = listOf(
      CropRegion(0.0, 0.0, 1.0, 1.0),
      CropRegion(0.04, 0.12, 0.96, 0.98),
      CropRegion(0.0, 0.14, 0.74, 0.98),
      CropRegion(0.26, 0.14, 1.0, 0.98),
      CropRegion(0.02, 0.30, 0.98, 1.0)
    )

    var best: LocalGuitarState? = null
    for (region in regions) {
      val cropped = crop(bitmap, region)
      try {
        val result = task.classify(BitmapImageBuilder(cropped).build())
        val categories = result.classificationResult()
          .classifications()
          .flatMap { it.categories() }
        for (category in categories) {
          val name = listOf(category.categoryName(), category.displayName())
            .joinToString(" ")
            .trim()
            .lowercase()
          if (!name.contains("guitar")) continue
          val score = category.score().toDouble()
          val type = when {
            name.contains("acoustic") -> "acoustic"
            name.contains("electric") -> "electric"
            name.contains("bass") -> "bass"
            else -> "guitar"
          }
          val label = when (type) {
            "acoustic" -> "통기타"
            "electric" -> "일렉기타"
            "bass" -> "베이스 기타"
            else -> "기타"
          }
          val candidate = LocalGuitarState(
            detected = score >= MIN_GUITAR_SCORE,
            type = type,
            label = label,
            confidence = score.coerceIn(0.0, 1.0),
            left = region.left,
            top = region.top,
            right = region.right,
            bottom = region.bottom,
            modelReady = true,
            reason = if (score >= MIN_GUITAR_SCORE) "로컬 기타 분류 확인" else "기타 후보 신뢰도 부족"
          )
          if (best == null || candidate.confidence > best!!.confidence) best = candidate
        }
      } finally {
        if (cropped !== bitmap) cropped.recycle()
      }
    }

    return best?.takeIf { it.detected }
      ?: LocalGuitarState.searching(true, "현재 프레임에서 기타를 확정하지 못했습니다.")
  }

  fun close() {
    classifier?.close()
    classifier = null
  }

  private fun getClassifier(): ImageClassifier {
    return classifier ?: run {
      val options = ImageClassifier.ImageClassifierOptions.builder()
        .setBaseOptions(
          BaseOptions.builder()
            .setModelAssetPath(MODEL_ASSET)
            .build()
        )
        .setRunningMode(RunningMode.IMAGE)
        .setDisplayNamesLocale("en")
        .setMaxResults(12)
        .setScoreThreshold(0.005f)
        .build()
      ImageClassifier.createFromOptions(context, options).also { classifier = it }
    }
  }

  private fun crop(bitmap: Bitmap, region: CropRegion): Bitmap {
    if (region.left == 0.0 && region.top == 0.0 && region.right == 1.0 && region.bottom == 1.0) {
      return bitmap
    }
    val left = (region.left * bitmap.width).roundToInt().coerceIn(0, bitmap.width - 2)
    val top = (region.top * bitmap.height).roundToInt().coerceIn(0, bitmap.height - 2)
    val right = (region.right * bitmap.width).roundToInt().coerceIn(left + 1, bitmap.width)
    val bottom = (region.bottom * bitmap.height).roundToInt().coerceIn(top + 1, bitmap.height)
    return Bitmap.createBitmap(
      bitmap,
      left,
      top,
      max(1, min(bitmap.width - left, right - left)),
      max(1, min(bitmap.height - top, bottom - top))
    )
  }

  private data class CropRegion(
    val left: Double,
    val top: Double,
    val right: Double,
    val bottom: Double
  )

  companion object {
    private const val MODEL_ASSET = "efficientnet_lite0.tflite"
    private const val MIN_GUITAR_SCORE = 0.14
  }
}
