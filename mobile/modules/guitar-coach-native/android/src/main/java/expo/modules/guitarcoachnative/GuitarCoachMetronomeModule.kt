package expo.modules.guitarcoachnative

import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale

class GuitarCoachMetronomeModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())

  private var toneGenerator: ToneGenerator? = null
  private var textToSpeech: TextToSpeech? = null
  private var ttsReady = false
  private var ttsInitializing = false
  private val voiceWaiters = mutableListOf<Promise>()

  private var running = false
  private var generation = 0
  private var pulseIndex = 0
  private var nextTickAt = 0L
  private var tickRunnable: Runnable? = null
  private var lastTickElapsedRealtime = 0L
  private var lastTickUptime = 0L
  private var lastTickPulseIndex = -1
  private var absolutePulseCount = 0L

  private var currentBpm = 70
  private var currentBeatsPerBar = 4
  private var currentSubdivision = 1
  private var currentSoundEnabled = true
  private var currentVoiceEnabled = false
  private var currentSoundPreset = 0

  override fun definition() = ModuleDefinition {
    Name("GuitarCoachMetronome")

    Constant("androidMetronomeAvailable") {
      true
    }

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
      mainHandler.post {
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
      mainHandler.post {
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
      mainHandler.post {
        val safeSubdivision = currentSubdivision.coerceIn(1, 4)
        val intervalMs = 60000.0 / currentBpm.toDouble() / safeSubdivision.toDouble()
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
            "uptimeNowMs" to SystemClock.uptimeMillis().toDouble()
          )
        )
      }
    }

    AsyncFunction("stopAsync") {
      mainHandler.post { stopInternal(stopSpeech = true) }
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
      mainHandler.post {
        playToneWithPreset(accent = true, preset = soundPreset.coerceIn(0, 4))
      }
    }

    OnDestroy {
      mainHandler.post {
        stopInternal(stopSpeech = true)
        toneGenerator?.release()
        toneGenerator = null
        textToSpeech?.shutdown()
        textToSpeech = null
        ttsReady = false
        ttsInitializing = false
        rejectVoiceWaiters("ERR_TTS_DESTROYED", "음성 엔진이 종료되었습니다.")
      }
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

    pulseIndex = 0
    absolutePulseCount = 0L
    lastTickElapsedRealtime = 0L
    lastTickUptime = 0L
    lastTickPulseIndex = -1
    running = true
    generation += 1

    if (voiceEnabled && !ttsReady) ensureTextToSpeech()

    nextTickAt = SystemClock.uptimeMillis() + 60L
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
    applyConfiguration(bpm, beatsPerBar, subdivision, soundEnabled, voiceEnabled, soundPreset)
    if (voiceEnabled && !ttsReady) ensureTextToSpeech()
    if (!running) return

    generation += 1
    tickRunnable?.let(mainHandler::removeCallbacks)
    tickRunnable = null
    toneGenerator?.stopTone()
    textToSpeech?.stop()
    pulseIndex = 0
    absolutePulseCount = 0L
    lastTickElapsedRealtime = 0L
    lastTickUptime = 0L
    lastTickPulseIndex = -1
    nextTickAt = SystemClock.uptimeMillis() + 35L
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
    tickRunnable?.let(mainHandler::removeCallbacks)
    tickRunnable = null
    toneGenerator?.stopTone()
    if (stopSpeech) textToSpeech?.stop()
  }

  private fun scheduleTick(expectedGeneration: Int, scheduledAt: Long) {
    val runnable = Runnable {
      if (!running || expectedGeneration != generation) return@Runnable

      val safeSubdivision = currentSubdivision.coerceIn(1, 4)
      val totalPulses = (currentBeatsPerBar * safeSubdivision).coerceAtLeast(1)
      val firedPulseIndex = pulseIndex
      val accent = firedPulseIndex == 0

      lastTickElapsedRealtime = SystemClock.elapsedRealtime()
      lastTickUptime = SystemClock.uptimeMillis()
      lastTickPulseIndex = firedPulseIndex
      absolutePulseCount += 1L

      if (currentSoundEnabled) playToneWithPreset(accent, currentSoundPreset)
      if (currentVoiceEnabled && ttsReady && firedPulseIndex % safeSubdivision == 0) {
        val beatIndex = (firedPulseIndex / safeSubdivision) % currentBeatsPerBar.coerceAtLeast(1)
        speakPhrase(voicePhraseForBeat(beatIndex, safeSubdivision))
      }

      pulseIndex = (firedPulseIndex + 1) % totalPulses

      val intervalMs = 60000.0 / currentBpm.toDouble() / safeSubdivision.toDouble()
      nextTickAt = (nextTickAt + intervalMs).toLong()
      val now = SystemClock.uptimeMillis()
      if (nextTickAt < now - intervalMs.toLong()) {
        nextTickAt = now + intervalMs.toLong()
      }

      scheduleTick(expectedGeneration, nextTickAt)
    }

    tickRunnable = runnable
    mainHandler.postAtTime(runnable, scheduledAt)
  }

  private fun playToneWithPreset(accent: Boolean, preset: Int) {
    val generator = toneGenerator ?: ToneGenerator(AudioManager.STREAM_MUSIC, 96).also {
      toneGenerator = it
    }
    val spec = toneSpec(preset.coerceIn(0, 4), accent)
    generator.stopTone()
    generator.startTone(spec.tone, spec.durationMs)
  }

  private fun toneSpec(preset: Int, accent: Boolean): ToneSpec {
    return when (preset) {
      1 -> ToneSpec(
        tone = if (accent) ToneGenerator.TONE_DTMF_9 else ToneGenerator.TONE_DTMF_8,
        durationMs = if (accent) 34 else 24
      )
      2 -> ToneSpec(
        tone = if (accent) ToneGenerator.TONE_DTMF_3 else ToneGenerator.TONE_DTMF_2,
        durationMs = if (accent) 42 else 30
      )
      3 -> ToneSpec(
        tone = if (accent) ToneGenerator.TONE_DTMF_A else ToneGenerator.TONE_DTMF_D,
        durationMs = if (accent) 28 else 20
      )
      4 -> ToneSpec(
        tone = if (accent) ToneGenerator.TONE_DTMF_6 else ToneGenerator.TONE_DTMF_5,
        durationMs = if (accent) 24 else 17
      )
      else -> ToneSpec(
        tone = if (accent) ToneGenerator.TONE_PROP_BEEP2 else ToneGenerator.TONE_PROP_BEEP,
        durationMs = if (accent) 42 else 30
      )
    }
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

        engine.setSpeechRate(1.55f)
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
      "message" to "사람 음성 준비 완료"
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

  private fun voicePhraseForBeat(beatIndex: Int, subdivision: Int): String {
    val number = KOREAN_COUNT_WORDS[beatIndex.coerceIn(KOREAN_COUNT_WORDS.indices)]
    return when (subdivision.coerceIn(1, 4)) {
      1 -> number
      2 -> "$number 앤"
      3 -> "$number 트립 렛"
      else -> "$number 이 앤 어"
    }
  }

  private data class ToneSpec(val tone: Int, val durationMs: Int)

  companion object {
    private val KOREAN_COUNT_WORDS = listOf(
      "원",
      "투",
      "쓰리",
      "포",
      "파이브",
      "식스",
      "세븐",
      "에잇",
      "나인",
      "텐",
      "일레븐",
      "트웰브"
    )
  }
}
