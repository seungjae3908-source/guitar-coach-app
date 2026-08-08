export type CameraFeedDiagnostics = {
  previewStreamState?: string;
  previewMode?: string;
  analysisFormat?: string;
  brightness?: number;
  darkFrameCount?: number;
  healthyFrameCount?: number;
  feedHealthy?: boolean;
  recoveryCount?: number;
  lastRecoveryReason?: string;
};

export type CameraFeedHealth = {
  healthy: boolean;
  recovering: boolean;
  brightnessPercent: number;
  label: string;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function getCameraFeedHealth(feed?: CameraFeedDiagnostics): CameraFeedHealth {
  if (!feed) {
    return {
      healthy: false,
      recovering: false,
      brightnessPercent: 0,
      label: '영상 진단 대기 중',
    };
  }
  const brightness = Number.isFinite(feed.brightness) ? Number(feed.brightness) : 0;
  const brightnessPercent = Math.round(clamp(brightness / 255 * 100, 0, 100));
  const healthy = feed.feedHealthy === true
    || (brightness >= 5.5 && (feed.healthyFrameCount ?? 0) >= 2);
  const recovering = !healthy && (feed.recoveryCount ?? 0) > 0;
  const mode = feed.previewMode === 'performance' ? '성능' : '호환';
  const stream = feed.previewStreamState === 'streaming' ? '스트리밍' : '연결 중';
  return {
    healthy,
    recovering,
    brightnessPercent,
    label: healthy
      ? `영상 정상 ${brightnessPercent}% · ${stream} · ${mode} 모드`
      : recovering
        ? `검은 영상 복구 중 · ${mode} 모드 · ${feed.recoveryCount ?? 0}회`
        : `영상 확인 중 ${brightnessPercent}% · ${stream}`,
  };
}
