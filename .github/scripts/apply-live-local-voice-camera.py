#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[2]
MOBILE = ROOT / "mobile"

def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"Pattern not found in {path}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")

def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")

# 1) Download a free on-device ImageNet classifier alongside the existing models.
gradle = MOBILE / "modules/guitar-coach-native/android/build.gradle"
replace_once(
    gradle,
    """def guitarObjectModelFile = file("$visionModelDir/efficientdet_lite0.tflite")
def guitarObjectModelUrl = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/latest/efficientdet_lite0.tflite'
""",
    """def guitarObjectModelFile = file("$visionModelDir/efficientdet_lite0.tflite")
def guitarObjectModelUrl = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/latest/efficientdet_lite0.tflite'
def guitarClassifierModelFile = file("$visionModelDir/efficientnet_lite0.tflite")
def guitarClassifierModelUrl = 'https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite0/float32/1/efficientnet_lite0.tflite'
""",
)
replace_once(
    gradle,
    """tasks.register('downloadGuitarObjectModel') {
  outputs.file(guitarObjectModelFile)
  doLast {
    visionModelDir.mkdirs()
    if (!guitarObjectModelFile.exists() || guitarObjectModelFile.length() < 2_000_000L) {
      logger.lifecycle('Downloading official MediaPipe EfficientDet-Lite0 object detector model...')
      new URL(guitarObjectModelUrl).withInputStream { input ->
        guitarObjectModelFile.withOutputStream { output -> output << input }
      }
    }
  }
}

afterEvaluate {
  tasks.named('preBuild').configure {
    dependsOn(tasks.named('downloadHandLandmarkerModel'))
    dependsOn(tasks.named('downloadGuitarObjectModel'))
  }
}
""",
    """tasks.register('downloadGuitarObjectModel') {
  outputs.file(guitarObjectModelFile)
  doLast {
    visionModelDir.mkdirs()
    if (!guitarObjectModelFile.exists() || guitarObjectModelFile.length() < 2_000_000L) {
      logger.lifecycle('Downloading official MediaPipe EfficientDet-Lite0 object detector model...')
      new URL(guitarObjectModelUrl).withInputStream { input ->
        guitarObjectModelFile.withOutputStream { output -> output << input }
      }
    }
  }
}

tasks.register('downloadGuitarClassifierModel') {
  outputs.file(guitarClassifierModelFile)
  doLast {
    visionModelDir.mkdirs()
    if (!guitarClassifierModelFile.exists() || guitarClassifierModelFile.length() < 3_000_000L) {
      logger.lifecycle('Downloading official MediaPipe EfficientNet-Lite0 image classifier model...')
      new URL(guitarClassifierModelUrl).withInputStream { input ->
        guitarClassifierModelFile.withOutputStream { output -> output << input }
      }
    }
  }
}

afterEvaluate {
  tasks.named('preBuild').configure {
    dependsOn(tasks.named('downloadHandLandmarkerModel'))
    dependsOn(tasks.named('downloadGuitarObjectModel'))
    dependsOn(tasks.named('downloadGuitarClassifierModel'))
  }
}
""",
)

# 2) Add an isolated local guitar classifier. It runs entirely on the phone.
write(
    MOBILE / "modules/guitar-coach-native/android/src/main/java/expo/modules/guitarcoachnative/LocalGuitarClassifier.kt",
    r'''package expo.modules.guitarcoachnative

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
''',
)

