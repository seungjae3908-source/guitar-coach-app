import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Guided-strum patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Guided-strum patch target is ambiguous: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceRegexOnce(source, pattern, replacement, label) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length === 0) throw new Error(`Guided-strum regex target missing: ${label}`);
  if (matches.length > 1) throw new Error(`Guided-strum regex target is ambiguous: ${label}`);
  return source.replace(pattern, replacement);
}

const centerPath = resolve(process.cwd(), 'src/DebugCenter.jsx');
let center = readFileSync(centerPath, 'utf8');
if (center.includes("from './strum-coach.js'")) {
  console.log('Guided strum coach already applied.');
  process.exit(0);
}

center = replaceOnce(
  center,
  "import { sendLiveDiagnostics } from './live-telemetry.js';\nimport './debug-center.css';",
  "import { sendLiveDiagnostics } from './live-telemetry.js';\nimport { GuidedHandRoleResolver, StrumGuideCalibrator, estimateStrumContactPoint, evaluateStrumGuidePoint } from './strum-coach.js';\nimport './debug-center.css';",
  'guided coach import',
);
center = replaceOnce(center, '  HandRoleResolver,\n', '', 'legacy hand resolver import');
center = replaceOnce(
  center,
  "  { id: 'down', title: '다운 스트럼', instruction: '평소 자세 그대로 다운 스트럼을 하세요. 실제 줄 영역을 위에서 아래로 통과한 오른손만 계산합니다.' },\n  { id: 'up', title: '업 스트럼', instruction: '평소 자세 그대로 업 스트럼을 하세요. 실제 줄 영역을 아래에서 위로 통과한 오른손만 계산합니다.' },",
  "  { id: 'down', title: '다운 스트럼', instruction: '화면의 가동범위 안에서 위쪽 문부터 아래쪽 문까지 통과하세요. 범위 밖으로 벗어난 동작은 세지 않습니다.' },\n  { id: 'up', title: '업 스트럼', instruction: '화면의 가동범위 안에서 아래쪽 문부터 위쪽 문까지 통과하세요. 범위 밖으로 벗어난 동작은 세지 않습니다.' },",
  'guided stroke instructions',
);
center = replaceOnce(
  center,
  "  pickPoint: null,\n  guitarModelScore: 0,",
  "  pickPoint: null,\n  strumGuide: null,\n  guideStatus: { ready: false, inside: false, lateralInside: false, normalInside: false, zone: 'unknown' },\n  guitarModelScore: 0,",
  'guide vision state',
);
center = replaceOnce(
  center,
  '  const handRoleRef = useRef(new HandRoleResolver());',
  '  const handRoleRef = useRef(new GuidedHandRoleResolver());\n  const guideRef = useRef(new StrumGuideCalibrator());',
  'guided resolver refs',
);

center = replaceRegexOnce(
  center,
  /  const drawOverlay = \(hands, lines, width, height\) => \{[\s\S]*?\n  \};\n\n  const processGuitar/,
  `  const drawOverlay = (hands, lines, guide, guideStatus, width, height) => {
    const canvas = overlayRef.current;
    if (!canvas || !width || !height) return;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, width, height);

    if (guide?.polygon?.length === 4) {
      const point = (entry) => ({ x: entry.x * width, y: entry.y * height });
      const polygon = guide.polygon.map(point);
      context.save();
      context.beginPath();
      context.moveTo(polygon[0].x, polygon[0].y);
      polygon.slice(1).forEach((entry) => context.lineTo(entry.x, entry.y));
      context.closePath();
      context.fillStyle = guideStatus?.inside ? 'rgba(52, 211, 153, 0.18)' : guideStatus?.ready ? 'rgba(248, 113, 113, 0.18)' : 'rgba(56, 189, 248, 0.16)';
      context.strokeStyle = guideStatus?.inside ? '#34d399' : guideStatus?.ready ? '#f87171' : '#38bdf8';
      context.lineWidth = Math.max(3, width / 280);
      context.setLineDash([Math.max(8, width / 70), Math.max(6, width / 100)]);
      context.fill();
      context.stroke();
      context.setLineDash([]);

      const drawGuideLine = (segment, color, lineWidth) => {
        if (!segment?.[0] || !segment?.[1]) return;
        context.beginPath();
        context.moveTo(segment[0].x * width, segment[0].y * height);
        context.lineTo(segment[1].x * width, segment[1].y * height);
        context.strokeStyle = color;
        context.lineWidth = lineWidth;
        context.stroke();
      };
      drawGuideLine(guide.topGate, '#fde047', Math.max(4, width / 220));
      drawGuideLine(guide.bottomGate, '#fde047', Math.max(4, width / 220));
      context.setLineDash([Math.max(5, width / 120), Math.max(5, width / 120)]);
      drawGuideLine(guide.centerLine, '#e0f2fe', Math.max(2, width / 420));
      context.restore();
    }

    context.lineWidth = Math.max(2, width / 420);
    for (const hand of hands || []) {
      const landmarks = hand?.landmarks || [];
      if (landmarks.length !== 21) continue;
      const selected = Boolean(hand.isStrumming);
      context.strokeStyle = selected ? '#f472b6' : '#34d399';
      context.fillStyle = selected ? '#f472b6' : '#34d399';
      for (const [start, end] of HAND_CONNECTIONS) {
        context.beginPath();
        context.moveTo(landmarks[start].x * width, landmarks[start].y * height);
        context.lineTo(landmarks[end].x * width, landmarks[end].y * height);
        context.stroke();
      }
      for (const landmark of landmarks) {
        context.beginPath();
        context.arc(landmark.x * width, landmark.y * height, Math.max(3, width / 230), 0, Math.PI * 2);
        context.fill();
      }
      if (hand.pickPoint) {
        context.beginPath();
        context.lineWidth = Math.max(4, width / 260);
        context.strokeStyle = selected ? '#f472b6' : '#f8fafc';
        context.arc(hand.pickPoint.x * width, hand.pickPoint.y * height, Math.max(8, width / 90), 0, Math.PI * 2);
        context.stroke();
      }
    }

    context.strokeStyle = '#fbbf24';
    context.lineWidth = Math.max(2, width / 360);
    for (const line of lines || []) {
      context.beginPath();
      context.moveTo(line.start.x * width, line.start.y * height);
      context.lineTo(line.end.x * width, line.end.y * height);
      context.stroke();
    }
  };

  const processGuitar`,
  'guided overlay renderer',
);

