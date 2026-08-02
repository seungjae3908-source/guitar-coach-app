"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("node:assert/strict");
const focus_v7_contract_1 = require("../services/focus-v7-contract");
assert.deepEqual(focus_v7_contract_1.FOCUS_V7_SCREEN_ORDER, [
    'header',
    'mode-selector',
    'primary-action',
    'camera',
    'recognition-status',
    'feedback-scroll',
], '레슨 시작 버튼은 반드시 카메라보다 위에 있어야 합니다.');
assert.ok((0, focus_v7_contract_1.focusV7CameraHeight)(384, 824) >= 460, '일반 삼성 세로 화면에서 카메라가 너무 작으면 안 됩니다.');
assert.ok((0, focus_v7_contract_1.focusV7CameraHeight)(384, 720) <= 446, '작은 화면에서 카메라가 하단 내용을 밀어내면 안 됩니다.');
assert.equal((0, focus_v7_contract_1.canShowFocusV7Coaching)({ lessonRunning: false, handLocked: true, acceptedFrames: 20, calibrationReady: true }), false);
assert.equal((0, focus_v7_contract_1.canShowFocusV7Coaching)({ lessonRunning: true, handLocked: false, acceptedFrames: 20, calibrationReady: true }), false);
assert.equal((0, focus_v7_contract_1.canShowFocusV7Coaching)({ lessonRunning: true, handLocked: true, acceptedFrames: 4, calibrationReady: true }), false);
assert.equal((0, focus_v7_contract_1.canShowFocusV7Coaching)({ lessonRunning: true, handLocked: true, acceptedFrames: 5, calibrationReady: true }), true);
assert.match((0, focus_v7_contract_1.focusV7WaitingMessage)({ lessonRunning: true, handLocked: false, acceptedFrames: 0, calibrationReady: true }), /아직 판정하지 않습니다/);
console.log('Focus V7 contract tests passed: 9');