# 3) Extend the existing CameraX stream with facing selection, optional strings, and guitar classification.
continuous = MOBILE / "modules/guitar-coach-native/android/src/main/java/expo/modules/guitarcoachnative/GuitarCoachContinuousCameraModule.kt"
replace_once(
    continuous,
    """      Prop("pickColor", "auto") { view: GuitarCoachContinuousCameraView, pickColor: String ->
        view.setPickColor(pickColor)
      }

      OnViewDestroys""",
    """      Prop("pickColor", "auto") { view: GuitarCoachContinuousCameraView, pickColor: String ->
        view.setPickColor(pickColor)
      }

      Prop("facing", "back") { view: GuitarCoachContinuousCameraView, facing: String ->
        view.setFacing(facing)
      }

      Prop("analyzeStrings", false) { view: GuitarCoachContinuousCameraView, enabled: Boolean ->
        view.setAnalyzeStrings(enabled)
      }

      OnViewDestroys""",
)
replace_once(
    continuous,
    """  private var handLandmarker: HandLandmarker? = null
  private var running = false
  private var destroyed = false
  private var pickColor = "auto"
""",
    """  private var handLandmarker: HandLandmarker? = null
  private val guitarClassifier = LocalGuitarClassifier(context.applicationContext)
  private var running = false
  private var destroyed = false
  private var pickColor = "auto"
  private var facing = "back"
  private var analyzeStrings = false
  private var lastGuitarState = LocalGuitarState.searching()
  private var lastGuitarRefreshFrame = 0L
""",
)
replace_once(
    continuous,
    """  fun setPickColor(value: String) {
    pickColor = value.lowercase()
  }

  override fun onAttachedToWindow()""",
    """  fun setPickColor(value: String) {
    pickColor = value.lowercase()
  }

  fun setFacing(value: String) {
    val normalized = if (value.lowercase() == "front") "front" else "back"
    if (normalized == facing) return
    facing = normalized
    if (running && !destroyed) {
      post {
        stopCamera()
        startCamera()
      }
    }
  }

  fun setAnalyzeStrings(value: Boolean) {
    analyzeStrings = value
    if (!value) {
      lastStringState = null
      consecutiveStringMisses = 0
      previousContacts.clear()
      recentHits.clear()
    }
  }

  override fun onAttachedToWindow()""",
)
replace_once(
    continuous,
    """          CameraSelector.DEFAULT_BACK_CAMERA,
          preview,
          analysis
""",
    """          if (facing == "front") CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA,
          preview,
          analysis
""",
)
replace_once(
    continuous,
    """            "continuous" to true,
            "targetPreviewFps" to 30,
            "autoFraming" to true
""",
    """            "continuous" to true,
            "targetPreviewFps" to 30,
            "autoFraming" to true,
            "facing" to facing,
            "guitarClassifier" to true
""",
)
replace_once(
    continuous,
    """    handLandmarker?.close()
    handLandmarker = null
    analysisExecutor.shutdownNow()
""",
    """    handLandmarker?.close()
    handLandmarker = null
    guitarClassifier.close()
    analysisExecutor.shutdownNow()
""",
)
replace_once(
    continuous,
    """    autoFramingState = "searching"
    spatialResetRequested.set(false)
""",
    """    autoFramingState = "searching"
    lastGuitarState = LocalGuitarState.searching()
    lastGuitarRefreshFrame = 0
    spatialResetRequested.set(false)
""",
)
replace_once(
    continuous,
    """      val hand = lastHandResult
      updateAutoFraming(hand, startedAt)
      if (hand?.hasHand != true) previousContacts.clear()

      val shouldRefreshStrings = lastStringState == null || frameCount - lastStringRefreshFrame >= 3L
      if (shouldRefreshStrings) {
        val detected = detectStrings(bitmap, hand)
        if (detected != null) {
          lastStringState = stabilizeStrings(lastStringState, detected)
          lastStringRefreshFrame = frameCount
          consecutiveStringMisses = 0
        } else {
          consecutiveStringMisses += 1
          if (consecutiveStringMisses >= 2) {
            lastStringState = null
            previousContacts.clear()
          }
        }
      }
""",
    """      val hand = lastHandResult
      updateAutoFraming(hand, startedAt)
      if (hand?.hasHand != true) previousContacts.clear()

      if (lastGuitarRefreshFrame == 0L || frameCount - lastGuitarRefreshFrame >= 8L) {
        lastGuitarState = guitarClassifier.classify(bitmap)
        lastGuitarRefreshFrame = frameCount
      }

      if (analyzeStrings) {
        val shouldRefreshStrings = lastStringState == null || frameCount - lastStringRefreshFrame >= 3L
        if (shouldRefreshStrings) {
          val detected = detectStrings(bitmap, hand)
          if (detected != null) {
            lastStringState = stabilizeStrings(lastStringState, detected)
            lastStringRefreshFrame = frameCount
            consecutiveStringMisses = 0
          } else {
            consecutiveStringMisses += 1
            if (consecutiveStringMisses >= 2) {
              lastStringState = null
              previousContacts.clear()
            }
          }
        }
      } else {
        lastStringState = null
        consecutiveStringMisses = 0
      }
""",
)
replace_once(
    continuous,
    """      "pick" to pick.toMap(),
      "continuous" to mapOf(
""",
    """      "pick" to pick.toMap(),
      "guitar" to lastGuitarState.toMap(),
      "continuous" to mapOf(
""",
)
replace_once(
    continuous,
    """.setMinHandDetectionConfidence(0.42f)
        .setMinHandPresenceConfidence(0.42f)
        .setMinTrackingConfidence(0.38f)
""",
    """.setMinHandDetectionConfidence(0.30f)
        .setMinHandPresenceConfidence(0.30f)
        .setMinTrackingConfidence(0.34f)
""",
)

