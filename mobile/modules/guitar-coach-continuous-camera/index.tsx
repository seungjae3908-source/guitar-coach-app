import { requireNativeView, requireOptionalNativeModule } from 'expo';
import { type ComponentType, useEffect, useRef } from 'react';
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
export type LocalGuitarDetection = {
  detected: boolean;
  type: 'acoustic' | 'electric' | 'bass' | 'guitar' | 'unknown' | string;
  label: string;
  confidence: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  modelReady: boolean;
  reason: string;
};
export type ContinuousHandAnalysisResult = QualityContinuousHandResult & {
  guitar: LocalGuitarDetection;
};

type ContinuousCameraModule = {
  androidContinuousRightHandAvailable: boolean;
};

type NativeEvent<T> = NativeSyntheticEvent<T>;

type NativeContinuousCameraProps = ViewProps & {
  running: boolean;
  pickColor?: string;
  facing?: 'front' | 'back';
  analyzeStrings?: boolean;
  onCameraReady?: (event: NativeEvent<{ continuous: boolean; targetPreviewFps: number; facing?: string; guitarClassifier?: boolean }>) => void;
  onAnalysis?: (event: NativeEvent<ContinuousHandAnalysisResult>) => void;
  onError?: (event: NativeEvent<{ message: string }>) => void;
};

const NativeModule = requireOptionalNativeModule<ContinuousCameraModule>('GuitarCoachContinuousCamera');
let NativeContinuousCameraView: ComponentType<NativeContinuousCameraProps> | null = null;

if (NativeModule?.androidContinuousRightHandAvailable) {
  try {
    NativeContinuousCameraView = requireNativeView<NativeContinuousCameraProps>('GuitarCoachContinuousCamera');
  } catch {
    // A stale or compact APK can expose the module constant before the native
    // view manager is usable. Keep the app alive so SessionCoachCamera can use
    // the expo-camera fallback instead of crashing while this file is imported.
    NativeContinuousCameraView = null;
  }
}

export const isContinuousRightHandCameraAvailable = Boolean(
  NativeModule?.androidContinuousRightHandAvailable && NativeContinuousCameraView,
);

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
  facing = 'back',
  analyzeStrings = false,
  onAnalysis,
  ...props
}: NativeContinuousCameraProps) {
  const qualityGateRef = useRef(new ContinuousTrackingQualityGate());
  const verifiedPickColor = pickColor === 'auto' ? 'green' : pickColor;

  useEffect(() => {
    if (!running) qualityGateRef.current.reset();
  }, [running]);

  useEffect(() => () => qualityGateRef.current.reset(), []);

  if (!NativeContinuousCameraView) return null;
  const ContinuousCameraView = NativeContinuousCameraView;

  return (
    <ContinuousCameraView
      {...props}
      // Keep CameraX preview, autofocus and auto-framing alive as soon as the
      // precision screen mounts. Practice controllers still ignore frames until
      // the live practice context becomes active, so no score is fabricated.
      running={true}
      pickColor={verifiedPickColor}
      facing={facing}
      analyzeStrings={analyzeStrings}
      onAnalysis={(event) => {
        const normalized = normalizeResult(event.nativeEvent);
        const qualityChecked = qualityGateRef.current.process(normalized, Date.now()) as ContinuousHandAnalysisResult;
        const result = fuseAudio({ ...qualityChecked, guitar: normalized.guitar }) as ContinuousHandAnalysisResult;
        publishLiveAnalysisFrame({ kind: 'hand', capturedAt: Date.now(), result });
        onAnalysis?.({ ...event, nativeEvent: result });
      }}
    />
  );
}
