import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Strong-guitar-consensus target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Strong-guitar-consensus target is ambiguous: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const centerPath = resolve(process.cwd(), 'src/AdaptiveDebugCenter.jsx');
let center = readFileSync(centerPath, 'utf8');

if (!center.includes("from './strong-guitar-consensus.js'")) {
  center = "import { StrongGuitarConsensus } from './strong-guitar-consensus.js';\n" + center;

  center = replaceOnce(
    center,
    '  const backlitGuitarRecoveryRef = useRef(new BacklitGuitarRecovery());',
    `  const backlitGuitarRecoveryRef = useRef(new BacklitGuitarRecovery());
  const strongGuitarConsensusRef = useRef(new StrongGuitarConsensus());`,
    'strong guitar consensus ref',
  );

  center = replaceOnce(
    center,
    `      const pose = backlitGuitarRecoveryRef.current.update({
        pose: stabilized.pose || candidatePose,
        observedStrings,
        strictPose,
        hands: lastHandsRef.current || [],
        bodyLandmarks: bodyPoseRef.current?.landmarks || [],
        previous: poseRef.current,
        timestamp,
      });`,
    `      const consensusPose = strongGuitarConsensusRef.current.update({
        pose: stabilized.pose || candidatePose,
        strictPose,
        previous: poseRef.current,
        timestamp,
      });
      const pose = backlitGuitarRecoveryRef.current.update({
        pose: stabilized.pose || candidatePose,
        observedStrings,
        strictPose: consensusPose,
        hands: lastHandsRef.current || [],
        bodyLandmarks: bodyPoseRef.current?.landmarks || [],
        previous: poseRef.current,
        timestamp,
      });`,
    'strong consensus before two-hand recovery',
  );

  center = replaceOnce(
    center,
    `      visionRef.current.guitarPartialRecovery = pose.partialValidation ? {
        ready: true,
        confidence: Number(pose.recoveryConfidence || pose.confidence || 0),
        source: pose.recoverySource || 'two-hand-axis',
        reason: pose.validationReason || '역광·부분 인식',
      } : null;`,
    `      visionRef.current.guitarPartialRecovery = pose.partialValidation ? {
        ready: true,
        confidence: Number(pose.recoveryConfidence || pose.confidence || 0),
        source: pose.recoverySource || 'two-hand-axis',
        label: pose.recoverySource === 'internal-pose-consensus'
          ? '사운드홀·넥·6줄 합의'
          : '양손 축 적용',
        reason: pose.validationReason || '역광·부분 인식',
      } : null;`,
    'report consensus recovery source',
  );

  center = replaceOnce(
    center,
    `    backlitGuitarRecoveryRef.current.reset();`,
    `    backlitGuitarRecoveryRef.current.reset();
    strongGuitarConsensusRef.current.reset();`,
    'camera reset strong consensus',
  );

  center = replaceOnce(
    center,
    `            <EvidencePill ok={Boolean(vision.guitarPartialRecovery?.ready)} label="역광·부분 복구" value={vision.guitarPartialRecovery?.ready ? \`양손 축 적용 · \${percent(vision.guitarPartialRecovery?.confidence || 0)}\` : '엄격 인식 우선'} />`,
    `            <EvidencePill ok={Boolean(vision.guitarPartialRecovery?.ready)} label="기타 판정 복구" value={vision.guitarPartialRecovery?.ready ? \`\${vision.guitarPartialRecovery?.label || '부분 복구'} · \${percent(vision.guitarPartialRecovery?.confidence || 0)}\` : '엄격 인식 우선'} />`,
    'consensus recovery evidence pill',
  );

  center = replaceOnce(center, '    version: 8,', '    version: 9,', 'diagnostic report version');
  writeFileSync(centerPath, center);
}

console.log('Applied strong soundhole-neck-six-string consensus so wood-grain conflicts cannot cancel a verified guitar.');
