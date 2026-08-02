"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const dynamics_accent_engine_1 = require("../services/dynamics-accent-engine");
const feedback_evidence_gate_1 = require("../services/feedback-evidence-gate");
function reading(attackCount, level, clippingRatio = 0, overrides = {}) {
    return {
        timestampMs: attackCount * 200,
        frequencyHz: 110,
        pitchConfidence: 0.82,
        rms: level,
        peakAmplitude: level,
        noiseFloor: 0.001,
        signalToNoiseDb: 28,
        clippingRatio,
        zeroCrossingRate: 0.1,
        spectralCentroidHz: 1_200,
        brightnessRatio: 0.4,
        spectralFlatness: 0.1,
        attackCount,
        lastAttackAtMs: attackCount * 200,
        attackIntervalMs: 200,
        attackStrength: level,
        millisecondsSinceAttack: 20,
        envelopeRatio: 0.8,
        sampleCount: attackCount * 1_024,
        referenceA4: 440,
        hasPitch: true,
        inputSource: 'UNPROCESSED',
        automaticGainControlLikely: false,
        running: true,
        ...overrides,
    };
}
node_assert_1.strict.equal((0, feedback_evidence_gate_1.visualFeedbackReady)({ running: true, acceptedFrames: 0, sessionStartedAt: 1 }), false);
node_assert_1.strict.equal((0, feedback_evidence_gate_1.visualFeedbackReady)({ running: true, acceptedFrames: feedback_evidence_gate_1.MIN_VISUAL_EVIDENCE_FRAMES - 1, sessionStartedAt: 1 }), false);
node_assert_1.strict.equal((0, feedback_evidence_gate_1.visualFeedbackReady)({ running: true, acceptedFrames: feedback_evidence_gate_1.MIN_VISUAL_EVIDENCE_FRAMES, sessionStartedAt: 1 }), true);
node_assert_1.strict.equal((0, feedback_evidence_gate_1.visualFeedbackReady)({ running: false, acceptedFrames: 99, sessionStartedAt: 1 }), false);
node_assert_1.strict.equal((0, feedback_evidence_gate_1.audioFeedbackReady)({ microphoneActive: true, completedCycles: 0, acceptedAttacks: 99 }), false);
node_assert_1.strict.equal((0, feedback_evidence_gate_1.audioFeedbackReady)({ microphoneActive: true, completedCycles: feedback_evidence_gate_1.MIN_AUDIO_EVIDENCE_CYCLES, acceptedAttacks: feedback_evidence_gate_1.MIN_AUDIO_EVIDENCE_ATTACKS - 1 }), false);
node_assert_1.strict.equal((0, feedback_evidence_gate_1.audioFeedbackReady)({ microphoneActive: true, completedCycles: feedback_evidence_gate_1.MIN_AUDIO_EVIDENCE_CYCLES, acceptedAttacks: feedback_evidence_gate_1.MIN_AUDIO_EVIDENCE_ATTACKS }), true);
node_assert_1.strict.equal((0, feedback_evidence_gate_1.audioFeedbackReady)({ microphoneActive: false, completedCycles: 99, acceptedAttacks: 99 }), false);
const silence = reading(2, 0.0006, 0.08, {
    peakAmplitude: 0.001,
    attackStrength: 0.001,
    noiseFloor: 0.01,
    signalToNoiseDb: 2,
});
node_assert_1.strict.equal((0, dynamics_accent_engine_1.isAudibleAttackReading)(silence), false, '무음·주변 소음을 실제 기타 어택으로 받아들이면 안 됩니다.');
const silentAnalyzer = new dynamics_accent_engine_1.DynamicsAccentAnalyzer({ category: 'strumming', pattern: 'D U D U' });
silentAnalyzer.reset(0);
silentAnalyzer.addReading(reading(1, 0.0005), 200);
for (let count = 2; count <= 20; count += 1) {
    silentAnalyzer.addReading(reading(count, 0.0006, 0.08, {
        peakAmplitude: 0.001,
        attackStrength: 0.001,
        noiseFloor: 0.01,
        signalToNoiseDb: 2,
    }), count * 200);
}
node_assert_1.strict.equal(silentAnalyzer.getSnapshot().issue, 'waiting');
node_assert_1.strict.equal(silentAnalyzer.getSnapshot().acceptedAttacks, 0, '무음에서는 강약 표본이 하나도 쌓이면 안 됩니다.');
const stable = new dynamics_accent_engine_1.DynamicsAccentAnalyzer({ category: 'strumming', pattern: 'D U D U' });
stable.reset(0);
let stableCount = 1;
stable.addReading(reading(stableCount, 0.2), stableCount * 200);
stableCount += 1;
const targetLevels = [0.50, 0.30, 0.39, 0.30];
let stableIssue = '';
for (let cycle = 0; cycle < 5; cycle += 1) {
    targetLevels.forEach((level) => {
        const snapshot = stable.addReading(reading(stableCount, level), stableCount * 200);
        stableCount += 1;
        if (snapshot && snapshot.completedCycles >= 2 && snapshot.issue !== 'waiting')
            stableIssue = snapshot.issue;
    });
}
node_assert_1.strict.equal(stableIssue, 'stable', '목표 강약과 비슷한 실제 어택 패턴은 안정으로 판정되어야 합니다.');
const flat = new dynamics_accent_engine_1.DynamicsAccentAnalyzer({ category: 'strumming', pattern: 'D U D U' });
flat.reset(0);
let flatCount = 1;
flat.addReading(reading(flatCount, 0.2), flatCount * 200);
flatCount += 1;
let flatIssue = '';
for (let index = 0; index < 16; index += 1) {
    const snapshot = flat.addReading(reading(flatCount, 0.36), flatCount * 200);
    flatCount += 1;
    if (snapshot && snapshot.completedCycles >= 2 && snapshot.issue !== 'waiting')
        flatIssue = snapshot.issue;
}
node_assert_1.strict.ok(flatIssue === 'flat-dynamics' || flatIssue === 'accent-missed', `같은 음량 반복은 평평한 강약 또는 악센트 부족으로 판정되어야 합니다. 실제: ${flatIssue}`);
const clipped = new dynamics_accent_engine_1.DynamicsAccentAnalyzer({ category: 'alternatePicking', pattern: 'D U D U' });
clipped.reset(0);
let clippedCount = 1;
clipped.addReading(reading(clippedCount, 0.2), clippedCount * 200);
clippedCount += 1;
let sawClipping = false;
for (let index = 0; index < 12; index += 1) {
    const isClippedAttack = index === 6;
    const snapshot = clipped.addReading(reading(clippedCount, isClippedAttack ? 0.98 : 0.56, isClippedAttack ? 0.08 : 0), clippedCount * 200);
    clippedCount += 1;
    if (snapshot?.issue === 'clipping')
        sawClipping = true;
}
node_assert_1.strict.equal(sawClipping, true, '충분한 실제 어택 뒤 확인된 클리핑만 입력 오류로 판정되어야 합니다.');
console.log('dynamics-accent-engine and evidence-gate tests passed');
