import {
  cameraAnalysisProfile,
  categoryMatchesFocusMode,
  focusModeForCategory,
} from '../services/focus-practice-mode';

function equal(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}`);
}

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

equal(focusModeForCategory('alternatePicking'), 'picking', 'alternate picking mode');
equal(focusModeForCategory('downPicking'), 'picking', 'down picking mode');
equal(focusModeForCategory('strumming'), 'strumming', 'strum mode');
equal(focusModeForCategory('arpeggio'), 'arpeggio', 'arpeggio mode');
equal(focusModeForCategory('chords'), 'left-hand', 'left hand mode');

assert(categoryMatchesFocusMode('fingerstyle', 'arpeggio'), 'fingerstyle should use arpeggio focus');
assert(!categoryMatchesFocusMode('strumming', 'picking'), 'strumming must not leak into picking');

const picking = cameraAnalysisProfile('alternatePicking');
const strumming = cameraAnalysisProfile('strumming');
const arpeggio = cameraAnalysisProfile('arpeggio');
assert(picking.captureIntervalMs <= 220, 'picking camera cadence must support motion analysis');
assert(strumming.captureIntervalMs <= 220, 'strumming camera cadence must support motion analysis');
assert(arpeggio.captureIntervalMs <= 240, 'arpeggio camera cadence must support finger return analysis');
equal(picking.pickColor, 'auto', 'picking requires pick tracking');
equal(strumming.pickColor, 'auto', 'strumming requires pick tracking');
equal(arpeggio.pickColor, 'none', 'arpeggio must not require a pick');

console.log('Focus practice mode tests passed: 14');