center = replaceOnce(
  center,
  "  const reasonForLock = (evidence) => {",
  "  const canCountGuidedStrum = (evidence) => canCountStrum(evidence)\n    && Boolean(evidence.strumGuide?.ready)\n    && Boolean(evidence.guideStatus?.inside);\n\n  const reasonForLock = (evidence) => {",
  'guided count helper',
);
center = replaceOnce(
  center,
  "    if (!evidence.strumHandSelected) reasons.push('스트럼 손 미선택');\n    return reasons.join(' · ') || '준비 완료';",
  "    if (!evidence.strumGuide?.ready) reasons.push('가동범위 맞춤 중');\n    else if (!evidence.guideStatus?.inside) reasons.push('교정 범위 밖');\n    if (!evidence.strumHandSelected) reasons.push('스트럼 손 미선택');\n    return reasons.join(' · ') || '준비 완료';",
  'guide lock reason',
);
center = replaceOnce(center, '      const ready = canCountStrum(evidence);', '      const ready = canCountGuidedStrum(evidence);', 'guided stage gate');

center = replaceRegexOnce(
  center,
  /  const processHands = \(video, timestamp\) => \{[\s\S]*?\n  \};\n\n  const analyzeImage/,
  `  const processHands = (video, timestamp) => {
    const handModel = modelRef.current.hand;
    if (!handModel || video.readyState < 2) return;
    try {
      const result = handModel.detectForVideo(video, timestamp);
      const rawHands = (result.landmarks || []).slice(0, 2).map((landmarks, index) => {
        const category = result.handednesses?.[index]?.[0];
        const confidence = landmarks.length === 21 ? Number(category?.score || 0.75) : 0;
        return {
          handedness: category?.categoryName || category?.displayName || 'Unknown',
          confidence,
          landmarks,
          wrist: landmarks[0] || null,
          pickPoint: estimateStrumContactPoint(landmarks),
        };
      });

      const preliminaryGuide = guideRef.current.guideFor(visionRef.current.stringBand);
      const role = handRoleRef.current.update({
        timestamp,
        hands: rawHands,
        band: visionRef.current.stringBand,
        guide: preliminaryGuide,
        ready: visionRef.current.stringCount >= 4 && visionRef.current.stringConfidence >= 0.32 && visionRef.current.guitarConfidence >= 0.3,
      });
      const selected = role.selectedHand;
      const fallback = [...role.hands].sort((left, right) => {
        const leftProjection = projectPointToBand(left.pickPoint, visionRef.current.stringBand);
        const rightProjection = projectPointToBand(right.pickPoint, visionRef.current.stringBand);
        const center = Number(visionRef.current.stringBand?.center || 0.5);
        return Math.abs((leftProjection ?? 99) - center) - Math.abs((rightProjection ?? 99) - center);
      })[0] || null;
      const activeHand = selected || fallback;
      const guide = selected?.pickPoint
        ? guideRef.current.observe(selected.pickPoint, visionRef.current.stringBand, { force: Boolean(role.event) })
        : preliminaryGuide;
      const guideStatus = evaluateStrumGuidePoint(activeHand?.pickPoint, visionRef.current.stringBand, guide);
      const bestHandConfidence = Math.max(0, ...role.hands.map((hand) => Number(hand.confidence || 0)));

      visionRef.current.hands = role.hands;
      visionRef.current.selectedTrackId = role.selectedId;
      visionRef.current.selectedHandedness = selected?.handedness || '자동 선택 중';
      visionRef.current.strumHandSelected = Boolean(selected);
      visionRef.current.handLandmarks = activeHand?.landmarks || [];
      visionRef.current.handConfidence = activeHand?.confidence || bestHandConfidence;
      visionRef.current.pickPoint = activeHand?.pickPoint || null;
      visionRef.current.strumGuide = guide;
      visionRef.current.guideStatus = guideStatus;
      visionRef.current.lastDirection = role.event || visionRef.current.lastDirection || 'none';
      summaryRef.current.maxHands = Math.max(summaryRef.current.maxHands, role.hands.length);
      evaluateStage(timestamp, role.event);
    } catch (error) {
      setModelStatus((status) => ({ ...status, hand: '실행 오류', error: String(error?.message || error) }));
    }
  };

  const analyzeImage`,
  'guided hand processing',
);

