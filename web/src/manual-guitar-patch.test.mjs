import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const patch = readFileSync(new URL('../scripts/patch-manual-guitar-calibration-v3.mjs', import.meta.url), 'utf8');

test('manual calibration patch evaluates a manual pose after automatic recognition', () => {
  assert.match(patch, /const automaticPose = backlitGuitarRecoveryRef\.current\.update/);
  assert.match(patch, /const manualPose = manualGuitarCalibrationRef\.current\.poseFor\(timestamp\)/);
  assert.match(patch, /const pose = manualPose \|\| automaticPose/);
});

test('manual calibration patch enables three ordered pointer taps on the mirrored cover canvas', () => {
  assert.match(patch, /onPointerDown=\{handleManualCalibrationPointer\}/);
  assert.match(patch, /mapMirroredCoverPointer/);
  assert.match(patch, /pointerEvents: manualGuitarCalibration\.active/);
  assert.match(patch, /사운드홀 가운데 → 헤드 쪽 넥\/줄 → 피크가 줄에 닿는 위치/);
});

test('manual calibration patch supplies validated string and guitar evidence', () => {
  assert.match(patch, /visionRef\.current\.stringCount = manualPose\.lines\.length/);
  assert.match(patch, /visionRef\.current\.stringConfidence = manualPose\.confidence/);
  assert.match(patch, /visionRef\.current\.guitarConfidence = manualPose\.confidence/);
  assert.match(patch, /visionRef\.current\.manualCalibrationReady = Boolean\(manualPose\)/);
});

test('manual calibration remains an explicit fallback rather than replacing automatic recognition', () => {
  assert.match(patch, /manualPose \|\| automaticPose/);
  assert.match(patch, /필요 시 사용/);
  assert.match(patch, /보정 지우기/);
});

test('manual calibration control stays visibly over the camera on mobile', () => {
  assert.match(patch, /data-manual-calibration-floating="true"/);
  assert.match(patch, /position: 'absolute'/);
  assert.match(patch, /zIndex: 5/);
  assert.match(patch, /자동 인식 안 되면 누르기 · 수동 3점 보정/);
  assert.match(patch, /수동 3점 보정 적용됨/);
});
