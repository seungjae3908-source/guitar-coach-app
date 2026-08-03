import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Guitar-evidence patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Guitar-evidence patch target is ambiguous: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function nearestVideoParameter(source, markerAt, label) {
  const headers = [
    ...source.slice(0, markerAt).matchAll(
      /const\s+[A-Za-z_$][\w$]*\s*=\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*\{/g,
    ),
  ];
  const header = headers.at(-1);
  if (!header) throw new Error(`Guitar-evidence function header missing: ${label}`);
  return { videoName: header[1], timestampName: header[2] };
}

function patchPoseAnalysis(source) {
  const marker = 'const candidatePose = detectAdaptiveGuitarPose(imageData, 240, 135, {';
  const markerAt = source.indexOf(marker);
  if (markerAt < 0) throw new Error('Guitar-evidence pose marker missing');
  const { videoName } = nearestVideoParameter(source, markerAt, 'pose analysis');
  const lineStart = source.lastIndexOf('\n', markerAt) + 1;
  const indent = source.slice(lineStart, markerAt);
  const inner = `${indent}  `;

  const restoredCall = [
    `const analysisFrame = restoreAnalysisAspect(`,
    `${inner}imageData,`,
    `${inner}240,`,
    `${inner}135,`,
    `${inner}${videoName}.videoWidth,`,
    `${inner}${videoName}.videoHeight,`,
    `${indent});`,
    `${indent}const candidatePose = detectAdaptiveGuitarPose(`,
    `${inner}analysisFrame.imageData,`,
    `${inner}analysisFrame.width,`,
    `${inner}analysisFrame.height,`,
    `${inner}{`,
  ].join('\n');
  source = source.slice(0, markerAt) + restoredCall + source.slice(markerAt + marker.length);

  const poseAssignment = [
    `${indent}const pose = stabilized.pose || candidatePose;`,
    `${indent}poseRef.current = pose;`,
  ].join('\n');
  const validatedAssignment = [
    `${indent}const observedStrings = detectStringBand(`,
    `${inner}analysisFrame.imageData,`,
    `${inner}analysisFrame.width,`,
    `${inner}analysisFrame.height,`,
    `${indent});`,
    `${indent}const pose = validateGuitarPresence({`,
    `${inner}pose: stabilized.pose || candidatePose,`,
    `${inner}observedStrings,`,
    `${inner}previous: poseRef.current,`,
    `${inner}timestamp,`,
    `${indent}});`,
    `${indent}poseRef.current = pose;`,
  ].join('\n');
  return replaceOnce(source, poseAssignment, validatedAssignment, 'validated pose assignment');
}

function patchMotionAnalysis(source) {
  const pattern = /(\s*)const\s+([A-Za-z_$][\w$]*)\s*=\s*motionTrackerRef\.current\.update\(\{\s*\n\s*imageData,\s*\n\s*width:\s*160,\s*\n\s*height:\s*90,/;
  const match = source.match(pattern);
  if (!match || match.index == null) throw new Error('Guitar-evidence motion marker missing');
  const { videoName } = nearestVideoParameter(source, match.index, 'motion analysis');
  const indent = match[1].includes('\n') ? match[1].slice(match[1].lastIndexOf('\n') + 1) : match[1];
  const resultName = match[2];
  const inner = `${indent}  `;
  const replacement = [
    `${match[1]}const motionFrame = restoreAnalysisAspect(`,
    `${inner}imageData,`,
    `${inner}160,`,
    `${inner}90,`,
    `${inner}${videoName}.videoWidth,`,
    `${inner}${videoName}.videoHeight,`,
    `${indent});`,
    `${indent}const ${resultName} = motionTrackerRef.current.update({`,
    `${inner}imageData: motionFrame.imageData,`,
    `${inner}width: motionFrame.width,`,
    `${inner}height: motionFrame.height,`,
  ].join('\n');
  return source.slice(0, match.index) + replacement + source.slice(match.index + match[0].length);
}

const centerPath = resolve(process.cwd(), 'src/AdaptiveDebugCenter.jsx');
let center = readFileSync(centerPath, 'utf8');
if (!center.includes("from './analysis-frame-policy.js'")) {
  center = "import { restoreAnalysisAspect } from './analysis-frame-policy.js';\n" + center;
}
if (!center.includes("from './guitar-presence-policy.js'")) {
  center = "import { validateGuitarPresence } from './guitar-presence-policy.js';\n" + center;
}
if (!center.includes("detectStringBand") || !center.includes("from './vision-logic.js'")) {
  center = "import { detectStringBand } from './vision-logic.js';\n" + center;
}
center = patchPoseAnalysis(center);
center = patchMotionAnalysis(center);
writeFileSync(centerPath, center);

const visionLogicPath = resolve(process.cwd(), 'src/vision-logic.js');
let visionLogic = readFileSync(visionLogicPath, 'utf8');
visionLogic = replaceOnce(
  visionLogic,
  '  const angles = [-35, -28, -21, -14, -7, 0, 7, 14, 21, 28, 35];',
  '  const angles = [-70, -63, -56, -49, -42, -35, -28, -21, -14, -7, 0, 7, 14, 21, 28, 35, 42, 49, 56, 63, 70];',
  'steep guitar string angles',
);
writeFileSync(visionLogicPath, visionLogic);

console.log('Applied aspect-safe analysis and independent visible-string guitar validation.');
