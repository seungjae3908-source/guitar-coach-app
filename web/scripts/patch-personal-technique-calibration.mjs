import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Personal-calibration target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Personal-calibration target is ambiguous: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const centerPath = resolve(process.cwd(), 'src/AdaptiveDebugCenter.jsx');
let center = readFileSync(centerPath, 'utf8');

if (!center.includes("from './personal-technique-calibration.js'")) {
  center = replaceOnce(
    center,
    "import { MultiAngleRightHandTechniqueAnalyzer } from './multi-angle-right-hand.js';",
    "import { PersonalizedRightHandTechniqueAnalyzer } from './personal-technique-calibration.js';",
    'personal analyzer import',
  );
  center = replaceOnce(
    center,
    'const rightHandTechniqueRef = useRef(new MultiAngleRightHandTechniqueAnalyzer());',
    'const rightHandTechniqueRef = useRef(new PersonalizedRightHandTechniqueAnalyzer());',
    'personal analyzer instance',
  );
  center = replaceOnce(
    center,
    `      visionRef.current.rightHandTechnique = rightHandTechnique;
      visionRef.current.bodyPoseReady = rightHandTechnique.poseReady;`,
    `      visionRef.current.rightHandTechnique = rightHandTechnique;
      visionRef.current.bodyPoseReady = rightHandTechnique.poseReady;
      adaptiveLiveStrumRef.current.setPersonalCalibration(rightHandTechnique.personalCalibrationTuning);`,
    'apply personal tuning to live strum engine',
  );
  center = replaceOnce(
    center,
    `            <EvidencePill ok={Number(vision.rightHandTechnique?.angleCorrectionConfidence || 0) >= 0.45} label="각도 보정" value={percent(vision.rightHandTechnique?.angleCorrectionConfidence || 0)} />`,
    `            <EvidencePill ok={Number(vision.rightHandTechnique?.angleCorrectionConfidence || 0) >= 0.45} label="각도 보정" value={percent(vision.rightHandTechnique?.angleCorrectionConfidence || 0)} />
            <EvidencePill ok={Boolean(vision.rightHandTechnique?.personalCalibrationReady)} label="개인 보정" value={vision.rightHandTechnique?.personalCalibrationReady ? \`적용 · \${vision.rightHandTechnique?.personalCalibrationCoverage || 1}각도\` : \`학습 \${Math.round(Number(vision.rightHandTechnique?.personalCalibrationProgress || 0) * 100)}%\`} />`,
    'personal calibration evidence',
  );
  center = replaceOnce(
    center,
    `            <span>촬영 각도: {vision.rightHandTechnique?.cameraViewLabel || '분석 중'} · 자동 보정 {percent(vision.rightHandTechnique?.angleCorrectionConfidence || 0)} · 카메라 기울기 {Math.round(Number(vision.rightHandTechnique?.cameraRollDegrees || 0))}°</span>`,
    `            <span>촬영 각도: {vision.rightHandTechnique?.cameraViewLabel || '분석 중'} · 자동 보정 {percent(vision.rightHandTechnique?.angleCorrectionConfidence || 0)} · 카메라 기울기 {Math.round(Number(vision.rightHandTechnique?.cameraRollDegrees || 0))}°</span>
            <span>개인 자동 보정: {vision.rightHandTechnique?.personalCalibrationFeedback || '학습 대기'} · 현재 각도 {Math.round(Number(vision.rightHandTechnique?.personalCalibrationProgress || 0) * 100)}% · 기준 일치 {percent(vision.rightHandTechnique?.personalBaselineSimilarity || 0)}</span>`,
    'personal calibration coaching row',
  );
  center = replaceOnce(center, '    version: 6,', '    version: 7,', 'diagnostic report version');
  writeFileSync(centerPath, center);
}

const strumPath = resolve(process.cwd(), 'src/adaptive-strum-live.js');
let strum = readFileSync(strumPath, 'utf8');

