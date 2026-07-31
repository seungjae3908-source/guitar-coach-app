import type { PracticeCategoryId } from '../config/guitar-mode-profiles';
import type { NativeAudioReading } from '../modules/guitar-coach-audio';

export type DynamicsPoint = {
  id: string;
  capturedAt: number;
  slot: number;
  label: string;
  actual: number;
  target: number;
  clipped: boolean;
};

export type DynamicsIssueId =
  | 'waiting'
  | 'clipping'
  | 'flat-dynamics'
  | 'accent-missed'
  | 'weak-upstroke'
  | 'uneven-volume'
  | 'stable';

export type DynamicsSnapshot = {
  capturedAt: number;
  points: DynamicsPoint[];
  issue: DynamicsIssueId;
  title: string;
  observation: string;
  correction: string;
  reinforcement: string;
  confidencePercent: number;
  accentMatchPercent: number | null;
  evennessPercent: number | null;
  completedCycles: number;
};

type DynamicsOptions = {
  category: PracticeCategoryId;
  pattern?: string;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function labelsFromPattern(pattern?: string) {
  const tokens = pattern?.match(/[PpIiMmAaDdUu]/g) ?? [];
  if (!tokens.length) return ['1', '&', '2', '&', '3', '&', '4', '&'];
  return tokens.slice(0, 12).map((token) => token.toUpperCase());
}

function targetFor(category: PracticeCategoryId, labels: string[]) {
  if (category === 'arpeggio' || category === 'fingerstyle') {
    return labels.map((label, index) => {
      if (label === 'P') return 0.86;
      if (label === 'A') return 0.82;
      if (label === 'M') return 0.76;
      if (label === 'I') return 0.70;
      return index === 0 ? 0.88 : 0.70;
    });
  }
  if (category === 'chords' || category === 'powerChords') {
    return labels.map((_, index) => index % 4 === 0 ? 1 : index % 2 === 0 ? 0.76 : 0.58);
  }
  return labels.map((label, index) => {
    if (index % 4 === 0) return 1;
    if (index % 2 === 0) return 0.78;
    if (label === 'U') return 0.60;
    return 0.62;
  });
}

function percentile(values: number[], amount: number) {
  if (!values.length) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.round((sorted.length - 1) * amount), 0, sorted.length - 1);
  return sorted[index] ?? 1;
}

export class DynamicsAccentAnalyzer {
  private readonly labels: string[];
  private readonly target: number[];
  private readonly category: PracticeCategoryId;
  private lastAttackCount = -1;
  private slot = 0;
  private completedCycles = 0;
  private rawLevels: number[] = [];
  private points: DynamicsPoint[] = [];
  private snapshot: DynamicsSnapshot;

  constructor(options: DynamicsOptions) {
    this.category = options.category;
    this.labels = labelsFromPattern(options.pattern);
    this.target = targetFor(options.category, this.labels);
    this.snapshot = this.waiting(Date.now());
  }

  reset(capturedAt = Date.now()) {
    this.lastAttackCount = -1;
    this.slot = 0;
    this.completedCycles = 0;
    this.rawLevels = [];
    this.points = [];
    this.snapshot = this.waiting(capturedAt);
    return this.snapshot;
  }

  getSnapshot() {
    return this.snapshot;
  }

  addReading(reading: NativeAudioReading, capturedAt = Date.now()) {
    if (!reading.running || reading.attackCount <= 0 || reading.attackCount === this.lastAttackCount) {
      return null;
    }
    this.lastAttackCount = reading.attackCount;
    const raw = Math.max(reading.rms, reading.peakAmplitude * 0.55, reading.attackStrength * 0.32);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    this.rawLevels.push(raw);
    while (this.rawLevels.length > 32) this.rawLevels.shift();
    const reference = Math.max(0.0001, percentile(this.rawLevels, 0.82));
    const actual = clamp(raw / reference, 0.04, 1.20);
    const currentSlot = this.slot % this.labels.length;
    this.points.push({
      id: `dynamics-${capturedAt}-${reading.attackCount}`,
      capturedAt,
      slot: currentSlot,
      label: this.labels[currentSlot] ?? String(currentSlot + 1),
      actual,
      target: this.target[currentSlot] ?? 0.7,
      clipped: reading.clippingRatio >= 0.025,
    });
    while (this.points.length > Math.max(16, this.labels.length * 2)) this.points.shift();
    this.slot += 1;

    if (this.slot % this.labels.length !== 0) {
      this.snapshot = {
        ...this.snapshot,
        capturedAt,
        points: [...this.points],
        confidencePercent: Math.min(88, 35 + this.points.length * 4),
      };
      return this.snapshot;
    }

    this.completedCycles += 1;
    this.snapshot = this.evaluate(capturedAt);
    return this.snapshot;
  }

