"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const focus_practice_mode_1 = require("../services/focus-practice-mode");
function equal(actual, expected, label) {
    if (actual !== expected)
        throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}`);
}
function assert(condition, label) {
    if (!condition)
        throw new Error(label);
}
equal((0, focus_practice_mode_1.focusModeForCategory)('alternatePicking'), 'picking', 'alternate picking mode');
equal((0, focus_practice_mode_1.focusModeForCategory)('downPicking'), 'picking', 'down picking mode');
equal((0, focus_practice_mode_1.focusModeForCategory)('strumming'), 'strumming', 'strum mode');
equal((0, focus_practice_mode_1.focusModeForCategory)('arpeggio'), 'arpeggio', 'arpeggio mode');
equal((0, focus_practice_mode_1.focusModeForCategory)('chords'), 'left-hand', 'left hand mode');
assert((0, focus_practice_mode_1.categoryMatchesFocusMode)('fingerstyle', 'arpeggio'), 'fingerstyle should use arpeggio focus');
assert(!(0, focus_practice_mode_1.categoryMatchesFocusMode)('strumming', 'picking'), 'strumming must not leak into picking');
const picking = (0, focus_practice_mode_1.cameraAnalysisProfile)('alternatePicking');
const strumming = (0, focus_practice_mode_1.cameraAnalysisProfile)('strumming');
const arpeggio = (0, focus_practice_mode_1.cameraAnalysisProfile)('arpeggio');
assert(picking.captureIntervalMs <= 220, 'picking camera cadence must support motion analysis');
assert(strumming.captureIntervalMs <= 220, 'strumming camera cadence must support motion analysis');
assert(arpeggio.captureIntervalMs <= 240, 'arpeggio camera cadence must support finger return analysis');
equal(picking.pickColor, 'auto', 'picking requires pick tracking');
equal(strumming.pickColor, 'auto', 'strumming requires pick tracking');
equal(arpeggio.pickColor, 'none', 'arpeggio must not require a pick');
console.log('Focus practice mode tests passed: 14');
