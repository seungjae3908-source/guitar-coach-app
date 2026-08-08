import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Stroke-consensus patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Stroke-consensus patch target is ambiguous: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceRegexOnce(source, pattern, replacement, label) {
  pattern.lastIndex = 0;
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length === 0) throw new Error(`Stroke-consensus regex target missing: ${label}`);
  if (matches.length > 1) throw new Error(`Stroke-consensus regex target is ambiguous: ${label}`);
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

function replaceRegexOptional(source, pattern, replacement, label) {
  pattern.lastIndex = 0;
  if (!pattern.test(source)) {
    console.warn(`Optional stroke-consensus target not found: ${label}`);
    return source;
  }
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function patchStrokeGate(source) {
  const warningAt = source.indexOf('점검 중 반대 방향');
  if (warningAt < 0) throw new Error('Stroke-consensus marker missing: opposite-direction log');

  const prefix = source.slice(0, warningAt);
  const headers = [
    ...prefix.matchAll(
      /const\s+([A-Za-z_$][\w$]*)\s*=\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*\{/g,
    ),
  ];
  const header = [...headers]
    .reverse()
    .find((candidate) => source.slice(candidate.index, warningAt).includes('lastStrokeEventAtRef.current'));
  if (!header) throw new Error('Stroke-consensus handler header missing');

  const [, , directionName, sourceName, timestampName] = header;
  const bodyStart = header.index + header[0].length;
  const gateStart = source.indexOf('if', bodyStart);
  if (gateStart < 0 || gateStart > warningAt) throw new Error('Stroke-consensus guard start missing');

  const handlerBeforeWarning = source.slice(gateStart, warningAt);
  const comparisonPattern = new RegExp(
    `if\\s*\\(\\s*${escapeRegExp(directionName)}\\s*!==\\s*([A-Za-z_$][\\w$]*)\\s*\\)\\s*\\{`,
  );
  const comparisonMatch = handlerBeforeWarning.match(comparisonPattern);
  if (!comparisonMatch) throw new Error('Stroke-consensus target comparison missing');
  const targetName = comparisonMatch[1];

  const assignmentPattern = new RegExp(`const\\s+${escapeRegExp(targetName)}\\s*=\\s*[^;\\n]+;`);
  const assignmentMatch = handlerBeforeWarning.match(assignmentPattern);
  if (!assignmentMatch || assignmentMatch.index == null) {
    throw new Error('Stroke-consensus target assignment missing');
  }

  const assignmentStart = gateStart + assignmentMatch.index;
  const assignmentEnd = assignmentStart + assignmentMatch[0].length;
  const lineStart = source.lastIndexOf('\n', gateStart) + 1;
  const indent = source.slice(lineStart, gateStart);
  const inner = `${indent}  `;

  const initialReplacement = [
    `if (!['down', 'up'].includes(${directionName})) return;`,
    `${indent}visionRef.current.lastDirection = ${directionName};`,
  ].join('\n');
  source = source.slice(0, gateStart) + initialReplacement + source.slice(assignmentStart);

  const shiftedAssignmentEnd =
    gateStart + initialReplacement.length + (assignmentEnd - assignmentStart);
  const decisionBlock = [
    '',
    `${indent}const strokeDecision = strokeConsensusRef.current.sample({`,
    `${inner}direction: ${directionName},`,
    `${inner}source: ${sourceName},`,
    `${inner}target: ${targetName},`,
    `${inner}timestamp: ${timestampName},`,
    `${indent}});`,
    `${indent}if (!strokeDecision.count) return;`,
    `${indent}lastStrokeEventAtRef.current = ${timestampName};`,
  ].join('\n');

  return source.slice(0, shiftedAssignmentEnd) + decisionBlock + source.slice(shiftedAssignmentEnd);
}

const centerPath = resolve(process.cwd(), 'src/AdaptiveDebugCenter.jsx');
let center = readFileSync(centerPath, 'utf8');

if (!center.includes("from './stroke-consensus-policy.js'")) {
  center =
    "import { SegmentDirectionalTracker, TargetStrokeConsensus } from './stroke-consensus-policy.js';\n" +
    center;
}

center = replaceOnce(
  center,
  '  const lastHandsRef = useRef([]);\n  const lastStrokeEventAtRef = useRef(0);',
  '  const lastHandsRef = useRef([]);\n  const lastStrokeEventAtRef = useRef(0);\n  const strokeConsensusRef = useRef(new TargetStrokeConsensus());',
  'stroke consensus ref',
);

center = replaceRegexOnce(
  center,
  /new SimpleDirectionalTracker\(\)/,
  "new SegmentDirectionalTracker({ cooldownMs: 105, maximumCrossingMs: 760, maximumSampleGapMs: 460, minimumTravel: 0.012, partialTravel: 0.006, minimumCenterTravel: 0.0065, centerDeadZoneRatio: 0.02, minimumCenterDeadZone: 0.0022, maximumCenterDeadZone: 0.0042 })",
  'small wrist landmark tracker',
);

center = patchStrokeGate(center);
center = center.replaceAll('빠른 동작 보간', '관절 누락 보완');
center = center.replaceAll('관절+지역 움직임', '관절 우선·영상 보완');

center = replaceRegexOnce(
  center,
  /x:\s*([A-Za-z_$][\w$]*)\.x\s*\*\s*0\.78\s*\+\s*([A-Za-z_$][\w$]*)\.x\s*\*\s*0\.22,\s*y:\s*\1\.y\s*\*\s*0\.78\s*\+\s*\2\.y\s*\*\s*0\.22,?/,
  (_match, pinchName, palmName) =>
    `x: ${pinchName}.x * 1.2 - ${palmName}.x * 0.2,\n          y: ${pinchName}.y * 1.2 - ${palmName}.y * 0.2`,
  'projected pick-tip tracking point',
);

center = replaceRegexOptional(
  center,
  /lastStrokeEventAtRef\.current\s*=\s*0;\s*\n(\s*)lastStrumHandAtRef\.current\s*=\s*0;/,
  (_match, indent) =>
    `lastStrokeEventAtRef.current = 0;\n${indent}strokeConsensusRef.current.reset();\n${indent}lastStrumHandAtRef.current = 0;`,
  'camera reset clears stroke consensus',
);

writeFileSync(centerPath, center);

const visionPath = resolve(process.cwd(), 'src/adaptive-guitar-vision.js');
let vision = readFileSync(visionPath, 'utf8');
if (!vision.includes("from './stroke-consensus-policy.js'")) {
  vision = "import { SegmentDirectionalTracker } from './stroke-consensus-policy.js';\n" + vision;
}
vision = replaceOnce(
  vision,
  '    this.tracker = new SimpleDirectionalTracker({ cooldownMs: 135, maximumCrossingMs: 650, minimumTravel: 0.024 });',
  '    this.tracker = new SegmentDirectionalTracker({ cooldownMs: 110, maximumCrossingMs: 760, maximumSampleGapMs: 480, minimumTravel: 0.018, partialTravel: 0.009, minimumCenterTravel: 0.009, centerDeadZoneRatio: 0.025, minimumCenterDeadZone: 0.0028, maximumCenterDeadZone: 0.005 });',
  'small local-motion fallback tracker',
);
writeFileSync(visionPath, vision);

console.log('Applied projected pick-tip tracking, 56ms hand sampling, compact center crossing, and duplicate suppression.');
