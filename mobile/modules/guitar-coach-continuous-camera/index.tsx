import { requireNativeView, requireOptionalNativeModule } from 'expo';
import { useEffect, useRef } from 'react';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';

import {
  ContinuousTrackingQualityGate,
  type QualityContinuousHandResult,
  type QualityContinuousStats,
  type QualityStringHit,
} from '../../services/continuous-tracking-quality';
import { getLatestLiveAnalysisFrames, publishLiveAnalysisFrame } from '../../services/analysis-stream';

export type ContinuousStringHit = QualityStringHit;
export type ContinuousRightHandStats = QualityContinuousStats;
export type ContinuousHandAnalysisResult = QualityContinuousHandResult;

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
  const newHits = result.continuous.newHits.map(fuseHitWithAudio);
  const newHitKeys = new Set(newHits.map((hit) => `${hit.capturedAt}-${hit.contactId}-${hit.visualIndex}`));
  const recentHits = result.continuous.recentHits.map((hit) => {
    const key = `${hit.capturedAt}-${hit.contactId}-${hit.visualIndex}`;
    return newHitKeys.has(key) ? newHits.find((candidate) => `${candidate.capturedAt}-${candidate.contactId}-${candidate.visualIndex}` === key) ?? hit : hit;
  });
  const currentAudioConfirmed = newHits.some((hit) => hit.audioConfirmed);
  return {
    ...result,
    stringTracking: result.stringTracking
      ? { ...result.stringTracking, audioConfirmed: currentAudioConfirmed }
      : result.stringTracking,
    continuous: {
      ...result.continuous,
      newHits,
      recentHits,
    },
  };
}

export default function ContinuousRightHandCamera({
  running,
  pickColor = 'auto',
  onAnalysis,
  ...props
}: NativeContinuousCameraProps) {
  const qualityGateRef = useRef(new ContinuousTrackingQualityGate());
  const verifiedPickColor = pickColor === 'auto' ? 'green' : pickColor;

  useEffect(() => {
    if (!running) qualityGateRef.current.reset();
  }, [running]);

  useEffect(() => () => qualityGateRef.current.reset(), []);

  return (
    <NativeContinuousCameraView
      {...props}
      running={running}
      pickColor={verifiedPickColor}
      onAnalysis={(event) => {
        const normalized = normalizeResult(event.nativeEvent);
        const qualityChecked = qualityGateRef.current.process(normalized, Date.now());
        const result = fuseAudio(qualityChecked);
        publishLiveAnalysisFrame({ kind: 'hand', capturedAt: Date.now(), result });
        onAnalysis?.({ ...event, nativeEvent: result });
      }}
    />
  );
}
