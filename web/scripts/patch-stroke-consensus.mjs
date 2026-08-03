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
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))];
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
  "new SegmentDirectionalTracker({ cooldownMs: 210, maximumCrossingMs: 720, minimumTravel: 0.018, partialTravel: 0.011 })",
  'landmark segment tracker',
);

center = replaceRegexOnce(
  center,
  /if\s*\(\s*!\['down',\s*'up'\]\.includes\(direction\)\s*\|\|\s*timestamp\s*-\s*lastStrokeEventAtRef\.current\s*<\s*115\s*\)\s*return;\s*lastStrokeEventAtRef\.current\s*=\s*timestamp;\s*visionRef\.current\.lastDirection\s*=\s*direction;\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*currentTestRef\.current;/,
  (_match, targetName) => `if (!['down', 'up'].includes(direction)) return;\n    const ${targetName} = currentTestRef.current;\n    const strokeDecision = strokeConsensusRef.current.sample({\n      direction,\n      source,\n      target: ${targetName},\n      timestamp,\n    });\n    visionRef.current.lastDirection = direction;\n    if (!strokeDecision.count) return;\n    lastStrokeEventAtRef.current = timestamp;`,
  'target stroke consensus gate',
);

center = center.replaceAll('빠른 동작 보간', '관절 누락 보완');
center = center.replaceAll('관절+지역 움직임', '관절 우선·영상 보완');

center = replaceRegexOptional(
  center,
  /x:\s*pinch\.x\s*\*\s*0\.78\s*\+\s*palmCenter\.x\s*\*\s*0\.22,\s*\n\s*y:\s*pinch\.y\s*\*\s*0\.78\s*\+\s*palmCenter\.y\s*\*\s*0\.22,/,
  'x: pinch.x * 0.72 + palmCenter.x * 0.28,\n          y: pinch.y * 0.72 + palmCenter.y * 0.28,',
  'stable pick-point weighting',
);

center = replaceOnce(
  center,
  '    lastStrokeEventAtRef.current = 0;\n    lastStrumHandAtRef.current = 0;',
  '    lastStrokeEventAtRef.current = 0;\n    strokeConsensusRef.current.reset();\n    lastStrumHandAtRef.current = 0;',
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
  '    this.tracker = new SegmentDirectionalTracker({ cooldownMs: 260, maximumCrossingMs: 720, minimumTravel: 0.032, partialTravel: 0.022 });',
  'motion segment tracker',
);
writeFileSync(visionPath, vision);

console.log('Applied target-direction consensus, return-stroke rearming, and skipped-frame segment tracking.');
