import { requireOptionalNativeModule } from 'expo';

import { publishLiveAnalysisFrame } from '../../services/analysis-stream';

export type PoseLandmarkPoint = {
  name:
    | 'nose'
    | 'leftEye'
    | 'rightEye'
    | 'leftEar'
    | 'rightEar'
    | 'leftShoulder'
    | 'rightShoulder'
    | 'leftElbow'
    | 'rightElbow'
    | 'leftWrist'
    | 'rightWrist'
    | 'leftThumb'
    | 'rightThumb'
    | 'leftIndex'
    | 'rightIndex'
    | 'leftPinky'
    | 'rightPinky'
    | 'leftHip'
    | 'rightHip';
  x: number;
  y: number;
  z: number;
  confidence: number;
};

export type PoseAnalysisResult = {
  hasPerson: boolean;
  imageWidth: number;
  imageHeight: number;
  latencyMs: number;
  landmarks: PoseLandmarkPoint[];
};

export type CameraFrameDiagnostic = {
  imageWidth: number;
  imageHeight: number;
  sampleCount: number;
  averageLuminance: number;
  contrast: number;
  darkRatio: number;
  brightRatio: number;
  blackFrameLikely: boolean;
  frameSignature: string;
  latencyMs: number;
};

type GuitarCoachNativeModule = {
  androidLiveCoachAvailable: boolean;
  playClickAsync(accent: boolean): Promise<void>;
  inspectCameraFrameAsync(uri: string): Promise<CameraFrameDiagnostic>;
  analyzePoseAsync(uri: string): Promise<PoseAnalysisResult>;
};

const NativeModule = requireOptionalNativeModule<GuitarCoachNativeModule>('GuitarCoachNative');

export const isLiveCoachNativeAvailable = Boolean(NativeModule?.androidLiveCoachAvailable);

export async function playNativeClickAsync(accent: boolean) {
  if (!NativeModule) throw new Error('메트로놈 소리 모듈을 사용할 수 없습니다.');
  await NativeModule.playClickAsync(accent);
}

export async function inspectCameraFrameAsync(uri: string) {
  if (!NativeModule) throw new Error('카메라 프레임 진단 모듈을 사용할 수 없습니다.');
  return NativeModule.inspectCameraFrameAsync(uri);
}

export async function analyzePoseAsync(uri: string) {
  if (!NativeModule) throw new Error('카메라 자세 분석 모듈을 사용할 수 없습니다.');
  const result = await NativeModule.analyzePoseAsync(uri);
  publishLiveAnalysisFrame({
    kind: 'pose',
    capturedAt: Date.now(),
    result,
  });
  return result;
}
