import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Manual-calibration target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Manual-calibration target is ambiguous: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function insertAfterLineContaining(source, needle, insertion, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`Manual-calibration line missing: ${label}`);
  if (source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`Manual-calibration line is ambiguous: ${label}`);
  }
  const lineEnd = source.indexOf('\n', first);
  if (lineEnd < 0) throw new Error(`Manual-calibration line ending missing: ${label}`);
  return source.slice(0, lineEnd + 1) + insertion + source.slice(lineEnd + 1);
}

function patchAutomaticPoseBlock(source) {
  const marker = 'const pose = backlitGuitarRecoveryRef.current.update({';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('Manual-calibration automatic pose block missing');
  if (source.indexOf(marker, start + marker.length) >= 0) {
    throw new Error('Manual-calibration automatic pose block is ambiguous');
  }
  const assignment = 'poseRef.current = pose;';
  const assignmentAt = source.indexOf(assignment, start);
  if (assignmentAt < 0) throw new Error('Manual-calibration pose assignment missing');
  const blockEnd = assignmentAt + assignment.length;
  const block = source.slice(start, blockEnd);
  const patched = block
    .replace('const pose = backlitGuitarRecoveryRef.current.update({', 'const automaticPose = backlitGuitarRecoveryRef.current.update({')
    .replace(
      assignment,
      `const manualPose = manualGuitarCalibrationRef.current.poseFor(timestamp);
      const pose = manualPose || automaticPose;
      poseRef.current = pose;
      visionRef.current.manualCalibrationReady = Boolean(manualPose);
      visionRef.current.manualCalibrationStep = manualGuitarCalibrationRef.current.snapshot().step;
      if (manualPose) {
        visionRef.current.stringBand = manualPose.stringBand;
        visionRef.current.stringLines = manualPose.lines;
        visionRef.current.stringCount = manualPose.lines.length;
        visionRef.current.stringConfidence = manualPose.confidence;
        visionRef.current.guitarConfidence = manualPose.confidence;
        visionRef.current.guitarModelScore = manualPose.confidence;
        visionRef.current.guitarAngle = manualPose.stringBand.angle || 0;
      }`,
    );
  return source.slice(0, start) + patched + source.slice(blockEnd);
}

function patchManualOverlayMarkers(source) {
  const marker = '  };\n\n  const processGuitar';
  const first = source.indexOf(marker);
  if (first < 0) throw new Error('Manual-calibration draw overlay ending missing');
  if (source.indexOf(marker, first + marker.length) >= 0) {
    throw new Error('Manual-calibration draw overlay ending is ambiguous');
  }
  const drawing = `    const manualSnapshot = manualGuitarCalibrationRef.current.snapshot();
    if (manualSnapshot.points.length) {
      const colors = ['#facc15', '#38bdf8', '#f472b6'];
      const labels = ['1', '2', '3'];
      context.save();
      context.font = \`bold \${Math.max(14, width / 42)}px sans-serif\`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      manualSnapshot.points.forEach((entry, index) => {
        const x = entry.x * width;
        const y = entry.y * height;
        context.beginPath();
        context.arc(x, y, Math.max(12, width / 55), 0, Math.PI * 2);
        context.fillStyle = 'rgba(15, 23, 42, 0.78)';
        context.fill();
        context.lineWidth = Math.max(4, width / 240);
        context.strokeStyle = colors[index] || '#f8fafc';
        context.stroke();
        context.fillStyle = '#f8fafc';
        context.fillText(labels[index] || String(index + 1), x, y);
      });
      if (manualSnapshot.points.length >= 2) {
        context.beginPath();
        context.moveTo(manualSnapshot.points[0].x * width, manualSnapshot.points[0].y * height);
        context.lineTo(manualSnapshot.points[1].x * width, manualSnapshot.points[1].y * height);
        context.strokeStyle = '#38bdf8';
        context.lineWidth = Math.max(3, width / 300);
        context.setLineDash([Math.max(7, width / 95), Math.max(5, width / 125)]);
        context.stroke();
      }
      context.restore();
    }
`;
  return source.slice(0, first) + drawing + source.slice(first);
}

const centerPath = resolve(process.cwd(), 'src/AdaptiveDebugCenter.jsx');
let center = readFileSync(centerPath, 'utf8');

