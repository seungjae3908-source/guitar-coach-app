import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PERSONAL_TECHNIQUE_CALIBRATION_STORAGE_KEY,
  PersonalizedRightHandTechniqueAnalyzer,
  calibrationViewBucket,
} from './personal-technique-calibration.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

class FakeAnalyzer {
  reset() {}
  update(input) { return input.fakeResult; }
}

function point(x, y, z = 0) {
  return { x, y, z, visibility: 1, presence: 1 };
}

function hand(scale = 0.12) {
  const wrist = point(0.55, 0.65);
  const landmarks = Array.from({ length: 21 }, () => point(wrist.x, wrist.y));
  landmarks[0] = wrist;
  landmarks[5] = point(wrist.x - scale * 0.35, wrist.y - scale * 0.55);
  landmarks[9] = point(wrist.x, wrist.y - scale * 0.66);
  landmarks[17] = point(wrist.x + scale * 0.42, wrist.y - scale * 0.48);
  landmarks[4] = point(wrist.x - scale * 0.1, wrist.y - scale * 0.95);
  landmarks[8] = point(wrist.x + scale * 0.12, wrist.y - scale * 0.98);
  return { trackId: 1, role: 'strum', wrist, landmarks };
}

function result(view = 'front', type = 'wrist', confidence = 0.82) {
  const labels = {
    front: '정면',
    'left-oblique': '왼쪽 사선',
    'right-oblique': '오른쪽 사선',
    'left-side': '왼쪽 측면',
    'right-side': '오른쪽 측면',
  };
  return {
    cameraView: view,
    cameraViewLabel: labels[view] || view,
    poseReady: true,
    angleCorrectionReady: true,
    angleCorrectionConfidence: 0.9,
    movementType: type,
    movementConfidence: confidence,
    wristRatio: type === 'wrist' ? 0.78 : 0.22,
    armRatio: type === 'arm' ? 0.78 : 0.22,
    strumSps: 6.5,
    pickingSps: 4.2,
    threeFingerSps: 3.8,
    pickingEvent: null,
    fingerEvent: null,
  };
}

function train(analyzer, {
  view = 'front',
  count = 30,
  start = 1000,
  scale = 0.12,
  type = 'wrist',
} = {}) {
  let output;
  for (let index = 0; index < count; index += 1) {
    output = analyzer.update({
      timestamp: start + index * 120,
      hand: hand(scale),
      band: { top: 0.48, bottom: 0.525, center: 0.5025 },
      strokeEvent: index % 2 ? 'up' : 'down',
      fakeResult: result(view, type),
    });
  }
  return output;
}

test('normalizes unknown camera view to the front calibration bucket', () => {
  assert.equal(calibrationViewBucket('left-oblique'), 'left-oblique');
  assert.equal(calibrationViewBucket('unexpected'), 'front');
});

test('learns and persists a local-only personal baseline', () => {
  const storage = new MemoryStorage();
  const analyzer = new PersonalizedRightHandTechniqueAnalyzer({ analyzer: new FakeAnalyzer(), storage });
  const output = train(analyzer);
  assert.equal(output.personalCalibrationReady, true);
  assert.equal(output.personalCalibrationProgress, 1);
  assert.ok(output.personalCalibrationTuning.palmScale > 0.05);
  assert.ok(output.personalBaselineSimilarity > 0.8);
  const saved = storage.getItem(PERSONAL_TECHNIQUE_CALIBRATION_STORAGE_KEY);
  assert.ok(saved);
  assert.equal(saved.includes('landmarks'), false);
  assert.equal(saved.includes('image'), false);
  assert.equal(saved.includes('video'), false);
});

test('restores the personal baseline in a new analyzer instance', () => {
  const storage = new MemoryStorage();
  const first = new PersonalizedRightHandTechniqueAnalyzer({ analyzer: new FakeAnalyzer(), storage });
  train(first);
  const second = new PersonalizedRightHandTechniqueAnalyzer({ analyzer: new FakeAnalyzer(), storage });
  const output = second.update({
    timestamp: 8000,
    hand: hand(0.12),
    band: { top: 0.48, bottom: 0.525, center: 0.5025 },
    strokeEvent: 'down',
    fakeResult: result('front'),
  });
  assert.equal(output.personalCalibrationReady, true);
  assert.equal(output.personalCalibrationSource, 'angle-personal');
  assert.ok(output.personalCalibrationSamples >= 24);
});

test('keeps separate profiles for front and oblique camera views', () => {
  const analyzer = new PersonalizedRightHandTechniqueAnalyzer({ analyzer: new FakeAnalyzer(), storage: new MemoryStorage() });
  train(analyzer, { view: 'front', count: 30, start: 1000 });
  let output = train(analyzer, { view: 'left-oblique', count: 8, start: 6000, scale: 0.1 });
  assert.equal(output.personalCalibrationBucket, 'left-oblique');
  assert.equal(output.personalCalibrationReady, false);
  assert.equal(output.personalCalibrationGlobalReady, true);
  assert.ok(['angle-learning', 'global-personal'].includes(output.personalCalibrationSource));
  output = train(analyzer, { view: 'left-oblique', count: 26, start: 8000, scale: 0.1 });
  assert.equal(output.personalCalibrationReady, true);
  assert.ok(output.personalCalibrationCoverage >= 2);
});

test('rejects repeated scale spikes from corrupting a mature baseline', () => {
  const analyzer = new PersonalizedRightHandTechniqueAnalyzer({ analyzer: new FakeAnalyzer(), storage: new MemoryStorage() });
  let output = train(analyzer, { count: 30, scale: 0.12 });
  const before = output.personalCalibrationTuning.palmScale;
  output = train(analyzer, { count: 12, start: 7000, scale: 0.3 });
  const after = output.personalCalibrationTuning.palmScale;
  assert.ok(after < before * 1.35);
});

test('does not learn when the arm is hidden or confidence is insufficient', () => {
  const analyzer = new PersonalizedRightHandTechniqueAnalyzer({ analyzer: new FakeAnalyzer(), storage: new MemoryStorage() });
  let output;
  for (let index = 0; index < 40; index += 1) {
    output = analyzer.update({
      timestamp: 1000 + index * 120,
      hand: hand(),
      band: { top: 0.48, bottom: 0.525 },
      fakeResult: {
        ...result('front', 'unjudgeable', 0),
        poseReady: false,
        angleCorrectionReady: false,
      },
    });
  }
  assert.equal(output.personalCalibrationSamples, 0);
  assert.equal(output.personalCalibrationProgress, 0);
  assert.equal(output.personalCalibrationReady, false);
});

test('clears the saved baseline without affecting the analyzer instance', () => {
  const storage = new MemoryStorage();
  const analyzer = new PersonalizedRightHandTechniqueAnalyzer({ analyzer: new FakeAnalyzer(), storage });
  train(analyzer);
  analyzer.clearPersonalCalibration();
  assert.equal(storage.getItem(PERSONAL_TECHNIQUE_CALIBRATION_STORAGE_KEY), null);
  const output = analyzer.update({
    timestamp: 10000,
    hand: hand(),
    band: { top: 0.48, bottom: 0.525 },
    strokeEvent: 'down',
    fakeResult: result('front'),
  });
  assert.equal(output.personalCalibrationReady, false);
});
