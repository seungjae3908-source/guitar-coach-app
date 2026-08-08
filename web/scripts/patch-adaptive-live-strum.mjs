import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Adaptive-live-strum target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Adaptive-live-strum target is ambiguous: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceRegexOnce(source, pattern, replacement, label) {
  pattern.lastIndex = 0;
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length === 0) throw new Error(`Adaptive-live-strum regex target missing: ${label}`);
  if (matches.length > 1) throw new Error(`Adaptive-live-strum regex target is ambiguous: ${label}`);
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function patchAutomaticCount(source) {
  const warningAt = source.indexOf('점검 중 반대 방향');
  if (warningAt < 0) throw new Error('Adaptive-live-strum counter marker missing');
  const prefix = source.slice(0, warningAt);
  const headers = [...prefix.matchAll(
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*\{/g,
  )];
  const header = [...headers]
    .reverse()
    .find((candidate) => source.slice(candidate.index, warningAt).includes('lastStrokeEventAtRef.current'));
  if (!header) throw new Error('Adaptive-live-strum counter handler missing');

  const [, , directionName] = header;
  const handlerBeforeWarning = source.slice(header.index, warningAt);
  const comparisonPattern = new RegExp(
    `if\\s*\\(\\s*${escapeRegExp(directionName)}\\s*!==\\s*([A-Za-z_$][\\w$]*)\\s*\\)\\s*\\{`,
  );
  const comparison = handlerBeforeWarning.match(comparisonPattern);
  if (!comparison) throw new Error('Adaptive-live-strum target comparison missing');
  const targetName = comparison[1];
  const assignmentPattern = new RegExp(`const\\s+${escapeRegExp(targetName)}\\s*=\\s*([^;\\n]+);`);
  const assignment = handlerBeforeWarning.match(assignmentPattern);
  if (!assignment || assignment.index == null) throw new Error('Adaptive-live-strum target assignment missing');

  const assignmentStart = header.index + assignment.index;
  const assignmentEnd = assignmentStart + assignment[0].length;
  const headerLineStart = source.lastIndexOf('\n', header.index) + 1;
  const headerIndent = source.slice(headerLineStart, header.index).match(/^\s*/)?.[0] || '';
  const indent = `${headerIndent}  `;
  const requestedExpression = assignment[1].trim();
  const replacement = [
    '',
    `${indent}const requestedTarget = ${requestedExpression};`,
    `${indent}const ${targetName} = requestedTarget === 'down' || requestedTarget === 'up'`,
    `${indent}  ? requestedTarget`,
    `${indent}  : ${directionName};`,
  ].join('\n');
  return source.slice(0, assignmentStart) + replacement + source.slice(assignmentEnd);
}

const centerPath = resolve(process.cwd(), 'src/AdaptiveDebugCenter.jsx');
let center = readFileSync(centerPath, 'utf8');
if (center.includes("from './adaptive-strum-live.js'")) {
  console.log('Adaptive live strum recognition already applied.');
  process.exit(0);
}

center = "import { AdaptiveLiveStrumEngine } from './adaptive-strum-live.js';\n" + center;

center = replaceOnce(
  center,
  `  const lastStrumHandAtRef = useRef(0);
  const lastStrumHandRef = useRef(null);
  const lastHandsAtRef = useRef(0);
  const lastHandsRef = useRef([]);
  const lastStrokeEventAtRef = useRef(0);`,
  `  const lastStrumHandAtRef = useRef(0);
  const lastStrumHandRef = useRef(null);
  const lastHandsAtRef = useRef(0);
  const lastHandsRef = useRef([]);
  const lastStrokeEventAtRef = useRef(0);
  const adaptiveLiveStrumRef = useRef(new AdaptiveLiveStrumEngine());`,
  'live engine ref',
);

center = replaceRegexOnce(
  center,
  /      const recoveredStrumHand = selectRecoveredStrumHand\(\{[\s\S]*?      visionRef\.current\.hands = displayedRoles;/,
  `      const poseForAdaptiveStrum = (() => {
        const pose = poseRef.current;
        const body = pose?.body;
        const soundhole = pose?.soundhole;
        const bodyRadius = Math.max(
          Number(body?.radiusAlong || body?.alongRadius || 0),
          Number(body?.radiusAcross || body?.acrossRadius || 0),
          0.18,
        );
        const soundholeDistance = body?.center && soundhole
          ? Math.hypot(soundhole.x - body.center.x, soundhole.y - body.center.y)
          : 0;
        const soundholeUsable = Boolean(soundhole && (!body?.center || soundholeDistance <= bodyRadius * 0.82));
        if (soundholeUsable || !body?.center || !pose?.neck || pose?.guitarValidated !== true) return pose;
        return {
          ...pose,
          soundhole: {
            x: body.center.x,
            y: body.center.y,
            radius: Math.max(0.045, Math.min(0.11, Number(body.radiusAcross || body.acrossRadius || 0.2) * 0.32)),
            confidence: Math.max(0.45, Number(pose.neck.confidence || 0.45)),
            synthetic: true,
          },
        };
      })();
      const adaptiveStrum = adaptiveLiveStrumRef.current.update({
        timestamp,
        roles,
        pose: poseForAdaptiveStrum,
      });
      const strumHand = adaptiveStrum.hand;
      if (strumHand?.pickPoint) {
        lastStrumHandAtRef.current = timestamp;
        lastStrumHandRef.current = { ...strumHand, lastSeenAt: timestamp };
      }
      const fretHand = chooseDistinctFretHand(displayedRoles, strumHand);
      const selectedStrumHand = strumHand;
      const landmarkEvent = adaptiveStrum.event;
      if (adaptiveStrum.band && poseRef.current) {
        poseRef.current = {
          ...poseRef.current,
          stringBand: adaptiveStrum.band,
          adaptiveStringSource: adaptiveStrum.bandSource,
          adaptiveStrumReady: adaptiveStrum.ready,
        };
        visionRef.current.stringBand = adaptiveStrum.band;
        visionRef.current.stringAngle = adaptiveStrum.band.angle || 0;
        if (adaptiveStrum.bandSource !== 'observed-validated') {
          poseRef.current.lines = [];
          visionRef.current.stringLines = [];
        }
      }
      visionRef.current.adaptiveStrumReady = adaptiveStrum.ready;
      visionRef.current.adaptiveStrumReason = adaptiveStrum.reason;
      visionRef.current.adaptiveStringSource = adaptiveStrum.bandSource;
      const liveDisplayedRoles = displayedRoles.map((hand) => hand.trackId === strumHand?.trackId
        ? { ...hand, role: 'strum', pickPoint: strumHand.pickPoint }
        : hand);
      visionRef.current.hands = liveDisplayedRoles;`,
  'connect live engine to generated automatic-recognition screen',
);

center = patchAutomaticCount(center);

center = replaceOnce(
  center,
  `    motionTrackerRef.current.reset();
    lastStrumHandAtRef.current = 0;`,
  `    motionTrackerRef.current.reset();
    adaptiveLiveStrumRef.current.reset();
    lastStrumHandAtRef.current = 0;`,
  'reset live engine with camera',
);

center = replaceOnce(
  center,
  `    if (!evidence.strumHandSelected && !isStrumHandRecent(performance.now(), lastStrumHandAtRef.current)) reasons.push('스트럼 손 미선택');
    return reasons.join(' · ') || '방향 감지 준비 완료';`,
  `    if (!evidence.strumHandSelected && !isStrumHandRecent(performance.now(), lastStrumHandAtRef.current)) reasons.push('스트럼 손 미선택');
    if (evidence.adaptiveStrumReason === 'string-band-away-from-guitar') reasons.push('잘못된 줄 후보 제외');
    else if (evidence.adaptiveStrumReason === 'soundhole-and-string-band-missing') reasons.push('사운드홀·줄 탐색 중');
    else if (evidence.adaptiveStrumReason === 'strum-hand-not-near-strings') reasons.push('스트럼 손을 실제 줄 가까이');
    else if (evidence.adaptiveStrumReason === 'contact-unstable') reasons.push('스트럼 손 좌표 안정화 중');
    return reasons.join(' · ') || '방향 감지 준비 완료';`,
  'show actionable live recognition reason',
);

writeFileSync(centerPath, center);
console.log('Connected precise live strum recognition to the deployed adaptive screen and enabled automatic counting.');
