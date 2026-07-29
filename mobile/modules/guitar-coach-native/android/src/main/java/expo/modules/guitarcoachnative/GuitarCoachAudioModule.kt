package expo.modules.guitarcoachnative

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.SystemClock
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

class GuitarCoachAudioModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext
      ?: throw IllegalStateException("Android 오디오 컨텍스트가 없습니다.")

  @Volatile private var running = false
  private var audioRecord: AudioRecord? = null
  private var workerThread: Thread? = null
  private val readingLock = Any()

  private var referenceA4 = 440.0
  private var latestReading = AudioReading.empty()
  private var noiseFloor = 0.004
  private var previousRms = 0.0
  private var lastAttackAt = 0L
  private var previousAttackAt = 0L
  private var attackCount = 0
  private var latestAttackStrength = 0.0

  override fun definition() = ModuleDefinition {
    Name("GuitarCoachAudio")

    Constant("androidAudioAnalysisAvailable") { true }

    AsyncFunction("startAudioAnalysisAsync") { requestedReferenceA4: Double, promise: Promise ->
      try {
        startInternal(requestedReferenceA4.coerceIn(430.0, 450.0))
        promise.resolve(
          mapOf(
            "started" to true,
            "sampleRate" to SAMPLE_RATE,
            "referenceA4" to referenceA4
          )
        )
      } catch (error: Throwable) {
        promise.reject("ERR_AUDIO_START", error.message ?: "마이크 분석을 시작하지 못했습니다.", error)
      }
    }

    AsyncFunction("updateAudioReferenceAsync") { requestedReferenceA4: Double ->
      referenceA4 = requestedReferenceA4.coerceIn(430.0, 450.0)
    }

    AsyncFunction("getLatestAudioReadingAsync") { promise: Promise ->
      val payload = synchronized(readingLock) { latestReading.toMap(referenceA4) }
      promise.resolve(payload)
    }

    AsyncFunction("stopAudioAnalysisAsync") {
      stopInternal()
    }

    OnDestroy {
      stopInternal()
    }
  }

  private fun startInternal(newReferenceA4: Double) {
    if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      throw SecurityException("마이크 권한이 필요합니다.")
    }

    stopInternal()
    referenceA4 = newReferenceA4
    latestReading = AudioReading.empty()
    noiseFloor = 0.004
    previousRms = 0.0
    lastAttackAt = 0L
    previousAttackAt = 0L
    attackCount = 0
    latestAttackStrength = 0.0

    val minBuffer = AudioRecord.getMinBufferSize(
      SAMPLE_RATE,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT
    )
    if (minBuffer <= 0) throw IllegalStateException("휴대폰 마이크 버퍼를 만들 수 없습니다.")

    val bufferSize = max(minBuffer * 2, FRAME_SIZE * 2)
    val recorder = AudioRecord(
      MediaRecorder.AudioSource.UNPROCESSED,
      SAMPLE_RATE,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
      bufferSize
    )
    if (recorder.state != AudioRecord.STATE_INITIALIZED) {
      recorder.release()
      throw IllegalStateException("휴대폰 마이크를 초기화하지 못했습니다.")
    }

    audioRecord = recorder
    running = true
    recorder.startRecording()
    workerThread = Thread({ captureLoop(recorder) }, "GuitarCoachAudio").also {
      it.priority = Thread.MAX_PRIORITY
      it.start()
    }
  }

  private fun stopInternal() {
    running = false
    runCatching { audioRecord?.stop() }
    workerThread?.interrupt()
    runCatching { workerThread?.join(350) }
    workerThread = null
    runCatching { audioRecord?.release() }
    audioRecord = null
  }

  private fun captureLoop(recorder: AudioRecord) {
    val buffer = ShortArray(FRAME_SIZE)
    while (running && !Thread.currentThread().isInterrupted) {
      val read = try {
        recorder.read(buffer, 0, buffer.size, AudioRecord.READ_BLOCKING)
      } catch (_: Throwable) {
        break
      }
      if (read <= 0) continue

      val timestamp = SystemClock.elapsedRealtime()
      val rms = calculateRms(buffer, read)
      val clippingRatio = calculateClippingRatio(buffer, read)
      val pitch = if (rms >= MIN_RMS && clippingRatio < 0.08) detectPitch(buffer, read) else PitchResult.none()
      updateAttackState(rms, timestamp)

      val reading = AudioReading(
        timestampMs = timestamp,
        frequencyHz = pitch.frequencyHz,
        pitchConfidence = pitch.confidence,
        rms = rms,
        noiseFloor = noiseFloor,
        clippingRatio = clippingRatio,
        attackCount = attackCount,
        lastAttackAtMs = lastAttackAt,
        attackIntervalMs = if (previousAttackAt > 0L && lastAttackAt > previousAttackAt) {
          (lastAttackAt - previousAttackAt).toDouble()
        } else 0.0,
        attackStrength = latestAttackStrength,
        sampleCount = read
      )
      synchronized(readingLock) {
        latestReading = reading
      }
    }
  }

  private fun updateAttackState(rms: Double, timestamp: Long) {
    if (rms < max(0.018, noiseFloor * 2.2)) {
      noiseFloor = noiseFloor * 0.96 + rms * 0.04
    }
    val threshold = max(0.018, noiseFloor * 3.2)
    val rising = previousRms < threshold && rms >= threshold
    if (rising && timestamp - lastAttackAt >= MIN_ATTACK_GAP_MS) {
      previousAttackAt = lastAttackAt
      lastAttackAt = timestamp
      attackCount += 1
      latestAttackStrength = min(1.0, rms / max(threshold, 0.0001))
    }
    previousRms = rms
  }

  private fun calculateRms(buffer: ShortArray, count: Int): Double {
    if (count <= 0) return 0.0
    var sum = 0.0
    for (index in 0 until count) {
      val normalized = buffer[index] / 32768.0
      sum += normalized * normalized
    }
    return sqrt(sum / count)
  }

  private fun calculateClippingRatio(buffer: ShortArray, count: Int): Double {
    if (count <= 0) return 0.0
    var clipped = 0
    for (index in 0 until count) {
      if (abs(buffer[index].toInt()) >= 32300) clipped += 1
    }
    return clipped.toDouble() / count.toDouble()
  }

  private fun detectPitch(buffer: ShortArray, count: Int): PitchResult {
    val usableCount = min(count, FRAME_SIZE)
    val downsampledCount = usableCount / DOWNSAMPLE
    if (downsampledCount < 512) return PitchResult.none()

    val samples = DoubleArray(downsampledCount)
    var mean = 0.0
    for (index in 0 until downsampledCount) {
      val value = buffer[index * DOWNSAMPLE] / 32768.0
      samples[index] = value
      mean += value
    }
    mean /= downsampledCount
    for (index in samples.indices) samples[index] -= mean

    val effectiveRate = SAMPLE_RATE.toDouble() / DOWNSAMPLE.toDouble()
    val minLag = max(2, (effectiveRate / MAX_FREQUENCY_HZ).toInt())
    val maxLag = min(samples.size / 2, (effectiveRate / MIN_FREQUENCY_HZ).toInt())
    if (maxLag <= minLag + 2) return PitchResult.none()

    var bestLag = -1
    var bestCorrelation = 0.0
    val correlations = DoubleArray(maxLag + 1)
    for (lag in minLag..maxLag) {
      var cross = 0.0
      var energyA = 0.0
      var energyB = 0.0
      val limit = samples.size - lag
      for (index in 0 until limit) {
        val a = samples[index]
        val b = samples[index + lag]
        cross += a * b
        energyA += a * a
        energyB += b * b
      }
      val denominator = sqrt(max(1e-12, energyA * energyB))
      val correlation = cross / denominator
      correlations[lag] = correlation
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation
        bestLag = lag
      }
    }

    if (bestLag < 0 || bestCorrelation < MIN_PITCH_CONFIDENCE) return PitchResult.none()

    var selectedLag = bestLag
    val strongThreshold = bestCorrelation * 0.92
    for (lag in (minLag + 1) until bestLag) {
      if (
        correlations[lag] >= strongThreshold &&
        correlations[lag] >= correlations[lag - 1] &&
        correlations[lag] >= correlations[lag + 1]
      ) {
        selectedLag = lag
        break
      }
    }

    val left = correlations[max(minLag, selectedLag - 1)]
    val center = correlations[selectedLag]
    val right = correlations[min(maxLag, selectedLag + 1)]
    val denominator = left - 2.0 * center + right
    val correction = if (abs(denominator) > 1e-9) 0.5 * (left - right) / denominator else 0.0
    val refinedLag = selectedLag + correction.coerceIn(-0.5, 0.5)
    val frequency = effectiveRate / refinedLag

    if (frequency !in MIN_FREQUENCY_HZ..MAX_FREQUENCY_HZ) return PitchResult.none()
    return PitchResult(frequencyHz = frequency, confidence = center.coerceIn(0.0, 1.0))
  }

  private data class PitchResult(val frequencyHz: Double, val confidence: Double) {
    companion object {
      fun none() = PitchResult(0.0, 0.0)
    }
  }

  private data class AudioReading(
    val timestampMs: Long,
    val frequencyHz: Double,
    val pitchConfidence: Double,
    val rms: Double,
    val noiseFloor: Double,
    val clippingRatio: Double,
    val attackCount: Int,
    val lastAttackAtMs: Long,
    val attackIntervalMs: Double,
    val attackStrength: Double,
    val sampleCount: Int
  ) {
    fun toMap(referenceA4: Double): Map<String, Any> = mapOf(
      "timestampMs" to timestampMs.toDouble(),
      "frequencyHz" to frequencyHz,
      "pitchConfidence" to pitchConfidence,
      "rms" to rms,
      "noiseFloor" to noiseFloor,
      "clippingRatio" to clippingRatio,
      "attackCount" to attackCount,
      "lastAttackAtMs" to lastAttackAtMs.toDouble(),
      "attackIntervalMs" to attackIntervalMs,
      "attackStrength" to attackStrength,
      "sampleCount" to sampleCount,
      "referenceA4" to referenceA4,
      "hasPitch" to (frequencyHz > 0.0 && pitchConfidence >= MIN_PITCH_CONFIDENCE),
      "running" to running
    )

    companion object {
      fun empty() = AudioReading(0L, 0.0, 0.0, 0.0, 0.004, 0.0, 0, 0L, 0.0, 0.0, 0)
    }
  }

  companion object {
    private const val SAMPLE_RATE = 44_100
    private const val FRAME_SIZE = 4_096
    private const val DOWNSAMPLE = 2
    private const val MIN_FREQUENCY_HZ = 55.0
    private const val MAX_FREQUENCY_HZ = 1_200.0
    private const val MIN_PITCH_CONFIDENCE = 0.48
    private const val MIN_RMS = 0.0045
    private const val MIN_ATTACK_GAP_MS = 55L
  }
}
