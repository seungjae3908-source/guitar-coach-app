import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Patch target is ambiguous: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const centerPath = resolve(process.cwd(), 'src/AdaptiveDebugCenter.jsx');
let center = readFileSync(centerPath, 'utf8');
if (!center.includes("from './guitar-pose-policy.js'")) {
  center = "import { stabilizeGuitarPose } from './guitar-pose-policy.js';\n" + center;
}
if (!center.includes("from './strum-role-policy.js'")) {
  center = "import { isStrumHandRecent, selectStickyStrumHand } from './strum-role-policy.js';\n" + center;
}
center = replaceOnce(
  center,
  '  const poseRef = useRef(null);\n  const manualSoundholeRef = useRef(null);',
  '  const poseRef = useRef(null);\n  const poseStabilityRef = useRef({ pendingAngle: null, pendingCount: 0 });\n  const manualSoundholeRef = useRef(null);',
  'guitar pose stability ref',
);
center = replaceOnce(
  center,
  '  const lastStrumHandAtRef = useRef(0);\n  const lastStrokeEventAtRef = useRef(0);',
  '  const lastStrumHandAtRef = useRef(0);\n  const lastStrumHandRef = useRef(null);\n  const lastStrokeEventAtRef = useRef(0);',
  'strum hand cache ref',
);
center = replaceOnce(
  center,
  `      const strumHand = [...roles].filter((hand) => hand.role === 'strum').sort((a, b) => b.roleConfidence - a.roleConfidence)[0] || null;\n      const fretHand = [...roles].filter((hand) => hand.role === 'fret').sort((a, b) => b.roleConfidence - a.roleConfidence)[0] || null;\n      let landmarkEvent = null;\n      if (strumHand?.pickPoint && poseRef.current?.stringBand) {\n        lastStrumHandAtRef.current = timestamp;`,
  `      const strumHand = [...roles].filter((hand) => hand.role === 'strum').sort((a, b) => b.roleConfidence - a.roleConfidence)[0] || null;\n      const fretHand = [...roles].filter((hand) => hand.role === 'fret').sort((a, b) => b.roleConfidence - a.roleConfidence)[0] || null;\n      if (strumHand?.pickPoint) {\n        lastStrumHandAtRef.current = timestamp;\n        lastStrumHandRef.current = { ...strumHand, lastSeenAt: timestamp };\n      }\n      const selectedStrumHand = selectStickyStrumHand({\n        current: strumHand,\n        cached: lastStrumHandRef.current,\n        now: timestamp,\n        lastSeenAt: lastStrumHandAtRef.current,\n      });\n      let landmarkEvent = null;\n      if (strumHand?.pickPoint && poseRef.current?.stringBand) {`,
  'strum hand persistence block',
);
center = replaceOnce(
  center,
  `      visionRef.current.strumHandSelected = Boolean(strumHand);\n      visionRef.current.strumHandedness = strumHand?.handedness || '미선택';\n      visionRef.current.fretHandSelected = Boolean(fretHand);\n      visionRef.current.fretHandedness = fretHand?.handedness || '미선택';\n      visionRef.current.pickPoint = strumHand?.pickPoint || null;`,
  `      visionRef.current.strumHandSelected = Boolean(selectedStrumHand);\n      visionRef.current.strumHandedness = selectedStrumHand?.handedness || '미선택';\n      visionRef.current.fretHandSelected = Boolean(fretHand);\n      visionRef.current.fretHandedness = fretHand?.handedness || '미선택';\n      visionRef.current.pickPoint = selectedStrumHand?.pickPoint || null;`,
  'selected strum hand evidence',
);
center = replaceOnce(
  center,
  "    if (!evidence.strumHandSelected && performance.now() - lastStrumHandAtRef.current > 320) reasons.push('스트럼 손 미선택');",
  "    if (!evidence.strumHandSelected && !isStrumHandRecent(performance.now(), lastStrumHandAtRef.current)) reasons.push('스트럼 손 미선택');",
  'lock reason hold window',
);
center = center.replaceAll(
  'vision.strumHandSelected || performance.now() - lastStrumHandAtRef.current <= 320',
  'vision.strumHandSelected || isStrumHandRecent(performance.now(), lastStrumHandAtRef.current)',
);
center = replaceOnce(
  center,
  `    const pose = detectAdaptiveGuitarPose(imageData, 240, 135, {\n      hands: visionRef.current.hands,\n      previousPose: poseRef.current,\n      timestamp,\n      soundholeHint: manualSoundholeRef.current,\n    });\n    poseRef.current = pose;`,
  `    const candidatePose = detectAdaptiveGuitarPose(imageData, 240, 135, {\n      hands: visionRef.current.hands,\n      previousPose: poseRef.current,\n      timestamp,\n      soundholeHint: manualSoundholeRef.current,\n    });\n    const stabilized = stabilizeGuitarPose({\n      previous: poseRef.current,\n      candidate: candidatePose,\n      state: poseStabilityRef.current,\n      timestamp,\n    });\n    poseStabilityRef.current = stabilized.state;\n    const pose = stabilized.pose || candidatePose;\n    poseRef.current = pose;`,
  'adaptive pose stabilization',
);
center = replaceOnce(
  center,
  '    motionTrackerRef.current.reset();\n    lastStrumHandAtRef.current = 0;\n    lastStrumHandRef.current = null;\n    const context = overlayRef.current?.getContext(\'2d\');',
  '    motionTrackerRef.current.reset();\n    lastStrumHandAtRef.current = 0;\n    lastStrumHandRef.current = null;\n    poseStabilityRef.current = { pendingAngle: null, pendingCount: 0 };\n    const context = overlayRef.current?.getContext(\'2d\');',
  'camera reset clears role and pose memory',
);
writeFileSync(centerPath, center);

