from pathlib import Path
import json


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"missing marker in {path}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


# v28 APK identity.
app_path = Path("mobile/app.json")
app = json.loads(app_path.read_text(encoding="utf-8"))
app["expo"]["android"]["versionCode"] = 28
app_path.write_text(json.dumps(app, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Do not force every automatic pick to green.
replace_once(
    "mobile/modules/guitar-coach-continuous-camera/index.tsx",
    "  const verifiedPickColor = pickColor === 'auto' ? 'green' : pickColor;",
    "  const verifiedPickColor = pickColor;",
)

# A handedness classification score is not a hand-presence score.
replace_once(
    "mobile/components/LiveLocalCoachCamera.tsx",
    """  const palmSize = distance(wrist, middleMcp);
  return {
    capturedAt,
    handConfidence: result.handednessScore,
    wristConfidence: clamp(result.handednessScore * Math.min(1, palmSize / 0.08), 0, 1),""",
    """  const palmSize = distance(wrist, middleMcp);
  const handPresenceConfidence = result.hasHand && result.landmarks.length >= 21
    ? Math.max(0.65, result.handednessScore)
    : 0;
  return {
    capturedAt,
    handConfidence: handPresenceConfidence,
    wristConfidence: clamp(handPresenceConfidence * Math.min(1, palmSize / 0.055), 0, 1),""",
)
replace_once(
    "mobile/components/LiveLocalCoachCamera.tsx",
    "  const handReady = Boolean(result?.hasHand && result.landmarks.length >= 21 && result.handednessScore >= 0.25);",
    "  const handReady = Boolean(result?.hasHand && result.landmarks.length >= 21);",
)
replace_once(
    "mobile/components/LiveLocalCoachCamera.tsx",
    "          const valid = next.hasHand && next.landmarks.length >= 21 && next.handednessScore >= 0.20;",
    "          const valid = next.hasHand && next.landmarks.length >= 21;",
)
replace_once(
    "mobile/components/LiveLocalCoachCamera.tsx",
    "            handConfidence: next.handednessScore,",
    "            handConfidence: next.hasHand && next.landmarks.length >= 21\n              ? Math.max(0.65, next.handednessScore)\n              : 0,",
)

# Native CameraX search, hand, string and hit sensitivity.
native_path = "mobile/modules/guitar-coach-native/android/src/main/java/expo/modules/guitarcoachnative/GuitarCoachContinuousCameraModule.kt"
replace_once(
    native_path,
    """  private var noHandFrames = 0
  private var autoFramingState = \"searching\"""",
    """  private var noHandFrames = 0
  private var searchZoomIndex = 0
  private var autoFramingState = \"searching\"""",
)
replace_once(
    native_path,
    """    noHandFrames = 0
    autoFramingState = \"searching\"""",
    """    noHandFrames = 0
    searchZoomIndex = 0
    autoFramingState = \"searching\"""",
)
replace_once(
    native_path,
    "      val shouldRefreshHand = lastHandResult == null || frameCount % 2L == 1L",
    "      val shouldRefreshHand = lastHandResult?.hasHand != true || frameCount % 2L == 1L",
)
replace_once(
    native_path,
    "        val shouldRefreshStrings = lastStringState == null || frameCount - lastStringRefreshFrame >= 3L",
    "        val shouldRefreshStrings = lastStringState == null || frameCount - lastStringRefreshFrame >= 2L",
)
replace_once(
    native_path,
    """            if (consecutiveStringMisses >= 2) {
              lastStringState = null
              previousContacts.clear()
            }""",
    """            if (consecutiveStringMisses >= 5 && startedAt >= strumLockUntilMs) {
              lastStringState = null
              previousContacts.clear()
            }""",
)
replace_once(
    native_path,
    """    if (hand?.hasHand != true || hand.landmarks.size < 21) {
      noHandFrames += 1
      autoFramingState = \"searching\"
      if (
        noHandFrames >= 12
        && now - lastAutoFrameAdjustmentAt >= 850
        && currentZoomRatio > minZoom * 1.04f
      ) {
        requestZoom(
          (currentZoomRatio * 0.82f).coerceAtLeast(minZoom),
          now,
          \"searching\"
        )
      }
      return
    }

    noHandFrames = 0""",
    """    if (hand?.hasHand != true || hand.landmarks.size < 21) {
      noHandFrames += 1
      autoFramingState = \"searching\"
      if (noHandFrames >= 8 && now - lastAutoFrameAdjustmentAt >= 650) {
        val searchTargets = listOf(
          minZoom,
          (minZoom * 1.22f).coerceAtMost(maxZoom),
          (minZoom * 1.48f).coerceAtMost(maxZoom)
        ).distinctBy { (it * 100).roundToInt() }
        if (searchTargets.isNotEmpty()) {
          searchZoomIndex = (searchZoomIndex + 1) % searchTargets.size
          requestZoom(searchTargets[searchZoomIndex], now, \"searching\")
        }
      }
      return
    }

    noHandFrames = 0
    searchZoomIndex = 0""",
)
replace_once(native_path, ".setMinHandDetectionConfidence(0.20f)", ".setMinHandDetectionConfidence(0.12f)")
replace_once(native_path, ".setMinHandPresenceConfidence(0.20f)", ".setMinHandPresenceConfidence(0.12f)")
replace_once(native_path, ".setMinTrackingConfidence(0.24f)", ".setMinTrackingConfidence(0.16f)")
replace_once(native_path, "          if (edge >= 4.5) {", "          if (edge >= 3.2) {")
replace_once(native_path, "          if (average > profileMean * 1.08) {", "          if (average > profileMean * 1.04) {")
replace_once(native_path, "            val coverage = strengths.count { it >= profileMean * 1.04 } / 6.0", "            val coverage = strengths.count { it >= profileMean * 1.015 } / 6.0")
replace_once(native_path, "            if (coverage >= 0.66 && regularity >= 0.32) {", "            if (coverage >= 0.50 && regularity >= 0.24) {")
replace_once(native_path, "    if (candidate.confidence < 0.26) return null", "    if (candidate.confidence < 0.18) return null")
replace_once(
    native_path,
    """    val spacing = averageLineSpacing(strings.lines).coerceAtLeast(0.004)
    val points = ArrayList<Triple<String, String, Pair<Double, Double>>>()""",
    """    val spacing = averageLineSpacing(strings.lines).coerceAtLeast(0.004)
    val handPresenceConfidence = if (hand.hasHand && hand.landmarks.size >= 21) {
      max(0.58, hand.score)
    } else {
      hand.score
    }
    val points = ArrayList<Triple<String, String, Pair<Double, Double>>>()""",
)
replace_once(native_path, "      val visual = if (nearest != null && distance <= 1.46) nearest.visualIndex else 0", "      val visual = if (nearest != null && distance <= 1.75) nearest.visualIndex else 0")
replace_once(native_path, "        && distance <= 0.92", "        && distance <= 1.05")
replace_once(native_path, "        && strings.confidence >= 0.34", "        && strings.confidence >= 0.24")
replace_once(native_path, "        && strings.numberingConfidence >= 0.50", "        && strings.numberingConfidence >= 0.40")
replace_once(native_path, "        hand.score * 0.34 +", "        handPresenceConfidence * 0.34 +")
replace_once(native_path, "        val approachedLine = previous.distanceRatio > 0.70 && contact.distanceRatio <= 0.48", "        val approachedLine = previous.distanceRatio > 0.86 && contact.distanceRatio <= 0.72")
replace_once(native_path, "        val fastEnough = contact.speed >= 0.10", "        val fastEnough = contact.speed >= 0.065")
replace_once(native_path, "            contact.y > previous.y + 0.004 -> \"down\"", "            contact.y > previous.y + 0.0025 -> \"down\"")
replace_once(native_path, "            contact.y < previous.y - 0.004 -> \"up\"", "            contact.y < previous.y - 0.0025 -> \"up\"")

# Quality gate must preserve valid landmarks even when handedness is ambiguous.
quality_path = "mobile/services/continuous-tracking-quality.ts"
replace_once(quality_path, "  if (Math.abs(left.angleDegrees - right.angleDegrees) > 6.5) return false;", "  if (Math.abs(left.angleDegrees - right.angleDegrees) > 10) return false;")
replace_once(quality_path, "  if (ratio > 1.42) return false;", "  if (ratio > 1.70) return false;")
replace_once(quality_path, "  return distance(leftCenter, rightCenter) <= Math.max(leftGeometry.spacingMean, rightGeometry.spacingMean) * 1.35;", "  return distance(leftCenter, rightCenter) <= Math.max(leftGeometry.spacingMean, rightGeometry.spacingMean) * 2.0;")
replace_once(quality_path, "  const marginX = Math.max(0.04, (right - left) * 0.15);", "  const marginX = Math.max(0.08, (right - left) * 0.22);")
replace_once(quality_path, "  const marginY = Math.max(0.04, (bottom - top) * 0.22);", "  const marginY = Math.max(0.08, (bottom - top) * 0.30);")
replace_once(
    quality_path,
    "  if (!next.hasHand || next.landmarks.length < 21 || next.handednessScore < 0.20) {",
    "  if (!next.hasHand || next.landmarks.length < 21) {",
)
replace_once(
    quality_path,
    """  const stability = clamp(
    compatible.length / 4 * 0.38
      + (1 - clamp(wristSpread / 0.055, 0, 1)) * 0.34
      + next.handednessScore * 0.28,""",
    """  const geometryConfidence = clamp(palmSize(next) / 0.055, 0.35, 1);
  const stability = clamp(
    compatible.length / 4 * 0.38
      + (1 - clamp(wristSpread / 0.055, 0, 1)) * 0.34
      + geometryConfidence * 0.28,""",
)
replace_once(quality_path, "  if (tracking.confidence < 0.28 || !roiMatchesCurrentHand(tracking, hand)) {", "  if (tracking.confidence < 0.18 || !roiMatchesCurrentHand(tracking, hand)) {")
replace_once(quality_path, "    || geometry.spacingVariation > 0.38", "    || geometry.spacingVariation > 0.52")
replace_once(quality_path, "    || geometry.angleVariation > 5.5", "    || geometry.angleVariation > 10")
replace_once(quality_path, "  if (lines.length < 5 || stability < 0.43) {", "  if (lines.length < 5 || stability < 0.30) {")
replace_once(quality_path, "      visibleLineCount: lines.filter((line) => line.strength >= 0.28).length,", "      visibleLineCount: lines.filter((line) => line.strength >= 0.20).length,")
replace_once(
    quality_path,
    """  const spacing = Math.max(0.004, averageLineSpacing(tracking.lines));
  const points: Array<{""",
    """  const spacing = Math.max(0.004, averageLineSpacing(tracking.lines));
  const handPresenceConfidence = hand.hasHand && hand.landmarks.length >= 21
    ? Math.max(0.58, hand.handednessScore)
    : 0;
  const points: Array<{""",
)
for finger in ("thumb", "index", "middle", "ring", "pinky"):
    replace_once(
        quality_path,
        f"sourceConfidence: hand.handednessScore }},\n    {{ id: '{finger if finger != 'thumb' else 'index'}'" if False else "__never__",
        "__never__",
    )
# Explicit replacements avoid accidental changes to pick confidence.
for old in [
    "{ id: 'thumb', label: 'P', point: hand.landmarks[4] ?? null, sourceConfidence: hand.handednessScore },",
    "{ id: 'index', label: 'i', point: hand.landmarks[8] ?? null, sourceConfidence: hand.handednessScore },",
    "{ id: 'middle', label: 'm', point: hand.landmarks[12] ?? null, sourceConfidence: hand.handednessScore },",
    "{ id: 'ring', label: 'a', point: hand.landmarks[16] ?? null, sourceConfidence: hand.handednessScore },",
    "{ id: 'pinky', label: '새끼', point: hand.landmarks[20] ?? null, sourceConfidence: hand.handednessScore },",
]:
    replace_once(quality_path, old, old.replace("hand.handednessScore", "handPresenceConfidence"))
replace_once(quality_path, "    const visualIndex: 0 | GuitarStringNumber = distanceRatio <= 1.42 ? nearest.line.visualIndex : 0;", "    const visualIndex: 0 | GuitarStringNumber = distanceRatio <= 1.72 ? nearest.line.visualIndex : 0;")
replace_once(quality_path, "    const stringNumber: 0 | GuitarStringNumber = distanceRatio <= 0.90", "    const stringNumber: 0 | GuitarStringNumber = distanceRatio <= 1.08")
replace_once(quality_path, "      && tracking.confidence >= 0.36", "      && tracking.confidence >= 0.24")
replace_once(quality_path, "      && (tracking.stabilityConfidence ?? 0) >= 0.40", "      && (tracking.stabilityConfidence ?? 0) >= 0.28")
replace_once(quality_path, "      && tracking.numberingConfidence >= 0.54", "      && tracking.numberingConfidence >= 0.40")
replace_once(quality_path, "    const proximity = clamp(1 - distanceRatio / 1.45, 0, 1);", "    const proximity = clamp(1 - distanceRatio / 1.75, 0, 1);")
replace_once(quality_path, "        || contact.distanceRatio > 0.96", "        || contact.distanceRatio > 1.24")
replace_once(quality_path, "        || contact.confidence < 0.38", "        || contact.confidence < 0.24")
replace_once(quality_path, "      if (confidence < 0.44) {", "      if (confidence < 0.30) {")

# Regression: low handedness certainty must not erase a valid 21-landmark hand.
test_path = "mobile/tests/continuous-tracking-quality.test.ts"
replace_once(
    test_path,
    """  offsetX?: number;
  offsetY?: number;
}): QualityContinuousHandResult {""",
    """  offsetX?: number;
  offsetY?: number;
  handednessScore?: number;
}): QualityContinuousHandResult {""",
)
replace_once(
    test_path,
    "    handednessScore: hasHand ? 0.93 : 0,",
    "    handednessScore: hasHand ? (input.handednessScore ?? 0.93) : 0,",
)
replace_once(
    test_path,
    """const reacquired = gate.process(result({ frame: 6 }), 1_420);
assert(!reacquired.stringTracking, '손을 다시 잡은 첫 프레임에서 과거 줄 상태를 재사용하면 안 됩니다.');

console.log('continuous-tracking quality gate: 13 checks passed');""",
    """const reacquired = gate.process(result({ frame: 6 }), 1_420);
assert(!reacquired.stringTracking, '손을 다시 잡은 첫 프레임에서 과거 줄 상태를 재사용하면 안 됩니다.');

const ambiguousHandGate = new ContinuousTrackingQualityGate();
const ambiguousHand = ambiguousHandGate.process(result({ frame: 1, handednessScore: 0.05 }), 5_000);
assert(ambiguousHand.hasHand, '손잡이 방향 점수가 낮아도 21개 랜드마크가 있으면 손을 유지해야 합니다.');
assert((ambiguousHand.continuous.qualityGate?.handStability ?? 0) > 0, '방향 점수 대신 손 기하로 안정도를 계산해야 합니다.');

console.log('continuous-tracking quality gate: 15 checks passed');""",
)
