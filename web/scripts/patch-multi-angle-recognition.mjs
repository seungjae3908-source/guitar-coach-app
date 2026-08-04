import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Multi-angle target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Multi-angle target is ambiguous: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const centerPath = resolve(process.cwd(), 'src/AdaptiveDebugCenter.jsx');
let center = readFileSync(centerPath, 'utf8');

if (!center.includes("from './multi-angle-right-hand.js'")) {
  center = replaceOnce(
    center,
    "import { RightHandTechniqueAnalyzer } from './right-hand-technique.js';",
    "import { MultiAngleRightHandTechniqueAnalyzer } from './multi-angle-right-hand.js';",
    'multi-angle analyzer import',
  );
  center = replaceOnce(
    center,
    'const rightHandTechniqueRef = useRef(new RightHandTechniqueAnalyzer());',
    'const rightHandTechniqueRef = useRef(new MultiAngleRightHandTechniqueAnalyzer());',
    'multi-angle analyzer instance',
  );
  center = center.replace(
    'pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    'pose_landmarker_full/float16/1/pose_landmarker_full.task',
  );
  center = replaceOnce(
    center,
    `      const landmarks = result.landmarks?.[0] || [];
      if (landmarks.length >= 17) {
        bodyPoseRef.current = { landmarks, at: timestamp };
        visionRef.current.bodyPoseLandmarks = landmarks;
        visionRef.current.bodyPoseReady = true;
      } else if (bodyPoseRef.current && timestamp - bodyPoseRef.current.at <= 360) {
        visionRef.current.bodyPoseLandmarks = bodyPoseRef.current.landmarks;
        visionRef.current.bodyPoseReady = true;
      } else {
        bodyPoseRef.current = null;
        visionRef.current.bodyPoseLandmarks = [];
        visionRef.current.bodyPoseReady = false;
      }`,
    `      const landmarks = result.landmarks?.[0] || [];
      const worldLandmarks = result.worldLandmarks?.[0] || [];
      if (landmarks.length >= 17) {
        bodyPoseRef.current = { landmarks, worldLandmarks, at: timestamp };
        visionRef.current.bodyPoseLandmarks = landmarks;
        visionRef.current.bodyPoseWorldLandmarks = worldLandmarks;
        visionRef.current.bodyPoseReady = true;
      } else if (bodyPoseRef.current && timestamp - bodyPoseRef.current.at <= 420) {
        visionRef.current.bodyPoseLandmarks = bodyPoseRef.current.landmarks;
        visionRef.current.bodyPoseWorldLandmarks = bodyPoseRef.current.worldLandmarks || [];
        visionRef.current.bodyPoseReady = true;
      } else {
        bodyPoseRef.current = null;
        visionRef.current.bodyPoseLandmarks = [];
        visionRef.current.bodyPoseWorldLandmarks = [];
        visionRef.current.bodyPoseReady = false;
      }`,
    'pose world landmarks and hold',
  );
  center = replaceOnce(
    center,
    `        bodyLandmarks: bodyPoseRef.current?.landmarks || [],
        band: adaptiveStrum.band,`,
    `        bodyLandmarks: bodyPoseRef.current?.landmarks || [],
        bodyWorldLandmarks: bodyPoseRef.current?.worldLandmarks || [],
        band: adaptiveStrum.band,`,
    'world pose analysis input',
  );
  center = replaceOnce(
    center,
    `            <EvidencePill ok={vision.bodyPoseReady} label="팔 자세" value={vision.bodyPoseReady ? '어깨·팔꿈치·손목 연결' : '관절이 보이게 조정'} />`,
    `            <EvidencePill ok={vision.bodyPoseReady} label="팔 자세" value={vision.bodyPoseReady ? '어깨·팔꿈치·손목 연결' : '관절이 보이게 조정'} />
            <EvidencePill ok={Boolean(vision.rightHandTechnique?.angleCorrectionReady)} label="촬영 각도" value={vision.rightHandTechnique?.cameraViewLabel || '각도 분석 중'} />
            <EvidencePill ok={Number(vision.rightHandTechnique?.angleCorrectionConfidence || 0) >= 0.45} label="각도 보정" value={percent(vision.rightHandTechnique?.angleCorrectionConfidence || 0)} />`,
    'camera angle evidence',
  );
  center = replaceOnce(
    center,
    `            <span>팔·손목 판정: {vision.rightHandTechnique?.movementLabel || '분석 대기'} · 신뢰도 {percent(vision.rightHandTechnique?.movementConfidence || 0)}</span>`,
    `            <span>촬영 각도: {vision.rightHandTechnique?.cameraViewLabel || '분석 중'} · 자동 보정 {percent(vision.rightHandTechnique?.angleCorrectionConfidence || 0)} · 카메라 기울기 {Math.round(Number(vision.rightHandTechnique?.cameraRollDegrees || 0))}°</span>
            <span>팔·손목 판정: {vision.rightHandTechnique?.movementLabel || '분석 대기'} · 신뢰도 {percent(vision.rightHandTechnique?.movementConfidence || 0)}</span>`,
    'camera angle coaching row',
  );
  center = replaceOnce(center, '    version: 5,', '    version: 6,', 'diagnostic report version');
}

