from pathlib import Path
import re


def sub_once(path: str, pattern: str, replacement: str, label: str):
    file = Path(path)
    text = file.read_text()
    next_text, count = re.subn(pattern, lambda _: replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    file.write_text(next_text)


hand_index = 'mobile/modules/guitar-coach-hand/index.ts'
sub_once(
    hand_index,
    r"import \{ effectiveHandDetailSize, hasUsableHandDetail, type HandPrecisionPayload \} from '../../services/hand-precision-region';\n",
    "import { effectiveHandDetailSize, hasUsableHandDetail, type HandPrecisionPayload } from '../../services/hand-precision-region';\nimport { shouldRefreshStringVision } from '../../services/hand-string-analysis-policy';\n",
    'hand policy import',
)
sub_once(
    hand_index,
    r"function shouldPublishForCoach\(result: HandAnalysisResult, pickColor: PickColor\) \{.*?\n\}\n\nfunction buildStringRegion",
    """function shouldPublishForCoach(result: HandAnalysisResult, _pickColor: PickColor) {
  const context = getLivePracticeContext();
  if (!context?.active) return true;
  if (!result.hasHand) return true;

  const leftHandCategory = context.category === 'chords'
    || context.category === 'fingering'
    || context.category === 'powerChords'
    || context.category === 'scales'
    || context.category === 'leadTechnique';

  if (leftHandCategory) return hasUsableHandDetail(result);
  return result.landmarks.length >= 21 && result.handednessScore >= 0.24;
}

function buildStringRegion""",
    'coach publication policy',
)
sub_once(
    hand_index,
    r"  const shouldRefresh = options\.refreshStringVision !== false\s*\|\| !cachedStringTracking\s*\|\| now - cachedStringTracking\.capturedAt > reuseMs;",
    """  const shouldRefresh = shouldRefreshStringVision({
    requested: options.refreshStringVision,
    cachedAt: cachedStringTracking?.capturedAt,
    now,
    reuseMs,
  });""",
    'string refresh policy',
)

camera = 'mobile/components/SessionCoachCamera.tsx'
sub_once(
    camera,
    r"        const refreshStringVision = handFrameIndexRef\.current === 1\s*\|\| handFrameIndexRef\.current % analysisProfile\.stringVisionEveryFrames === 0;",
    """        const refreshStringVision =
          handFrameIndexRef.current % analysisProfile.stringVisionEveryFrames === 0;""",
    'hand-first frame schedule',
)
sub_once(
    camera,
    r"          quality: activeMode === 'full'\s*\? 0\.30\s*: facing === 'front'\s*\? Math\.max\(0\.60, analysisProfile\.photoQuality\)\s*: analysisProfile\.photoQuality,",
    """          quality: activeMode === 'full'
            ? facing === 'front' ? 0.58 : 0.48
            : facing === 'front'
              ? Math.max(0.64, analysisProfile.photoQuality)
              : Math.max(0.52, analysisProfile.photoQuality),""",
    'camera quality',
)
sub_once(
    camera,
    r"      : size < 0\.13\s*\? '손이 작습니다 · 카메라 가까이'\s*: size > 0\.68\s*\? '손가락 끝이 잘립니다 · 조금 멀리'\s*: `손 추적 \$\{Math\.round\(handResult\.handednessScore \* 100\)\}%\$\{precisionApplied \? ' · ROI 2차 정밀' : ''\}`;",
    """      : size < 0.105
        ? '손이 작습니다 · 카메라 가까이'
        : size > 0.68
          ? '손가락 끝이 잘립니다 · 조금 멀리'
          : `손 추적 ${Math.round(handResult.handednessScore * 100)}%${precisionApplied ? ' · ROI 정밀' : ''}${handResult.stringTracking?.detected ? ' · 기타 줄 연결' : ' · 손 단독 인식'}`;""",
    'hand-only status',
)
sub_once(
    camera,
    r"        \{activeMode !== 'full' && handResult\?\.hasHand \? \(\s*<Text style=\{styles\.statusText\}>\s*\{handResult\.handedness\} · 관절 \{handResult\.landmarks\.length\}개 · 처리 \{Math\.round\(handResult\.latencyMs\)\}ms\s*</Text>\s*\) : null\}",
    """        {handResult?.hasHand ? (
          <Text style={styles.statusText}>
            {handStatus} · {handResult.handedness} · 관절 {handResult.landmarks.length}개 · 처리 {Math.round(handResult.latencyMs)}ms
          </Text>
        ) : null}""",
    'full-mode hand status',
)

kotlin = 'mobile/modules/guitar-coach-native/android/src/main/java/expo/modules/guitarcoachnative/GuitarCoachHandModule.kt'
sub_once(
    kotlin,
    r"        val safeRegion = requestedRegion\?\.normalized\(\)\s*val first = detectPass\(decoded, safeRegion, pickColor\)\s*var selected = first",
    """        val safeRegion = requestedRegion?.normalized()
        val initial = detectPass(decoded, safeRegion, pickColor)
        val reacquired = if (automaticPrecision && safeRegion == null && !initial.hasHand) {
          reacquireHand(decoded, pickColor)
        } else null
        val first = reacquired ?: initial
        var selected = first""",
    'native initial hand pass',
)
sub_once(
    kotlin,
    r"        \} else \{\s*val initialDecision = decidePrecisionRegion\(first\)\s*precisionPayload\(\s*applied = false,\s*passes = 1,\s*reason = initialDecision\.reason,\s*sourcePalmSize = initialDecision\.sourcePalmSize,\s*sourceEdgeMargin = initialDecision\.sourceEdgeMargin,\s*region = initialDecision\.region\s*\)\s*\}",
    """        } else if (reacquired != null) {
          precisionPayload(
            applied = true,
            passes = 2,
            reason = "multi-region-reacquired",
            sourcePalmSize = palmSize(first.landmarks),
            sourceEdgeMargin = edgeMargin(first.landmarks),
            region = first.region
          )
        } else {
          val initialDecision = decidePrecisionRegion(first)
          precisionPayload(
            applied = false,
            passes = 1,
            reason = initialDecision.reason,
            sourcePalmSize = initialDecision.sourcePalmSize,
            sourceEdgeMargin = initialDecision.sourceEdgeMargin,
            region = initialDecision.region
          )
        }""",
    'native precision payload',
)
sub_once(
    kotlin,
    r'passes = 2,\s*reason = "reacquired-and-refined",',
    'passes = if (reacquired != null) 3 else 2,\n                reason = "reacquired-and-refined",',
    'refined pass count',
)
sub_once(
    kotlin,
    r'passes = 2,\s*reason = decision\.reason,',
    'passes = if (reacquired != null) 3 else 2,\n                reason = decision.reason,',
    'fallback pass count',
)

reacquire = """  private fun reacquireHand(
    originalBitmap: Bitmap,
    pickColor: String
  ): DetectionPass? {
    val regions = listOf(
      NormalizedRegion(0.08, 0.08, 0.92, 0.92),
      NormalizedRegion(0.00, 0.04, 0.66, 0.96),
      NormalizedRegion(0.34, 0.04, 1.00, 0.96),
      NormalizedRegion(0.10, 0.28, 0.90, 1.00)
    )
    var best: DetectionPass? = null
    var bestScore = 0.0

    for (region in regions) {
      val candidate = detectPass(originalBitmap, region.normalized(), pickColor)
      if (!candidate.hasHand || candidate.landmarks.size < 21 || candidate.handednessScore < 0.24) continue
      val detail = (palmSize(candidate.landmarks) / 0.14).coerceIn(0.0, 1.0)
      val score = candidate.handednessScore * 0.78 + detail * 0.22
      if (score > bestScore) {
        best = candidate
        bestScore = score
      }
      if (candidate.handednessScore >= 0.72 && detail >= 0.58) break
    }
    return best
  }

"""
sub_once(
    kotlin,
    r"  private fun decidePrecisionRegion\(pass: DetectionPass\): PrecisionDecision \{",
    reacquire + '  private fun decidePrecisionRegion(pass: DetectionPass): PrecisionDecision {',
    'native reacquisition function',
)
sub_once(kotlin, r'\.setMinHandDetectionConfidence\(0\.38f\)', '.setMinHandDetectionConfidence(0.30f)', 'detection threshold')
sub_once(kotlin, r'\.setMinHandPresenceConfidence\(0\.38f\)', '.setMinHandPresenceConfidence(0.30f)', 'presence threshold')
sub_once(kotlin, r'\.setMinTrackingConfidence\(0\.42f\)', '.setMinTrackingConfidence(0.35f)', 'tracking threshold')

chord_engine = 'mobile/services/fretboard-chord-engine.ts'
sub_once(
    chord_engine,
    r"  const candidateAllowed = Boolean\(best && best\.total >= 0\.62 && best\.matched >= 2 && margin >= 0\.06\);",
    """  const minimumMatched = best ? Math.max(2, best.expectedCount - 1) : 2;
  const candidateAllowed = Boolean(best && best.total >= 0.68 && best.matched >= minimumMatched && margin >= 0.10);""",
    'strict chord candidate gate',
)

print('Patch applied successfully.')
