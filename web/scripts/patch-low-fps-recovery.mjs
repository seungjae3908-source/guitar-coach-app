import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LOW_FPS_HAND_HOLD_MS } from '../src/low-fps-strum-policy.js';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Low-FPS patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Low-FPS patch target is ambiguous: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceRegexOnce(source, pattern, replacement, label) {
  const first = source.search(pattern);
  if (first < 0) throw new Error(`Low-FPS regex target missing: ${label}`);
  const tail = source.slice(first);
  const match = tail.match(pattern);
  if (!match?.[0]) throw new Error(`Low-FPS regex target unreadable: ${label}`);
  if (source.slice(first + match[0].length).search(pattern) >= 0) {
    throw new Error(`Low-FPS regex target is ambiguous: ${label}`);
  }
  return source.replace(pattern, replacement);
}

function replaceRegexOptional(source, pattern, replacement, label) {
  if (!pattern.test(source)) {
    console.warn(`Optional low-FPS target not found: ${label}`);
    return source;
  }
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

const centerPath = resolve(process.cwd(), 'src/AdaptiveDebugCenter.jsx');
let center = readFileSync(centerPath, 'utf8');

if (!center.includes("from './low-fps-strum-policy.js'")) {
  center =
    "import { LOW_FPS_HAND_HOLD_MS, preserveDetectedHands, selectRecoveredStrumHand } from './low-fps-strum-policy.js';\n" +
    center;
}

center = replaceOnce(
  center,
  '  const lastStrumHandAtRef = useRef(0);\n  const lastStrumHandRef = useRef(null);\n  const lastStrokeEventAtRef = useRef(0);',
  '  const lastStrumHandAtRef = useRef(0);\n  const lastStrumHandRef = useRef(null);\n  const lastHandsAtRef = useRef(0);\n  const lastHandsRef = useRef([]);\n  const lastStrokeEventAtRef = useRef(0);',
  'low-fps hand memory refs',
);

center = replaceOnce(
  center,
  `      const strumHand = [...roles].filter((hand) => hand.role === 'strum').sort((a, b) => b.roleConfidence - a.roleConfidence)[0] || null;\n      const fretHand = [...roles].filter((hand) => hand.role === 'fret').sort((a, b) => b.roleConfidence - a.roleConfidence)[0] || null;\n      if (strumHand?.pickPoint) {\n        lastStrumHandAtRef.current = timestamp;\n        lastStrumHandRef.current = { ...strumHand, lastSeenAt: timestamp };\n      }\n      const selectedStrumHand = selectStickyStrumHand({\n        current: strumHand,\n        cached: lastStrumHandRef.current,\n        now: timestamp,\n        lastSeenAt: lastStrumHandAtRef.current,\n      });\n      let landmarkEvent = null;\n      if (strumHand?.pickPoint && poseRef.current?.stringBand) {`,
  `      const handMemory = preserveDetectedHands({\n        current: roles,\n        cached: lastHandsRef.current,\n        now: timestamp,\n        lastSeenAt: lastHandsAtRef.current,\n        holdMs: LOW_FPS_HAND_HOLD_MS,\n      });\n      lastHandsAtRef.current = handMemory.lastSeenAt;\n      lastHandsRef.current = handMemory.cached;\n      const displayedRoles = handMemory.hands;\n      const recoveredStrumHand = selectRecoveredStrumHand({\n        roles,\n        cached: lastStrumHandRef.current,\n        now: timestamp,\n        lastSeenAt: lastStrumHandAtRef.current,\n        holdMs: LOW_FPS_HAND_HOLD_MS,\n      });\n      if (recoveredStrumHand?.pickPoint && !recoveredStrumHand.inferred) {\n        lastStrumHandAtRef.current = timestamp;\n        lastStrumHandRef.current = { ...recoveredStrumHand, lastSeenAt: timestamp };\n      }\n      const strumHand = selectStickyStrumHand({\n        current: recoveredStrumHand,\n        cached: lastStrumHandRef.current,\n        now: timestamp,\n        lastSeenAt: lastStrumHandAtRef.current,\n        holdMs: LOW_FPS_HAND_HOLD_MS,\n      });\n      const fretHand = [...displayedRoles].filter((hand) => hand.role === 'fret').sort((a, b) => b.roleConfidence - a.roleConfidence)[0] || null;\n      const selectedStrumHand = strumHand;\n      let landmarkEvent = null;\n      if (strumHand?.pickPoint && poseRef.current?.stringBand) {`,
  'recover strum role before directional tracking',
);

center = replaceOnce(
  center,
  '      visionRef.current.hands = roles;',
  '      visionRef.current.hands = displayedRoles;',
  'retain hand evidence through low-fps gaps',
);
center = replaceOnce(
  center,
  '      visionRef.current.handConfidence = Math.max(0, ...roles.map((hand) => hand.confidence || 0));',
  '      visionRef.current.handConfidence = Math.max(0, ...displayedRoles.map((hand) => hand.confidence || 0));',
  'retain hand confidence through low-fps gaps',
);

center = replaceRegexOptional(
  center,
  /minHandDetectionConfidence:\s*0\.38,\s*\n\s*minHandPresenceConfidence:\s*0\.38,\s*\n\s*minTrackingConfidence:\s*0\.34,/,
  'minHandDetectionConfidence: 0.32,\n          minHandPresenceConfidence: 0.32,\n          minTrackingConfidence: 0.28,',
  'mobile motion-blur hand thresholds',
);
center = replaceRegexOptional(
  center,
  /timestamp\s*-\s*hand\.lastSeenAt\s*<=\s*900/,
  'timestamp - hand.lastSeenAt <= 1800',
  'hand track history window',
);

center = replaceOnce(
  center,
  '    motionTrackerRef.current.reset();\n    lastStrumHandAtRef.current = 0;\n    lastStrumHandRef.current = null;\n    poseStabilityRef.current = { pendingAngle: null, pendingCount: 0 };',
  '    motionTrackerRef.current.reset();\n    lastStrumHandAtRef.current = 0;\n    lastStrumHandRef.current = null;\n    lastHandsAtRef.current = 0;\n    lastHandsRef.current = [];\n    poseStabilityRef.current = { pendingAngle: null, pendingCount: 0 };',
  'camera reset clears low-fps hand memory',
);

writeFileSync(centerPath, center);

const strumPolicyPath = resolve(process.cwd(), 'src/strum-role-policy.js');
let strumPolicy = readFileSync(strumPolicyPath, 'utf8');
strumPolicy = replaceRegexOnce(
  strumPolicy,
  /(STRUM_HAND_HOLD_MS\s*=\s*)1100\b/,
  `$1${LOW_FPS_HAND_HOLD_MS}`,
  'strum hand hold duration',
);
writeFileSync(strumPolicyPath, strumPolicy);

const motionPolicyPath = resolve(process.cwd(), 'src/motion-sampling-policy.js');
let motionPolicy = readFileSync(motionPolicyPath, 'utf8');
motionPolicy = replaceRegexOnce(
  motionPolicy,
  /(HAND_SAMPLE_INTERVAL_MS\s*=\s*)180\b/,
  '$196',
  'hand inference cadence at 7-9 FPS',
);
writeFileSync(motionPolicyPath, motionPolicy);

console.log(
  `Applied low-FPS recovery: ${LOW_FPS_HAND_HOLD_MS}ms hand hold, 96ms hand cadence, recovered landmark tracking.`,
);
