import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Manual-calibration-v3 target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Manual-calibration-v3 target is ambiguous: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceOptional(source, before, after) {
  const first = source.indexOf(before);
  if (first < 0) return source;
  if (source.indexOf(before, first + before.length) >= 0) return source;
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function insertAfterLineContaining(source, needle, insertion, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`Manual-calibration-v3 line missing: ${label}`);
  const lineEnd = source.indexOf('\n', first);
  if (lineEnd < 0) throw new Error(`Manual-calibration-v3 line ending missing: ${label}`);
  return source.slice(0, lineEnd + 1) + insertion + source.slice(lineEnd + 1);
}

function insertBeforeComponentReturn(source, insertion) {
  const marker = '\n  return (';
  const at = source.lastIndexOf(marker);
  if (at < 0) throw new Error('Manual-calibration-v3 component return missing');
  return source.slice(0, at + 1) + insertion + source.slice(at + 1);
}

function patchFinalPose(source) {
  const marker = 'const pose = backlitGuitarRecoveryRef.current.update({';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('Manual-calibration-v3 final pose block missing');
  if (source.indexOf(marker, start + marker.length) >= 0) throw new Error('Manual-calibration-v3 final pose block is ambiguous');
  const assignment = 'poseRef.current = pose;';
  const assignmentAt = source.indexOf(assignment, start);
  if (assignmentAt < 0) throw new Error('Manual-calibration-v3 pose assignment missing');
  const end = assignmentAt + assignment.length;
  const block = source.slice(start, end);
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
        visionRef.current.adaptiveStrumReason = 'manual-three-point-ready';
      }`,
    );
  return source.slice(0, start) + patched + source.slice(end);
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
    'manual state',
  );

  center = patchFinalPose(center);

  const handlers = `  const applyManualGuitarPose = (pose) => {
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
    visionRef.current.adaptiveStrumReason = 'manual-three-point-ready';
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
    visionRef.current.adaptiveStrumReason = 'manual-three-point-cleared';
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
  center = insertBeforeComponentReturn(center, handlers);

  center = replaceOnce(
    center,
    '            ref={overlayRef}\n            style={{',
    '            ref={overlayRef}\n            onPointerDown={handleManualCalibrationPointer}\n            style={{',
    'canvas pointer',
  );
  center = replaceOnce(
    center,
    "              pointerEvents: 'none',",
    "              pointerEvents: manualGuitarCalibration.active ? 'auto' : 'none',\n              cursor: manualGuitarCalibration.active ? 'crosshair' : 'default',\n              touchAction: manualGuitarCalibration.active ? 'none' : 'auto',",
    'canvas interaction',
  );

  center = replaceOptional(
    center,
    `  label: pose.recoverySource === 'internal-pose-consensus'
    ? '사운드홀·넥·6줄 원본 합의'
    : '양손 축 적용',`,
    `  label: pose.recoverySource === 'manual-three-point'
    ? '수동 3점 보정'
    : pose.recoverySource === 'internal-pose-consensus'
      ? '사운드홀·넥·6줄 원본 합의'
      : '양손 축 적용',`,
  );

  center = insertAfterLineContaining(
    center,
    'label="기타 판정 복구"',
    `            <EvidencePill ok={manualGuitarCalibration.ready} label="수동 3점 보정" value={manualGuitarCalibration.ready ? '적용됨' : manualGuitarCalibration.active ? \`진행 \${manualGuitarCalibration.step}/3\` : '필요 시 사용'} />
`,
    'manual evidence pill',
  );

  const panel = `              {(!evidenceReady || manualGuitarCalibration.active || manualGuitarCalibration.ready) && (
                <div style={{ marginTop: 10, padding: 12, border: '1px solid rgba(56, 189, 248, 0.42)', borderRadius: 12, background: 'rgba(15, 23, 42, 0.72)', display: 'grid', gap: 8 }}>
                  <strong>자동 인식이 안 될 때 · 수동 3점 보정</strong>
                  <span>{manualGuitarCalibration.instruction}</span>
                  {manualGuitarCalibration.error && <span className="debug-error">{manualGuitarCalibration.error}</span>}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {!manualGuitarCalibration.active && !manualGuitarCalibration.ready && <button type="button" onClick={beginManualGuitarCalibration}>수동 3점 보정 시작</button>}
                    {manualGuitarCalibration.active && <button type="button" onClick={cancelManualGuitarCalibration}>보정 취소</button>}
                    {manualGuitarCalibration.ready && <button type="button" onClick={beginManualGuitarCalibration}>다시 보정</button>}
                    {(manualGuitarCalibration.active || manualGuitarCalibration.ready) && <button type="button" onClick={clearManualGuitarCalibration}>보정 지우기</button>}
                  </div>
                  <small>순서: 사운드홀 가운데 → 헤드 쪽 넥/줄 → 피크가 줄에 닿는 위치</small>
                </div>
              )}
`;
  center = insertAfterLineContaining(
    center,
    "className={evidenceReady ? 'debug-voice-result' : 'debug-error'}",
    panel,
    'manual panel',
  );

  center = replaceOptional(center, '    version: 9,', '    version: 10,');
  writeFileSync(centerPath, center);
}

console.log('Connected manual three-point calibration without depending on overlay-renderer layout.');
