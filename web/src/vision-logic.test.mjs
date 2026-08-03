import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DirectionalStrumTracker,
  canCountStrum,
  combinedGuitarConfidence,
  guitarPredictionScore,
} from './vision-logic.js';

test('global motion alone can never authorize a strum', () => {
  assert.equal(canCountStrum({ handConfidence: 0, guitarConfidence: 0, stringCount: 0, stringConfidence: 0 }), false);
  assert.equal(canCountStrum({ handConfidence: 0.8, guitarConfidence: 0.8, stringCount: 3, stringConfidence: 0.8 }), false);
  assert.equal(canCountStrum({ handConfidence: 0.8, guitarConfidence: 0.8, stringCount: 6, stringConfidence: 0.8 }), true);
});

test('guitar score accepts instrument labels and rejects unrelated labels', () => {
  assert.equal(guitarPredictionScore([{ className: 'tabby cat', probability: 0.9 }]), 0);
  assert.equal(guitarPredictionScore([{ className: 'acoustic guitar', probability: 0.62 }]), 0.62);
});

test('parallel strings only support guitar evidence when a hand is also present', () => {
  assert.equal(combinedGuitarConfidence({ stringCount: 6, stringConfidence: 0.8, handConfidence: 0 }), 0);
  assert.ok(combinedGuitarConfidence({ stringCount: 6, stringConfidence: 0.8, handConfidence: 0.8 }) > 0.6);
});

test('direction tracker counts only a full crossing in the requested direction', () => {
  const tracker = new DirectionalStrumTracker({ minimumTravel: 0.05, cooldownMs: 100 });
  const band = { top: 0.45, bottom: 0.55 };

  assert.equal(tracker.sample({ timestamp: 0, pointY: 0.4, band, ready: true }), null);
  assert.equal(tracker.sample({ timestamp: 150, pointY: 0.6, band, ready: true }), 'down');
  assert.equal(tracker.sample({ timestamp: 300, pointY: 0.58, band, ready: true }), null);
  assert.equal(tracker.sample({ timestamp: 450, pointY: 0.4, band, ready: true }), 'up');
});

test('direction tracker resets when recognition evidence is lost', () => {
  const tracker = new DirectionalStrumTracker({ minimumTravel: 0.05, cooldownMs: 100 });
  const band = { top: 0.45, bottom: 0.55 };
  tracker.sample({ timestamp: 0, pointY: 0.4, band, ready: true });
  tracker.sample({ timestamp: 100, pointY: 0.5, band, ready: false });
  assert.equal(tracker.sample({ timestamp: 200, pointY: 0.6, band, ready: true }), null);
});
