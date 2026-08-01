"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setLiveAnalysisSubscribersSuppressed = setLiveAnalysisSubscribersSuppressed;
exports.publishLiveAnalysisFrame = publishLiveAnalysisFrame;
exports.subscribeLiveAnalysis = subscribeLiveAnalysis;
exports.getLatestLiveAnalysisFrames = getLatestLiveAnalysisFrames;
exports.clearLatestLiveAnalysisFrames = clearLatestLiveAnalysisFrames;
const listeners = new Set();
let latestPoseFrame = null;
let latestHandFrame = null;
let latestAudioFrame = null;
let latestMetronomeFrame = null;
let latestChordFrame = null;
let latestFingeringFrame = null;
let subscribersSuppressed = false;
function setLiveAnalysisSubscribersSuppressed(suppressed) {
    subscribersSuppressed = suppressed;
}
function publishLiveAnalysisFrame(frame) {
    if (frame.kind === 'pose')
        latestPoseFrame = frame;
    else if (frame.kind === 'hand')
        latestHandFrame = frame;
    else if (frame.kind === 'audio')
        latestAudioFrame = frame;
    else if (frame.kind === 'metronome')
        latestMetronomeFrame = frame;
    else if (frame.kind === 'chord')
        latestChordFrame = frame;
    else
        latestFingeringFrame = frame;
    if (subscribersSuppressed && frame.kind !== 'metronome')
        return;
    listeners.forEach((listener) => {
        try {
            listener(frame);
        }
        catch {
            // 한 화면의 구독 오류가 카메라·마이크·메트로놈 분석 자체를 중단하지 않게 합니다.
        }
    });
}
function subscribeLiveAnalysis(listener) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
function getLatestLiveAnalysisFrames() {
    return {
        pose: latestPoseFrame,
        hand: latestHandFrame,
        audio: latestAudioFrame,
        metronome: latestMetronomeFrame,
        chord: latestChordFrame,
        fingering: latestFingeringFrame,
    };
}
function clearLatestLiveAnalysisFrames() {
    latestPoseFrame = null;
    latestHandFrame = null;
    latestAudioFrame = null;
    latestMetronomeFrame = null;
    latestChordFrame = null;
    latestFingeringFrame = null;
}
