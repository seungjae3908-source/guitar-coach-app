import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Right-hand-technique target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Right-hand-technique target is ambiguous: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceRegexOnce(source, pattern, replacement, label) {
  pattern.lastIndex = 0;
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length === 0) throw new Error(`Right-hand-technique regex target missing: ${label}`);
  if (matches.length > 1) throw new Error(`Right-hand-technique regex target is ambiguous: ${label}`);
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

const centerPath = resolve(process.cwd(), 'src/AdaptiveDebugCenter.jsx');
let center = readFileSync(centerPath, 'utf8');
if (center.includes("from './right-hand-technique.js'")) {
  console.log('Right-hand arm, wrist, picking, and fingerstyle analysis already applied.');
  process.exit(0);
}

center = "import { RightHandTechniqueAnalyzer } from './right-hand-technique.js';\n" + center;
center = replaceOnce(
  center,
  "import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';",
  "import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';",
  'pose landmarker import',
);
center = replaceOnce(
  center,
  "  const modelRef = useRef({ loading: null, hand: null, error: '' });",
  "  const modelRef = useRef({ loading: null, hand: null, pose: null, poseUnavailable: false, error: '' });",
  'pose model state',
);
center = replaceOnce(
  center,
  '  const adaptiveLiveStrumRef = useRef(new AdaptiveLiveStrumEngine());',
  `  const adaptiveLiveStrumRef = useRef(new AdaptiveLiveStrumEngine());
  const rightHandTechniqueRef = useRef(new RightHandTechniqueAnalyzer());
  const bodyPoseRef = useRef(null);
  const lastBodyPoseAtRef = useRef(0);`,
  'right hand analysis refs',
);
center = replaceOnce(
  center,
  '    if (modelRef.current.hand) return;',
  '    if (modelRef.current.hand && (modelRef.current.pose || modelRef.current.poseUnavailable)) return;',
  'model readiness gate',
);
center = replaceOnce(
  center,
  `      }
      setModelStatus({ hand: '준비 완료', guitar: '형태 분석 준비 완료', error: '' });`,
  `      }
      const poseOptions = {
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.34,
        minPosePresenceConfidence: 0.34,
        minTrackingConfidence: 0.3,
      };
      try {
        modelRef.current.pose = await PoseLandmarker.createFromOptions(files, {
          ...poseOptions,
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'GPU',
          },
        });
      } catch (poseGpuError) {
        try {
          modelRef.current.pose = await PoseLandmarker.createFromOptions(files, {
            ...poseOptions,
            baseOptions: {
              modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
              delegate: 'CPU',
            },
          });
          addLog(\`GPU 자세 모델 대신 CPU 모드 사용 · \${poseGpuError?.message || poseGpuError}\`, 'warn');
        } catch (poseError) {
          modelRef.current.poseUnavailable = true;
          modelRef.current.pose = null;
          addLog(\`팔·손목 구분용 자세 모델 판정 불가 · \${poseError?.message || poseError}\`, 'warn');
        }
      }
      setModelStatus({
        hand: modelRef.current.pose ? '손·팔 자세 준비 완료' : '손 준비 완료 · 팔 자세 판정 불가',
        guitar: '형태 분석 준비 완료',
        error: '',
      });`,
  'pose model initialization',
);
center = replaceOnce(
  center,
  '  const processHands = (video, timestamp) => {',
  `  const processBodyPose = (video, timestamp) => {
    const model = modelRef.current.pose;
    if (!model || video.readyState < 2) return;
    try {
      const result = model.detectForVideo(video, timestamp);
      const landmarks = result.landmarks?.[0] || [];
      if (landmarks.length >= 17) {
        bodyPoseRef.current = { landmarks, at: timestamp };
        visionRef.current.bodyPoseLandmarks = landmarks;
        visionRef.current.bodyPoseReady = true;
      } else if (bodyPoseRef.current && timestamp - bodyPoseRef.current.at <= 360) {
        visionRef.current.bodyPoseLandmarks = bodyPoseRef.current.landmarks;
        visionRef.current.bodyPoseReady = true;
      } else {
        bodyPoseRef.current = null;
        visionRef.current.bodyPoseLandmarks = [];
        visionRef.current.bodyPoseReady = false;
      }
    } catch (error) {
      if (!bodyPoseRef.current || timestamp - bodyPoseRef.current.at > 360) {
        visionRef.current.bodyPoseReady = false;
      }
    }
  };

  const processHands = (video, timestamp) => {`,
  'body pose processing',
);
center = replaceOnce(
  center,
  '      const landmarkEvent = adaptiveStrum.event;',
  `      const landmarkEvent = adaptiveStrum.event;
      const rightHandTechnique = rightHandTechniqueRef.current.update({
        timestamp,
        hand: strumHand,
        bodyLandmarks: bodyPoseRef.current?.landmarks || [],
        band: adaptiveStrum.band,
        strokeEvent: landmarkEvent,
      });
      visionRef.current.rightHandTechnique = rightHandTechnique;
      visionRef.current.bodyPoseReady = rightHandTechnique.poseReady;`,
  'live right hand analysis',
);
center = replaceOnce(
  center,
  '    for (const hand of visionRef.current.hands || []) {',
  `    const bodyPose = visionRef.current.bodyPoseLandmarks || [];
    const technique = visionRef.current.rightHandTechnique;
    const armIndices = technique?.poseSide === 'left' ? [11, 13, 15] : technique?.poseSide === 'right' ? [12, 14, 16] : null;
    if (armIndices && bodyPose.length >= 17 && armIndices.every((index) => bodyPose[index])) {
      const armColor = technique.movementType === 'wrist' ? '#4ade80' : technique.movementType === 'arm' ? '#fb7185' : '#facc15';
      context.save();
      context.strokeStyle = armColor;
      context.fillStyle = armColor;
      context.lineWidth = Math.max(4, width / 260);
      context.setLineDash([]);
      context.beginPath();
      context.moveTo(bodyPose[armIndices[0]].x * width, bodyPose[armIndices[0]].y * height);
      context.lineTo(bodyPose[armIndices[1]].x * width, bodyPose[armIndices[1]].y * height);
      context.lineTo(bodyPose[armIndices[2]].x * width, bodyPose[armIndices[2]].y * height);
      context.stroke();
      for (const index of armIndices) {
        context.beginPath();
        context.arc(bodyPose[index].x * width, bodyPose[index].y * height, Math.max(4, width / 150), 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
    }

    for (const hand of visionRef.current.hands || []) {`,
  'arm overlay',
);
center = replaceRegexOnce(
  center,
  /(    if \(timestamp - lastHandAtRef\.current >= HAND_SAMPLE_INTERVAL_MS\) \{)/,
  `    if (timestamp - lastBodyPoseAtRef.current >= 90) {
      lastBodyPoseAtRef.current = timestamp;
      processBodyPose(video, timestamp);
    }
$1`,
  'body pose sampling cadence',
);
center = replaceOnce(
  center,
  `    motionTrackerRef.current.reset();
    adaptiveLiveStrumRef.current.reset();`,
  `    motionTrackerRef.current.reset();
    adaptiveLiveStrumRef.current.reset();
    rightHandTechniqueRef.current.reset();
    bodyPoseRef.current = null;
    lastBodyPoseAtRef.current = 0;`,
  'right hand reset',
);
center = replaceOnce(
  center,
  '            <EvidencePill ok={vision.strumHandSelected} label="스트럼 손" value={vision.strumHandedness} />',
  `            <EvidencePill ok={vision.strumHandSelected} label="스트럼 손" value={vision.strumHandedness} />
            <EvidencePill ok={vision.bodyPoseReady} label="팔 자세" value={vision.bodyPoseReady ? '어깨·팔꿈치·손목 연결' : '관절이 보이게 조정'} />
            <EvidencePill ok={Number(vision.rightHandTechnique?.movementConfidence || 0) >= 0.45} label="동작 기준" value={vision.rightHandTechnique?.movementLabel || '분석 대기'} />
            <EvidencePill ok={Number(vision.rightHandTechnique?.wristRatio || 0) >= 0.55} label="손목 사용" value={percent(vision.rightHandTechnique?.wristRatio || 0)} />
            <EvidencePill ok={Number(vision.rightHandTechnique?.armRatio || 0) < 0.55} label="팔 개입" value={percent(vision.rightHandTechnique?.armRatio || 0)} />`,
  'technique evidence pills',
);
center = replaceOnce(
  center,
  `            <EvidencePill ok={evidenceReady} label="실제 줄 구간" value={evidenceReady ? '방향 감지 준비 완료' : vision.lockReason || '대기'} />
          </div>
          <div className="debug-controls">`,
  `            <EvidencePill ok={evidenceReady} label="실제 줄 구간" value={evidenceReady ? '방향 감지 준비 완료' : vision.lockReason || '대기'} />
          </div>
          <div style={{ marginTop: 12, padding: 12, border: '1px solid rgba(148,163,184,.24)', borderRadius: 14, display: 'grid', gap: 7 }}>
            <strong>오른손 정밀 코치</strong>
            <span>팔·손목 판정: {vision.rightHandTechnique?.movementLabel || '분석 대기'} · 신뢰도 {percent(vision.rightHandTechnique?.movementConfidence || 0)}</span>
            <span>빠른 스트럼: {Number(vision.rightHandTechnique?.strumSps || 0).toFixed(1)}회/초 · 정확도 {percent(vision.rightHandTechnique?.fastStrumAccuracy || 0)} · 최고 안정 {Number(vision.rightHandTechnique?.maxStableSps || 0).toFixed(1)}회/초</span>
            <span>피킹: {Number(vision.rightHandTechnique?.pickingSps || 0).toFixed(1)}회/초 · 업다운 균형 {percent(vision.rightHandTechnique?.pickingAlternation || 0)} · 정확도 {percent(vision.rightHandTechnique?.pickingAccuracy || 0)}</span>
            <span>아르페지오: {vision.rightHandTechnique?.detectedPattern || '자동 분석 중'} · 순서 정확도 {percent(vision.rightHandTechnique?.patternAccuracy || 0)}</span>
            <span>쓰리핑거: {Number(vision.rightHandTechnique?.threeFingerSps || 0).toFixed(1)}회/초 · 독립성 {percent(vision.rightHandTechnique?.independence || 0)} · 복귀 {Math.round(Number(vision.rightHandTechnique?.returnMs || 0))}ms</span>
          </div>
          <div className="debug-controls">`,
  'right hand coaching panel',
);
center = replaceOnce(
  center,
  '            <div><span>동작 FPS</span><strong>{stats.fps}</strong></div>',
  `            <div><span>동작 FPS</span><strong>{stats.fps}</strong></div>
            <div><span>스트럼 속도</span><strong>{Number(vision.rightHandTechnique?.strumSps || 0).toFixed(1)}/초</strong></div>
            <div><span>피킹 속도</span><strong>{Number(vision.rightHandTechnique?.pickingSps || 0).toFixed(1)}/초</strong></div>
            <div><span>쓰리핑거</span><strong>{Number(vision.rightHandTechnique?.threeFingerSps || 0).toFixed(1)}/초</strong></div>`,
  'live speed cards',
);
center = replaceOnce(center, '    version: 4,', '    version: 5,', 'diagnostic report version');

writeFileSync(centerPath, center);
console.log('Applied pose-backed arm/wrist separation plus fast strum, picking, arpeggio, and three-finger metrics.');