# 4) JS wrapper types and props.
wrapper = MOBILE / "modules/guitar-coach-continuous-camera/index.tsx"
text = wrapper.read_text(encoding="utf-8")
text = text.replace(
    """export type ContinuousStringHit = QualityStringHit;
export type ContinuousRightHandStats = QualityContinuousStats;
export type ContinuousHandAnalysisResult = QualityContinuousHandResult;
""",
    """export type ContinuousStringHit = QualityStringHit;
export type ContinuousRightHandStats = QualityContinuousStats;
export type LocalGuitarDetection = {
  detected: boolean;
  type: 'acoustic' | 'electric' | 'bass' | 'guitar' | 'unknown' | string;
  label: string;
  confidence: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  modelReady: boolean;
  reason: string;
};
export type ContinuousHandAnalysisResult = QualityContinuousHandResult & {
  guitar: LocalGuitarDetection;
};
""",
)
text = text.replace(
    """  running: boolean;
  pickColor?: string;
  onCameraReady?: (event: NativeEvent<{ continuous: boolean; targetPreviewFps: number }>) => void;
""",
    """  running: boolean;
  pickColor?: string;
  facing?: 'front' | 'back';
  analyzeStrings?: boolean;
  onCameraReady?: (event: NativeEvent<{ continuous: boolean; targetPreviewFps: number; facing?: string; guitarClassifier?: boolean }>) => void;
""",
)
text = text.replace(
    """  running,
  pickColor = 'auto',
  onAnalysis,
  ...props
}: NativeContinuousCameraProps) {
""",
    """  running,
  pickColor = 'auto',
  facing = 'back',
  analyzeStrings = false,
  onAnalysis,
  ...props
}: NativeContinuousCameraProps) {
""",
)
text = text.replace(
    """      pickColor={verifiedPickColor}
      onAnalysis={(event) => {
        const normalized = normalizeResult(event.nativeEvent);
        const qualityChecked = qualityGateRef.current.process(normalized, Date.now());
        const result = fuseAudio(qualityChecked);
""",
    """      pickColor={verifiedPickColor}
      facing={facing}
      analyzeStrings={analyzeStrings}
      onAnalysis={(event) => {
        const normalized = normalizeResult(event.nativeEvent);
        const qualityChecked = qualityGateRef.current.process(normalized, Date.now()) as ContinuousHandAnalysisResult;
        const result = fuseAudio({ ...qualityChecked, guitar: normalized.guitar }) as ContinuousHandAnalysisResult;
""",
)
wrapper.write_text(text, encoding="utf-8")

# 5) Pure voice transition policy with repeat suppression.
write(
    MOBILE / "services/live-recognition-voice-policy.ts",
    r'''export type LiveRecognitionVoiceSnapshot = {
  running: boolean;
  cameraReady: boolean;
  hasHand: boolean;
  handConfidence: number;
  palmSize: number;
  guitarDetected: boolean;
  guitarType: string;
  guitarConfidence: number;
  error?: string;
};

export class LiveRecognitionVoicePolicy {
  private cameraAnnounced = false;
  private handFrames = 0;
  private guitarFrames = 0;
  private handMissFrames = 0;
  private handAnnounced = false;
  private guitarAnnouncedType = '';
  private combinedAnnounced = false;
  private tooSmallFrames = 0;
  private lastPhrase = '';
  private lastSpokenAt = -Infinity;

  reset() {
    this.cameraAnnounced = false;
    this.handFrames = 0;
    this.guitarFrames = 0;
    this.handMissFrames = 0;
    this.handAnnounced = false;
    this.guitarAnnouncedType = '';
    this.combinedAnnounced = false;
    this.tooSmallFrames = 0;
    this.lastPhrase = '';
    this.lastSpokenAt = -Infinity;
  }

  next(snapshot: LiveRecognitionVoiceSnapshot, now = Date.now()): string | null {
    if (!snapshot.running) {
      this.handFrames = 0;
      this.guitarFrames = 0;
      this.handMissFrames = 0;
      this.tooSmallFrames = 0;
      return null;
    }

    if (snapshot.error) {
      return this.emit(`카메라 분석 오류입니다. ${snapshot.error}`, now, 8_000);
    }

    if (snapshot.cameraReady && !this.cameraAnnounced) {
      this.cameraAnnounced = true;
      return this.emit('카메라 분석을 시작합니다.', now, 0);
    }

    const handValid = snapshot.hasHand && snapshot.handConfidence >= 0.25;
    if (handValid) {
      this.handFrames += 1;
      this.handMissFrames = 0;
      this.tooSmallFrames = snapshot.palmSize > 0 && snapshot.palmSize < 0.075
        ? this.tooSmallFrames + 1
        : 0;
    } else {
      this.handFrames = 0;
      this.handMissFrames += 1;
      this.tooSmallFrames = 0;
    }

    const guitarValid = snapshot.guitarDetected && snapshot.guitarConfidence >= 0.14;
    this.guitarFrames = guitarValid ? this.guitarFrames + 1 : 0;

    if (this.handAnnounced && this.handMissFrames >= 14) {
      this.handAnnounced = false;
      this.combinedAnnounced = false;
      this.handMissFrames = 0;
      return this.emit('손이 화면에서 벗어났습니다.', now, 4_500);
    }

    if (this.tooSmallFrames >= 10) {
      this.tooSmallFrames = 0;
      return this.emit('손을 조금 더 가까이 보여 주세요.', now, 8_000);
    }

    if (!this.handAnnounced && this.handFrames >= 3) {
      this.handAnnounced = true;
      if (this.guitarAnnouncedType) {
        this.combinedAnnounced = true;
        return this.emit('손과 기타 인식이 완료되었습니다.', now, 2_000);
      }
      return this.emit('손을 인식했습니다.', now, 2_000);
    }

    if (guitarValid && this.guitarFrames >= 2 && this.guitarAnnouncedType !== snapshot.guitarType) {
      this.guitarAnnouncedType = snapshot.guitarType;
      if (this.handAnnounced) {
        this.combinedAnnounced = true;
        return this.emit('손과 기타 인식이 완료되었습니다.', now, 2_000);
      }
      const label = snapshot.guitarType === 'acoustic'
        ? '통기타'
        : snapshot.guitarType === 'electric'
          ? '일렉기타'
          : snapshot.guitarType === 'bass'
            ? '베이스 기타'
            : '기타';
      return this.emit(`${label}를 인식했습니다.`, now, 2_000);
    }

    if (this.handAnnounced && this.guitarAnnouncedType && !this.combinedAnnounced) {
      this.combinedAnnounced = true;
      return this.emit('손과 기타 인식이 완료되었습니다.', now, 2_000);
    }

    return null;
  }

  private emit(phrase: string, now: number, cooldown: number) {
    if (phrase === this.lastPhrase && now - this.lastSpokenAt < cooldown) return null;
    if (now - this.lastSpokenAt < 1_100) return null;
    this.lastPhrase = phrase;
    this.lastSpokenAt = now;
    return phrase;
  }
}
''',
)
write(
    MOBILE / "tests/live-recognition-voice-policy.test.ts",
    r'''import { strict as assert } from 'node:assert';

import {
  LiveRecognitionVoicePolicy,
  type LiveRecognitionVoiceSnapshot,
} from '../services/live-recognition-voice-policy';

const base: LiveRecognitionVoiceSnapshot = {
  running: true,
  cameraReady: true,
  hasHand: false,
  handConfidence: 0,
  palmSize: 0,
  guitarDetected: false,
  guitarType: 'unknown',
  guitarConfidence: 0,
};

const policy = new LiveRecognitionVoicePolicy();
assert.equal(policy.next(base, 2_000), '카메라 분석을 시작합니다.');
assert.equal(policy.next(base, 2_200), null);

const hand = { ...base, hasHand: true, handConfidence: 0.72, palmSize: 0.16 };
assert.equal(policy.next(hand, 3_200), null);
assert.equal(policy.next(hand, 3_300), null);
assert.equal(policy.next(hand, 3_400), '손을 인식했습니다.');
assert.equal(policy.next(hand, 3_500), null);

const guitar = {
  ...hand,
  guitarDetected: true,
  guitarType: 'acoustic',
  guitarConfidence: 0.66,
};
assert.equal(policy.next(guitar, 5_000), null);
assert.equal(policy.next(guitar, 5_100), '손과 기타 인식이 완료되었습니다.');

for (let index = 0; index < 13; index += 1) {
  assert.equal(policy.next(base, 7_000 + index * 100), null);
}
assert.equal(policy.next(base, 8_300), '손이 화면에서 벗어났습니다.');

policy.reset();
assert.equal(policy.next({ ...base, cameraReady: false }, 10_000), null);
assert.equal(policy.next({ ...base, cameraReady: true }, 11_200), '카메라 분석을 시작합니다.');

console.log('live recognition voice policy tests passed');
''',
)

