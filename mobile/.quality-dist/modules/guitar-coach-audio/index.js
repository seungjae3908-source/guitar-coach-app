"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isNativeAudioAnalysisAvailable = void 0;
exports.startNativeAudioAnalysisAsync = startNativeAudioAnalysisAsync;
exports.updateNativeAudioReferenceAsync = updateNativeAudioReferenceAsync;
exports.getLatestNativeAudioReadingAsync = getLatestNativeAudioReadingAsync;
exports.stopNativeAudioAnalysisAsync = stopNativeAudioAnalysisAsync;
const expo_1 = require("expo");
const analysis_stream_1 = require("../../services/analysis-stream");
const NativeModule = (0, expo_1.requireOptionalNativeModule)('GuitarCoachAudio');
exports.isNativeAudioAnalysisAvailable = Boolean(NativeModule?.androidAudioAnalysisAvailable);
async function startNativeAudioAnalysisAsync(referenceA4 = 440) {
    if (!NativeModule)
        throw new Error('마이크 튜너 모듈을 사용할 수 없습니다.');
    return NativeModule.startAudioAnalysisAsync(referenceA4);
}
async function updateNativeAudioReferenceAsync(referenceA4) {
    if (!NativeModule)
        throw new Error('마이크 튜너 모듈을 사용할 수 없습니다.');
    await NativeModule.updateAudioReferenceAsync(referenceA4);
}
async function getLatestNativeAudioReadingAsync() {
    if (!NativeModule)
        throw new Error('마이크 튜너 모듈을 사용할 수 없습니다.');
    const result = await NativeModule.getLatestAudioReadingAsync();
    const readAt = Date.now();
    const attackAge = Number.isFinite(result.millisecondsSinceAttack)
        ? Math.max(0, Math.min(2_000, result.millisecondsSinceAttack))
        : 0;
    const capturedAt = result.lastAttackAtMs > 0 ? Math.round(readAt - attackAge) : readAt;
    (0, analysis_stream_1.publishLiveAnalysisFrame)({
        kind: 'audio',
        capturedAt,
        result,
    });
    return result;
}
async function stopNativeAudioAnalysisAsync() {
    if (!NativeModule)
        return;
    await NativeModule.stopAudioAnalysisAsync();
}
