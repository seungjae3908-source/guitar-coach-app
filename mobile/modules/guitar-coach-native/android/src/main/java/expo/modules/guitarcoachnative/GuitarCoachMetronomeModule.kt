package expo.modules.guitarcoachnative

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.roundToLong
import kotlin.math.sin

class GuitarCoachMetronomeModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val timingThread = HandlerThread(
    "GuitarCoachMetronomeClock",
    Process.THREAD_PRIORITY_URGENT_AUDIO
  ).apply { start() }
  private val timingHandler = Handler(timingThread.looper)
  private val voiceToken = Any()

  private var accentTrack: AudioTrack? = null
  private var regularTrack: AudioTrack? = null
  private var preparedSoundPreset = -1
  private var textToSpeech: TextToSpeech? = null
  private var ttsReady = false
  private var ttsInitializing = false
  private val voiceWaiters = mutableListOf<Promise>()

  @Volatile private var running = false
  @Volatile private var generation = 0
  @Volatile private var pulseIndex = 0
  @Volatile private var nextTickAt = 0L
  private var nextTickTargetMs = 0.0
  private var tickRunnable: Runnable? = null
  @Volatile private var lastTickElapsedRealtime = 0L
  @Volatile private var lastTickUptime = 0L
  @Volatile private var lastTickPulseIndex = -1
  @Volatile private var absolutePulseCount = 0L
  @Volatile private var averageSchedulerJitterMs = 0.0

  @Volatile private var currentBpm = 70
  @Volatile private var currentBeatsPerBar = 4
  @Volatile private var currentSubdivision = 1
  @Volatile private var currentSoundEnabled = true
  @Volatile private var currentVoiceEnabled = false
  @Volatile private var currentSoundPreset = 0
  private val voiceLeadMs = 170L

  override fun definition() = ModuleDefinition {
    Name("GuitarCoachMetronome")

    Constant("androidMetronomeAvailable") { true }

    AsyncFunction("prepareVoiceAsync") { promise: Promise ->
      mainHandler.post { prepareVoiceInternal(promise) }
    }

    AsyncFunction("startAsync") {
      bpm: Int,
      beatsPerBar: Int,
      subdivision: Int,
      soundEnabled: Boolean,
      voiceEnabled: Boolean,
      soundPreset: Int ->
      timingHandler.post {
        startInternal(
          bpm = bpm.coerceIn(35, 220),
          beatsPerBar = beatsPerBar.coerceIn(1, 12),
          subdivision = subdivision.coerceIn(1, 4),
          soundEnabled = soundEnabled,
          voiceEnabled = voiceEnabled,
          soundPreset = soundPreset.coerceIn(0, 4)
        )
      }
    }

    AsyncFunction("updateAsync") {
      bpm: Int,
      beatsPerBar: Int,
      subdivision: Int,
      soundEnabled: Boolean,
      voiceEnabled: Boolean,
      soundPreset: Int ->
      timingHandler.post {
        updateInternal(
          bpm = bpm.coerceIn(35, 220),
          beatsPerBar = beatsPerBar.coerceIn(1, 12),
          subdivision = subdivision.coerceIn(1, 4),
          soundEnabled = soundEnabled,
          voiceEnabled = voiceEnabled,
          soundPreset = soundPreset.coerceIn(0, 4)
        )
      }
    }

    AsyncFunction("getTimingStateAsync") { promise: Promise ->
      val safeSubdivision = currentSubdivision.coerceIn(1, 4)
      val intervalMs = intervalMs(currentBpm, safeSubdivision)
      promise.resolve(
        mapOf(
          "running" to running,
          "bpm" to currentBpm,
          "beatsPerBar" to currentBeatsPerBar,
          "subdivision" to safeSubdivision,
          "intervalMs" to intervalMs,
          "lastTickElapsedRealtimeMs" to lastTickElapsedRealtime.toDouble(),
          "lastTickUptimeMs" to lastTickUptime.toDouble(),
          "nextTickUptimeMs" to nextTickAt.toDouble(),
          "lastTickPulseIndex" to lastTickPulseIndex,
          "nextPulseIndex" to pulseIndex,
          "absolutePulseCount" to absolutePulseCount.toDouble(),
          "elapsedRealtimeNowMs" to SystemClock.elapsedRealtime().toDouble(),
          "uptimeNowMs" to SystemClock.uptimeMillis().toDouble(),
          "schedulerJitterMs" to averageSchedulerJitterMs,
          "voiceLeadMs" to voiceLeadMs.toDouble()
        )
      )
    }

    AsyncFunction("stopAsync") {
      timingHandler.post { stopInternal(stopSpeech = true) }
    }

    AsyncFunction("previewVoiceAsync") { subdivision: Int, promise: Promise ->
      mainHandler.post {
        if (!ttsReady) {
          promise.reject("ERR_TTS_NOT_READY", "음성 엔진이 아직 준비되지 않았습니다.", null)
          return@post
        }
        speakPhrase(voicePhraseForBeat(0, subdivision.coerceIn(1, 4)))
        promise.resolve(null)
      }
    }

    AsyncFunction("previewSoundAsync") { soundPreset: Int ->
      timingHandler.post {
        ensureClickTracks(soundPreset.coerceIn(0, 4))
        playStaticTrack(accentTrack)
      }
    }

    OnDestroy {
      timingHandler.post {
        stopInternal(stopSpeech = true)
        releaseClickTracks()
      }
      mainHandler.post {
        textToSpeech?.shutdown()
        textToSpeech = null
        ttsReady = false
        ttsInitializing = false
        rejectVoiceWaiters("ERR_TTS_DESTROYED", "음성 엔진이 종료되었습니다.")
      }
      timingThread.quitSafely()
    }
  }

  private fun startInternal(
    bpm: Int,
    beatsPerBar: Int,
    subdivision: Int,
    soundEnabled: Boolean,
    voiceEnabled: Boolean,
    soundPreset: Int
  ) {
    stopInternal(stopSpeech = true)
    applyConfiguration(bpm, beatsPerBar, subdivision, soundEnabled, voiceEnabled, soundPreset)
    ensureClickTracks(soundPreset)

    pulseIndex = 0
    absolutePulseCount = 0L
    lastTickElapsedRealtime = 0L
    lastTickUptime = 0L
    lastTickPulseIndex = -1
    averageSchedulerJitterMs = 0.0
    running = true
    generation += 1

    if (voiceEnabled && !ttsReady) mainHandler.post { ensureTextToSpeech() }

    nextTickTargetMs = SystemClock.uptimeMillis() + 320.0
    nextTickAt = nextTickTargetMs.roundToLong()
    scheduleVoiceCue(generation, pulseIndex, nextTickAt)
    scheduleTick(generation, nextTickAt)
  }

  private fun updateInternal(
    bpm: Int,
    beatsPerBar: Int,
    subdivision: Int,
    soundEnabled: Boolean,
    voiceEnabled: Boolean,
    soundPreset: Int
  ) {
    val wasRunning = running
    val oldPulseIndex = pulseIndex
    applyConfiguration(bpm, beatsPerBar, subdivision, soundEnabled, voiceEnabled, soundPreset)
    ensureClickTracks(soundPreset)
    if (voiceEnabled && !ttsReady) mainHandler.post { ensureTextToSpeech() }
    if (!wasRunning) return

    generation += 1
    tickRunnable?.let(timingHandler::removeCallbacks)
    tickRunnable = null
    mainHandler.removeCallbacksAndMessages(voiceToken)
    pulseIndex = oldPulseIndex % max(1, currentBeatsPerBar * currentSubdivision)

    val interval = intervalMs(currentBpm, currentSubdivision)
    val now = SystemClock.uptimeMillis().toDouble()
    nextTickTargetMs = if (lastTickUptime > 0) lastTickUptime + interval else now + 240.0
    while (nextTickTargetMs <= now + 4.0) nextTickTargetMs += interval
    nextTickAt = nextTickTargetMs.roundToLong()
    scheduleVoiceCue(generation, pulseIndex, nextTickAt)
    scheduleTick(generation, nextTickAt)
  }

  private fun applyConfiguration(
    bpm: Int,
    beatsPerBar: Int,
    subdivision: Int,
    soundEnabled: Boolean,
    voiceEnabled: Boolean,
    soundPreset: Int
  ) {
    currentBpm = bpm
    currentBeatsPerBar = beatsPerBar
    currentSubdivision = subdivision
    currentSoundEnabled = soundEnabled
    currentVoiceEnabled = voiceEnabled
    currentSoundPreset = soundPreset
  }

  private fun stopInternal(stopSpeech: Boolean) {
    running = false
    generation += 1
    tickRunnable?.let(timingHandler::removeCallbacks)
    tickRunnable = null
    mainHandler.removeCallbacksAndMessages(voiceToken)
    stopStaticTrack(accentTrack)
    stopStaticTrack(regularTrack)
    if (stopSpeech) mainHandler.post { textToSpeech?.stop() }
  }

  private fun scheduleTick(expectedGeneration: Int, scheduledAt: Long) {
    val runnable = Runnable {
      if (!running || expectedGeneration != generation) return@Runnable

      val nowUptime = SystemClock.uptimeMillis()
      val schedulerJitter = abs(nowUptime - scheduledAt).toDouble()
      averageSchedulerJitterMs = if (absolutePulseCount == 0L) {
        schedulerJitter
      } else {
        averageSchedulerJitterMs * 0.86 + schedulerJitter * 0.14
      }

      val safeSubdivision = currentSubdivision.coerceIn(1, 4)
      val totalPulses = (currentBeatsPerBar * safeSubdivision).coerceAtLeast(1)
      val firedPulseIndex = pulseIndex
      val accent = firedPulseIndex == 0

      lastTickElapsedRealtime = SystemClock.elapsedRealtime()
      lastTickUptime = nowUptime
      lastTickPulseIndex = firedPulseIndex
      absolutePulseCount += 1L

      if (currentSoundEnabled) {
        playStaticTrack(if (accent) accentTrack else regularTrack)
      }

      pulseIndex = (firedPulseIndex + 1) % totalPulses
      val interval = intervalMs(currentBpm, safeSubdivision)
      nextTickTargetMs += interval
      val now = SystemClock.uptimeMillis().toDouble()
      while (nextTickTargetMs <= now + 1.0) nextTickTargetMs += interval
      nextTickAt = nextTickTargetMs.roundToLong()

      scheduleVoiceCue(expectedGeneration, pulseIndex, nextTickAt)
      scheduleTick(expectedGeneration, nextTickAt)
    }

    tickRunnable = runnable
    timingHandler.postAtTime(runnable, scheduledAt)
  }

  private fun scheduleVoiceCue(expectedGeneration: Int, targetPulseIndex: Int, targetTickAt: Long) {
    if (!currentVoiceEnabled || !ttsReady) return
    val safeSubdivision = currentSubdivision.coerceIn(1, 4)
    if (targetPulseIndex % safeSubdivision != 0) return
    val beatIndex = (targetPulseIndex / safeSubdivision) % currentBeatsPerBar.coerceAtLeast(1)
    val scheduledSpeechAt = max(SystemClock.uptimeMillis(), targetTickAt - voiceLeadMs)
    val runnable = Runnable {
      if (!running || expectedGeneration != generation || !currentVoiceEnabled) return@Runnable
      speakPhrase(runtimeVoicePhraseForBeat(beatIndex))
    }
    mainHandler.postAtTime(runnable, voiceToken, scheduledSpeechAt)
  }

  private fun intervalMs(bpm: Int, subdivision: Int) =
    60000.0 / bpm.coerceIn(35, 220).toDouble() / subdivision.coerceIn(1, 4).toDouble()

  private fun ensureClickTracks(preset: Int) {
    if (
      preparedSoundPreset == preset
      && accentTrack?.state == AudioTrack.STATE_INITIALIZED
      && regularTrack?.state == AudioTrack.STATE_INITIALIZED
    ) return

    releaseClickTracks()
    val spec = clickSpec(preset)
    accentTrack = createStaticClickTrack(
      frequencyHz = spec.accentFrequency,
      durationMs = spec.accentDurationMs,
      amplitude = 0.88
    )
    regularTrack = createStaticClickTrack(
      frequencyHz = spec.regularFrequency,
      durationMs = spec.regularDurationMs,
      amplitude = 0.68
    )
    preparedSoundPreset = preset
  }

  private fun createStaticClickTrack(
    frequencyHz: Double,
    durationMs: Int,
    amplitude: Double
  ): AudioTrack {
    val sampleRate = 48_000
    val frameCount = max(480, (sampleRate * durationMs / 1000.0).roundToInt())
    val pcm = ShortArray(frameCount)
    val attackFrames = max(1, (sampleRate * 0.0015).roundToInt())
    val releaseFrames = max(1, (sampleRate * 0.012).roundToInt())
    for (index in pcm.indices) {
      val attack = min(1.0, index.toDouble() / attackFrames)
      val release = min(1.0, (pcm.lastIndex - index).coerceAtLeast(0).toDouble() / releaseFrames)
      val envelope = attack * release
      val fundamental = sin(2.0 * PI * frequencyHz * index / sampleRate)
      val overtone = sin(2.0 * PI * frequencyHz * 2.0 * index / sampleRate) * 0.22
      val sample = (fundamental + overtone) / 1.22 * amplitude * envelope
      pcm[index] = (sample * Short.MAX_VALUE).roundToInt()
        .coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
        .toShort()
    }

    val bufferBytes = pcm.size * 2
    val track = AudioTrack.Builder()
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
      )
      .setAudioFormat(
        AudioFormat.Builder()
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .setSampleRate(sampleRate)
          .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .build()
      )
      .setBufferSizeInBytes(bufferBytes)
      .setTransferMode(AudioTrack.MODE_STATIC)
      .build()
    val written = track.write(pcm, 0, pcm.size, AudioTrack.WRITE_BLOCKING)
    if (written <= 0 || track.state != AudioTrack.STATE_INITIALIZED) {
      track.release()
      throw IllegalStateException("저지연 메트로놈 클릭 음원을 준비하지 못했습니다.")
    }
    return track
  }

  private fun playStaticTrack(track: AudioTrack?) {
    if (track == null || track.state != AudioTrack.STATE_INITIALIZED) return
    runCatching {
      if (track.playState == AudioTrack.PLAYSTATE_PLAYING) track.stop()
      track.setPlaybackHeadPosition(0)
      track.play()
    }
  }

  private fun stopStaticTrack(track: AudioTrack?) {
    if (track == null || track.state != AudioTrack.STATE_INITIALIZED) return
    runCatching { if (track.playState == AudioTrack.PLAYSTATE_PLAYING) track.stop() }
  }

  private fun releaseClickTracks() {
    stopStaticTrack(accentTrack)
    stopStaticTrack(regularTrack)
    accentTrack?.release()
    regularTrack?.release()
    accentTrack = null
    regularTrack = null
    preparedSoundPreset = -1
  }

  private fun clickSpec(preset: Int): ClickSpec = when (preset.coerceIn(0, 4)) {
    1 -> ClickSpec(1_760.0, 1_320.0, 36, 27)
    2 -> ClickSpec(1_480.0, 1_110.0, 42, 31)
    3 -> ClickSpec(2_240.0, 1_680.0, 30, 22)
    4 -> ClickSpec(1_980.0, 1_485.0, 25, 18)
    else -> ClickSpec(2_000.0, 1_500.0, 38, 28)
  }

  private fun prepareVoiceInternal(promise: Promise) {
    if (ttsReady) {
      promise.resolve(voiceReadyPayload())
      return
    }
    voiceWaiters.add(promise)
    ensureTextToSpeech()
  }

  private fun ensureTextToSpeech() {
    if (ttsReady || ttsInitializing) return
    val context = appContext.reactContext?.applicationContext
    if (context == null) {
      rejectVoiceWaiters("ERR_TTS_CONTEXT", "Android 음성엔진을 시작할 수 없습니다.")
      return
    }

    ttsInitializing = true
    textToSpeech = TextToSpeech(context) { status ->
      mainHandler.post {
        ttsInitializing = false
        if (status != TextToSpeech.SUCCESS) {
          textToSpeech?.shutdown()
          textToSpeech = null
          ttsReady = false
          rejectVoiceWaiters("ERR_TTS_INIT", "휴대폰의 사람 음성엔진을 초기화하지 못했습니다.")
          return@post
        }

        val engine = textToSpeech
        if (engine == null) {
          rejectVoiceWaiters("ERR_TTS_INIT", "휴대폰의 사람 음성엔진을 찾지 못했습니다.")
          return@post
        }

        val koreanResult = engine.setLanguage(Locale.KOREA)
        val languageAvailable = koreanResult != TextToSpeech.LANG_MISSING_DATA &&
          koreanResult != TextToSpeech.LANG_NOT_SUPPORTED
        if (!languageAvailable) {
          val englishResult = engine.setLanguage(Locale.US)
          val englishAvailable = englishResult != TextToSpeech.LANG_MISSING_DATA &&
            englishResult != TextToSpeech.LANG_NOT_SUPPORTED
          if (!englishAvailable) {
            engine.shutdown()
            textToSpeech = null
            ttsReady = false
            rejectVoiceWaiters("ERR_TTS_LANGUAGE", "한국어 또는 영어 사람 음성이 휴대폰에 설치되어 있지 않습니다.")
            return@post
          }
        }

        engine.setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        )
        engine.setSpeechRate(1.7f)
        engine.setPitch(1.0f)
        ttsReady = true
        resolveVoiceWaiters()
      }
    }
  }

  private fun resolveVoiceWaiters() {
    val payload = voiceReadyPayload()
    val waiters = voiceWaiters.toList()
    voiceWaiters.clear()
    waiters.forEach { it.resolve(payload) }
  }

  private fun rejectVoiceWaiters(code: String, message: String) {
    val waiters = voiceWaiters.toList()
    voiceWaiters.clear()
    waiters.forEach { it.reject(code, message, null) }
  }

  private fun voiceReadyPayload(): Map<String, Any> {
    val language = textToSpeech?.language?.toLanguageTag().orEmpty().ifBlank { "system" }
    return mapOf(
      "ready" to true,
      "language" to language,
      "message" to "사람 음성 준비 완료 · 박보다 ${voiceLeadMs}ms 먼저 발음 요청"
    )
  }

  private fun speakPhrase(phrase: String) {
    if (!ttsReady || phrase.isBlank()) return
    val params = Bundle().apply {
      putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC)
    }
    textToSpeech?.speak(
      phrase,
      TextToSpeech.QUEUE_FLUSH,
      params,
      "guitar-coach-count-${SystemClock.uptimeMillis()}"
    )
  }

  private fun runtimeVoicePhraseForBeat(beatIndex: Int): String =
    KOREAN_COUNT_WORDS[beatIndex.coerceIn(KOREAN_COUNT_WORDS.indices)]

  private fun voicePhraseForBeat(beatIndex: Int, subdivision: Int): String {
    val number = KOREAN_COUNT_WORDS[beatIndex.coerceIn(KOREAN_COUNT_WORDS.indices)]
    return when (subdivision.coerceIn(1, 4)) {
      1 -> number
      2 -> "$number 앤"
      3 -> "$number 트립 렛"
      else -> "$number 이 앤 어"
    }
  }

  private data class ClickSpec(
    val accentFrequency: Double,
    val regularFrequency: Double,
    val accentDurationMs: Int,
    val regularDurationMs: Int
  )

  companion object {
    private val KOREAN_COUNT_WORDS = listOf(
      "원", "투", "쓰리", "포", "파이브", "식스",
      "세븐", "에잇", "나인", "텐", "일레븐", "트웰브"
    )
  }
}