# 6) New voice-first CameraX screen. Full-body continues to use the existing pose path.
write(
    MOBILE / "components/LiveLocalCoachCamera.tsx",
    r'''import { useCameraPermissions } from 'expo-camera';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { PracticeCategoryId } from '../config/guitar-mode-profiles';
import type { PracticePreset } from '../config/personal-practice-presets';
import ContinuousRightHandCamera, {
  isContinuousRightHandCameraAvailable,
  type ContinuousHandAnalysisResult,
} from '../modules/guitar-coach-continuous-camera';
import {
  isCoachSpeechAvailable,
  prepareCoachSpeechAsync,
  speakCoachPhraseAsync,
  stopCoachSpeechAsync,
} from '../modules/guitar-coach-speech';
import { LiveRecognitionVoicePolicy } from '../services/live-recognition-voice-policy';
import type { MotionSample } from '../services/trajectory-speed-engine';
import FocusCoachCameraV7 from './FocusCoachCameraV7';

type Size = { width: number; height: number };
const HAND_LINKS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const distance = (left: { x: number; y: number }, right: { x: number; y: number }) =>
  Math.hypot(left.x - right.x, left.y - right.y);

function Segment({
  x1,
  y1,
  x2,
  y2,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  return (
    <View
      style={[
        styles.handLine,
        {
          width: length,
          left: (x1 + x2 - length) / 2,
          top: (y1 + y2) / 2,
          transform: [{ rotate: `${Math.atan2(y2 - y1, x2 - x1)}rad` }],
        },
      ]}
    />
  );
}

function HandOverlay({ result, size }: { result: ContinuousHandAnalysisResult | null; size: Size }) {
  if (!result?.hasHand || result.landmarks.length < 21 || size.width <= 0 || size.height <= 0) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {HAND_LINKS.map(([fromIndex, toIndex]) => {
        const from = result.landmarks[fromIndex];
        const to = result.landmarks[toIndex];
        if (!from || !to) return null;
        return (
          <Segment
            key={`${fromIndex}-${toIndex}`}
            x1={from.x * size.width}
            y1={from.y * size.height}
            x2={to.x * size.width}
            y2={to.y * size.height}
          />
        );
      })}
      {result.landmarks.map((point) => (
        <View
          key={point.index}
          style={[
            point.index === 0 ? styles.wristDot : styles.handDot,
            {
              left: point.x * size.width - (point.index === 0 ? 7 : 5),
              top: point.y * size.height - (point.index === 0 ? 7 : 5),
            },
          ]}
        />
      ))}
    </View>
  );
}

function GuitarOverlay({ result, size }: { result: ContinuousHandAnalysisResult | null; size: Size }) {
  const guitar = result?.guitar;
  if (!guitar?.detected || size.width <= 0 || size.height <= 0) return null;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.guitarBox,
        {
          left: guitar.left * size.width,
          top: guitar.top * size.height,
          width: (guitar.right - guitar.left) * size.width,
          height: (guitar.bottom - guitar.top) * size.height,
        },
      ]}
    />
  );
}

function toMotionSample(result: ContinuousHandAnalysisResult, capturedAt: number): MotionSample | null {
  const points = new Map(result.landmarks.map((point) => [point.name, point]));
  const wrist = points.get('wrist');
  const middleMcp = points.get('middleMcp');
  const thumb = points.get('thumbTip');
  const index = points.get('indexTip');
  const middle = points.get('middleTip');
  const ring = points.get('ringTip');
  if (!wrist || !middleMcp || !thumb || !index || !middle || !ring) return null;
  const palmSize = distance(wrist, middleMcp);
  return {
    capturedAt,
    handConfidence: result.handednessScore,
    wristConfidence: clamp(result.handednessScore * Math.min(1, palmSize / 0.08), 0, 1),
    palmSize,
    wristX: wrist.x,
    wristY: wrist.y,
    palmAngleDegrees: Math.atan2(middleMcp.y - wrist.y, middleMcp.x - wrist.x) * 180 / Math.PI,
    thumbX: thumb.x,
    thumbY: thumb.y,
    indexX: index.x,
    indexY: index.y,
    middleX: middle.x,
    middleY: middle.y,
    ringX: ring.x,
    ringY: ring.y,
    pickX: result.pick.detected ? result.pick.centerX : null,
    pickY: result.pick.detected ? result.pick.centerY : null,
    pickConfidence: result.pick.confidence,
  };
}

function pickColor(category: PracticeCategoryId) {
  return category === 'arpeggio' || category === 'fingerstyle' ? 'none' : 'auto';
}

export default function LiveLocalCoachCamera({
  coachingActive,
  category,
  cameraFocus,
  initialFacing = cameraFocus === 'full-body' ? 'front' : 'back',
  voiceEnabled,
  onNeedCalibration,
  onMotionSample,
  onAcceptedFrame,
  onFrameCount,
  onStatus,
  onHandLockChange,
}: {
  coachingActive: boolean;
  category: PracticeCategoryId;
  cameraFocus: PracticePreset['cameraFocus'];
  initialFacing?: 'front' | 'back';
  voiceEnabled: boolean;
  onNeedCalibration?: (facing: 'front' | 'back') => void;
  onMotionSample?: (sample: MotionSample) => void;
  onAcceptedFrame?: () => void;
  onFrameCount?: (count: number) => void;
  onStatus?: (status: string) => void;
  onHandLockChange?: (locked: boolean) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<'front' | 'back'>(initialFacing);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState<ContinuousHandAnalysisResult | null>(null);
  const [error, setError] = useState('');
  const frameRef = useRef(0);
  const validFramesRef = useRef(0);
  const lockedRef = useRef(false);
  const lastAcceptedAtRef = useRef(0);
  const voicePolicyRef = useRef(new LiveRecognitionVoicePolicy());
  const speechReadyRef = useRef(false);
  const speechBusyRef = useRef(false);

  const palmSize = useMemo(() => {
    const wrist = result?.landmarks[0];
    const middleMcp = result?.landmarks[9];
    return wrist && middleMcp ? distance(wrist, middleMcp) : 0;
  }, [result]);

  useEffect(() => {
    setFacing(initialFacing);
  }, [initialFacing]);

  useEffect(() => {
    if (!voiceEnabled || !isCoachSpeechAvailable) {
      speechReadyRef.current = false;
      void stopCoachSpeechAsync();
      return;
    }
    let cancelled = false;
    void prepareCoachSpeechAsync()
      .then(() => {
        if (!cancelled) speechReadyRef.current = true;
      })
      .catch(() => {
        speechReadyRef.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [voiceEnabled]);

  useEffect(() => () => {
    void stopCoachSpeechAsync();
  }, []);

  const announce = (phrase: string | null) => {
    if (!phrase || !voiceEnabled || !speechReadyRef.current || speechBusyRef.current) return;
    speechBusyRef.current = true;
    void speakCoachPhraseAsync(phrase, { interrupt: false, speechRate: 1.02 })
      .catch(() => undefined)
      .finally(() => {
        speechBusyRef.current = false;
      });
  };

  const updateLock = (next: boolean) => {
    if (lockedRef.current === next) return;
    lockedRef.current = next;
    onHandLockChange?.(next);
  };

  if (cameraFocus === 'full-body' || cameraFocus === 'none') {
    return (
      <FocusCoachCameraV7
        coachingActive={coachingActive}
        category={category}
        cameraFocus={cameraFocus}
        initialFacing={initialFacing}
        onNeedCalibration={onNeedCalibration}
        onMotionSample={onMotionSample}
        onAcceptedFrame={onAcceptedFrame}
        onFrameCount={onFrameCount}
        onStatus={onStatus}
        onHandLockChange={onHandLockChange}
      />
    );
  }

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.permissionText}>카메라 권한 확인 중</Text>
      </View>
    );
  }

  if (!permission.granted) {
    const open = async () => {
      if (permission.canAskAgain === false) await Linking.openSettings();
      else await requestPermission();
    };
    return (
      <View style={styles.center}>
        <Text style={styles.permissionTitle}>카메라 권한이 필요합니다</Text>
        <Text style={styles.permissionText}>손과 기타는 서버 전송 없이 휴대폰에서만 인식합니다.</Text>
        <Pressable onPress={() => void open()} style={styles.permissionButton}>
          <Text style={styles.permissionButtonText}>
            {permission.canAskAgain === false ? '휴대폰 설정 열기' : '카메라 허용'}
          </Text>
        </Pressable>
      </View>
    );
  }

  if (!isContinuousRightHandCameraAvailable) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionTitle}>연속 카메라 모듈 판정 불가</Text>
        <Text style={styles.permissionText}>현재 APK에는 CameraX 연속 손 인식 모듈이 없습니다.</Text>
      </View>
    );
  }

  const handReady = Boolean(result?.hasHand && result.landmarks.length >= 21 && result.handednessScore >= 0.25);
  const guitarReady = Boolean(result?.guitar?.detected);
  const guitarLabel = result?.guitar?.label || '기타';
  const status = error
    ? '분석 오류'
    : handReady && guitarReady
      ? '손 · 기타 준비 완료'
      : handReady
        ? '손 인식 완료'
        : guitarReady
          ? `${guitarLabel} 인식 완료`
          : '손과 기타 찾는 중';

  return (
    <View
      style={styles.root}
      onLayout={(event: LayoutChangeEvent) => setSize({
        width: event.nativeEvent.layout.width,
        height: event.nativeEvent.layout.height,
      })}
    >
      <ContinuousRightHandCamera
        style={StyleSheet.absoluteFill}
        running
        facing={facing}
        analyzeStrings={false}
        pickColor={pickColor(category)}
        onCameraReady={() => {
          setReady(true);
          setError('');
          onStatus?.('카메라 연결 완료 · 손과 기타를 독립적으로 찾는 중');
          announce(voicePolicyRef.current.next({
            running: true,
            cameraReady: true,
            hasHand: false,
            handConfidence: 0,
            palmSize: 0,
            guitarDetected: false,
            guitarType: 'unknown',
            guitarConfidence: 0,
          }));
        }}
        onAnalysis={(event) => {
          const next = event.nativeEvent;
          setResult(next);
          frameRef.current += 1;
          onFrameCount?.(frameRef.current);
          const valid = next.hasHand && next.landmarks.length >= 21 && next.handednessScore >= 0.25;
          validFramesRef.current = valid ? Math.min(5, validFramesRef.current + 1) : 0;
          const nextLocked = validFramesRef.current >= 3;
          updateLock(nextLocked);

          if (nextLocked) {
            const capturedAt = Date.now();
            const sample = toMotionSample(next, capturedAt);
            if (sample) onMotionSample?.(sample);
            if (coachingActive && capturedAt - lastAcceptedAtRef.current >= 120) {
              lastAcceptedAtRef.current = capturedAt;
              onAcceptedFrame?.();
            }
          }

          const nextPalm = (() => {
            const wrist = next.landmarks[0];
            const middleMcp = next.landmarks[9];
            return wrist && middleMcp ? distance(wrist, middleMcp) : 0;
          })();
          const nextStatus = nextLocked
            ? next.guitar?.detected
              ? `손과 ${next.guitar.label || '기타'} 인식 완료`
              : '손 단독 인식 완료 · 기타는 별도 확인 중'
            : next.guitar?.detected
              ? `${next.guitar.label || '기타'} 인식 완료 · 손 찾는 중`
              : '손과 기타를 독립적으로 찾는 중';
          onStatus?.(nextStatus);
          announce(voicePolicyRef.current.next({
            running: true,
            cameraReady: ready || true,
            hasHand: next.hasHand,
            handConfidence: next.handednessScore,
            palmSize: nextPalm,
            guitarDetected: Boolean(next.guitar?.detected),
            guitarType: next.guitar?.type ?? 'unknown',
            guitarConfidence: next.guitar?.confidence ?? 0,
          }));
        }}
        onError={(event) => {
          const message = event.nativeEvent.message || '연속 카메라 분석 오류';
          setError(message);
          onStatus?.(`카메라 분석 오류 · ${message}`);
          updateLock(false);
          announce(voicePolicyRef.current.next({
            running: true,
            cameraReady: ready,
            hasHand: false,
            handConfidence: 0,
            palmSize: 0,
            guitarDetected: false,
            guitarType: 'unknown',
            guitarConfidence: 0,
            error: message,
          }));
        }}
      />

      <GuitarOverlay result={result} size={size} />
      <HandOverlay result={result} size={size} />

      <View pointerEvents="none" style={styles.topStatus}>
        <View style={[styles.largeBadge, handReady ? styles.goodBadge : styles.waitBadge]}>
          <Text style={styles.badgeIcon}>{handReady ? '✓' : '○'}</Text>
          <Text style={styles.badgeText}>{handReady ? '손' : '손 찾는 중'}</Text>
        </View>
        <View style={[styles.largeBadge, guitarReady ? styles.goodBadge : styles.waitBadge]}>
          <Text style={styles.badgeIcon}>{guitarReady ? '✓' : '○'}</Text>
          <Text style={styles.badgeText}>{guitarReady ? guitarLabel : '기타 찾는 중'}</Text>
        </View>
      </View>

      <View pointerEvents="none" style={styles.voiceStatus}>
        <Text style={styles.voiceStatusText}>{voiceEnabled ? '🔊 음성 안내' : '음성 꺼짐'}</Text>
        <Text style={styles.mainStatus}>{status}</Text>
      </View>

      <Pressable
        onPress={() => {
          setFacing((current) => current === 'back' ? 'front' : 'back');
          setResult(null);
          setReady(false);
          setError('');
          validFramesRef.current = 0;
          updateLock(false);
          voicePolicyRef.current.reset();
        }}
        style={styles.switchButton}
      >
        <Text style={styles.switchText}>전후면</Text>
      </Pressable>

      {onNeedCalibration ? (
        <Pressable onPress={() => onNeedCalibration(facing)} style={styles.manualButton}>
          <Text style={styles.manualText}>수동 보정</Text>
        </Pressable>
      ) : null}

      {error ? (
        <View pointerEvents="none" style={styles.errorBox}>
          <Text style={styles.errorText}>현재 판정 불가</Text>
        </View>
      ) : null}

      {!ready ? (
        <View pointerEvents="none" style={styles.loading}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>카메라 연결 중</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000', overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0d1117', padding: 24 },
  permissionTitle: { color: '#ffffff', fontSize: 20, fontWeight: '900', textAlign: 'center' },
  permissionText: { color: '#b1bac4', fontSize: 12, lineHeight: 19, textAlign: 'center', marginTop: 8 },
  permissionButton: { minHeight: 50, borderRadius: 14, backgroundColor: '#238636', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, marginTop: 18 },
  permissionButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  handLine: { position: 'absolute', height: 4, borderRadius: 2, backgroundColor: 'rgba(126,231,135,0.95)', zIndex: 20 },
  handDot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: '#7ee787', borderWidth: 2, borderColor: '#ffffff', zIndex: 22 },
  wristDot: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#ff7b72', borderWidth: 2, borderColor: '#ffffff', zIndex: 22 },
  guitarBox: { position: 'absolute', borderWidth: 4, borderColor: '#58a6ff', borderRadius: 22, backgroundColor: 'rgba(88,166,255,0.04)', zIndex: 15 },
  topStatus: { position: 'absolute', left: 12, right: 12, top: 12, flexDirection: 'row', gap: 9, zIndex: 40 },
  largeBadge: { flex: 1, minHeight: 58, borderRadius: 17, borderWidth: 3, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 8 },
  goodBadge: { backgroundColor: 'rgba(22,101,52,0.92)', borderColor: '#7ee787' },
  waitBadge: { backgroundColor: 'rgba(32,36,45,0.90)', borderColor: '#f2cc60' },
  badgeIcon: { color: '#ffffff', fontSize: 22, fontWeight: '900' },
  badgeText: { color: '#ffffff', fontSize: 16, fontWeight: '900' },
  voiceStatus: { position: 'absolute', left: 12, right: 12, bottom: 78, borderRadius: 16, backgroundColor: 'rgba(13,17,23,0.90)', borderWidth: 2, borderColor: '#30363d', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, zIndex: 40 },
  voiceStatusText: { color: '#79c0ff', fontSize: 12, fontWeight: '900' },
  mainStatus: { color: '#ffffff', fontSize: 15, fontWeight: '900', marginTop: 3, textAlign: 'center' },
  switchButton: { position: 'absolute', right: 12, bottom: 14, minWidth: 86, minHeight: 50, borderRadius: 15, backgroundColor: 'rgba(13,17,23,0.94)', borderWidth: 2, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  switchText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  manualButton: { position: 'absolute', left: 12, bottom: 14, minWidth: 96, minHeight: 50, borderRadius: 15, backgroundColor: 'rgba(13,17,23,0.94)', borderWidth: 2, borderColor: '#6e7681', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  manualText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  errorBox: { position: 'absolute', left: '25%', right: '25%', top: '45%', minHeight: 52, borderRadius: 15, backgroundColor: 'rgba(177,35,36,0.94)', alignItems: 'center', justifyContent: 'center', zIndex: 60 },
  errorText: { color: '#ffffff', fontSize: 16, fontWeight: '900' },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)', zIndex: 70 },
  loadingText: { color: '#ffffff', fontSize: 14, fontWeight: '900', marginTop: 10 },
});
''',
)