const visionPath = resolve(process.cwd(), 'src/adaptive-guitar-vision.js');
let vision = readFileSync(visionPath, 'utf8');
if (!vision.includes("from './strum-role-policy.js'")) {
  vision = "import { isStrumHandRecent } from './strum-role-policy.js';\n" + vision;
}
vision = replaceOnce(
  vision,
  '    this.tracker = new SimpleDirectionalTracker({ cooldownMs: 145, maximumCrossingMs: 420, minimumTravel: 0.03 });',
  '    this.tracker = new SimpleDirectionalTracker({ cooldownMs: 135, maximumCrossingMs: 650, minimumTravel: 0.024 });',
  'motion directional tracker tuning',
);
vision = replaceOnce(
  vision,
  '    if (activePixels < 8 || totalWeight < 180 || globalMotion > 38) return { point: null, event: null, confidence: 0 };',
  '    if (activePixels < 6 || totalWeight < 130 || globalMotion > 38) return { point: null, event: null, confidence: 0 };',
  'low-fps active motion threshold',
);
vision = replaceOnce(
  vision,
  '    const confidence = clamp(activePixels / 75) * clamp(totalWeight / 1800);',
  '    const confidence = clamp(activePixels / 60) * clamp(totalWeight / 1400);',
  'low-fps motion confidence',
);
vision = replaceOnce(
  vision,
  '    const handRecent = Number(timestamp) - Number(recentHandAt || 0) <= 320;\n    const event = this.tracker.sample({ point, band: pose.stringBand, timestamp, ready: handRecent && confidence >= 0.12 });',
  '    const handRecent = isStrumHandRecent(timestamp, recentHandAt);\n    const event = this.tracker.sample({ point, band: pose.stringBand, timestamp, ready: handRecent && confidence >= 0.08 });',
  'recent hand and motion gate',
);
writeFileSync(visionPath, vision);

console.log('Applied sticky strum-hand and stable guitar-angle runtime patches.');
