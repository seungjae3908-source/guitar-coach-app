"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAdvancedMetronomeAvailable = void 0;
exports.prepareVoiceCountAsync = prepareVoiceCountAsync;
exports.startAdvancedMetronomeAsync = startAdvancedMetronomeAsync;
exports.updateAdvancedMetronomeAsync = updateAdvancedMetronomeAsync;
exports.getAdvancedMetronomeTimingStateAsync = getAdvancedMetronomeTimingStateAsync;
exports.stopAdvancedMetronomeAsync = stopAdvancedMetronomeAsync;
exports.previewVoiceCountAsync = previewVoiceCountAsync;
exports.previewMetronomeSoundAsync = previewMetronomeSoundAsync;
const expo_1 = require("expo");
const analysis_stream_1 = require("../../services/analysis-stream");
const NativeModule = (0, expo_1.requireOptionalNativeModule)('GuitarCoachMetronome');
exports.isAdvancedMetronomeAvailable = Boolean(NativeModule?.androidMetronomeAvailable);
async function prepareVoiceCountAsync() {
    if (!NativeModule)
        throw new Error('음성 카운트 모듈을 사용할 수 없습니다.');
    return NativeModule.prepareVoiceAsync();
}
async function startAdvancedMetronomeAsync(bpm, beatsPerBar, subdivision, soundEnabled, voiceEnabled, soundPreset = 0) {
    if (!NativeModule)
        throw new Error('고급 메트로놈 모듈을 사용할 수 없습니다.');
    await NativeModule.startAsync(bpm, beatsPerBar, subdivision, soundEnabled, voiceEnabled, soundPreset);
}
async function updateAdvancedMetronomeAsync(bpm, beatsPerBar, subdivision, soundEnabled, voiceEnabled, soundPreset = 0) {
    if (!NativeModule)
        throw new Error('고급 메트로놈 모듈을 사용할 수 없습니다.');
    await NativeModule.updateAsync(bpm, beatsPerBar, subdivision, soundEnabled, voiceEnabled, soundPreset);
}
async function getAdvancedMetronomeTimingStateAsync() {
    if (!NativeModule)
        throw new Error('고급 메트로놈 모듈을 사용할 수 없습니다.');
    const result = await NativeModule.getTimingStateAsync();
    (0, analysis_stream_1.publishLiveAnalysisFrame)({
        kind: 'metronome',
        capturedAt: Date.now(),
        result,
    });
    return result;
}
async function stopAdvancedMetronomeAsync() {
    if (!NativeModule)
        return;
    await NativeModule.stopAsync();
}
async function previewVoiceCountAsync(subdivision) {
    if (!NativeModule)
        throw new Error('음성 카운트 모듈을 사용할 수 없습니다.');
    await NativeModule.previewVoiceAsync(subdivision);
}
async function previewMetronomeSoundAsync(soundPreset) {
    if (!NativeModule)
        throw new Error('메트로놈 음원 모듈을 사용할 수 없습니다.');
    await NativeModule.previewSoundAsync(soundPreset);
}