# 7) Use the live local camera and stop forcing calibration before practice.
runner = MOBILE / "components/PracticeSessionRunnerV8.tsx"
replace_once(
    runner,
    """import FocusCoachCameraV7, {
  clearFocusV7RightHandRegion,
  loadFocusV7RightHandRegion,
} from './FocusCoachCameraV7';
""",
    """import FocusCoachCameraV7, {
  clearFocusV7RightHandRegion,
  loadFocusV7RightHandRegion,
} from './FocusCoachCameraV7';
import LiveLocalCoachCamera from './LiveLocalCoachCamera';
""",
)
replace_once(
    runner,
    """      if (!preset || preset.cameraFocus !== 'right-hand') {
        if (!cancelled) {
          setCalibrationReady(true);
          setCalibrationChecked(true);
        }
        return;
      }
      try {
        await prepareFocusV8CalibrationStorage();
        const stored = await loadFocusV7RightHandRegion(cameraFacing);
        if (cancelled) return;
        setCalibrationReady(Boolean(stored));
        setCalibrationVisible(!stored);
        setCalibrationChecked(true);
      } catch {
        if (cancelled) return;
        setCalibrationReady(false);
        setCalibrationVisible(true);
        setCalibrationChecked(true);
      }
""",
    """      if (!preset || preset.cameraFocus !== 'right-hand') {
        if (!cancelled) {
          setCalibrationReady(true);
          setCalibrationChecked(true);
        }
        return;
      }
      // The CameraX live path recognizes the hand without requiring a guitar ROI.
      // Manual calibration remains available as an optional fallback button.
      if (!cancelled) {
        setCalibrationReady(true);
        setCalibrationVisible(false);
        setCalibrationChecked(true);
      }
""",
)
replace_once(
    runner,
    """    if (preset.cameraFocus === 'right-hand' && !calibrationReady) {
      setCalibrationVisible(true);
      return;
    }
""",
    """""",
)
replace_once(
    runner,
    """                <FocusCoachCameraV7
                  coachingActive={running}
                  category={preset.category}
                  cameraFocus={preset.cameraFocus}
                  initialFacing={cameraFacing}
""",
    """                <LiveLocalCoachCamera
                  coachingActive={running}
                  category={preset.category}
                  cameraFocus={preset.cameraFocus}
                  initialFacing={cameraFacing}
                  voiceEnabled={voiceCoachEnabled}
""",
)
runner.write_text(runner.read_text(encoding="utf-8").replace("FOCUS V9 · v24", "FOCUS LIVE · v25", 1), encoding="utf-8")

