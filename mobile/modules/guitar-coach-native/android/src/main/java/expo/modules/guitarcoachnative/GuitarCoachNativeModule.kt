package expo.modules.guitarcoachnative

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioManager
import android.media.ToneGenerator
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.pose.PoseDetector
import com.google.mlkit.vision.pose.PoseLandmark
import com.google.mlkit.vision.pose.defaults.PoseDetection
import com.google.mlkit.vision.pose.defaults.PoseDetectorOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.util.concurrent.atomic.AtomicBoolean

class GuitarCoachNativeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private var toneGenerator: ToneGenerator? = null
  private var poseDetector: PoseDetector? = null
  private val analysisBusy = AtomicBoolean(false)

  override fun definition() = ModuleDefinition {
    Name("GuitarCoachNative")

    Constant("androidLiveCoachAvailable") {
      true
    }

    AsyncFunction("playClickAsync") { accent: Boolean ->
      val generator = toneGenerator ?: ToneGenerator(AudioManager.STREAM_MUSIC, 88).also {
        toneGenerator = it
      }
      val tone = if (accent) ToneGenerator.TONE_PROP_BEEP2 else ToneGenerator.TONE_PROP_BEEP
      generator.startTone(tone, if (accent) 72 else 48)
    }

    AsyncFunction("analyzePoseAsync") { uri: String, promise: Promise ->
      if (!analysisBusy.compareAndSet(false, true)) {
        promise.reject("ERR_POSE_BUSY", "이전 자세 분석이 아직 끝나지 않았습니다.", null)
        return@AsyncFunction
      }

      val startedAt = System.currentTimeMillis()
      var bitmap: Bitmap? = null

      try {
        val decodedBitmap = decodeBitmap(uri)
        bitmap = decodedBitmap
        val image = InputImage.fromBitmap(decodedBitmap, 0)
        val detector = getPoseDetector()

        detector.process(image)
          .addOnSuccessListener { pose ->
            try {
              val points = LANDMARKS.mapNotNull { spec ->
                val landmark = pose.getPoseLandmark(spec.type) ?: return@mapNotNull null
                mapOf(
                  "name" to spec.name,
                  "x" to (landmark.position.x / decodedBitmap.width.toFloat()).coerceIn(0f, 1f),
                  "y" to (landmark.position.y / decodedBitmap.height.toFloat()).coerceIn(0f, 1f),
                  "z" to (landmark.position3D.z / decodedBitmap.width.toFloat()),
                  "confidence" to landmark.inFrameLikelihood.toDouble()
                )
              }

              promise.resolve(
                mapOf(
                  "hasPerson" to (points.size >= 4),
                  "imageWidth" to decodedBitmap.width,
                  "imageHeight" to decodedBitmap.height,
                  "latencyMs" to (System.currentTimeMillis() - startedAt),
                  "landmarks" to points
                )
              )
            } catch (error: Throwable) {
              promise.reject("ERR_POSE_RESULT", "자세 분석 결과를 처리하지 못했습니다.", error)
            } finally {
              decodedBitmap.recycle()
              cleanupFile(uri)
              analysisBusy.set(false)
            }
          }
          .addOnFailureListener { error ->
            decodedBitmap.recycle()
            cleanupFile(uri)
            analysisBusy.set(false)
            promise.reject("ERR_POSE_ANALYSIS", "카메라 자세 분석에 실패했습니다.", error)
          }
      } catch (error: Throwable) {
        bitmap?.recycle()
        cleanupFile(uri)
        analysisBusy.set(false)
        promise.reject("ERR_POSE_INPUT", "카메라 이미지를 분석할 수 없습니다.", error)
      }
    }

    OnDestroy {
      toneGenerator?.release()
      toneGenerator = null
      poseDetector?.close()
      poseDetector = null
    }
  }

  private fun getPoseDetector(): PoseDetector {
    return poseDetector ?: PoseDetection.getClient(
      PoseDetectorOptions.Builder()
        .setDetectorMode(PoseDetectorOptions.STREAM_MODE)
        .build()
    ).also { poseDetector = it }
  }

  private fun decodeBitmap(uriString: String): Bitmap {
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
      if (uri.scheme == "file" && uri.path != null) {
        File(uri.path!!).delete()
      }
    }
  }

  private data class LandmarkSpec(val name: String, val type: Int)

  companion object {
    private val LANDMARKS = listOf(
      LandmarkSpec("nose", PoseLandmark.NOSE),
      LandmarkSpec("leftShoulder", PoseLandmark.LEFT_SHOULDER),
      LandmarkSpec("rightShoulder", PoseLandmark.RIGHT_SHOULDER),
      LandmarkSpec("leftElbow", PoseLandmark.LEFT_ELBOW),
      LandmarkSpec("rightElbow", PoseLandmark.RIGHT_ELBOW),
      LandmarkSpec("leftWrist", PoseLandmark.LEFT_WRIST),
      LandmarkSpec("rightWrist", PoseLandmark.RIGHT_WRIST),
      LandmarkSpec("leftHip", PoseLandmark.LEFT_HIP),
      LandmarkSpec("rightHip", PoseLandmark.RIGHT_HIP)
    )
  }
}
