import { getCameraFeedHealth } from '../services/camera-feed-health';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`카메라 영상 진단 테스트 실패: ${message}`);
}

const waiting = getCameraFeedHealth();
assert(!waiting.healthy, '진단값이 없으면 정상 영상으로 처리하면 안 됩니다.');

const black = getCameraFeedHealth({
  previewStreamState: 'streaming',
  previewMode: 'compatible',
  brightness: 0.8,
  darkFrameCount: 14,
  healthyFrameCount: 0,
  feedHealthy: false,
  recoveryCount: 1,
});
assert(!black.healthy, '검은 프레임을 정상 영상으로 처리하면 안 됩니다.');
assert(black.recovering, '자동 재연결 중임을 표시해야 합니다.');

const healthy = getCameraFeedHealth({
  previewStreamState: 'streaming',
  previewMode: 'compatible',
  brightness: 64,
  darkFrameCount: 0,
  healthyFrameCount: 5,
  feedHealthy: true,
  recoveryCount: 1,
});
assert(healthy.healthy, '밝기가 확보된 연속 프레임은 정상으로 처리해야 합니다.');
assert(healthy.brightnessPercent === 25, '밝기 백분율을 계산해야 합니다.');

console.log('camera-feed health: 7 checks passed');
