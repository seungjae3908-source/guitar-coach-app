"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isLiveCoachNativeAvailable = void 0;
exports.playNativeClickAsync = playNativeClickAsync;
exports.inspectCameraFrameAsync = inspectCameraFrameAsync;
exports.analyzePoseAsync = analyzePoseAsync;
const expo_1 = require("expo");
const analysis_stream_1 = require("../../services/analysis-stream");
const NativeModule = (0, expo_1.requireOptionalNativeModule)('GuitarCoachNative');
exports.isLiveCoachNativeAvailable = Boolean(NativeModule?.androidLiveCoachAvailable);
async function playNativeClickAsync(accent) {
    if (!NativeModule)
        throw new Error('메트로놈 소리 모듈을 사용할 수 없습니다.');
    await NativeModule.playClickAsync(accent);
}
async function inspectCameraFrameAsync(uri) {
    if (!NativeModule)
        throw new Error('카메라 프레임 진단 모듈을 사용할 수 없습니다.');
    return NativeModule.inspectCameraFrameAsync(uri);
}
async function analyzePoseAsync(uri) {
    if (!NativeModule)
        throw new Error('카메라 자세 분석 모듈을 사용할 수 없습니다.');
    const result = await NativeModule.analyzePoseAsync(uri);
    (0, analysis_stream_1.publishLiveAnalysisFrame)({
        kind: 'pose',
        capturedAt: Date.now(),
        result,
    });
    return result;
}
