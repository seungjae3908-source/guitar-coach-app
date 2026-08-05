import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Backlit-recovery target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Backlit-recovery target is ambiguous: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceRegexOnce(source, pattern, replacement, label) {
  pattern.lastIndex = 0;
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length === 0) throw new Error(`Backlit-recovery regex target missing: ${label}`);
  if (matches.length > 1) throw new Error(`Backlit-recovery regex target is ambiguous: ${label}`);
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

const centerPath = resolve(process.cwd(), 'src/AdaptiveDebugCenter.jsx');
let center = readFileSync(centerPath, 'utf8');

if (!center.includes("from './backlit-guitar-recovery.js'")) {
  center = "import { BacklitGuitarRecovery } from './backlit-guitar-recovery.js';\n" + center;
  center = replaceOnce(
    center,
    '  const adaptiveLiveStrumRef = useRef(new AdaptiveLiveStrumEngine());',
    `  const adaptiveLiveStrumRef = useRef(new AdaptiveLiveStrumEngine());
  const backlitGuitarRecoveryRef = useRef(new BacklitGuitarRecovery());`,
    'recovery ref',
  );

  center = replaceRegexOnce(
    center,
    /(^[ \t]*)const pose = validateGuitarPresence\(\{\s*\n[ \t]*pose: stabilized\.pose \|\| candidatePose,\s*\n[ \t]*observedStrings,\s*\n[ \t]*previous: poseRef\.current,\s*\n[ \t]*timestamp,\s*\n[ \t]*\}\);\s*\n[ \t]*poseRef\.current = pose;/m,
    (match, indent) => `${indent}const strictPose = validateGuitarPresence({
${indent}  pose: stabilized.pose || candidatePose,
${indent}  observedStrings,
${indent}  previous: poseRef.current,
${indent}  timestamp,
${indent}});
${indent}const pose = backlitGuitarRecoveryRef.current.update({
${indent}  pose: stabilized.pose || candidatePose,
${indent}  observedStrings,
${indent}  strictPose,
${indent}  hands: lastHandsRef.current || [],
${indent}  bodyLandmarks: bodyPoseRef.current?.landmarks || [],
${indent}  previous: poseRef.current,
${indent}  timestamp,
${indent}});
${indent}poseRef.current = pose;
${indent}visionRef.current.guitarPartialRecovery = pose.partialValidation ? {
${indent}  ready: true,
${indent}  confidence: Number(pose.recoveryConfidence || pose.confidence || 0),
${indent}  source: pose.recoverySource || 'two-hand-axis',
${indent}  reason: pose.validationReason || '역광·부분 인식',
${indent}} : null;`,
    'strict pose plus backlit recovery',
  );

  center = replaceOnce(
    center,
    '    adaptiveLiveStrumRef.current.reset();',
    `    adaptiveLiveStrumRef.current.reset();
    backlitGuitarRecoveryRef.current.reset();`,
    'camera reset recovery',
  );

  center = replaceOnce(
    center,
    '            <EvidencePill ok={Boolean(vision.rightHandTechnique?.personalCalibrationReady)} label="개인 보정" value={vision.rightHandTechnique?.personalCalibrationReady ? `적용 · ${vision.rightHandTechnique?.personalCalibrationCoverage || 1}각도` : `학습 ${Math.round(Number(vision.rightHandTechnique?.personalCalibrationProgress || 0) * 100)}%`} />',
    `            <EvidencePill ok={Boolean(vision.rightHandTechnique?.personalCalibrationReady)} label="개인 보정" value={vision.rightHandTechnique?.personalCalibrationReady ? \`적용 · \${vision.rightHandTechnique?.personalCalibrationCoverage || 1}각도\` : \`학습 \${Math.round(Number(vision.rightHandTechnique?.personalCalibrationProgress || 0) * 100)}%\`} />
            <EvidencePill ok={Boolean(vision.guitarPartialRecovery?.ready)} label="역광·부분 복구" value={vision.guitarPartialRecovery?.ready ? \`양손 축 적용 · \${percent(vision.guitarPartialRecovery?.confidence || 0)}\` : '엄격 인식 우선'} />`,
    'partial recovery evidence',
  );

  center = replaceOnce(center, '    version: 7,', '    version: 8,', 'diagnostic report version');
  writeFileSync(centerPath, center);
}

console.log('Applied safe backlit and tilted-guitar recovery from stable two-hand geometry.');
