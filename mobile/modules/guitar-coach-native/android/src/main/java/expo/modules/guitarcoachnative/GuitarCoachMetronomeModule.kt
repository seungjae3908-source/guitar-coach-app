package expo.modules.guitarcoachnative

import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale

class GuitarCoachMetronomeModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())

  private var toneGenerator: ToneGenerator? = null
  private var textToSpeech: TextToSpeech? = null
  private var ttsReady = false
  private var pendingSpeech: String? = null

  private var running = false
  private var generation = 0
  private var pulseIndex = 0
  private var nextTickAt = 0L
  private var tickRunnable: Runnable? = null

  private var currentBpm = 70
  private var currentBeatsPerBar = 4
  private var currentSubdivision = 1
  private var currentSoundEnabled = true
  private var currentVoiceEnabled = false

  override fun definition() = ModuleDefinition {
    Name("GuitarCoachMetronome")

    Constant("androidMetronomeAvailable") {
      true
    }

    AsyncFunction("startAsync") {
      bpm: Int,
      beatsPerBar: Int,
      subdivision: Int,
      soundEnabled: Boolean,
      voiceEnabled: Boolean ->
      mainHandler.post {
        startInternal(
          bpm = bpm.coerceIn(35, 220),
          beatsPerBar = beatsPerBar.coerceIn(1, 12),
          subdivision = subdivision.coerceIn(1, 4),
          soundEnabled = soundEnabled,
          voiceEnabled = voiceEnabled
        )
      }
    }

    AsyncFunction("stopAsync") {
      mainHandler.post { stopInternal(stopSpeech = true) }
    }

    AsyncFunction("previewVoiceAsync") { subdivision: Int ->
      mainHandler.post {
        val safeSubdivision = subdivision.coerceIn(1, 4)
        speakToken(tokenForPulse(0, safeSubdivision))
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
      }
    }
  }

  private fun startInternal(
    bpm: Int,
    beatsPerBar: Int,
    subdivision: Int,
    soundEnabled: Boolean,
    voiceEnabled: Boolean
  ) {
    stopInternal(stopSpeech = true)

    currentBpm = bpm
    currentBeatsPerBar = beatsPerBar
    currentSubdivision = subdivision
    currentSoundEnabled = soundEnabled
    currentVoiceEnabled = voiceEnabled
    pulseIndex = 0
    running = true
    generation += 1

    if (voiceEnabled) ensureTextToSpeech()

    nextTickAt = SystemClock.uptimeMillis() + 80L
    scheduleTick(generation, nextTickAt)
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

      val totalPulses = currentBeatsPerBar * currentSubdivision
      val accent = pulseIndex == 0

      if (currentSoundEnabled) playTone(accent)
      if (currentVoiceEnabled) speakToken(tokenForPulse(pulseIndex, currentSubdivision))

      pulseIndex = (pulseIndex + 1) % totalPulses.coerceAtLeast(1)

      val intervalMs = 60000.0 / currentBpm.toDouble() / currentSubdivision.toDouble()
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

  private fun playTone(accent: Boolean) {
    val generator = toneGenerator ?: ToneGenerator(AudioManager.STREAM_MUSIC, 92).also {
      toneGenerator = it
    }

    generator.stopTone()
    val tone = if (accent) ToneGenerator.TONE_PROP_BEEP2 else ToneGenerator.TONE_PROP_BEEP
    generator.startTone(tone, if (accent) 46 else 34)
  }

  private fun ensureTextToSpeech() {
    if (textToSpeech != null) return

    val context = appContext.reactContext ?: return
    textToSpeech = TextToSpeech(context) { status ->
      ttsReady = status == TextToSpeech.SUCCESS
      if (!ttsReady) return@TextToSpeech

      val engine = textToSpeech ?: return@TextToSpeech
      val languageResult = engine.setLanguage(Locale.US)
      if (languageResult == TextToSpeech.LANG_MISSING_DATA || languageResult == TextToSpeech.LANG_NOT_SUPPORTED) {
        engine.language = Locale.getDefault()
      }
      engine.setSpeechRate(1.65f)
      engine.setPitch(1.0f)

      pendingSpeech?.let { token ->
        pendingSpeech = null
        speakToken(token)
      }
    }
  }

  private fun speakToken(token: String) {
    if (token.isBlank()) return

    if (!ttsReady) {
      pendingSpeech = token
      ensureTextToSpeech()
      return
    }

    textToSpeech?.speak(
      token,
      TextToSpeech.QUEUE_FLUSH,
      null,
      "guitar-coach-count-${SystemClock.uptimeMillis()}"
    )
  }

  private fun tokenForPulse(index: Int, subdivision: Int): String {
    val safeSubdivision = subdivision.coerceIn(1, 4)
    val beatNumber = (index / safeSubdivision) % currentBeatsPerBar.coerceAtLeast(1)
    val subIndex = index % safeSubdivision

    return when (safeSubdivision) {
      1 -> NUMBER_WORDS[beatNumber.coerceIn(NUMBER_WORDS.indices)]
      2 -> if (subIndex == 0) NUMBER_WORDS[beatNumber.coerceIn(NUMBER_WORDS.indices)] else "and"
      3 -> when (subIndex) {
        0 -> NUMBER_WORDS[beatNumber.coerceIn(NUMBER_WORDS.indices)]
        1 -> "trip"
        else -> "let"
      }
      else -> when (subIndex) {
        0 -> NUMBER_WORDS[beatNumber.coerceIn(NUMBER_WORDS.indices)]
        1 -> "e"
        2 -> "and"
        else -> "a"
      }
    }
  }

  companion object {
    private val NUMBER_WORDS = listOf(
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
      "nine",
      "ten",
      "eleven",
      "twelve"
    )
  }
}
