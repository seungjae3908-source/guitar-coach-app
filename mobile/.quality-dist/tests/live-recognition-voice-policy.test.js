"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const live_recognition_voice_policy_1 = require("../services/live-recognition-voice-policy");
const base = {
    running: true,
    cameraReady: true,
    hasHand: false,
    handConfidence: 0,
    palmSize: 0,
    guitarDetected: false,
    guitarType: 'unknown',
    guitarConfidence: 0,
};
const policy = new live_recognition_voice_policy_1.LiveRecognitionVoicePolicy();
node_assert_1.strict.equal(policy.next(base, 2_000), '카메라 분석을 시작합니다.');
node_assert_1.strict.equal(policy.next(base, 2_200), null);
const hand = { ...base, hasHand: true, handConfidence: 0.72, palmSize: 0.16 };
node_assert_1.strict.equal(policy.next(hand, 3_200), null);
node_assert_1.strict.equal(policy.next(hand, 3_300), null);
node_assert_1.strict.equal(policy.next(hand, 3_400), '손을 인식했습니다.');
node_assert_1.strict.equal(policy.next(hand, 3_500), null);
const guitar = {
    ...hand,
    guitarDetected: true,
    guitarType: 'acoustic',
    guitarConfidence: 0.66,
};
node_assert_1.strict.equal(policy.next(guitar, 5_000), null);
node_assert_1.strict.equal(policy.next(guitar, 5_100), '손과 기타 인식이 완료되었습니다.');
for (let index = 0; index < 13; index += 1) {
    node_assert_1.strict.equal(policy.next(base, 7_000 + index * 100), null);
}
node_assert_1.strict.equal(policy.next(base, 8_300), '손이 화면에서 벗어났습니다.');
policy.reset();
node_assert_1.strict.equal(policy.next({ ...base, cameraReady: false }, 10_000), null);
node_assert_1.strict.equal(policy.next({ ...base, cameraReady: true }, 11_200), '카메라 분석을 시작합니다.');
console.log('live recognition voice policy tests passed');
