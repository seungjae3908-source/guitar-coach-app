package expo.modules.guitarcoachnative

import android.media.AudioManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale

class GuitarCoachSpeechModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var engine: TextToSpeech? = null
  private var ready = false
  private var initializing = false
  private var languageTag = ""
  private var lastPhrase = ""
  private var lastSpokenAt = 0L
  private val waiters = mutableListOf<Promise>()

  override fun definition() = ModuleDefinition {
    Name("GuitarCoachSpeech")

    Constant("androidCoachSpeechAvailable") { true }

    AsyncFunction("prepareAsync") { promise: Promise ->
      mainHandler.post { prepareInternal(promise) }
    }

    AsyncFunction("speakAsync") {
      phrase: String,
      interrupt: Boolean,
      speechRate: Double,
      pitch: Double,
      promise: Promise ->
      mainHandler.post {
        val cleanPhrase = phrase.trim().take(MAX_PHRASE_LENGTH)
        if (cleanPhrase.isBlank()) {
          promise.reject("ERR_EMPTY_SPEECH", "읽을 문장이 없습니다.", null)
          return@post
        }
        if (!ready) {
          promise.reject("ERR_SPEECH_NOT_READY", "사람 음성 엔진이 아직 준비되지 않았습니다.", null)
          return@post
        }
        val tts = engine
        if (tts == null) {
          promise.reject("ERR_SPEECH_ENGINE", "사람 음성 엔진을 찾지 못했습니다.", null)
          return@post
        }
        tts.setSpeechRate(speechRate.toFloat().coerceIn(0.55f, 2.0f))
        tts.setPitch(pitch.toFloat().coerceIn(0.65f, 1.45f))
        val params = Bundle().apply {
          putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC)
        }
        val result = tts.speak(
          cleanPhrase,
          if (interrupt) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD,
          params,
          "guitar-coach-speech-${SystemClock.uptimeMillis()}"
        )
        if (result == TextToSpeech.ERROR) {
          promise.reject("ERR_SPEECH_PLAY", "사람 음성을 재생하지 못했습니다.", null)
          return@post
        }
        lastPhrase = cleanPhrase
        lastSpokenAt = SystemClock.elapsedRealtime()
        promise.resolve(
          mapOf(
            "spoken" to true,
            "phrase" to cleanPhrase,
            "language" to languageTag,
            "spokenAtMs" to lastSpokenAt.toDouble()
          )
        )
      }
    }

    AsyncFunction("stopAsync") {
      mainHandler.post { engine?.stop() }
    }

    AsyncFunction("getStatusAsync") { promise: Promise ->
      mainHandler.post {
        promise.resolve(
          mapOf(
            "ready" to ready,
            "initializing" to initializing,
            "language" to languageTag,
            "speaking" to (engine?.isSpeaking == true),
            "lastPhrase" to lastPhrase,
            "lastSpokenAtMs" to lastSpokenAt.toDouble()
          )
        )
      }
    }

    OnDestroy {
      mainHandler.post {
        engine?.stop()
        engine?.shutdown()
        engine = null
        ready = false
        initializing = false
        rejectWaiters("ERR_SPEECH_DESTROYED", "사람 음성 엔진이 종료되었습니다.")
      }
    }
  }

  private fun prepareInternal(promise: Promise) {
    if (ready) {
      promise.resolve(readyPayload())
      return
    }
    waiters += promise
    ensureEngine()
  }

  private fun ensureEngine() {
    if (ready || initializing) return
    val context = appContext.reactContext?.applicationContext
    if (context == null) {
      rejectWaiters("ERR_SPEECH_CONTEXT", "Android 음성 컨텍스트가 없습니다.")
      return
    }
    initializing = true
    engine = TextToSpeech(context) { status ->
      mainHandler.post {
        initializing = false
        if (status != TextToSpeech.SUCCESS) {
          engine?.shutdown()
          engine = null
          ready = false
          rejectWaiters("ERR_SPEECH_INIT", "휴대폰 사람 음성 엔진을 초기화하지 못했습니다.")
          return@post
        }
        val tts = engine
        if (tts == null) {
          rejectWaiters("ERR_SPEECH_ENGINE", "휴대폰 사람 음성 엔진을 찾지 못했습니다.")
          return@post
        }
        val koreanResult = tts.setLanguage(Locale.KOREA)
        val koreanAvailable = koreanResult != TextToSpeech.LANG_MISSING_DATA &&
          koreanResult != TextToSpeech.LANG_NOT_SUPPORTED
        if (!koreanAvailable) {
          val englishResult = tts.setLanguage(Locale.US)
          val englishAvailable = englishResult != TextToSpeech.LANG_MISSING_DATA &&
            englishResult != TextToSpeech.LANG_NOT_SUPPORTED
          if (!englishAvailable) {
            tts.shutdown()
            engine = null
            ready = false
            rejectWaiters("ERR_SPEECH_LANGUAGE", "한국어 또는 영어 음성이 휴대폰에 설치되어 있지 않습니다.")
            return@post
          }
        }
        tts.setSpeechRate(1.08f)
        tts.setPitch(1.0f)
        languageTag = tts.language?.toLanguageTag().orEmpty().ifBlank { "system" }
        ready = true
        resolveWaiters()
      }
    }
  }

  private fun readyPayload() = mapOf(
    "ready" to true,
    "language" to languageTag,
    "message" to "코칭 음성 준비 완료"
  )

  private fun resolveWaiters() {
    val payload = readyPayload()
    val pending = waiters.toList()
    waiters.clear()
    pending.forEach { it.resolve(payload) }
  }

  private fun rejectWaiters(code: String, message: String) {
    val pending = waiters.toList()
    waiters.clear()
    pending.forEach { it.reject(code, message, null) }
  }

  companion object {
    private const val MAX_PHRASE_LENGTH = 180
  }
}