if (!center.includes("from './manual-guitar-calibration.js'")) {
  center = "import { ManualGuitarCalibration, mapMirroredCoverPointer } from './manual-guitar-calibration.js';\n" + center;

  center = replaceOnce(
    center,
    '  const strongGuitarConsensusRef = useRef(new StrongGuitarConsensus());',
    `  const strongGuitarConsensusRef = useRef(new StrongGuitarConsensus());
  const manualGuitarCalibrationRef = useRef(new ManualGuitarCalibration());
  const [manualGuitarCalibration, setManualGuitarCalibration] = useState(() => manualGuitarCalibrationRef.current.snapshot());`,
    'manual calibration ref and state',
  );

  center = patchAutomaticPoseBlock(center);

  center = replaceOnce(
    center,
    '    visionRef.current.stringBand = stringResult.band;',
    `    const manualPoseForStrings = manualGuitarCalibrationRef.current.poseFor(timestamp);
    const activeStringBand = manualPoseForStrings?.stringBand || stringResult.band;
    visionRef.current.stringBand = activeStringBand;`,
    'manual string band override',
  );
  center = replaceOnce(
    center,
    '    visionRef.current.strumGuide = guideRef.current.guideFor(stringResult.band);',
    '    visionRef.current.strumGuide = guideRef.current.guideFor(activeStringBand);',
    'manual guide band',
  );
  center = replaceOnce(
    center,
    '    visionRef.current.guideStatus = evaluateStrumGuidePoint(visionRef.current.pickPoint, stringResult.band, visionRef.current.strumGuide);',
    '    visionRef.current.guideStatus = evaluateStrumGuidePoint(visionRef.current.pickPoint, activeStringBand, visionRef.current.strumGuide);',
    'manual guide status band',
  );
  center = replaceOnce(
    center,
    '    visionRef.current.guitarAngle = stringResult.angle || 0;',
    `    visionRef.current.guitarAngle = manualPoseForStrings?.stringBand?.angle || stringResult.angle || 0;
    if (manualPoseForStrings) {
      visionRef.current.stringLines = manualPoseForStrings.lines;
      visionRef.current.stringCount = manualPoseForStrings.lines.length;
      visionRef.current.stringConfidence = manualPoseForStrings.confidence;
      visionRef.current.guitarConfidence = manualPoseForStrings.confidence;
      visionRef.current.guitarModelScore = manualPoseForStrings.confidence;
      visionRef.current.manualCalibrationReady = true;
    }`,
    'manual string evidence override',
  );

  center = replaceOnce(
    center,
    `  const canCountGuidedStrum = (evidence) => canCountStrum(evidence)
    && Boolean(evidence.strumGuide?.ready)
    && Boolean(evidence.guideStatus?.inside);`,
    `  const canCountGuidedStrum = (evidence) => {
    const baseReady = evidence.manualCalibrationReady
      ? Boolean(evidence.strumHandSelected && evidence.stringBand)
      : canCountStrum(evidence);
    return baseReady
      && Boolean(evidence.strumGuide?.ready)
      && Boolean(evidence.guideStatus?.inside);
  };`,
    'manual guided count gate',
  );

  const uiFunctions = `  const applyManualGuitarPose = (pose) => {
    if (!pose) return;
    poseRef.current = pose;
    visionRef.current.stringBand = pose.stringBand;
    visionRef.current.stringLines = pose.lines;
    visionRef.current.stringCount = pose.lines.length;
    visionRef.current.stringConfidence = pose.confidence;
    visionRef.current.guitarConfidence = pose.confidence;
    visionRef.current.guitarModelScore = pose.confidence;
    visionRef.current.guitarAngle = pose.stringBand.angle || 0;
    visionRef.current.manualCalibrationReady = true;
    visionRef.current.manualCalibrationStep = 3;
    visionRef.current.guitarPartialRecovery = {
      ready: true,
      confidence: pose.confidence,
      source: 'manual-three-point',
      label: '수동 3점 보정',
      reason: pose.validationReason,
    };
    guideRef.current.reset();
    adaptiveLiveStrumRef.current.reset();
  };

  const beginManualGuitarCalibration = () => {
    guideRef.current.reset();
    adaptiveLiveStrumRef.current.reset();
    setManualGuitarCalibration(manualGuitarCalibrationRef.current.begin());
  };

  const cancelManualGuitarCalibration = () => {
    setManualGuitarCalibration(manualGuitarCalibrationRef.current.cancel());
  };

  const clearManualGuitarCalibration = () => {
    setManualGuitarCalibration(manualGuitarCalibrationRef.current.clear());
    visionRef.current.manualCalibrationReady = false;
    visionRef.current.manualCalibrationStep = 1;
    visionRef.current.guitarPartialRecovery = null;
    poseRef.current = null;
    guideRef.current.reset();
    adaptiveLiveStrumRef.current.reset();
  };

  const handleManualCalibrationPointer = (event) => {
    if (!manualGuitarCalibrationRef.current.snapshot().active) return;
    event.preventDefault();
    const canvas = event.currentTarget;
    const video = videoRef.current;
    const mapped = mapMirroredCoverPointer({
      clientX: event.clientX,
      clientY: event.clientY,
      rect: canvas.getBoundingClientRect(),
      sourceWidth: video?.videoWidth || canvas.width,
      sourceHeight: video?.videoHeight || canvas.height,
    });
    const next = manualGuitarCalibrationRef.current.addPoint(mapped, performance.now());
    if (next.ready) applyManualGuitarPose(next.pose);
    setManualGuitarCalibration(next);
  };

`;
  center = replaceOnce(
    center,
    '  const evidenceReady = canCountGuidedStrum(vision);',
    `${uiFunctions}  const evidenceReady = canCountGuidedStrum(vision);`,
    'manual calibration UI handlers',
  );

  center = replaceOnce(
    center,
    '            ref={overlayRef}\n            style={{',
    '            ref={overlayRef}\n            onPointerDown={handleManualCalibrationPointer}\n            style={{',
    'manual calibration canvas pointer handler',
  );
  center = replaceOnce(
    center,
    "              pointerEvents: 'none',",
    "              pointerEvents: manualGuitarCalibration.active ? 'auto' : 'none',\n              cursor: manualGuitarCalibration.active ? 'crosshair' : 'default',\n              touchAction: manualGuitarCalibration.active ? 'none' : 'auto',",
    'manual calibration canvas pointer style',
  );

  center = patchManualOverlayMarkers(center);

  center = replaceOnce(
    center,
    `  label: pose.recoverySource === 'internal-pose-consensus'
    ? '사운드홀·넥·6줄 원본 합의'
    : '양손 축 적용',`,
    `  label: pose.recoverySource === 'manual-three-point'
    ? '수동 3점 보정'
    : pose.recoverySource === 'internal-pose-consensus'
      ? '사운드홀·넥·6줄 원본 합의'
      : '양손 축 적용',`,
    'manual recovery label',
  );

  center = insertAfterLineContaining(
    center,
    'label="기타 판정 복구"',
    `            <EvidencePill ok={manualGuitarCalibration.ready} label="수동 3점 보정" value={manualGuitarCalibration.ready ? '적용됨' : manualGuitarCalibration.active ? \`진행 \${manualGuitarCalibration.step}/3\` : '필요 시 사용'} />
`,
    'manual calibration evidence pill',
  );

  const manualPanel = `              {(!evidenceReady || manualGuitarCalibration.active || manualGuitarCalibration.ready) && (
                <div style={{ marginTop: 10, padding: 12, border: '1px solid rgba(56, 189, 248, 0.42)', borderRadius: 12, background: 'rgba(15, 23, 42, 0.72)', display: 'grid', gap: 8 }}>
                  <strong>자동 인식이 안 될 때 · 수동 3점 보정</strong>
                  <span>{manualGuitarCalibration.instruction}</span>
                  {manualGuitarCalibration.error && <span className="debug-error">{manualGuitarCalibration.error}</span>}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {!manualGuitarCalibration.active && !manualGuitarCalibration.ready && (
                      <button type="button" onClick={beginManualGuitarCalibration}>수동 3점 보정 시작</button>
                    )}
                    {manualGuitarCalibration.active && (
                      <button type="button" onClick={cancelManualGuitarCalibration}>보정 취소</button>
                    )}
                    {manualGuitarCalibration.ready && (
                      <button type="button" onClick={beginManualGuitarCalibration}>다시 보정</button>
                    )}
                    {(manualGuitarCalibration.active || manualGuitarCalibration.ready) && (
                      <button type="button" onClick={clearManualGuitarCalibration}>보정 지우기</button>
                    )}
                  </div>
                  <small>순서: 사운드홀 가운데 → 헤드 쪽 넥/줄 → 피크가 줄에 닿는 위치</small>
                </div>
              )}
`;
  center = insertAfterLineContaining(
    center,
    "className={evidenceReady ? 'debug-voice-result' : 'debug-error'}",
    manualPanel,
    'manual calibration controls',
  );

  center = replaceOnce(center, '    version: 9,', '    version: 10,', 'manual diagnostic report version');
  writeFileSync(centerPath, center);
}

console.log('Connected manual three-point guitar calibration as a safe fallback for locked automatic recognition.');