writeFileSync(centerPath, center);

const strumPath = resolve(process.cwd(), 'src/adaptive-strum-live.js');
let strum = readFileSync(strumPath, 'utf8');
if (!strum.includes('multiAngleScale: true')) {
  strum = replaceOnce(
    strum,
    `    quality,
    source: 'thumb-index-contact',`,
    `    quality,
    palmScale,
    pinchRatio,
    multiAngleScale: true,
    source: 'thumb-index-contact',`,
    'contact scale metadata',
  );
  strum = replaceOnce(
    strum,
    '      const allowed = clamp(0.06 + elapsed * 0.0018, 0.08, 0.24);',
    '      const allowed = clamp(Math.max(finite(point.palmScale, 0.1) * 1.55, 0.045) + elapsed * 0.0012, 0.07, 0.24);',
    'scale-aware point jump',
  );
  strum = replaceOnce(
    strum,
    `    if (previous != null && (elapsed > 320 || Math.abs(projection - previous) > 0.22)) {`,
    `    const palmScale = clamp(finite(point.palmScale, 0.1), 0.035, 0.22);
    const bandWidth = Math.max(0.008, finite(band.bottom) - finite(band.top));
    const crossingScale = Math.max(bandWidth, palmScale * 0.24);
    const maximumJump = clamp(palmScale * 1.75 + Math.max(0, elapsed) * 0.00055, 0.11, 0.24);
    if (previous != null && (elapsed > 340 || Math.abs(projection - previous) > maximumJump)) {`,
    'scale-aware discontinuity',
  );
  strum = replaceOnce(
    strum,
    '    const margin = Math.max(0.006, (band.bottom - band.top) * 0.12);',
    '    const margin = Math.max(0.0035, bandWidth * 0.12, crossingScale * 0.055);',
    'scale-aware band margin',
  );
  strum = replaceOnce(
    strum,
    `      && travel >= Math.max(0.045, (band.bottom - band.top) * 0.82)`,
    `      && travel >= Math.max(0.018, bandWidth * 0.82, crossingScale * 0.38)`,
    'scale-aware crossing distance',
  );
  strum = replaceOnce(
    strum,
    `      && this.armed.maxLateral <= 0.19`,
    `      && this.armed.maxLateral <= clamp(Math.max(0.11, palmScale * 1.25), 0.11, 0.2)`,
    'scale-aware lateral corridor',
  );
  writeFileSync(strumPath, strum);
}

console.log('Applied multi-angle 3D pose normalization, mirrored/rolled camera correction, and scale-aware strum crossing.');
