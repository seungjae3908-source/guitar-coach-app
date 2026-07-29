import type { NativeAudioReading } from '../modules/guitar-coach-audio';

export type SoundConsistencyMode = 'waiting' | 'same-note' | 'pattern';
export type SoundConsistencyIssueId =
  | 'clipping'
  | 'low-snr'
  | 'pitch-variation'
  | 'volume-variation'
  | 'attack-variation'
  | 'brightness-variation'
  | 'sustain-variation'
  | 'stable';

export type SoundConsistencySnapshot = {
  capturedAt: number;
  mode: SoundConsistencyMode;
  judgeable: boolean;
  score: number | null;
  confidencePercent: number;
  sampleCount: number;
  sameNoteSampleCount: number;
  noteLabel: string | null;
  volumeVariationPercent: number | null;
  attackVariationPercent: number | null;
  brightnessVariationPercent: number | null;
  sustainVariationPercent: number | null;
  pitchVariationCents: number | null;
  averageSignalToNoiseDb: number | null;
  averageSpectralCentroidHz: number | null;
  averageBrightnessRatio: number | null;
  averageSpectralFlatness: number | null;
  mainIssue: SoundConsistencyIssueId | null;
  title: string;
  instruction: string;
  evidence: string;
};

type AttackSample = {
  attackCount: number;
  capturedAt: number;
  peakRms: number;
  attackStrength: number;
  spectralCentroidHz: number;
  brightnessRatio: number;
  sustainRatio: number | null;
  noteNumber: number | null;
  pitchCents: number | null;
  pitchConfidence: number;
  signalToNoiseDb: number;
  spectralFlatness: number;
  clippingRatio: number;
};

type ActiveAttack = {
  attackCount: number;
  capturedAt: number;
  peakRms: number;
  attackStrength: number;
  centroids: number[];
  brightness: number[];
  sustains: number[];
  pitchMidi: number[];
  pitchConfidence: number[];
  signalToNoise: number[];
  flatness: number[];
  clipping: number[];
};

type Listener = (snapshot: SoundConsistencySnapshot) => void;

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const listeners = new Set<Listener>();
let liveAnalyzer = new SoundConsistencyAnalyzer();
let latestSnapshot = emptySoundConsistencySnapshot();
let lastPublishedAt = 0;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function trimmed(values: number[]) {
  if (values.length < 7) return values;
  return [...values].sort((a, b) => a - b).slice(1, -1);
}

function variationPercent(values: number[]) {
  const safe = trimmed(values.filter((value) => Number.isFinite(value) && value > 0));
  if (safe.length < 3) return null;
  return standardDeviation(safe) / Math.max(0.000001, mean(safe)) * 100;
}

function scoreFromVariation(value: number | null, freeRange: number, multiplier: number) {
  if (value == null) return null;
  return clamp(100 - Math.max(0, value - freeRange) * multiplier, 0, 100);
}

function midiFromFrequency(frequencyHz: number) {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) return null;
  return 69 + 12 * Math.log2(frequencyHz / 440);
}

