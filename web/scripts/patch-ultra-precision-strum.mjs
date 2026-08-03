import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Ultra-precision patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Ultra-precision patch target is ambiguous: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const centerPath = resolve(process.cwd(), 'src/DebugCenter.jsx');
let center = readFileSync(centerPath, 'utf8');
if (center.includes('bandStabilizerRef')) {
  console.log('Ultra-precision strum stabilization already applied.');
  process.exit(0);
}

center = replaceOnce(
  center,
  "import { GuidedHandRoleResolver, StrumGuideCalibrator, estimateStrumContactPoint, evaluateStrumGuidePoint } from './strum-coach.js';",
  "import { GuidedHandRoleResolver, StringBandStabilizer, StrumGuideCalibrator, estimateStrumContactPoint, evaluateStrumGuidePoint } from './strum-coach.js';",
  'precision imports',
);
center = replaceOnce(
  center,
  "  pickPoint: null,\n  strumGuide: null,",
  "  pickPoint: null,\n  contactQuality: 0,\n  contactStable: false,\n  lastStrokeQuality: null,\n  strumGuide: null,",
  'precision vision state',
);
center = replaceOnce(
  center,
  "  const handRoleRef = useRef(new GuidedHandRoleResolver());\n  const guideRef = useRef(new StrumGuideCalibrator());",
  "  const handRoleRef = useRef(new GuidedHandRoleResolver());\n  const guideRef = useRef(new StrumGuideCalibrator());\n  const bandStabilizerRef = useRef(new StringBandStabilizer());",
  'precision refs',
);
center = replaceOnce(
  center,
  `  const canCountGuidedStrum = (evidence) => canCountStrum(evidence)
    && Boolean(evidence.strumGuide?.ready)
    && Boolean(evidence.guideStatus?.inside);`,
  `  const canCountGuidedStrum = (evidence) => canCountStrum(evidence)
    && evidence.stringBand?.stable === true
    && Boolean(evidence.contactStable)
    && Number(evidence.contactQuality || 0) >= 0.48
    && Boolean(evidence.strumGuide?.ready)
    && Boolean(evidence.guideStatus?.inside);`,
  'precision count gate',
);
center = replaceOnce(
  center,
  "    if (!evidence.strumGuide?.ready) reasons.push('가동범위 맞춤 중');\n    else if (!evidence.guideStatus?.inside) reasons.push('교정 범위 밖');\n    if (!evidence.strumHandSelected) reasons.push('스트럼 손 미선택');",
  "    if (evidence.stringBand && evidence.stringBand.stable !== true) reasons.push('줄 위치 안정화 중');\n    if (!evidence.contactStable || Number(evidence.contactQuality || 0) < 0.48) reasons.push('타격점 안정화 중');\n    if (!evidence.strumGuide?.ready) reasons.push('가동범위 맞춤 중');\n    else if (!evidence.guideStatus?.inside) reasons.push('교정 범위 밖');\n    if (!evidence.strumHandSelected) reasons.push('스트럼 손 미선택');",
  'precision lock reasons',
);
center = replaceOnce(
  center,
  "      visionRef.current.pickPoint = activeHand?.pickPoint || null;\n      visionRef.current.strumGuide = guide;",
  "      visionRef.current.pickPoint = activeHand?.pickPoint || null;\n      visionRef.current.contactQuality = Number(activeHand?.contactConfidence || activeHand?.contactQuality || 0);\n      visionRef.current.contactStable = Boolean(activeHand?.contactStable);\n      if (role.eventDetail) visionRef.current.lastStrokeQuality = role.eventDetail;\n      visionRef.current.strumGuide = guide;",
  'precision hand evidence',
);
center = replaceOnce(
  center,
  '    const stringResult = detectStringBand(imageData, 320, 180);',
  '    const rawStringResult = detectStringBand(imageData, 320, 180);\n    const stringResult = bandStabilizerRef.current.update(rawStringResult, timestamp);',
  'temporal string stabilization',
);
center = replaceOnce(
  center,
  "        ready: visionRef.current.stringCount >= 4 && visionRef.current.stringConfidence >= 0.32 && visionRef.current.guitarConfidence >= 0.3,",
  "        ready: visionRef.current.stringBand?.stable === true && visionRef.current.stringCount >= 4 && visionRef.current.stringConfidence >= 0.32 && visionRef.current.guitarConfidence >= 0.3,",
  'stable band hand gate',
);
center = replaceOnce(
  center,
  "    handRoleRef.current.reset();\n    guideRef.current.reset();\n    countsRef.current = { down: 0, up: 0 };",
  "    handRoleRef.current.reset();\n    guideRef.current.reset();\n    bandStabilizerRef.current.reset();\n    countsRef.current = { down: 0, up: 0 };",
  'reset stabilizer on begin',
);
center = replaceOnce(
  center,
  "    handRoleRef.current.reset();\n    guideRef.current.reset();\n    countsRef.current[direction] = 0;",
  "    handRoleRef.current.reset();\n    guideRef.current.reset();\n    bandStabilizerRef.current.reset();\n    countsRef.current[direction] = 0;",
  'reset stabilizer on direct test',
);
center = replaceOnce(center, '    version: 4,', '    version: 5,', 'precision diagnostic version');
center = replaceOnce(
  center,
  '            <EvidencePill ok={vision.strumHandSelected} label="스트럼 손" value={vision.selectedHandedness} />',
  '            <EvidencePill ok={vision.strumHandSelected} label="스트럼 손" value={vision.selectedHandedness} />\n            <EvidencePill ok={vision.contactStable} label="타격점" value={`${Math.round(Number(vision.contactQuality || 0) * 100)}%`} />\n            <EvidencePill ok={vision.stringBand?.stable === true} label="줄 안정도" value={`${Math.round(Number(vision.stringBand?.stability || 0) * 100)}%`} />',
  'precision evidence pills',
);
center = replaceOnce(
  center,
  "            <div><strong>교정 가동범위</strong> {vision.strumGuide?.calibrated ? (vision.guideStatus?.inside ? '범위 안' : '범위 밖 · 손을 색상 영역 안으로 이동') : '첫 유효 스트럼으로 자동 맞춤'}</div>",
  "            <div><strong>교정 가동범위</strong> {vision.strumGuide?.calibrated ? (vision.guideStatus?.inside ? '범위 안' : '범위 밖 · 손을 색상 영역 안으로 이동') : '첫 유효 스트럼으로 자동 맞춤'}</div>\n            <div><strong>줄 좌표 안정도</strong> {Math.round(Number(vision.stringBand?.stability || 0) * 100)}% {vision.stringBand?.held ? '· 급변 보류' : ''}</div>\n            <div><strong>타격점 안정도</strong> {Math.round(Number(vision.contactQuality || 0) * 100)}%</div>\n            {vision.lastStrokeQuality ? <div><strong>최근 스트럼 품질</strong> 단조도 {Math.round(Number(vision.lastStrokeQuality.monotonicity || 0) * 100)}% · {(Number(vision.lastStrokeQuality.duration || 0) / 1000).toFixed(2)}초</div> : null}",
  'precision diagnostics',
);

writeFileSync(centerPath, center);
console.log('Applied temporal string stabilization, adaptive contact filtering, monotonic crossing validation, and precision diagnostics.');
