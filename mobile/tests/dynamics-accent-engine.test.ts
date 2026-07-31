import { strict as assert } from 'node:assert';

import type { NativeAudioReading } from '../modules/guitar-coach-audio';
import {
  DynamicsAccentAnalyzer,
  isAudibleAttackReading,
} from '../services/dynamics-accent-engine';

function reading(
  attackCount: number,
  level: number,
  clippingRatio = 0,
  overrides: Partial<NativeAudioReading> = {},
): NativeAudioReading {
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

const silence = reading(2, 0.0006, 0.08, {
  peakAmplitude: 0.001,
  attackStrength: 0.001,
  noiseFloor: 0.01,
  signalToNoiseDb: 2,
});
assert.equal(isAudibleAttackReading(silence), false, '무음·주변 소음을 실제 기타 어택으로 받아들이면 안 됩니다.');

const silentAnalyzer = new DynamicsAccentAnalyzer({ category: 'strumming', pattern: 'D U D U' });
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
assert.equal(silentAnalyzer.getSnapshot().issue, 'waiting');
assert.equal(silentAnalyzer.getSnapshot().acceptedAttacks, 0, '무음에서는 강약 표본이 하나도 쌓이면 안 됩니다.');

const stable = new DynamicsAccentAnalyzer({ category: 'strumming', pattern: 'D U D U' });
stable.reset(0);
const targetLevels = [0.50, 0.30, 0.39, 0.30];
let stableIssue = '';
for (let cycle = 0; cycle < 5; cycle += 1) {
  targetLevels.forEach((level, index) => {
    const count = cycle * targetLevels.length + index + 1;
    const snapshot = stable.addReading(reading(count, level), count * 200);
    if (snapshot && snapshot.completedCycles >= 2) stableIssue = snapshot.issue;
  });
}
assert.equal(stableIssue, 'stable', '목표 강약과 비슷한 실제 어택 패턴은 안정으로 판정되어야 합니다.');

const flat = new DynamicsAccentAnalyzer({ category: 'strumming', pattern: 'D U D U' });
flat.reset(0);
let flatIssue = '';
for (let count = 1; count <= 16; count += 1) {
  const snapshot = flat.addReading(reading(count, 0.36), count * 200);
  if (snapshot && snapshot.completedCycles >= 2) flatIssue = snapshot.issue;
}
assert.ok(
  flatIssue === 'flat-dynamics' || flatIssue === 'accent-missed',
  `같은 음량 반복은 평평한 강약 또는 악센트 부족으로 판정되어야 합니다. 실제: ${flatIssue}`,
);

const clipped = new DynamicsAccentAnalyzer({ category: 'alternatePicking', pattern: 'D U D U' });
clipped.reset(0);
let clippingIssue = '';
for (let count = 1; count <= 12; count += 1) {
  const isClippedAttack = count === 8;
  const snapshot = clipped.addReading(
    reading(count, isClippedAttack ? 0.98 : 0.56, isClippedAttack ? 0.08 : 0),
    count * 200,
  );
  if (snapshot && snapshot.completedCycles >= 2) clippingIssue = snapshot.issue;
}
assert.equal(clippingIssue, 'clipping', '충분한 실제 어택 뒤 확인된 클리핑만 입력 오류로 판정되어야 합니다.');

console.log('dynamics-accent-engine tests passed');
