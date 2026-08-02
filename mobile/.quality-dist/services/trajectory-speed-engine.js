"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrajectorySpeedCoach = void 0;
const BIN_COUNT = 16;
const BASELINE_MIN_SAMPLES = 30;
const BASELINE_MIN_DURATION_MS = 5_500;
const STABLE_DEVIATION = 0.22;
const BROKEN_DEVIATION = 0.34;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
function mean(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
function patternSteps(pattern) {
    const tokens = pattern?.match(/[PpIiMmAaDdUu]/g) ?? [];
    return clamp(tokens.length || 4, 2, 12);
}
function emptyVector(length) {
    return Array.from({ length }, () => 0);
}
function addVectors(left, right) {
    return left.map((value, index) => value + (right[index] ?? 0));
}
function divideVector(vector, divisor) {
    return vector.map((value) => value / Math.max(1, divisor));
}
function pairDistance(left, right, first, second) {
    return Math.hypot((left[first] ?? 0) - (right[first] ?? 0), (left[second] ?? 0) - (right[second] ?? 0));
}
function vectorDistance(left, right) {
    if (!left.length || left.length !== right.length)
        return 1;
    const wristCenter = pairDistance(left, right, 0, 1) * 2.4;
    const wristAngle = Math.abs((left[2] ?? 0) - (right[2] ?? 0)) * 1.25;
    const thumb = pairDistance(left, right, 3, 4) * 0.72;
    const index = pairDistance(left, right, 5, 6) * 0.92;
    const middle = pairDistance(left, right, 7, 8) * 0.82;
    const ring = pairDistance(left, right, 9, 10) * 0.78;
    const pick = pairDistance(left, right, 11, 12) * 0.95;
    const combined = mean([wristCenter, wristAngle, thumb, index, middle, ring, pick]);
    return Math.max(wristCenter, wristAngle, index, pick, combined * 1.15);
}
function featureVector(sample) {
    const palm = Math.max(0.035, sample.palmSize);
    const relative = (x, y) => [
        clamp((x - sample.wristX) / palm, -4, 4),
        clamp((y - sample.wristY) / palm, -4, 4),
    ];
    const thumb = relative(sample.thumbX, sample.thumbY);
    const index = relative(sample.indexX, sample.indexY);
    const middle = relative(sample.middleX, sample.middleY);
    const ring = relative(sample.ringX, sample.ringY);
    const pick = sample.pickX == null || sample.pickY == null
        ? [0, 0]
        : relative(sample.pickX, sample.pickY);
    return [
        sample.wristX,
        sample.wristY,
        clamp(sample.palmAngleDegrees / 90, -2, 2),
        ...thumb,
        ...index,
        ...middle,
        ...ring,
        ...pick,
    ];
}
function dominantCause(current, baseline) {
    const group = (indices) => mean(indices.map((index) => Math.abs((current[index] ?? 0) - (baseline[index] ?? 0))));
    const candidates = [
        { id: 'wrist-center', value: group([0, 1]) * 2.4 },
        { id: 'wrist-angle', value: group([2]) * 1.25 },
        { id: 'thumb', value: group([3, 4]) * 0.72 },
        { id: 'index-return', value: group([5, 6]) * 0.92 },
        { id: 'finger-balance', value: group([7, 8, 9, 10]) * 0.8 },
        { id: 'pick-path', value: group([11, 12]) * 0.95 },
    ].sort((left, right) => right.value - left.value);
    return candidates[0]?.id ?? 'wrist-center';
}
function guidance(cause, deviationPercent, bpm, lastStableBpm) {
    if (cause === 'wrist-angle') {
        return {
            observation: `${bpm} BPM에서 기준보다 손목 회전축 편차가 커졌습니다.`,
            cause: '속도에 맞추려고 손목 각도를 매번 새로 만들면서 다운·업 궤적이 달라지고 있습니다.',
            correction: '손목 중심은 같은 위치에 두고 전완 회전과 작은 손목 움직임을 같은 축으로 반복하세요.',
            reinforcement: '기타 없이 손목 중심을 고정한 다운·업 공중 궤적 8회 후 한 줄 피킹 8회를 실행하세요.',
        };
    }
    if (cause === 'index-return') {
        return {
            observation: `${bpm} BPM에서 검지 끝의 복귀 궤적이 기준에서 ${deviationPercent}% 벗어났습니다.`,
            cause: '탄현 뒤 검지가 앞으로 남거나 손바닥 쪽 복귀가 늦어 다음 동작 준비가 밀리고 있습니다.',
            correction: '줄을 통과한 즉시 검지 끝을 손바닥 안쪽으로 짧게 되돌리고 다음 음 전에 준비 위치를 만드세요.',
            reinforcement: `P-i 또는 i 단독 탄현 후 즉시 복귀하는 동작을 ${Math.max(35, lastStableBpm - 10)} BPM에서 8회 반복하세요.`,
        };
    }
    if (cause === 'finger-balance') {
        return {
            observation: `${bpm} BPM에서 중지·약지의 상대 위치가 느린 기준 궤적과 달라졌습니다.`,
            cause: '한 손가락을 움직일 때 사용하지 않는 손가락이 같이 들리거나 준비 위치가 흔들리고 있습니다.',
            correction: '움직이는 손가락만 탄현하고 나머지 손가락 끝은 줄 위 준비 위치에서 작게 유지하세요.',
            reinforcement: 'p-a-m-i를 소리 없이 공중에서 4회, 기타에서 아주 약하게 4회 반복하세요.',
        };
    }
    if (cause === 'pick-path') {
        return {
            observation: `${bpm} BPM에서 피크 끝의 줄 통과 경로가 기준에서 ${deviationPercent}% 벗어났습니다.`,
            cause: '속도가 올라가면서 피크 노출량이나 줄을 통과하는 깊이가 커져 되돌아오는 경로가 벌어지고 있습니다.',
            correction: '피크 끝을 조금 숨기고 한 줄을 지난 뒤 줄에서 멀어지지 않게 짧은 타원 궤적으로 돌아오세요.',
            reinforcement: `마지막 안정 속도 ${lastStableBpm} BPM에서 한 줄 다운·업 8회, 줄 이동 4회를 실행하세요.`,
        };
    }
    if (cause === 'thumb') {
        return {
            observation: `${bpm} BPM에서 엄지의 시작점과 복귀점이 느린 기준보다 크게 움직였습니다.`,
            cause: '엄지를 아래로 눌러 멈춘 뒤 다시 들어 올리면서 동작이 두 단계로 끊기고 있습니다.',
            correction: '줄을 누르지 말고 통과한 방향으로 자연스럽게 이어서 다음 준비 위치로 이동하세요.',
            reinforcement: `P-i-P를 ${Math.max(35, lastStableBpm - 5)} BPM에서 6회 반복하고 두 번째 P의 시작 지연을 줄이세요.`,
        };
    }
    return {
        observation: `${bpm} BPM에서 손목 중심 이동이 기준보다 ${deviationPercent}% 커졌습니다.`,
        cause: '속도를 손가락이나 피크가 아니라 손 전체 이동으로 따라가면서 기준 궤적이 무너지고 있습니다.',
        correction: '손목 중심을 화면의 같은 지점에 두고 필요한 손가락·피크만 짧게 움직이세요.',
        reinforcement: `마지막 안정 속도 ${lastStableBpm} BPM에서 손목 중심 고정 3회 성공 후 다시 5 BPM 올리세요.`,
    };
}
class TrajectorySpeedCoach {
    startBpm;
    targetBpm;
    pulsesPerBeat;
    cycleSteps;
    baselineBins;
    baselineSamples = [];
    baselineStartedAt = 0;
    baselineReady = false;
    currentBpm;
    lastStableBpm;
    phaseStartedAt = 0;
    cycleIndex = -1;
    cycleDistances = [];
    cycleCauses = [];
    stableCycles = 0;
    brokenCycles = 0;
    lastResult;
    constructor(options) {
        this.startBpm = options.startBpm;
        this.targetBpm = options.targetBpm;
        this.currentBpm = options.startBpm;
        this.lastStableBpm = options.startBpm;
        this.pulsesPerBeat = Math.max(1, options.pulsesPerBeat);
        this.cycleSteps = patternSteps(options.pattern);
        this.baselineBins = Array.from({ length: BIN_COUNT }, () => ({ sum: emptyVector(13), count: 0 }));
        this.lastResult = this.result('waiting', Date.now(), '기준 궤적 대기', '카메라에서 손목과 손가락 궤적을 확인하고 있습니다.');
    }
    start(capturedAt = Date.now()) {
        this.baselineStartedAt = capturedAt;
        this.phaseStartedAt = capturedAt;
        this.baselineReady = false;
        this.baselineSamples = [];
        this.baselineBins.forEach((bin) => {
            bin.sum = emptyVector(13);
            bin.count = 0;
        });
        this.currentBpm = this.startBpm;
        this.lastStableBpm = this.startBpm;
        this.cycleIndex = -1;
        this.cycleDistances = [];
        this.cycleCauses = [];
        this.stableCycles = 0;
        this.brokenCycles = 0;
        this.lastResult = this.result('collecting-baseline', capturedAt, '느린 속도 기준 궤적을 만드는 중', '힘을 빼고 올바른 자세와 궤적으로 같은 패턴을 반복하세요.');
        return this.lastResult;
    }
    updateBpm(nextBpm, capturedAt = Date.now()) {
        this.currentBpm = clamp(Math.round(nextBpm), 35, 220);
        this.phaseStartedAt = capturedAt;
        this.cycleIndex = -1;
        this.cycleDistances = [];
        this.cycleCauses = [];
        this.stableCycles = 0;
        this.brokenCycles = 0;
    }
    getLastResult() {
        return this.lastResult;
    }
    addSample(sample) {
        if (sample.handConfidence < 0.48 || sample.wristConfidence < 0.38 || sample.palmSize < 0.06) {
            this.lastResult = this.result('cannot-judge', sample.capturedAt, '궤적 정밀 판정 불가', `손 ${Math.round(sample.handConfidence * 100)}% · 손목 ${Math.round(sample.wristConfidence * 100)}%로 기준 궤적을 비교하기 부족합니다.`);
            return this.lastResult;
        }
        const vector = featureVector(sample);
        const bin = this.phaseBin(sample.capturedAt);
        if (!this.baselineReady) {
            const baselineBin = this.baselineBins[bin];
            baselineBin.sum = addVectors(baselineBin.sum, vector);
            baselineBin.count += 1;
            this.baselineSamples.push({ bin, vector });
            if (this.canFinishBaseline(sample.capturedAt)) {
                const noise = this.baselineNoise();
                if (noise <= 0.30) {
                    this.baselineReady = true;
                    this.phaseStartedAt = sample.capturedAt;
                    this.cycleIndex = -1;
                    this.lastResult = this.result('baseline-ready', sample.capturedAt, `${this.startBpm} BPM 기준 궤적 저장 완료`, `느린 기준의 반복 편차가 ${Math.round(noise * 100)}%입니다. 이제 속도를 올려도 같은 궤적이 유지되는지 비교합니다.`);
                    return this.lastResult;
                }
                if (sample.capturedAt - this.baselineStartedAt >= 12_000) {
                    this.lastResult = this.result('cannot-judge', sample.capturedAt, '기준 궤적이 아직 불안정합니다', `느린 속도 반복 편차가 ${Math.round(noise * 100)}%입니다. 속도를 올리지 말고 같은 동작을 더 작게 반복하세요.`);
                    return this.lastResult;
                }
            }
            this.lastResult = this.result('collecting-baseline', sample.capturedAt, '느린 속도 기준 궤적 수집 중', `${this.baselineSamples.length}/${BASELINE_MIN_SAMPLES}개 표본 · 같은 자세로 계속 반복하세요.`);
            return null;
        }
        const baseline = this.baselineVector(bin);
        if (!baseline)
            return null;
        const measuredDistance = vectorDistance(vector, baseline);
        this.cycleDistances.push(measuredDistance);
        this.cycleCauses.push(dominantCause(vector, baseline));
        const nextCycleIndex = this.currentCycleIndex(sample.capturedAt);
        if (this.cycleIndex < 0) {
            this.cycleIndex = nextCycleIndex;
            return null;
        }
        if (nextCycleIndex === this.cycleIndex)
            return null;
        const completedDistances = this.cycleDistances.splice(0);
        const completedCauses = this.cycleCauses.splice(0);
        this.cycleIndex = nextCycleIndex;
        if (completedDistances.length < 3)
            return null;
        const averageDeviation = mean(completedDistances);
        const deviationPercent = Math.round(averageDeviation * 100);
        const causeCounts = new Map();
        completedCauses.forEach((cause) => causeCounts.set(cause, (causeCounts.get(cause) ?? 0) + 1));
        const cause = [...causeCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'wrist-center';
        if (averageDeviation <= STABLE_DEVIATION) {
            this.stableCycles += 1;
            this.brokenCycles = 0;
            if (this.stableCycles >= 2)
                this.lastStableBpm = Math.max(this.lastStableBpm, this.currentBpm);
            this.lastResult = this.result('stable', sample.capturedAt, `${this.currentBpm} BPM에서도 기준 궤적 유지`, `느린 기준 대비 궤적 편차 ${deviationPercent}% · ${this.stableCycles}회 연속 안정입니다.`, deviationPercent);
            return this.lastResult;
        }
        if (averageDeviation >= BROKEN_DEVIATION) {
            this.brokenCycles += 1;
            this.stableCycles = 0;
            const detail = guidance(cause, deviationPercent, this.currentBpm, this.lastStableBpm);
            this.lastResult = {
                ...this.result('broken', sample.capturedAt, '속도를 올리면서 기준 궤적이 깨졌습니다', detail.observation, deviationPercent),
                cause: detail.cause,
                correction: detail.correction,
                reinforcement: detail.reinforcement,
                nextGoal: `${this.lastStableBpm} BPM에서 3회 안정 후 다시 ${Math.min(this.targetBpm, this.lastStableBpm + 5)} BPM을 시도하세요.`,
            };
            return this.lastResult;
        }
        this.stableCycles = 0;
        this.brokenCycles = 0;
        this.lastResult = this.result('baseline-ready', sample.capturedAt, '기준 궤적 경계 구간', `현재 편차 ${deviationPercent}%입니다. 속도를 유지하고 같은 동작을 2회 더 반복하세요.`, deviationPercent);
        return this.lastResult;
    }
    cycleDurationMs() {
        const stepMs = 60_000 / Math.max(35, this.currentBpm) / this.pulsesPerBeat;
        return stepMs * this.cycleSteps;
    }
    currentCycleIndex(capturedAt) {
        return Math.floor(Math.max(0, capturedAt - this.phaseStartedAt) / Math.max(200, this.cycleDurationMs()));
    }
    phaseBin(capturedAt) {
        const cycleMs = Math.max(200, this.cycleDurationMs());
        const position = ((capturedAt - this.phaseStartedAt) % cycleMs + cycleMs) % cycleMs;
        return clamp(Math.floor(position / cycleMs * BIN_COUNT), 0, BIN_COUNT - 1);
    }
    baselineVector(binIndex) {
        const exact = this.baselineBins[binIndex];
        if (exact?.count)
            return divideVector(exact.sum, exact.count);
        for (let offset = 1; offset < BIN_COUNT; offset += 1) {
            const left = this.baselineBins[(binIndex - offset + BIN_COUNT) % BIN_COUNT];
            const right = this.baselineBins[(binIndex + offset) % BIN_COUNT];
            if (left.count)
                return divideVector(left.sum, left.count);
            if (right.count)
                return divideVector(right.sum, right.count);
        }
        return null;
    }
    canFinishBaseline(capturedAt) {
        const occupied = this.baselineBins.filter((bin) => bin.count > 0).length;
        return this.baselineSamples.length >= BASELINE_MIN_SAMPLES
            && occupied >= 9
            && capturedAt - this.baselineStartedAt >= BASELINE_MIN_DURATION_MS;
    }
    baselineNoise() {
        const distances = this.baselineSamples.map((sample) => {
            const baseline = this.baselineVector(sample.bin);
            return baseline ? vectorDistance(sample.vector, baseline) : 1;
        });
        return mean(distances);
    }
    result(state, capturedAt, title, observation, deviationPercent = null) {
        const stable = state === 'stable';
        const broken = state === 'broken';
        return {
            capturedAt,
            state,
            title,
            observation,
            cause: stable
                ? '손목 중심, 손가락 상대 위치와 피크 경로가 느린 기준 범위 안에 있습니다.'
                : state === 'collecting-baseline'
                    ? '먼저 올바른 느린 동작을 개인 기준으로 저장해야 합니다.'
                    : state === 'cannot-judge'
                        ? '손목 또는 손가락 표본 신뢰도가 부족합니다.'
                        : '기준 궤적과 현재 궤적을 같은 연주 단계에서 비교하고 있습니다.',
            correction: stable
                ? '현재 손목 중심과 동작 폭을 그대로 유지하세요.'
                : '손목과 손가락 끝이 모두 보이게 맞추고 같은 동작을 작게 반복하세요.',
            reinforcement: stable
                ? '현재 속도에서 2회 더 유지하면 다음 속도로 올립니다.'
                : '마지막 안정 속도에서 짧은 부분 동작을 반복한 뒤 다시 연결하세요.',
            nextGoal: stable
                ? `${Math.min(this.targetBpm, this.currentBpm + 5)} BPM에서도 같은 궤적을 유지하세요.`
                : `${this.currentBpm} BPM에서 기준 궤적 안으로 3회 연속 들어오세요.`,
            confidencePercent: state === 'cannot-judge' ? 35 : this.baselineReady ? 82 : 58,
            deviationPercent,
            currentBpm: this.currentBpm,
            baselineBpm: this.startBpm,
            lastStableBpm: this.lastStableBpm,
            stableCycles: this.stableCycles,
            brokenCycles: this.brokenCycles,
            shouldIncreaseBpm: stable && this.stableCycles >= 3 && this.currentBpm < this.targetBpm,
            shouldReturnToStableBpm: broken && this.brokenCycles >= 2 && this.currentBpm > this.lastStableBpm,
        };
    }
}
exports.TrajectorySpeedCoach = TrajectorySpeedCoach;