# 8) Lift bottom navigation away from Samsung's system navigation buttons.
shell = MOBILE / "CompleteBetaAppV060Plus.tsx"
replace_once(
    shell,
    """    paddingBottom: Platform.OS === 'android' ? 30 : 10,
""",
    """    paddingBottom: Platform.OS === 'android' ? 48 : 10,
""",
)

# 9) Add tests to the existing strict quality command and increment only the test APK version code.
package_path = MOBILE / "package.json"
package_data = json.loads(package_path.read_text(encoding="utf-8"))
quality = package_data["scripts"]["quality:analysis"]
quality = quality.replace(
    "services/hand-string-analysis-policy.ts ",
    "services/hand-string-analysis-policy.ts services/live-recognition-voice-policy.ts ",
)
quality = quality.replace(
    "tests/hand-string-analysis-policy.test.ts &&",
    "tests/hand-string-analysis-policy.test.ts tests/live-recognition-voice-policy.test.ts &&",
)
quality += " && node .quality-dist/tests/live-recognition-voice-policy.test.js"
package_data["scripts"]["quality:analysis"] = quality
package_path.write_text(json.dumps(package_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

app_json = MOBILE / "app.json"
app = json.loads(app_json.read_text(encoding="utf-8"))
app["expo"]["android"]["versionCode"] = 25
app_json.write_text(json.dumps(app, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

diagnostics = MOBILE / "DiagnosticRootApp.tsx"
replace_once(diagnostics, "versionCode: 24,", "versionCode: 25,")
replace_once(
    diagnostics,
    """      focusScreen: 'V9-automatic-guitar-localization',
      automaticGuitarLocalization: true,
""",
    """      focusScreen: 'CameraX-live-local-recognition',
      automaticGuitarLocalization: false,
      continuousLocalHandRecognition: true,
      localGuitarImageClassifier: true,
      voiceFirstRecognition: true,
""",
)

print("Applied CameraX live hand + local guitar + voice-first UI patch")
