import { requireOptionalNativeModule } from 'expo';

export type HandLandmarkName =
  | 'wrist'
  | 'thumbCmc'
  | 'thumbMcp'
  | 'thumbIp'
  | 'thumbTip'
  | 'indexMcp'
  | 'indexPip'
  | 'indexDip'
  | 'indexTip'
  | 'middleMcp'
  | 'middlePip'
  | 'middleDip'
  | 'middleTip'
  | 'ringMcp'
  | 'ringPip'
  | 'ringDip'
  | 'ringTip'
  | 'pinkyMcp'
  | 'pinkyPip'
  | 'pinkyDip'
  | 'pinkyTip';

export type HandLandmarkPoint = {
  index: number;
  name: HandLandmarkName;
  x: number;
  y: number;
  z: number;
};

export type PickColor =
  | 'none'
  | 'auto'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'white'
  | 'black';

export type PickAnalysisResult = {
  detected: boolean;
  color: PickColor | string;
  confidence: number;
  angleDegrees: number;
  exposure: number;
  centerX: number;
  centerY: number;
};

export type HandAnalysisResult = {
  hasHand: boolean;
  imageWidth: number;
  imageHeight: number;
  latencyMs: number;
  handedness: 'Left' | 'Right' | 'Unknown' | string;
  handednessScore: number;
  landmarks: HandLandmarkPoint[];
  pick: PickAnalysisResult;
};

type GuitarCoachHandModule = {
  androidHandCoachAvailable: boolean;
  analyzeHandAsync(uri: string, pickColor: PickColor): Promise<HandAnalysisResult>;
};

const NativeModule = requireOptionalNativeModule<GuitarCoachHandModule>('GuitarCoachHand');

export const isDetailedHandCoachAvailable = Boolean(NativeModule?.androidHandCoachAvailable);

export async function analyzeHandAsync(uri: string, pickColor: PickColor) {
  if (!NativeModule) throw new Error('손가락 상세 분석 모듈을 사용할 수 없습니다.');
  return NativeModule.analyzeHandAsync(uri, pickColor);
}
