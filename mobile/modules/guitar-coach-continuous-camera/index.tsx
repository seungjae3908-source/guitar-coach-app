import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';

import { getLatestLiveAnalysisFrames, publishLiveAnalysisFrame } from '../../services/analysis-stream';
import type { HandAnalysisResult } from '../guitar-coach-hand';

export type ContinuousStringHit = {
  capturedAt: number;
  contactId: string;
  label: string;
  visualIndex: number;
  stringNumber: number;
  direction: 'down' | 'up' | 'unknown' | string;
  speed: number;
  confidence: number;
  audioConfirmed?: boolean;
  audioOffsetMs?: number;
  audioSignalToNoiseDb?: number;
};

export type ContinuousRightHandStats = {
  enabled: true;
  previewFps: number;
  analysisFps: number;
  frameCount: number;
  analyzedFrameCount: number;
  stringRefreshAgeFrames: number;
  newHits: ContinuousStringHit[];
  recentHits: ContinuousStringHit[];
};

export type ContinuousHandAnalysisResult = HandAnalysisResult & {
  continuous: ContinuousRightHandStats;
};

type ContinuousCameraModule = {
  androidContinuousRightHandAvailable: boolean;
};

type NativeEvent<T> = NativeSyntheticEvent<T>;

type NativeContinuousCameraProps = ViewProps & {
  running: boolean;
  pickColor?: string;
  onCameraReady?: (event: NativeEvent<{ continuous: boolean; targetPreviewFps: number }>) => void;
  onAnalysis?: (event: NativeEvent<ContinuousHandAnalysisResult>) => void;
  onError?: (event: NativeEvent<{ message: string }>) => void;
};

const NativeModule = requireOptionalNativeModule<ContinuousCameraModule>('GuitarCoachContinuousCamera');
const NativeContinuousCameraView = requireNativeView<NativeContinuousCameraProps>('GuitarCoachContinuousCamera');

export const isContinuousRightHandCameraAvailable = Boolean(NativeModule?.androidContinuousRightHandAvailable);

function normalizeResult(result: ContinuousHandAnalysisResult): ContinuousHandAnalysisResult {
  const tracking = result.stringTracking;
  if (!tracking) return result;
  const width = Math.max(1, result.imageWidth);
  const height = Math.max(1, result.imageHeight);
  const normalizeX = (value: number | undefined) => value == null ? value : value > 1 ? value / width : value;
  const normalizeY = (value: number | undefined) => value == null ? value : value > 1 ? value / height : value;
  return {
    ...result,
    stringTracking: {
      ...tracking,
      roiLeft: normalizeX(tracking.roiLeft),
      roiRight: normalizeX(tracking.roiRight),
      roiTop: normalizeY(tracking.roiTop),
      roiBottom: normalizeY(tracking.roiBottom),
    },
  };
}

function fuseHitWithAudio(hit: ContinuousStringHit): ContinuousStringHit {
  const audioFrame = getLatestLiveAnalysisFrames().audio;
  if (!audioFrame) return hit;
  const audio = audioFrame.result;
  if (!audio.running || audio.attackCount <= 0 || audio.lastAttackAtMs <= 0) return hit;
  if (audio.signalToNoiseDb < 10 || audio.clippingRatio >= 0.03) return hit;
  const offset = Math.round(hit.capturedAt - audio.lastAttackAtMs);
  if (Math.abs(offset) > 125) return hit;
  return {
    ...hit,
    audioConfirmed: true,
    audioOffsetMs: offset,
    audioSignalToNoiseDb: Math.round(audio.signalToNoiseDb),
    confidence: Math.min(1, hit.confidence + 0.1),
  };
}

function fuseAudio(result: ContinuousHandAnalysisResult): ContinuousHandAnalysisResult {
  return {
    ...result,
    continuous: {
      ...result.continuous,
      newHits: result.continuous.newHits.map(fuseHitWithAudio),
      recentHits: result.continuous.recentHits.map(fuseHitWithAudio),
    },
  };
}

export default function ContinuousRightHandCamera({
  running,
  pickColor = 'auto',
  onAnalysis,
  ...props
}: NativeContinuousCameraProps) {
  return (
    <NativeContinuousCameraView
      {...props}
      running={running}
      pickColor={pickColor}
      onAnalysis={(event) => {
        const result = fuseAudio(normalizeResult(event.nativeEvent));
        publishLiveAnalysisFrame({ kind: 'hand', capturedAt: Date.now(), result });
        onAnalysis?.({ ...event, nativeEvent: result });
      }}
    />
  );
}
