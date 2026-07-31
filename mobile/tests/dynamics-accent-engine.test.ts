import { strict as assert } from 'node:assert';

import type { NativeAudioReading } from '../modules/guitar-coach-audio';
import { DynamicsAccentAnalyzer } from '../services/dynamics-accent-engine';

function reading(attackCount: number, level: number, clippingRatio = 0): NativeAudioReading {
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
  };
}

const stable = new DynamicsAccentAnalyzer({ category: 'strumming', pattern: 'D U D U' });
stable.reset(0);
const targetLevels = [0.50, 0.30, 0.39, 0.30];
let stableIssue = '';
for (let cycle = 0; cycle < 4; cycle += 1) {
  targetLevels.forEach((level, index) => {
    const count = cycle * targetLevels.length + index + 1;
    const snapshot = stable.addReading(reading(count, level), count * 200);
    if (snapshot && snapshot.completedCycles >= 2) stableIssue = snapshot.issue;
  });
}
assert.equal(stableIssue, 'stable', '목표 강약과 비슷한 패턴은 안정으로 판정되어야 합니다.');

const flat = new DynamicsAccentAnalyzer({ category: 'strumming', pattern: 'D U D U' });
flat.reset(0);
let flatIssue = '';
for (let count = 1; count <= 12; count += 1) {
  const snapshot = flat.addReading(reading(count, 0.36), count * 200);
  if (snapshot?.completedCycles) flatIssue = snapshot.issue;
}
assert.ok(
  flatIssue === 'flat-dynamics' || flatIssue === 'accent-missed',
  `같은 음량 반복은 평평한 강약 또는 악센트 부족으로 판정되어야 합니다. 실제: ${flatIssue}`,
);

const clipped = new DynamicsAccentAnalyzer({ category: 'alternatePicking', pattern: 'D U D U' });
clipped.reset(0);
let clippingIssue = '';
for (let count = 1; count <= 4; count += 1) {
  const snapshot = clipped.addReading(reading(count, 0.7, count === 3 ? 0.08 : 0), count * 200);
  if (snapshot?.completedCycles) clippingIssue = snapshot.issue;
}
assert.equal(clippingIssue, 'clipping', '클리핑 표본은 강약 점수 대신 입력 오류로 판정되어야 합니다.');

console.log('dynamics-accent-engine tests passed');