function noteLabel(noteNumber: number | null) {
  if (noteNumber == null) return null;
  const rounded = Math.round(noteNumber);
  const name = NOTE_NAMES[(rounded % 12 + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return `${name}${octave}`;
}

function dominantNote(samples: AttackSample[]) {
  const counts = new Map<number, number>();
  samples.forEach((sample) => {
    if (sample.noteNumber == null || sample.pitchConfidence < 0.58) return;
    counts.set(sample.noteNumber, (counts.get(sample.noteNumber) ?? 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
}

export function emptySoundConsistencySnapshot(): SoundConsistencySnapshot {
  return {
    capturedAt: 0,
    mode: 'waiting',
    judgeable: false,
    score: null,
    confidencePercent: 0,
    sampleCount: 0,
    sameNoteSampleCount: 0,
    noteLabel: null,
    volumeVariationPercent: null,
    attackVariationPercent: null,
    brightnessVariationPercent: null,
    sustainVariationPercent: null,
    pitchVariationCents: null,
    averageSignalToNoiseDb: null,
    averageSpectralCentroidHz: null,
    averageBrightnessRatio: null,
    averageSpectralFlatness: null,
    mainIssue: null,
    title: '소리 표본 대기',
    instruction: '같은 음 또는 같은 짧은 패턴을 일정한 세기로 반복하세요.',
    evidence: '동일 음은 4회, 스트럼·코드 패턴은 6회 이상부터 판단합니다.',
  };
}

function guidanceFor(input: {
  issue: SoundConsistencyIssueId | null;
  mode: SoundConsistencyMode;
  note: string | null;
  volume: number | null;
  attack: number | null;
  brightness: number | null;
  sustain: number | null;
  pitch: number | null;
  snr: number | null;
  clipping: number;
}) {
  const prefix = input.mode === 'same-note' && input.note ? `${input.note} 반복에서 ` : '';
  switch (input.issue) {
    case 'clipping':
      return {
        title: '입력이 찌그러져 톤 비교가 어렵습니다',
        instruction: '앰프 또는 기타 볼륨을 낮추고 휴대폰을 조금 멀리 둔 뒤 다시 반복하세요.',
        evidence: `최근 클리핑 비율이 ${(input.clipping * 100).toFixed(1)}%입니다.`,
      };
    case 'low-snr':
      return {
        title: '주변 소음이 연주음을 덮고 있습니다',
        instruction: '메트로놈·TV·선풍기 소리를 줄이고 기타 또는 앰프 쪽으로 휴대폰 마이크를 향하게 하세요.',
        evidence: `평균 신호대잡음비가 ${Math.round(input.snr ?? 0)}dB로 정밀 비교 기준보다 낮습니다.`,
      };
    case 'pitch-variation':
      return {
        title: `${prefix}음정이 일정하지 않습니다`,
        instruction: '프렛 바로 뒤를 같은 압력으로 누르고, 불필요한 벤딩·손가락 흔들림 없이 음을 끝까지 유지하세요.',
        evidence: `반복 음정 표준편차가 약 ${Math.round(input.pitch ?? 0)}센트입니다.`,
      };
    case 'volume-variation':
      return {
        title: `${prefix}음량이 들쭉날쭉합니다`,
        instruction: '세게 치려 하지 말고 피크 또는 손가락이 줄을 통과하는 깊이와 이동 폭을 같게 만드세요.',
        evidence: `반복 음량 편차가 ${Math.round(input.volume ?? 0)}%입니다.`,
      };
    case 'attack-variation':
      return {
        title: `${prefix}첫 어택의 세기가 일정하지 않습니다`,
        instruction: '매번 같은 준비 높이에서 출발하고 피크 각도·손가락 접촉 깊이를 고정하세요.',
        evidence: `어택 세기 편차가 ${Math.round(input.attack ?? 0)}%입니다.`,
      };
    case 'brightness-variation':
      return {
        title: `${prefix}톤의 밝기가 매번 달라집니다`,
        instruction: '탄현 위치를 고정하고 피크 기울기와 노출량을 유지하세요. 브리지 쪽과 넥 쪽을 오가지 마세요.',
        evidence: `고역 비율·스펙트럼 중심 편차가 ${Math.round(input.brightness ?? 0)}%입니다.`,
      };
    case 'sustain-variation':
      return {
        title: `${prefix}음 길이와 감쇠가 일정하지 않습니다`,
        instruction: '왼손 압력을 너무 빨리 풀지 말고 다음 음 직전까지 같은 시간 동안 유지하세요.',
        evidence: `서스테인 편차가 ${Math.round(input.sustain ?? 0)}%입니다.`,
      };
    case 'stable':
      return {
        title: `${prefix}톤이 안정적으로 반복됩니다`,
        instruction: '현재 탄현 위치·피크 각도·왼손 압력·음 길이를 그대로 유지하세요.',
        evidence: '음량·어택·밝기·서스테인·음정이 현재 기준 범위 안에 있습니다.',
      };
    default:
      return {
        title: '소리 표본을 모으는 중입니다',
        instruction: '같은 음 또는 같은 짧은 패턴을 끊지 말고 반복하세요.',
        evidence: '마이크 신뢰도와 반복 횟수가 충족되면 항목별 편차를 표시합니다.',
      };
  }
}

export class SoundConsistencyAnalyzer {
  private readonly attacks: AttackSample[] = [];
  private active: ActiveAttack | null = null;
  private lastAttackCount = 0;

  reset() {
    this.attacks.length = 0;
    this.active = null;
    this.lastAttackCount = 0;
  }

  addReading(reading: NativeAudioReading, capturedAt = Date.now()) {
    if (!reading.running) return this.snapshot(capturedAt);

    if (reading.attackCount > 0 && reading.attackCount !== this.lastAttackCount) {
      this.finalizeActive();
      this.lastAttackCount = reading.attackCount;
      this.active = {
        attackCount: reading.attackCount,
        capturedAt,
        peakRms: Math.max(reading.rms, reading.peakAmplitude * 0.45),
        attackStrength: reading.attackStrength,
        centroids: [],
        brightness: [],
        sustains: [],
        pitchMidi: [],
        pitchConfidence: [],
        signalToNoise: [],
        flatness: [],
        clipping: [],
      };
    }

    const active = this.active;
    if (active && reading.attackCount === active.attackCount) {
      active.peakRms = Math.max(active.peakRms, reading.rms, reading.peakAmplitude * 0.45);
      active.attackStrength = Math.max(active.attackStrength, reading.attackStrength);
      if (reading.spectralCentroidHz > 0 && reading.millisecondsSinceAttack <= 260) active.centroids.push(reading.spectralCentroidHz);
      if (reading.brightnessRatio >= 0 && reading.millisecondsSinceAttack <= 260) active.brightness.push(reading.brightnessRatio);
      if (reading.millisecondsSinceAttack >= 180 && reading.millisecondsSinceAttack <= 650 && reading.envelopeRatio > 0) {
        active.sustains.push(reading.envelopeRatio);
      }
      if (reading.hasPitch && reading.pitchConfidence >= 0.52) {
        const midi = midiFromFrequency(reading.frequencyHz);
        if (midi != null) active.pitchMidi.push(midi);
        active.pitchConfidence.push(reading.pitchConfidence);
      }
      if (reading.signalToNoiseDb > 0) active.signalToNoise.push(reading.signalToNoiseDb);
      if (reading.spectralFlatness >= 0) active.flatness.push(reading.spectralFlatness);
      active.clipping.push(reading.clippingRatio);
    }

    return this.snapshot(capturedAt);
  }

  private finalizeActive() {
    const active = this.active;
    if (!active || active.peakRms <= 0) return;
    const pitchMidi = active.pitchMidi.length ? median(active.pitchMidi) : null;
    const roundedNote = pitchMidi == null ? null : Math.round(pitchMidi);
    this.attacks.push({
      attackCount: active.attackCount,
      capturedAt: active.capturedAt,
      peakRms: active.peakRms,
      attackStrength: active.attackStrength,
      spectralCentroidHz: active.centroids.length ? median(active.centroids) : 0,
      brightnessRatio: active.brightness.length ? median(active.brightness) : 0,
      sustainRatio: active.sustains.length ? median(active.sustains) : null,
      noteNumber: roundedNote,
      pitchCents: pitchMidi == null || roundedNote == null ? null : (pitchMidi - roundedNote) * 100,
      pitchConfidence: active.pitchConfidence.length ? mean(active.pitchConfidence) : 0,
      signalToNoiseDb: active.signalToNoise.length ? median(active.signalToNoise) : 0,
      spectralFlatness: active.flatness.length ? median(active.flatness) : 0,
      clippingRatio: active.clipping.length ? Math.max(...active.clipping) : 0,
    });
    while (this.attacks.length > 48) this.attacks.shift();
    this.active = null;
  }

  snapshot(capturedAt = Date.now()): SoundConsistencySnapshot {
    const recent = this.attacks.slice(-16);
    const dominant = dominantNote(recent);
    const sameNote = dominant
      ? recent.filter((sample) => sample.noteNumber === dominant[0] && sample.pitchConfidence >= 0.58)
      : [];
    const mode: SoundConsistencyMode = sameNote.length >= 4 ? 'same-note' : recent.length >= 6 ? 'pattern' : 'waiting';
    const selected = mode === 'same-note' ? sameNote.slice(-10) : mode === 'pattern' ? recent.slice(-12) : recent;
    const averageSnr = selected.length ? mean(selected.map((sample) => sample.signalToNoiseDb)) : null;
    const maxClipping = selected.length ? Math.max(...selected.map((sample) => sample.clippingRatio)) : 0;
    const volume = variationPercent(selected.map((sample) => sample.peakRms));
    const attack = variationPercent(selected.map((sample) => sample.attackStrength));
    const brightness = variationPercent(selected.map((sample) => sample.brightnessRatio).filter((value) => value > 0.001));
    const sustainValues = selected.map((sample) => sample.sustainRatio).filter((value): value is number => value != null && value > 0);
    const sustain = mode === 'same-note' ? variationPercent(sustainValues) : null;
    const pitchValues = selected.map((sample) => sample.pitchCents).filter((value): value is number => value != null);
    const pitch = mode === 'same-note' && pitchValues.length >= 4 ? standardDeviation(trimmed(pitchValues)) : null;
    const centroid = selected.length ? mean(selected.map((sample) => sample.spectralCentroidHz).filter((value) => value > 0)) : null;
    const brightnessRatio = selected.length ? mean(selected.map((sample) => sample.brightnessRatio).filter((value) => value >= 0)) : null;
    const flatness = selected.length ? mean(selected.map((sample) => sample.spectralFlatness).filter((value) => value >= 0)) : null;

    const countRequired = mode === 'same-note' ? 4 : 6;
    const sampleReady = mode !== 'waiting' && selected.length >= countRequired;
    const inputReady = (averageSnr ?? 0) >= 12 && maxClipping < 0.015;
    const judgeable = sampleReady && inputReady;

    const componentScores = [
      { value: scoreFromVariation(volume, 6, 3.0), weight: 0.24 },
      { value: scoreFromVariation(attack, 8, 2.7), weight: 0.2 },
      { value: scoreFromVariation(brightness, 8, 2.5), weight: 0.22 },
      { value: scoreFromVariation(sustain, 12, 2.0), weight: 0.16 },
      { value: pitch == null ? null : clamp(100 - Math.max(0, pitch - 4) * 3.2, 0, 100), weight: 0.18 },
    ].filter((item): item is { value: number; weight: number } => item.value != null);
    const weightTotal = componentScores.reduce((sum, item) => sum + item.weight, 0);
    const score = judgeable && weightTotal > 0
      ? Math.round(componentScores.reduce((sum, item) => sum + item.value * item.weight, 0) / weightTotal)
      : null;

    const countConfidence = clamp(selected.length / 10, 0, 1);
    const snrConfidence = clamp(((averageSnr ?? 0) - 8) / 24, 0, 1);
    const pitchConfidence = mode === 'same-note'
      ? clamp(mean(selected.map((sample) => sample.pitchConfidence)), 0, 1)
      : 0.72;
    const confidencePercent = Math.round(clamp((countConfidence * 0.42 + snrConfidence * 0.33 + pitchConfidence * 0.25) * 100, 0, 100));

    let mainIssue: SoundConsistencyIssueId | null = null;
    if (sampleReady && maxClipping >= 0.015) mainIssue = 'clipping';
    else if (sampleReady && (averageSnr ?? 0) < 12) mainIssue = 'low-snr';
    else if (judgeable && pitch != null && pitch > 14) mainIssue = 'pitch-variation';
    else if (judgeable && volume != null && volume > 18) mainIssue = 'volume-variation';
    else if (judgeable && attack != null && attack > 20) mainIssue = 'attack-variation';
    else if (judgeable && brightness != null && brightness > 18) mainIssue = 'brightness-variation';
    else if (judgeable && sustain != null && sustain > 28) mainIssue = 'sustain-variation';
    else if (judgeable) mainIssue = 'stable';

    const note = mode === 'same-note' ? noteLabel(dominant?.[0] ?? null) : null;
    const guidance = guidanceFor({
      issue: mainIssue,
      mode,
      note,
      volume,
      attack,
      brightness,
      sustain,
      pitch,
      snr: averageSnr,
      clipping: maxClipping,
    });

    return {
      capturedAt,
      mode,
      judgeable,
      score,
      confidencePercent,
      sampleCount: selected.length,
      sameNoteSampleCount: sameNote.length,
      noteLabel: note,
      volumeVariationPercent: volume == null ? null : Math.round(volume),
      attackVariationPercent: attack == null ? null : Math.round(attack),
      brightnessVariationPercent: brightness == null ? null : Math.round(brightness),
      sustainVariationPercent: sustain == null ? null : Math.round(sustain),
      pitchVariationCents: pitch == null ? null : Math.round(pitch),
      averageSignalToNoiseDb: averageSnr == null ? null : Math.round(averageSnr),
      averageSpectralCentroidHz: centroid == null || Number.isNaN(centroid) ? null : Math.round(centroid),
      averageBrightnessRatio: brightnessRatio == null || Number.isNaN(brightnessRatio) ? null : Math.round(brightnessRatio * 100),
      averageSpectralFlatness: flatness == null || Number.isNaN(flatness) ? null : Math.round(flatness * 100),
      mainIssue,
      ...guidance,
    };
  }
}

export function resetLiveSoundConsistency() {
  liveAnalyzer = new SoundConsistencyAnalyzer();
  latestSnapshot = emptySoundConsistencySnapshot();
  lastPublishedAt = 0;
  listeners.forEach((listener) => listener(latestSnapshot));
}

export function addLiveSoundReading(reading: NativeAudioReading, capturedAt = Date.now()) {
  latestSnapshot = liveAnalyzer.addReading(reading, capturedAt);
  if (capturedAt - lastPublishedAt >= 180 || latestSnapshot.mainIssue === 'clipping') {
    lastPublishedAt = capturedAt;
    listeners.forEach((listener) => {
      try {
        listener(latestSnapshot);
      } catch {
        // 한 화면의 표시 오류가 분석 스트림을 중단하지 않게 합니다.
      }
    });
  }
  return latestSnapshot;
}

export function getLatestSoundConsistency() {
  return latestSnapshot;
}

export function subscribeSoundConsistency(listener: Listener) {
  listeners.add(listener);
  listener(latestSnapshot);
  return () => {
    listeners.delete(listener);
  };
}