if (!strum.includes('setPersonalCalibration(calibration')) {
  strum = replaceOnce(
    strum,
    `  reset() {
    this.selectedId = null;`,
    `  reset() {
    const retainedPersonalCalibration = this.personalCalibration || null;
    this.selectedId = null;`,
    'retain personal calibration across camera reset',
  );
  strum = replaceOnce(
    strum,
    `    this.lastReason = 'waiting';
  }
  stabilizeBand(derived, timestamp) {`,
    `    this.lastReason = 'waiting';
    this.personalCalibration = retainedPersonalCalibration;
  }
  setPersonalCalibration(calibration = null) {
    if (!calibration || finite(calibration.confidence) < 0.18) {
      this.personalCalibration = null;
      return;
    }
    this.personalCalibration = {
      palmScale: clamp(finite(calibration.palmScale), 0.025, 0.28),
      bandWidth: clamp(finite(calibration.bandWidth), 0.006, 0.16),
      pinchRatio: clamp(finite(calibration.pinchRatio), 0.02, 2.8),
      confidence: clamp(finite(calibration.confidence)),
      source: calibration.source || 'personal',
      bucket: calibration.bucket || 'global',
    };
  }
  stabilizeBand(derived, timestamp) {`,
    'personal calibration setter',
  );
  strum = replaceOnce(
    strum,
    '  sample({ point, band, timestamp, ready }) {',
    '  sample({ point, band, timestamp, ready, calibration = null }) {',
    'tracker calibration input',
  );
  strum = replaceOnce(
    strum,
    `    const bandWidth = Math.max(0.008, finite(band.bottom) - finite(band.top));
    const crossingScale = Math.max(bandWidth, palmScale * 0.24);`,
    `    const liveBandWidth = Math.max(0.008, finite(band.bottom) - finite(band.top));
    const learnedBandWidth = clamp(finite(calibration?.bandWidth), 0.006, 0.16);
    const calibrationWeight = learnedBandWidth > 0 ? clamp(finite(calibration?.confidence) * 0.58, 0, 0.52) : 0;
    const bandWidth = liveBandWidth * (1 - calibrationWeight) + learnedBandWidth * calibrationWeight;
    const crossingScale = Math.max(bandWidth, palmScale * 0.24);`,
    'calibrated string band width',
  );
  strum = replaceOnce(
    strum,
    '      const filtered = this.filters.get(hand.trackId).update(hand.pickPoint, timestamp);',
    `      const livePalmScale = clamp(finite(hand.pickPoint?.palmScale), 0.025, 0.28);
      const learnedPalmScale = clamp(finite(this.personalCalibration?.palmScale), 0.025, 0.28);
      const scaleWeight = learnedPalmScale > 0 ? clamp(finite(this.personalCalibration?.confidence) * 0.62, 0, 0.56) : 0;
      const calibratedPoint = {
        ...hand.pickPoint,
        palmScale: livePalmScale * (1 - scaleWeight) + learnedPalmScale * scaleWeight,
        personalCalibrationApplied: scaleWeight > 0,
      };
      const filtered = this.filters.get(hand.trackId).update(calibratedPoint, timestamp);`,
    'calibrated hand scale filtering',
  );
  strum = replaceOnce(
    strum,
    `        timestamp,
        ready: geometry.valid && finite(geometry.confidence, pose?.confidence) >= 0.38,
      });`,
    `        timestamp,
        ready: geometry.valid && finite(geometry.confidence, pose?.confidence) >= 0.38,
        calibration: this.personalCalibration,
      });`,
    'pass personal tuning to crossing tracker',
  );
  strum = replaceOnce(
    strum,
    `      reason: this.lastReason,
    };`,
    `      reason: this.lastReason,
      personalCalibrationApplied: Boolean(this.personalCalibration && finite(this.personalCalibration.confidence) >= 0.18),
      personalCalibrationBucket: this.personalCalibration?.bucket || null,
    };`,
    'report personal calibration application',
  );
  writeFileSync(strumPath, strum);
}

console.log('Applied private angle-specific personal calibration to live strum, picking, and fingerstyle analysis.');
