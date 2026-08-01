"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_AUDIO_EVIDENCE_ATTACKS = exports.MIN_AUDIO_EVIDENCE_CYCLES = exports.MIN_VISUAL_EVIDENCE_FRAMES = void 0;
exports.visualFeedbackReady = visualFeedbackReady;
exports.audioFeedbackReady = audioFeedbackReady;
exports.MIN_VISUAL_EVIDENCE_FRAMES = 12;
exports.MIN_AUDIO_EVIDENCE_CYCLES = 2;
exports.MIN_AUDIO_EVIDENCE_ATTACKS = 8;
function visualFeedbackReady({ running, acceptedFrames, sessionStartedAt, }) {
    return running
        && Boolean(sessionStartedAt && sessionStartedAt > 0)
        && acceptedFrames >= exports.MIN_VISUAL_EVIDENCE_FRAMES;
}
function audioFeedbackReady({ microphoneActive, completedCycles, acceptedAttacks, }) {
    return microphoneActive
        && completedCycles >= exports.MIN_AUDIO_EVIDENCE_CYCLES
        && acceptedAttacks >= exports.MIN_AUDIO_EVIDENCE_ATTACKS;
}