  private evaluate(capturedAt: number): DynamicsSnapshot {
    const cycle = this.points.slice(-this.labels.length);
    const clipped = cycle.filter((point) => point.clipped).length;
    const errors = cycle.map((point) => Math.abs(point.actual - point.target));
    const accentIndices = this.target
      .map((value, index) => ({ value, index }))
      .filter((item) => item.value >= 0.88)
      .map((item) => item.index);
    const weakIndices = this.target
      .map((value, index) => ({ value, index }))
      .filter((item) => item.value <= 0.66)
      .map((item) => item.index);
    const accentActual = mean(cycle.filter((point) => accentIndices.includes(point.slot)).map((point) => point.actual));
    const weakActual = mean(cycle.filter((point) => weakIndices.includes(point.slot)).map((point) => point.actual));
    const accentContrast = accentActual - weakActual;
    const variation = standardDeviation(cycle.map((point) => point.actual));
    const evenness = clamp(100 - variation * 115, 0, 100);
    const accentMatch = clamp(100 - mean(errors) * 125, 0, 100);
    const upstrokes = cycle.filter((point) => point.label === 'U');
    const downstrokes = cycle.filter((point) => point.label === 'D');
    const upAverage = mean(upstrokes.map((point) => point.actual));
    const downAverage = mean(downstrokes.map((point) => point.actual));

    if (clipped > 0) {
      return this.result(
        capturedAt,
        'clipping',
        '소리가 찌그러져 강약 비교가 어렵습니다',
        `${cycle.length}번 중 ${clipped}번의 어택이 마이크 입력 한계를 넘었습니다.`,
        '기타·앰프 볼륨을 조금 낮추거나 휴대폰을 멀리 두고 같은 패턴을 다시 연주하세요.',
        '약한 스트럼 4회와 보통 스트럼 4회를 번갈아 치며 파형 꼭대기가 잘리지 않게 맞추세요.',
        accentMatch,
        evenness,
      );
    }

    if (downstrokes.length >= 2 && upstrokes.length >= 2 && upAverage < downAverage * 0.58) {
      return this.result(
        capturedAt,
        'weak-upstroke',
        '업스트로크가 사라져 리듬이 한쪽으로 기웁니다',
        `다운 평균 ${Math.round(downAverage * 100)}%, 업 평균 ${Math.round(upAverage * 100)}%입니다.`,
        '업스트로크는 줄을 깊게 긁지 말고 1~3번 줄을 짧게 통과하되 소리가 들릴 만큼만 유지하세요.',
        '업스트로크 단독 8회 후 다운·업 8회를 연결하고 두 막대의 차이를 35% 안으로 줄이세요.',
        accentMatch,
        evenness,
      );
    }

    if (accentIndices.length && accentContrast < 0.12) {
      return this.result(
        capturedAt,
        'accent-missed',
        '강박과 약박의 차이가 작아 음악적 흐름이 없습니다',
        `강박과 약박의 평균 차이가 ${Math.round(accentContrast * 100)}%입니다.`,
        '강박을 더 세게 치기보다 약박의 동작 폭과 피크 깊이를 줄여 대비를 만드세요.',
        '강박 1회·약박 3회를 한 묶음으로 4세트 반복하고 목표선 안에 3세트 들어오게 하세요.',
        accentMatch,
        evenness,
      );
    }

    if (variation > 0.30 && mean(errors) > 0.22) {
      return this.result(
        capturedAt,
        'uneven-volume',
        '의도하지 않은 음량 튐이 반복됩니다',
        `최근 한 패턴의 음량 흔들림이 ${Math.round(variation * 100)}%입니다.`,
        '피크·손가락의 출발 높이, 줄 통과 깊이와 탄현 위치를 같은 범위로 유지하세요.',
        '같은 음 또는 같은 코드 8회를 연주해 실제 막대 6개 이상을 목표선 ±20% 안에 넣으세요.',
        accentMatch,
        evenness,
      );
    }

    if (variation < 0.08 && accentIndices.length) {
      return this.result(
        capturedAt,
        'flat-dynamics',
        '모든 음이 비슷해 강약 표현이 평평합니다',
        `한 패턴의 음량 변화가 ${Math.round(variation * 100)}%에 그쳤습니다.`,
        '강박을 억지로 크게 만들지 말고 약박을 작게 만들어 자연스러운 대비를 만드세요.',
        '목표 악센트 막대를 보며 강·약·중·약을 4세트 반복하세요.',
        accentMatch,
        evenness,
      );
    }

    return this.result(
      capturedAt,
      'stable',
      '강약과 악센트가 목표 흐름 안에 있습니다',
      `악센트 일치 ${Math.round(accentMatch)}% · 음량 안정 ${Math.round(evenness)}%입니다.`,
      '현재 탄현 위치와 동작 폭을 유지하면서 속도를 올려도 같은 강약 구조를 지키세요.',
      '같은 패턴을 2회 더 유지한 뒤 5 BPM 올려 비교하세요.',
      accentMatch,
      evenness,
    );
  }

  private result(
    capturedAt: number,
    issue: DynamicsIssueId,
    title: string,
    observation: string,
    correction: string,
    reinforcement: string,
    accentMatchPercent: number,
    evennessPercent: number,
  ): DynamicsSnapshot {
    return {
      capturedAt,
      points: [...this.points],
      issue,
      title,
      observation,
      correction,
      reinforcement,
      confidencePercent: Math.min(94, 54 + this.completedCycles * 8),
      accentMatchPercent: Math.round(accentMatchPercent),
      evennessPercent: Math.round(evennessPercent),
      completedCycles: this.completedCycles,
    };
  }

  private waiting(capturedAt: number): DynamicsSnapshot {
    return {
      capturedAt,
      points: [],
      issue: 'waiting',
      title: '강약 표본 대기',
      observation: '레슨을 시작하고 같은 패턴을 반복하면 실제 어택과 목표 악센트를 비교합니다.',
      correction: '마이크를 기타 또는 앰프 방향으로 두고 너무 크게 입력되지 않게 맞추세요.',
      reinforcement: '첫 패턴은 평소 세기로 연주해 개인 음량 기준을 만드세요.',
      confidencePercent: 0,
      accentMatchPercent: null,
      evennessPercent: null,
      completedCycles: 0,
    };
  }
}
