import { requireOptionalNativeModule } from 'expo';

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

type GuitarCoachNativeModule = {
  androidLiveCoachAvailable: boolean;
  playClickAsync(accent: boolean): Promise<void>;
  analyzePoseAsync(uri: string): Promise<PoseAnalysisResult>;
};

const NativeModule = requireOptionalNativeModule<GuitarCoachNativeModule>('GuitarCoachNative');

export const isLiveCoachNativeAvailable = Boolean(NativeModule?.androidLiveCoachAvailable);

export async function playNativeClickAsync(accent: boolean) {
  if (!NativeModule) throw new Error('메트로놈 소리 모듈을 사용할 수 없습니다.');
  await NativeModule.playClickAsync(accent);
}

export async function analyzePoseAsync(uri: string) {
  if (!NativeModule) throw new Error('카메라 자세 분석 모듈을 사용할 수 없습니다.');
  return NativeModule.analyzePoseAsync(uri);
}
