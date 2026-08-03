import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Strum-precision patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Strum-precision patch target is ambiguous: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceRegexOnce(source, pattern, replacement, label) {
  pattern.lastIndex = 0;
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length === 0) throw new Error(`Strum-precision regex target missing: ${label}`);
  if (matches.length > 1) throw new Error(`Strum-precision regex target is ambiguous: ${label}`);
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

const centerPath = resolve(process.cwd(), 'src/AdaptiveDebugCenter.jsx');
let center = readFileSync(centerPath, 'utf8');

center = replaceOnce(
  center,
  "import { LOW_FPS_HAND_HOLD_MS, preserveDetectedHands, selectRecoveredStrumHand } from './low-fps-strum-policy.js';",
  "import { LOW_FPS_HAND_HOLD_MS, STRUM_EVENT_HOLD_MS, chooseDistinctFretHand, isCountableStrumHand, preserveDetectedHands, selectRecoveredStrumHand } from './low-fps-strum-policy.js';",
  'strict low-fps imports',
);

if (!center.includes("from './strict-stroke-consensus-policy.js'")) {
  center = "import { StrictTargetStrokeConsensus } from './strict-stroke-consensus-policy.js';\n" + center;
}
center = replaceOnce(
  center,
  'new TargetStrokeConsensus()',
  'new StrictTargetStrokeConsensus()',
  'strict stroke consensus instance',
);

center = replaceOnce(
  center,
  `      const recoveredStrumHand = selectRecoveredStrumHand({
        roles,
        cached: lastStrumHandRef.current,
        now: timestamp,
        lastSeenAt: lastStrumHandAtRef.current,
        holdMs: LOW_FPS_HAND_HOLD_MS,
      });
      if (recoveredStrumHand?.pickPoint && !recoveredStrumHand.inferred) {
        lastStrumHandAtRef.current = timestamp;
        lastStrumHandRef.current = { ...recoveredStrumHand, lastSeenAt: timestamp };
      }
      const strumHand = selectStickyStrumHand({
        current: recoveredStrumHand,
        cached: lastStrumHandRef.current,
        now: timestamp,
        lastSeenAt: lastStrumHandAtRef.current,
        holdMs: LOW_FPS_HAND_HOLD_MS,
      });
      const fretHand = [...displayedRoles].filter((hand) => hand.role === 'fret').sort((a, b) => b.roleConfidence - a.roleConfidence)[0] || null;
      const selectedStrumHand = strumHand;
      let landmarkEvent = null;
      if (strumHand?.pickPoint && poseRef.current?.stringBand) {`,
  `      const recoveredStrumHand = selectRecoveredStrumHand({
        roles,
        cached: lastStrumHandRef.current,
        now: timestamp,
        lastSeenAt: lastStrumHandAtRef.current,
        holdMs: STRUM_EVENT_HOLD_MS,
      });
      const strumHand = isCountableStrumHand(recoveredStrumHand)
        ? recoveredStrumHand
        : null;
      if (strumHand?.pickPoint) {
        lastStrumHandAtRef.current = timestamp;
        lastStrumHandRef.current = { ...strumHand, lastSeenAt: timestamp };
      }
      const fretHand = chooseDistinctFretHand(displayedRoles, strumHand);
      const selectedStrumHand = strumHand;
      let landmarkEvent = null;
      if (strumHand?.pickPoint && poseRef.current?.guitarValidated && poseRef.current?.stringBand) {`,
  'verified and distinct hand selection',
);

center = replaceOnce(
  center,
  'new SegmentDirectionalTracker({ cooldownMs: 105, maximumCrossingMs: 760, maximumSampleGapMs: 460, minimumTravel: 0.012, partialTravel: 0.006, minimumCenterTravel: 0.0065, centerDeadZoneRatio: 0.02, minimumCenterDeadZone: 0.0022, maximumCenterDeadZone: 0.0042 })',
  'new SegmentDirectionalTracker({ cooldownMs: 180, maximumCrossingMs: 650, maximumSampleGapMs: 300, minimumTravel: 0.022, partialTravel: 0.012, minimumCenterTravel: 0.014, centerDeadZoneRatio: 0.045, minimumCenterDeadZone: 0.004, maximumCenterDeadZone: 0.009 })',
  'strict landmark crossing tracker',
);

center = replaceRegexOnce(
  center,
  /ready:\s*poseRef\.current\.confidence\s*>=\s*0\.25/,
  'ready: poseRef.current.guitarValidated === true && poseRef.current.confidence >= 0.42',
  'validated guitar required for landmark crossing',
);

center = replaceRegexOnce(
  center,
  /motionResult\.event\s*&&\s*timestamp\s*-\s*lastStrokeEventAtRef\.current\s*>\s*105/,
  'motionResult.event && motionResult.confidence >= 0.11 && isStrumHandRecent(timestamp, lastStrumHandAtRef.current, STRUM_EVENT_HOLD_MS) && timestamp - lastStrokeEventAtRef.current > 180',
  'strict motion event gate',
);

writeFileSync(centerPath, center);

const visionPath = resolve(process.cwd(), 'src/adaptive-guitar-vision.js');
let vision = readFileSync(visionPath, 'utf8');
vision = replaceOnce(
  vision,
  "import { LOW_FPS_HAND_HOLD_MS } from './low-fps-strum-policy.js';",
  "import { STRUM_EVENT_HOLD_MS } from './low-fps-strum-policy.js';",
  'strict motion recency import',
);
vision = replaceOnce(
  vision,
  'isStrumHandRecent(timestamp, recentHandAt, LOW_FPS_HAND_HOLD_MS)',
  'isStrumHandRecent(timestamp, recentHandAt, STRUM_EVENT_HOLD_MS)',
  'strict motion hand recency',
);
vision = replaceOnce(
  vision,
  'new SegmentDirectionalTracker({ cooldownMs: 110, maximumCrossingMs: 760, maximumSampleGapMs: 480, minimumTravel: 0.018, partialTravel: 0.009, minimumCenterTravel: 0.009, centerDeadZoneRatio: 0.025, minimumCenterDeadZone: 0.0028, maximumCenterDeadZone: 0.005 })',
  'new SegmentDirectionalTracker({ cooldownMs: 220, maximumCrossingMs: 650, maximumSampleGapMs: 260, minimumTravel: 0.025, partialTravel: 0.014, minimumCenterTravel: 0.016, centerDeadZoneRatio: 0.05, minimumCenterDeadZone: 0.0045, maximumCenterDeadZone: 0.01 })',
  'strict motion fallback tracker',
);
vision = replaceOnce(
  vision,
  "if (!imageData || !pose?.zones?.strum || !pose?.stringBand || pose.confidence < 0.32) {",
  "if (!imageData || !pose?.guitarValidated || !pose?.zones?.strum || !pose?.stringBand || pose.confidence < 0.42) {",
  'validated guitar required for motion fallback',
);

writeFileSync(visionPath, vision);
console.log('Applied strict strum evidence: distinct hand roles, compact string band, verified return, and strong motion fallback.');
