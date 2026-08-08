package expo.modules.guitarcoachnative

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sqrt

class GuitarCoachAudioFileModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext
      ?: throw IllegalStateException("Android 오디오 파일 컨텍스트가 없습니다.")

  override fun definition() = ModuleDefinition {
    Name("GuitarCoachAudioFile")

    Constant("androidAudioFileAnalysisAvailable") { true }

    AsyncFunction("analyzeAudioFileAsync") { uriString: String, requestedMaxSeconds: Int, promise: Promise ->
      try {
        val maxSeconds = requestedMaxSeconds.coerceIn(10, MAX_ANALYSIS_SECONDS)
        val decoded = decodeToMono(uriString, maxSeconds)
        if (decoded.samples.size < TARGET_SAMPLE_RATE * 3) {
          throw IllegalArgumentException("분석하려면 최소 3초 이상의 음원이 필요합니다.")
        }
        val result = analyzeSignal(decoded)
        promise.resolve(result.toMap())
      } catch (error: Throwable) {
        promise.reject("ERR_AUDIO_FILE_ANALYSIS", error.message ?: "음원 파일을 분석하지 못했습니다.", error)
      }
    }
  }

  private fun decodeToMono(uriString: String, maxSeconds: Int): DecodedAudio {
    val extractor = MediaExtractor()
    var descriptor: android.content.res.AssetFileDescriptor? = null
    var codec: MediaCodec? = null
    try {
      val uri = Uri.parse(uriString)
      when (uri.scheme?.lowercase()) {
        "content" -> {
          descriptor = context.contentResolver.openAssetFileDescriptor(uri, "r")
            ?: throw IllegalArgumentException("선택한 음원 파일을 열 수 없습니다.")
          if (descriptor.length >= 0) {
            extractor.setDataSource(descriptor.fileDescriptor, descriptor.startOffset, descriptor.length)
          } else {
            extractor.setDataSource(descriptor.fileDescriptor)
          }
        }
        "file" -> extractor.setDataSource(File(uri.path ?: throw IllegalArgumentException("파일 경로가 없습니다.")).absolutePath)
        else -> extractor.setDataSource(uriString)
      }

      var audioTrack = -1
      var inputFormat: MediaFormat? = null
      for (index in 0 until extractor.trackCount) {
        val format = extractor.getTrackFormat(index)
        val mime = format.getString(MediaFormat.KEY_MIME).orEmpty()
        if (mime.startsWith("audio/")) {
          audioTrack = index
          inputFormat = format
          break
        }
      }
      if (audioTrack < 0 || inputFormat == null) throw IllegalArgumentException("지원되는 오디오 트랙을 찾지 못했습니다.")

      val mime = inputFormat.getString(MediaFormat.KEY_MIME)
        ?: throw IllegalArgumentException("오디오 형식을 확인하지 못했습니다.")
      extractor.selectTrack(audioTrack)
      codec = MediaCodec.createDecoderByType(mime)
      codec.configure(inputFormat, null, null, 0)
      codec.start()

      val accumulator = FloatAccumulator(TARGET_SAMPLE_RATE * maxSeconds)
      val info = MediaCodec.BufferInfo()
      var inputDone = false
      var outputDone = false
      var outputSampleRate = inputFormat.intOrDefault(MediaFormat.KEY_SAMPLE_RATE, 44_100)
      var outputChannels = inputFormat.intOrDefault(MediaFormat.KEY_CHANNEL_COUNT, 1).coerceAtLeast(1)
      var pcmEncoding = AudioFormat.ENCODING_PCM_16BIT
      var resamplePhase = 0
      val maxUs = maxSeconds * 1_000_000L
      var safetyCounter = 0

      while (!outputDone && accumulator.size < TARGET_SAMPLE_RATE * maxSeconds && safetyCounter < 2_000_000) {
        safetyCounter += 1
        if (!inputDone) {
          val inputIndex = codec.dequeueInputBuffer(CODEC_TIMEOUT_US)
          if (inputIndex >= 0) {
            val inputBuffer = codec.getInputBuffer(inputIndex)
              ?: throw IllegalStateException("오디오 입력 버퍼가 없습니다.")
            inputBuffer.clear()
            val sampleTime = extractor.sampleTime
            val sampleSize = if (sampleTime < 0 || sampleTime > maxUs) -1 else extractor.readSampleData(inputBuffer, 0)
            if (sampleSize < 0) {
              codec.queueInputBuffer(inputIndex, 0, 0, max(0L, sampleTime), MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              codec.queueInputBuffer(inputIndex, 0, sampleSize, sampleTime, 0)
              extractor.advance()
            }
          }
        }

        when (val outputIndex = codec.dequeueOutputBuffer(info, CODEC_TIMEOUT_US)) {
          MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            val format = codec.outputFormat
            outputSampleRate = format.intOrDefault(MediaFormat.KEY_SAMPLE_RATE, outputSampleRate)
            outputChannels = format.intOrDefault(MediaFormat.KEY_CHANNEL_COUNT, outputChannels).coerceAtLeast(1)
            pcmEncoding = format.intOrDefault(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
          }
          MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
          else -> if (outputIndex >= 0) {
            val outputBuffer = codec.getOutputBuffer(outputIndex)
            if (outputBuffer != null && info.size > 0) {
              outputBuffer.position(info.offset)
              outputBuffer.limit(info.offset + info.size)
              outputBuffer.order(ByteOrder.LITTLE_ENDIAN)
              resamplePhase = appendPcm(
                outputBuffer,
                pcmEncoding,
                outputChannels,
                outputSampleRate,
                resamplePhase,
                accumulator
              )
            }
            outputDone = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
            codec.releaseOutputBuffer(outputIndex, false)
          }
        }
      }

      if (accumulator.size == 0) throw IllegalArgumentException("음원에서 PCM 샘플을 읽지 못했습니다.")
      return DecodedAudio(
        samples = accumulator.toArray(),
        sampleRate = TARGET_SAMPLE_RATE,
        sourceSampleRate = outputSampleRate,
        sourceChannels = outputChannels,
        durationSeconds = accumulator.size.toDouble() / TARGET_SAMPLE_RATE.toDouble()
      )
    } finally {
      runCatching { codec?.stop() }
      runCatching { codec?.release() }
      runCatching { extractor.release() }
      runCatching { descriptor?.close() }
    }
  }

  private fun appendPcm(
    buffer: ByteBuffer,
    pcmEncoding: Int,
    channels: Int,
    sourceSampleRate: Int,
    initialPhase: Int,
    accumulator: FloatAccumulator
  ): Int {
    var phase = initialPhase
    val safeRate = sourceSampleRate.coerceAtLeast(TARGET_SAMPLE_RATE)
    val bytesPerSample = if (pcmEncoding == AudioFormat.ENCODING_PCM_FLOAT) 4 else 2
    val bytesPerFrame = bytesPerSample * channels
    while (buffer.remaining() >= bytesPerFrame && !accumulator.full) {
      var mono = 0.0f
      repeat(channels) {
        mono += if (pcmEncoding == AudioFormat.ENCODING_PCM_FLOAT) {
          buffer.float.coerceIn(-1f, 1f)
        } else {
          buffer.short / 32768.0f
        }
      }
      mono /= channels.toFloat()
      phase += TARGET_SAMPLE_RATE
      while (phase >= safeRate && !accumulator.full) {
        accumulator.add(mono)
        phase -= safeRate
      }
    }
    return phase
  }

  private fun analyzeSignal(decoded: DecodedAudio): AudioFileAnalysis {
    val bpm = estimateBpm(decoded.samples, decoded.sampleRate)
    val chromaFrames = calculateChromaFrames(decoded.samples, decoded.sampleRate)
    val key = estimateKey(chromaFrames)
    val chordCandidates = estimateChordTimeline(chromaFrames, bpm.bpm, decoded.durationSeconds)
    val notes = mutableListOf<String>()
    if (bpm.confidence < 0.45) notes += "BPM 신뢰도가 낮습니다. 드럼이 약하거나 템포 변화가 큰 곡일 수 있습니다."
    if (key.confidence < 0.35) notes += "Key 신뢰도가 낮습니다. 조바꿈 또는 비화성음이 많은 곡일 수 있습니다."
    if (chordCandidates.none { it.confidence >= 0.35 }) notes += "확실한 코드 구간이 적습니다. 기타가 분리된 음원에서 정확도가 높아집니다."
    notes += "보컬·드럼·베이스가 섞인 완성 음원의 코드와 Key는 연습용 추정치입니다."
    return AudioFileAnalysis(
      durationSeconds = decoded.durationSeconds,
      sourceSampleRate = decoded.sourceSampleRate,
      sourceChannels = decoded.sourceChannels,
      analyzedSampleRate = decoded.sampleRate,
      bpm = bpm.bpm,
      bpmConfidence = bpm.confidence,
      key = key.name,
      keyConfidence = key.confidence,
      chords = chordCandidates,
      notes = notes
    )
  }

  private fun estimateBpm(samples: FloatArray, sampleRate: Int): BpmResult {
    val frameSize = 1024
    val hop = 512
    if (samples.size < frameSize * 4) return BpmResult(0.0, 0.0)
    val envelopeSize = 1 + (samples.size - frameSize) / hop
    val envelope = DoubleArray(envelopeSize)
    var previousRms = 0.0
    for (frame in 0 until envelopeSize) {
      val start = frame * hop
      var energy = 0.0
      for (index in 0 until frameSize) {
        val value = samples[start + index].toDouble()
        energy += value * value
      }
      val rms = sqrt(energy / frameSize)
      envelope[frame] = max(0.0, rms - previousRms * 0.92)
      previousRms = rms
    }
    val mean = envelope.average()
    for (index in envelope.indices) envelope[index] = max(0.0, envelope[index] - mean * 0.65)

    var bestBpm = 0.0
    var bestScore = 0.0
    var secondScore = 0.0
    for (candidate in 50..200) {
      val lag = (60.0 * sampleRate / (candidate * hop)).roundToInt().coerceAtLeast(1)
      if (lag >= envelope.size - 2) continue
      var cross = 0.0
      var energyA = 0.0
      var energyB = 0.0
      for (index in lag until envelope.size) {
        val a = envelope[index]
        val b = envelope[index - lag]
        cross += a * b
        energyA += a * a
        energyB += b * b
      }
      val score = cross / sqrt(max(1e-12, energyA * energyB))
      if (score > bestScore) {
        secondScore = bestScore
        bestScore = score
        bestBpm = candidate.toDouble()
      } else if (score > secondScore) {
        secondScore = score
      }
    }
    val separation = max(0.0, bestScore - secondScore)
    val confidence = ((bestScore - 0.08) * 1.25 + separation * 2.5).coerceIn(0.0, 1.0)
    return BpmResult(bestBpm, confidence)
  }

  private fun calculateChromaFrames(samples: FloatArray, sampleRate: Int): List<ChromaFrame> {
    val frameSize = 4096
    val hop = 4096
    if (samples.size < frameSize) return emptyList()
    val frames = mutableListOf<ChromaFrame>()
    var start = 0
    while (start + frameSize <= samples.size) {
      var mean = 0.0
      for (index in 0 until frameSize) mean += samples[start + index]
      mean /= frameSize.toDouble()
      val chroma = DoubleArray(12)
      for (midi in 40..76) {
        val frequency = 440.0 * 2.0.pow((midi - 69) / 12.0)
        val energy = goertzel(samples, start, frameSize, sampleRate, frequency, mean)
        chroma[midi % 12] += ln(1.0 + energy * 5000.0)
      }
      val sum = chroma.sum()
      if (sum > 1e-9) for (index in chroma.indices) chroma[index] /= sum
      frames += ChromaFrame(
        timeSeconds = (start + frameSize / 2).toDouble() / sampleRate.toDouble(),
        chroma = chroma,
        energy = sum
      )
      start += hop
    }
    return frames
  }

  private fun goertzel(
    samples: FloatArray,
    start: Int,
    count: Int,
    sampleRate: Int,
    frequency: Double,
    mean: Double
  ): Double {
    val omega = 2.0 * PI * frequency / sampleRate.toDouble()
    val coefficient = 2.0 * cos(omega)
    var s1 = 0.0
    var s2 = 0.0
    for (index in 0 until count) {
      val window = 0.5 - 0.5 * cos(2.0 * PI * index / max(1, count - 1))
      val sample = (samples[start + index] - mean) * window
      val s0 = sample + coefficient * s1 - s2
      s2 = s1
      s1 = s0
    }
    return max(0.0, s1 * s1 + s2 * s2 - coefficient * s1 * s2) / count.toDouble()
  }

  private fun estimateKey(frames: List<ChromaFrame>): KeyResult {
    if (frames.isEmpty()) return KeyResult("Unknown", 0.0)
    val global = DoubleArray(12)
    frames.forEach { frame ->
      val weight = max(0.05, frame.energy)
      for (pitch in 0 until 12) global[pitch] += frame.chroma[pitch] * weight
    }
    val sum = global.sum()
    if (sum <= 1e-9) return KeyResult("Unknown", 0.0)
    for (index in global.indices) global[index] /= sum

    var bestName = "Unknown"
    var bestScore = Double.NEGATIVE_INFINITY
    var secondScore = Double.NEGATIVE_INFINITY
    for (root in 0 until 12) {
      val majorScore = profileScore(global, MAJOR_PROFILE, root)
      val minorScore = profileScore(global, MINOR_PROFILE, root)
      listOf(
        "${PITCH_NAMES[root]} major" to majorScore,
        "${PITCH_NAMES[root]} minor" to minorScore
      ).forEach { (name, score) ->
        if (score > bestScore) {
          secondScore = bestScore
          bestScore = score
          bestName = name
        } else if (score > secondScore) {
          secondScore = score
        }
      }
    }
    val confidence = ((bestScore - secondScore) * 6.0 + (bestScore - 0.35) * 0.8).coerceIn(0.0, 1.0)
    return KeyResult(bestName, confidence)
  }

  private fun profileScore(chroma: DoubleArray, profile: DoubleArray, root: Int): Double {
    var numerator = 0.0
    var normA = 0.0
    var normB = 0.0
    for (pitch in 0 until 12) {
      val expected = profile[(pitch - root + 12) % 12]
      numerator += chroma[pitch] * expected
      normA += chroma[pitch] * chroma[pitch]
      normB += expected * expected
    }
    return numerator / sqrt(max(1e-12, normA * normB))
  }

  private fun estimateChordTimeline(
    frames: List<ChromaFrame>,
    bpm: Double,
    durationSeconds: Double
  ): List<ChordSegment> {
    if (frames.isEmpty()) return emptyList()
    val beatSeconds = if (bpm in 40.0..240.0) 60.0 / bpm else 1.0
    val segmentSeconds = beatSeconds.coerceIn(0.35, 1.5)
    val raw = mutableListOf<ChordSegment>()
    val sortedEnergies = frames.map { it.energy }.filter { it > 0.0 }.sorted()
    val medianEnergy = if (sortedEnergies.isEmpty()) 0.0 else sortedEnergies[sortedEnergies.size / 2]
    var start = 0.0
    while (start < durationSeconds && raw.size < 512) {
      val end = min(durationSeconds, start + segmentSeconds)
      val selected = frames.filter { it.timeSeconds >= start && it.timeSeconds < end }
      if (selected.isNotEmpty()) {
        val chroma = DoubleArray(12)
        selected.forEach { frame -> for (pitch in 0 until 12) chroma[pitch] += frame.chroma[pitch] }
        val segmentEnergy = selected.map { it.energy }.average()
        val candidate = if (medianEnergy > 0.0 && segmentEnergy < medianEnergy * 0.18) {
          ChordCandidate("N.C.", 0.0)
        } else {
          bestChord(chroma)
        }
        raw += ChordSegment(start, end, candidate.name, candidate.confidence)
      }
      start = end
    }

    val smoothed = raw.toMutableList()
    for (index in 1 until raw.lastIndex) {
      if (raw[index - 1].chord == raw[index + 1].chord && raw[index].chord != raw[index - 1].chord && raw[index].confidence < 0.4) {
        smoothed[index] = raw[index].copy(chord = raw[index - 1].chord, confidence = min(raw[index - 1].confidence, raw[index + 1].confidence))
      }
    }

    val merged = mutableListOf<ChordSegment>()
    smoothed.forEach { segment ->
      val previous = merged.lastOrNull()
      if (previous != null && previous.chord == segment.chord) {
        val totalDuration = segment.endSeconds - previous.startSeconds
        val weightedConfidence = if (totalDuration > 0) {
          ((previous.confidence * (previous.endSeconds - previous.startSeconds)) +
            (segment.confidence * (segment.endSeconds - segment.startSeconds))) / totalDuration
        } else previous.confidence
        merged[merged.lastIndex] = previous.copy(endSeconds = segment.endSeconds, confidence = weightedConfidence)
      } else {
        merged += segment
      }
    }
    return merged.take(96)
  }

  private fun bestChord(chroma: DoubleArray): ChordCandidate {
    val sum = chroma.sum()
    if (sum <= 1e-9) return ChordCandidate("N.C.", 0.0)
    for (index in chroma.indices) chroma[index] /= sum
    var bestName = "N.C."
    var bestScore = Double.NEGATIVE_INFINITY
    var secondScore = Double.NEGATIVE_INFINITY
    var bestCoverage = 0.0
    for (root in 0 until 12) {
      val templates = listOf(
        "${PITCH_NAMES[root]}" to intArrayOf(0, 4, 7),
        "${PITCH_NAMES[root]}m" to intArrayOf(0, 3, 7),
        "${PITCH_NAMES[root]}7" to intArrayOf(0, 4, 7, 10),
        "${PITCH_NAMES[root]}maj7" to intArrayOf(0, 4, 7, 11),
        "${PITCH_NAMES[root]}m7" to intArrayOf(0, 3, 7, 10),
        "${PITCH_NAMES[root]}sus2" to intArrayOf(0, 2, 7),
        "${PITCH_NAMES[root]}sus4" to intArrayOf(0, 5, 7),
        "${PITCH_NAMES[root]}5" to intArrayOf(0, 7)
      )
      templates.forEach { (name, intervals) ->
        val notes = intervals.map { (root + it) % 12 }.toSet()
        val chordEnergy = notes.sumOf { chroma[it] }
        val nonChordEnergy = (0 until 12).filterNot { it in notes }.sumOf { chroma[it] }
        val rootBonus = chroma[root] * 0.18
        val fifthBonus = chroma[(root + 7) % 12] * 0.08
        val complexityPenalty = max(0, notes.size - 3) * 0.012
        val score = chordEnergy + rootBonus + fifthBonus - nonChordEnergy * 0.34 - complexityPenalty
        if (score > bestScore) {
          secondScore = bestScore
          bestScore = score
          bestName = name
          bestCoverage = chordEnergy
        } else if (score > secondScore) {
          secondScore = score
        }
      }
    }
    val margin = (bestScore - secondScore).coerceAtLeast(0.0)
    val confidence = (margin * 7.0 + (bestCoverage - 0.50) * 1.45).coerceIn(0.0, 1.0)
    return if (bestCoverage < 0.48 || confidence < 0.14) ChordCandidate("N.C.", confidence) else ChordCandidate(bestName, confidence)
  }

  private data class DecodedAudio(
    val samples: FloatArray,
    val sampleRate: Int,
    val sourceSampleRate: Int,
    val sourceChannels: Int,
    val durationSeconds: Double
  )

  private data class BpmResult(val bpm: Double, val confidence: Double)
  private data class KeyResult(val name: String, val confidence: Double)
  private data class ChromaFrame(val timeSeconds: Double, val chroma: DoubleArray, val energy: Double)
  private data class ChordCandidate(val name: String, val confidence: Double)
  private data class ChordSegment(
    val startSeconds: Double,
    val endSeconds: Double,
    val chord: String,
    val confidence: Double
  ) {
    fun toMap() = mapOf(
      "startSeconds" to startSeconds,
      "endSeconds" to endSeconds,
      "chord" to chord,
      "confidence" to confidence
    )
  }

  private data class AudioFileAnalysis(
    val durationSeconds: Double,
    val sourceSampleRate: Int,
    val sourceChannels: Int,
    val analyzedSampleRate: Int,
    val bpm: Double,
    val bpmConfidence: Double,
    val key: String,
    val keyConfidence: Double,
    val chords: List<ChordSegment>,
    val notes: List<String>
  ) {
    fun toMap() = mapOf(
      "durationSeconds" to durationSeconds,
      "sourceSampleRate" to sourceSampleRate,
      "sourceChannels" to sourceChannels,
      "analyzedSampleRate" to analyzedSampleRate,
      "bpm" to bpm,
      "bpmConfidence" to bpmConfidence,
      "key" to key,
      "keyConfidence" to keyConfidence,
      "chords" to chords.map { it.toMap() },
      "notes" to notes
    )
  }

  private class FloatAccumulator(private val maxSize: Int) {
    private var data = FloatArray(min(maxSize, 65_536).coerceAtLeast(1))
    var size: Int = 0
      private set
    val full: Boolean get() = size >= maxSize

    fun add(value: Float) {
      if (full) return
      if (size >= data.size) data = data.copyOf(min(maxSize, data.size * 2))
      data[size] = value
      size += 1
    }

    fun toArray() = data.copyOf(size)
  }

  private fun MediaFormat.intOrDefault(key: String, fallback: Int): Int {
    return if (containsKey(key)) runCatching { getInteger(key) }.getOrDefault(fallback) else fallback
  }

  companion object {
    private const val TARGET_SAMPLE_RATE = 11_025
    private const val MAX_ANALYSIS_SECONDS = 120
    private const val CODEC_TIMEOUT_US = 10_000L
    private val PITCH_NAMES = listOf("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
    private val MAJOR_PROFILE = doubleArrayOf(6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88)
    private val MINOR_PROFILE = doubleArrayOf(6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17)
  }
}
