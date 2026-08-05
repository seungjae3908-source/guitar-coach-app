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

function replaceRegexOnce(source, pattern, replacement, label) {
  pattern.lastIndex = 0;
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length === 0) throw new Error(`Strong-guitar-consensus regex target missing: ${label}`);
  if (matches.length > 1) throw new Error(`Strong-guitar-consensus regex target is ambiguous: ${label}`);
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
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

  center = replaceRegexOnce(
    center,
    /(^[ \t]*)const pose = backlitGuitarRecoveryRef\.current\.update\(\{([\s\S]*?^[ \t]*)strictPose,([\s\S]*?^[ \t]*\}\);)/m,
    (_match, indent, beforeStrict, strictIndent, afterStrict) => {
      const inner = `${indent}  `;
      return `${indent}const consensusPose = strongGuitarConsensusRef.current.update({
${inner}pose: candidatePose,
${inner}strictPose,
${inner}previous: poseRef.current,
${inner}timestamp,
${indent}});
${indent}const pose = backlitGuitarRecoveryRef.current.update({${beforeStrict}${strictIndent}strictPose: consensusPose,${afterStrict}`;
    },
    'strong consensus before two-hand recovery',
  );

  center = replaceRegexOnce(
    center,
    /(^[ \t]*)visionRef\.current\.guitarPartialRecovery = pose\.partialValidation \? \{\s*\n[ \t]*ready: true,\s*\n[ \t]*confidence: Number\(pose\.recoveryConfidence \|\| pose\.confidence \|\| 0\),\s*\n[ \t]*source: pose\.recoverySource \|\| 'two-hand-axis',\s*\n[ \t]*reason: pose\.validationReason \|\| '역광·부분 인식',\s*\n[ \t]*\} : null;/m,
    (_match, indent) => `${indent}visionRef.current.guitarPartialRecovery = pose.partialValidation ? {
${indent}  ready: true,
${indent}  confidence: Number(pose.recoveryConfidence || pose.confidence || 0),
${indent}  source: pose.recoverySource || 'two-hand-axis',
${indent}  label: pose.recoverySource === 'internal-pose-consensus'
${indent}    ? '사운드홀·넥·6줄 원본 합의'
${indent}    : '양손 축 적용',
${indent}  reason: pose.validationReason || '역광·부분 인식',
${indent}} : null;`,
    'report consensus recovery source',
  );

  center = replaceOnce(
    center,
    '    backlitGuitarRecoveryRef.current.reset();',
    `    backlitGuitarRecoveryRef.current.reset();
    strongGuitarConsensusRef.current.reset();`,
    'camera reset strong consensus',
  );

  center = replaceRegexOnce(
    center,
    /<EvidencePill ok=\{Boolean\(vision\.guitarPartialRecovery\?\.ready\)\} label="역광·부분 복구" value=\{vision\.guitarPartialRecovery\?\.ready \? `양손 축 적용 · \$\{percent\(vision\.guitarPartialRecovery\?\.confidence \|\| 0\)\}` : '엄격 인식 우선'\} \/>/,
    `<EvidencePill ok={Boolean(vision.guitarPartialRecovery?.ready)} label="기타 판정 복구" value={vision.guitarPartialRecovery?.ready ? \`\${vision.guitarPartialRecovery?.label || '부분 복구'} · \${percent(vision.guitarPartialRecovery?.confidence || 0)}\` : '엄격 인식 우선'} />`,
    'consensus recovery evidence pill',
  );

  center = replaceOnce(center, '    version: 8,', '    version: 9,', 'diagnostic report version');
  writeFileSync(centerPath, center);
}

console.log('Applied raw-candidate soundhole-neck-six-string consensus before stabilized display pose.');
