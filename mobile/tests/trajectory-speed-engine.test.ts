import { strict as assert } from 'node:assert';

import { TrajectorySpeedCoach, type MotionSample } from '../services/trajectory-speed-engine';

function sample(capturedAt: number, shift = 0): MotionSample {
  const phase = capturedAt / 2_000 * Math.PI * 2;
  const wristX = 0.52 + Math.sin(phase) * 0.018 + shift;
  const wristY = 0.60 + Math.cos(phase) * 0.014;
  return {
    capturedAt,
    handConfidence: 0.92,
    wristConfidence: 0.88,
    palmSize: 0.19,
    wristX,
    wristY,
    palmAngleDegrees: 52 + Math.sin(phase) * 4 + shift * 80,
    thumbX: wristX - 0.10,
    thumbY: wristY - 0.03,
    indexX: wristX + 0.06 + Math.sin(phase) * 0.015,
    indexY: wristY - 0.16,
    middleX: wristX + 0.02,
    middleY: wristY - 0.18,
    ringX: wristX - 0.02,
    ringY: wristY - 0.17,
    pickX: wristX + 0.05 + shift,
    pickY: wristY + 0.08,
    pickConfidence: 0.82,
  };
}

const coach = new TrajectorySpeedCoach({
  startBpm: 60,
  targetBpm: 100,
  pulsesPerBeat: 2,
  pattern: 'D U D U',
});
coach.start(0);

let baselineReady = false;
for (let time = 0; time <= 8_000; time += 160) {
  const result = coach.addSample(sample(time));
  if (result?.state === 'baseline-ready') baselineReady = true;
}
assert.equal(baselineReady, true, '느린 속도 기준 궤적이 저장되어야 합니다.');

let stableSeen = false;
for (let time = 8_160; time <= 16_000; time += 160) {
  const result = coach.addSample(sample(time));
  if (result?.state === 'stable') stableSeen = true;
}
assert.equal(stableSeen, true, '같은 궤적 반복은 안정으로 판정되어야 합니다.');

coach.updateBpm(75, 16_100);
let brokenSeen = false;
for (let time = 16_100; time <= 24_500; time += 150) {
  const result = coach.addSample(sample(time, 0.18));
  if (result?.state === 'broken') {
    brokenSeen = true;
    assert.ok(result.reinforcement.length > 10, '붕괴 원인에 맞는 보강훈련이 포함되어야 합니다.');
    assert.ok(result.lastStableBpm >= 60, '마지막 안정 BPM이 유지되어야 합니다.');
  }
}
assert.equal(brokenSeen, true, '속도 상승 후 크게 달라진 궤적은 붕괴로 판정되어야 합니다.');

console.log('trajectory-speed-engine tests passed');
