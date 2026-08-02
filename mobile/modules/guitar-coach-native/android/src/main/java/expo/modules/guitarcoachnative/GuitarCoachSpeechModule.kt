package expo.modules.guitarcoachnative

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
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
  private var audioFocusGranted = false
  private var focusRequest: AudioFocusRequest? = null
  private val waiters = mutableListOf<Promise>()
  private val pendingSpeech = mutableMapOf<String, PendingSpeech>()

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
        if (!requestSpeechAudioFocus()) {
          promise.reject("ERR_SPEECH_AUDIO_FOCUS", "휴대폰 미디어 음성 출력을 확보하지 못했습니다.", null)
          return@post
        }

        tts.setSpeechRate(speechRate.toFloat().coerceIn(0.55f, 2.0f))
        tts.setPitch(pitch.toFloat().coerceIn(0.65f, 1.45f))
        val utteranceId = "guitar-coach-speech-${SystemClock.uptimeMillis()}"
        val params = Bundle().apply {
          putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC)
          putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f)
        }
        pendingSpeech[utteranceId] = PendingSpeech(promise, cleanPhrase)
        val result = tts.speak(
          cleanPhrase,
          if (interrupt) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD,
          params,
          utteranceId
        )
        if (result == TextToSpeech.ERROR) {
          pendingSpeech.remove(utteranceId)
          releaseSpeechAudioFocus()
          promise.reject("ERR_SPEECH_PLAY", "사람 음성을 재생하지 못했습니다.", null)
          return@post
        }
        mainHandler.postDelayed({
          val pending = pendingSpeech.remove(utteranceId) ?: return@postDelayed
          releaseSpeechAudioFocus()
          pending.promise.reject(
            "ERR_SPEECH_TIMEOUT",
            "음성 엔진이 재생 완료 신호를 보내지 않았습니다.",
            null
          )
        }, SPEECH_TIMEOUT_MS)
      }
    }

    AsyncFunction("stopAsync") {
      mainHandler.post {
        engine?.stop()
        rejectPendingSpeech("ERR_SPEECH_STOPPED", "음성 재생이 중지되었습니다.")
        releaseSpeechAudioFocus()
      }
    }

    AsyncFunction("getStatusAsync") { promise: Promise ->
      mainHandler.post {
        val manager = audioManager()
        promise.resolve(
          mapOf(
            "ready" to ready,
            "initializing" to initializing,
            "language" to languageTag,
            "speaking" to (engine?.isSpeaking == true),
            "lastPhrase" to lastPhrase,
            "lastSpokenAtMs" to lastSpokenAt.toDouble(),
            "musicVolume" to (manager?.getStreamVolume(AudioManager.STREAM_MUSIC) ?: -1),
            "maxMusicVolume" to (manager?.getStreamMaxVolume(AudioManager.STREAM_MUSIC) ?: -1),
            "audioFocusGranted" to audioFocusGranted
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
        rejectPendingSpeech("ERR_SPEECH_DESTROYED", "사람 음성 엔진이 종료되었습니다.")
        releaseSpeechAudioFocus()
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
        tts.setAudioAttributes(speechAudioAttributes())
        tts.setSpeechRate(1.08f)
        tts.setPitch(1.0f)
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
          override fun onStart(utteranceId: String?) {
            mainHandler.post {
              val pending = utteranceId?.let { pendingSpeech[it] } ?: return@post
              lastPhrase = pending.phrase
              lastSpokenAt = SystemClock.elapsedRealtime()
            }
          }

          override fun onDone(utteranceId: String?) {
            mainHandler.post {
              val id = utteranceId ?: return@post
              val pending = pendingSpeech.remove(id) ?: return@post
              releaseSpeechAudioFocus()
              pending.promise.resolve(
                mapOf(
                  "spoken" to true,
                  "phrase" to pending.phrase,
                  "language" to languageTag,
                  "spokenAtMs" to lastSpokenAt.toDouble()
                )
              )
            }
          }

          @Deprecated("Deprecated in Android")
          override fun onError(utteranceId: String?) {
            handleSpeechError(utteranceId, "사람 음성 재생 중 오류가 발생했습니다.")
          }

          override fun onError(utteranceId: String?, errorCode: Int) {
            handleSpeechError(utteranceId, "사람 음성 재생 오류 코드: $errorCode")
          }
        })
        languageTag = tts.language?.toLanguageTag().orEmpty().ifBlank { "system" }
        ready = true
        resolveWaiters()
      }
    }
  }

  private fun handleSpeechError(utteranceId: String?, message: String) {
    mainHandler.post {
      val id = utteranceId ?: return@post
      val pending = pendingSpeech.remove(id) ?: return@post
      releaseSpeechAudioFocus()
      pending.promise.reject("ERR_SPEECH_PLAY", message, null)
    }
  }

  private fun audioManager(): AudioManager? {
    val context = appContext.reactContext?.applicationContext ?: return null
    return context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
  }

  private fun speechAudioAttributes() = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
    .build()

  @Suppress("DEPRECATION")
  private fun requestSpeechAudioFocus(): Boolean {
    val manager = audioManager() ?: return false
    val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(speechAudioAttributes())
        .setAcceptsDelayedFocusGain(false)
        .setWillPauseWhenDucked(false)
        .setOnAudioFocusChangeListener { }
        .build()
      focusRequest = request
      manager.requestAudioFocus(request)
    } else {
      manager.requestAudioFocus(
        null,
        AudioManager.STREAM_MUSIC,
        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
      )
    }
    audioFocusGranted = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    return audioFocusGranted
  }

  @Suppress("DEPRECATION")
  private fun releaseSpeechAudioFocus() {
    val manager = audioManager() ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      focusRequest?.let { manager.abandonAudioFocusRequest(it) }
    } else {
      manager.abandonAudioFocus(null)
    }
    focusRequest = null
    audioFocusGranted = false
  }

  private fun readyPayload(): Map<String, Any> {
    val manager = audioManager()
    return mapOf(
      "ready" to true,
      "language" to languageTag,
      "message" to "코칭 음성 준비 완료",
      "musicVolume" to (manager?.getStreamVolume(AudioManager.STREAM_MUSIC) ?: -1),
      "maxMusicVolume" to (manager?.getStreamMaxVolume(AudioManager.STREAM_MUSIC) ?: -1)
    )
  }

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

  private fun rejectPendingSpeech(code: String, message: String) {
    val pending = pendingSpeech.values.toList()
    pendingSpeech.clear()
    pending.forEach { it.promise.reject(code, message, null) }
  }

  private data class PendingSpeech(
    val promise: Promise,
    val phrase: String
  )

  companion object {
    private const val MAX_PHRASE_LENGTH = 180
    private const val SPEECH_TIMEOUT_MS = 12_000L
  }
}