center = replaceOnce(
  center,
  '    visionRef.current.stringBand = stringResult.band;\n    visionRef.current.guitarAngle = stringResult.angle || 0;',
  '    visionRef.current.stringBand = stringResult.band;\n    visionRef.current.strumGuide = guideRef.current.guideFor(stringResult.band);\n    visionRef.current.guideStatus = evaluateStrumGuidePoint(visionRef.current.pickPoint, stringResult.band, visionRef.current.strumGuide);\n    visionRef.current.guitarAngle = stringResult.angle || 0;',
  'refresh guide with string band',
);
center = replaceOnce(
  center,
  '      drawOverlay(visionRef.current.hands, visionRef.current.stringLines, video.videoWidth, video.videoHeight);',
  '      drawOverlay(visionRef.current.hands, visionRef.current.stringLines, visionRef.current.strumGuide, visionRef.current.guideStatus, video.videoWidth, video.videoHeight);',
  'draw guide overlay',
);
center = replaceOnce(
  center,
  '    handRoleRef.current.reset();\n    countsRef.current = { down: 0, up: 0 };',
  '    handRoleRef.current.reset();\n    guideRef.current.reset();\n    countsRef.current = { down: 0, up: 0 };',
  'reset guide on begin',
);
center = replaceOnce(
  center,
  '    handRoleRef.current.reset();\n    countsRef.current[direction] = 0;',
  '    handRoleRef.current.reset();\n    guideRef.current.reset();\n    countsRef.current[direction] = 0;',
  'reset guide on direct stroke test',
);
center = replaceOnce(center, '    version: 3,', '    version: 4,', 'diagnostic version');
center = center.replaceAll('evidenceReady: canCountStrum(vision),', 'evidenceReady: canCountGuidedStrum(vision),');
center = replaceOnce(center, '  const evidenceReady = canCountStrum(vision);', '  const evidenceReady = canCountGuidedStrum(vision);', 'guided UI evidence');
center = replaceOnce(
  center,
  '          <p>기타를 중앙에 맞추지 않아도 됩니다. 실제로 보이는 줄 구간과 스트럼 손의 교차만 계산합니다.</p>',
  '          <p>실제 줄 구간을 찾은 뒤 스트럼 가동범위를 표시합니다. 범위 안에서 완전 교차한 동작만 계산합니다.</p>',
  'header guide description',
);
center = replaceOnce(
  center,
  '            <EvidencePill ok={vision.stringCount >= 4 && vision.stringConfidence >= 0.32} label="실제 줄" value={`${vision.stringCount}개 · ${percent(vision.stringConfidence)}`} />',
  '            <EvidencePill ok={vision.stringCount >= 4 && vision.stringConfidence >= 0.32} label="실제 줄" value={`${vision.stringCount}개 · ${percent(vision.stringConfidence)}`} />\n            <EvidencePill ok={vision.guideStatus?.inside} label="가동범위" value={vision.strumGuide?.calibrated ? (vision.guideStatus?.inside ? \'안쪽\' : \'밖\') : \'자동 맞춤 중\'} />',
  'guide evidence pill',
);
center = replaceOnce(
  center,
  "              <div className={evidenceReady ? 'debug-voice-result' : 'debug-error'}>{evidenceReady ? '방향 감지 준비 완료' : vision.lockReason}</div>",
  "              <div className={evidenceReady ? 'debug-voice-result' : 'debug-error'}>{evidenceReady ? '초록 가동범위 안 · 완전 교차만 카운트' : vision.lockReason}</div>",
  'guide feedback message',
);
center = replaceOnce(
  center,
  '            <div><strong>실제 줄 구간</strong> {Math.round((vision.stringBand?.supportLength || 0) * 100)}%</div>',
  '            <div><strong>실제 줄 구간</strong> {Math.round((vision.stringBand?.supportLength || 0) * 100)}%</div>\n            <div><strong>교정 가동범위</strong> {vision.strumGuide?.calibrated ? (vision.guideStatus?.inside ? \'범위 안\' : \'범위 밖 · 손을 색상 영역 안으로 이동\') : \'첫 유효 스트럼으로 자동 맞춤\'}</div>',
  'guide threshold detail',
);

writeFileSync(centerPath, center);
console.log('Applied guided strum corridor, thumb-index contact tracking, and strict full-crossing count gate.');
