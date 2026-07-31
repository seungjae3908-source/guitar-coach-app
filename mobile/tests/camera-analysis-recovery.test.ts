import assert from 'node:assert/strict';

import {
  cameraRecoveryDecision,
  initialAnalysisDelayMs,
} from '../services/camera-analysis-recovery';

const capture = cameraRecoveryDecision('capture', 1, 320);
assert.equal(capture.blocksPreview, false, '분석용 사진 실패가 카메라 영상을 막으면 안 됩니다.');
assert.ok(capture.retryDelayMs >= 420, '첫 촬영 실패 뒤에는 카메라가 안정될 시간을 줘야 합니다.');

const repeated = cameraRecoveryDecision('analysis', 4, 320);
assert.equal(repeated.blocksPreview, false, 'AI 분석 실패가 반복되어도 프리뷰는 유지되어야 합니다.');
assert.ok(repeated.retryDelayMs > capture.retryDelayMs, '반복 실패 시 재시도 간격이 늘어나야 합니다.');

const mount = cameraRecoveryDecision('mount', 1, 320);
assert.equal(mount.blocksPreview, true, '실제 카메라 마운트 실패만 프리뷰 차단 오류입니다.');

assert.equal(initialAnalysisDelayMs(1_000, 1_250), 650, '카메라 준비 직후 분석을 서두르면 안 됩니다.');
assert.equal(initialAnalysisDelayMs(1_000, 2_000), 0, '안정 시간이 지난 뒤에는 바로 분석할 수 있어야 합니다.');

console.log('Camera analysis recovery tests passed: 7');
